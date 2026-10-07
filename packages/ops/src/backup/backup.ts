import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BackupConfig } from "./config";
import { decryptFile, encryptFile, keyId, sha256File } from "./crypto";
import { countRows, dumpDatabase, listPublicTables, pgToolVersion, resetScratchDatabase, restoreDump } from "./postgres";
import { DUMP_SUFFIX, listBackups, MANIFEST_SUFFIX, statusKey, type BackupEntry, type BackupManifest, type RestoreTestResult } from "./catalog";
import type { BackupStore } from "./store";

const stamp = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");

async function withTempDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), "applyance-backup-"));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Dumps, encrypts and uploads the database, then applies retention. */
export async function runBackup(config: BackupConfig, now = new Date()): Promise<BackupManifest> {
  const started = Date.now();
  const base = `${config.prefix}${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/applyance-${stamp(now)}`;
  const manifest = await withTempDir(async (dir) => {
    const plain = join(dir, "db.dump");
    const encrypted = join(dir, "db.dump.enc");
    const pgDumpVersion = await pgToolVersion("pg_dump");
    const dump = await dumpDatabase(config.databaseUrl, plain);
    const { bytes, sha256 } = await encryptFile(plain, encrypted, config.key);
    await rm(plain);
    const file = `${base}${DUMP_SUFFIX}`;
    await config.store.upload(file, encrypted);
    const m: BackupManifest = {
      version: 1,
      createdAt: now.toISOString(),
      file,
      bytes,
      sha256,
      database: dump.database,
      serverVersion: dump.serverVersion,
      pgDumpVersion,
      encryption: "aes-256-gcm",
      keyId: keyId(config.key).toString("hex"),
      counts: dump.counts,
      durationMs: Date.now() - started,
    };
    // Written last: a backup only counts once its manifest exists.
    await config.store.putText(`${base}${MANIFEST_SUFFIX}`, JSON.stringify(m, null, 2));
    return m;
  });
  await pruneBackups(config, now);
  return manifest;
}

/** Deletes backups older than the retention period, always keeping the newest `keepMin`. */
export async function pruneBackups(config: BackupConfig, now = new Date()): Promise<string[]> {
  const backups = await listBackups(config.store, config.prefix);
  const cutoff = now.getTime() - config.retentionDays * 86_400_000;
  const removed: string[] = [];
  for (const b of backups.slice(config.keepMin)) {
    if (b.createdAt.getTime() >= cutoff) continue;
    await config.store.delete(b.manifestKey);
    await config.store.delete(b.file);
    removed.push(b.file);
  }
  return removed;
}

async function readManifest(store: BackupStore, entry: BackupEntry): Promise<BackupManifest> {
  const m = JSON.parse(await store.getText(entry.manifestKey)) as BackupManifest;
  if (m.version !== 1 || m.file !== entry.file) throw new Error(`Manifest ${entry.manifestKey} doesn't match its backup`);
  return m;
}

async function pick(store: BackupStore, prefix: string, file?: string): Promise<BackupEntry> {
  const backups = await listBackups(store, prefix);
  if (!backups.length) throw new Error("No complete backups found");
  if (!file) return backups[0]!;
  const match = backups.find((b) => b.file === file || b.file.endsWith(`/${file}`));
  if (!match) throw new Error(`Backup ${file} not found`);
  return match;
}

/** Downloads a backup, checks it against its manifest and decrypts it to a plain dump file in `dir`. */
async function fetchAndDecrypt(config: BackupConfig, entry: BackupEntry, dir: string): Promise<{ manifest: BackupManifest; dumpFile: string }> {
  const manifest = await readManifest(config.store, entry);
  const encrypted = join(dir, "backup.enc");
  const dumpFile = join(dir, "backup.dump");
  await config.store.download(entry.file, encrypted);
  if ((await sha256File(encrypted)) !== manifest.sha256) throw new Error(`Backup ${entry.file} doesn't match the checksum in its manifest`);
  await decryptFile(encrypted, dumpFile, config.keys);
  await rm(encrypted);
  return { manifest, dumpFile };
}

function compareCounts(expected: Record<string, number>, restored: Record<string, number>) {
  const mismatches: RestoreTestResult["mismatches"] = [];
  for (const table of new Set([...Object.keys(expected), ...Object.keys(restored)])) {
    const e = expected[table] ?? null;
    const r = restored[table] ?? null;
    if (e !== r) mismatches.push({ table, expected: e, restored: r });
  }
  return mismatches;
}

/**
 * The restore test: restores a backup (the newest by default) into the
 * scratch database and checks every table has exactly the rows the backup
 * recorded. The result is saved next to the backups for the health check.
 */
export async function testRestore(config: BackupConfig, options: { file?: string } = {}): Promise<RestoreTestResult> {
  if (!config.verifyDatabaseUrl) throw new Error("Set BACKUP_VERIFY_DATABASE_URL to an empty scratch database to run the restore test");
  const scratch = config.verifyDatabaseUrl;
  const started = Date.now();
  let result: RestoreTestResult;
  let entry: BackupEntry | undefined;
  try {
    entry = await pick(config.store, config.prefix, options.file);
    const chosen = entry;
    result = await withTempDir(async (dir) => {
      const { manifest, dumpFile } = await fetchAndDecrypt(config, chosen, dir);
      await resetScratchDatabase(scratch);
      await restoreDump(scratch, dumpFile);
      const restored = await countRows(scratch);
      const mismatches = compareCounts(manifest.counts, restored);
      return {
        ok: mismatches.length === 0,
        testedAt: new Date().toISOString(),
        backup: chosen.file,
        backupCreatedAt: manifest.createdAt,
        tables: Object.keys(restored).length,
        rows: Object.values(restored).reduce((a, b) => a + b, 0),
        mismatches,
        durationMs: Date.now() - started,
        ...(mismatches.length ? { error: `${mismatches.length} table(s) restored with the wrong number of rows` } : {}),
      };
    });
  } catch (err) {
    result = {
      ok: false,
      testedAt: new Date().toISOString(),
      backup: entry?.file ?? "",
      tables: 0,
      rows: 0,
      mismatches: [],
      durationMs: Date.now() - started,
      error: (err as Error).message,
    };
  } finally {
    // Don't leave a copy of user data sitting in the scratch database.
    await resetScratchDatabase(scratch).catch(() => undefined);
  }
  await config.store.putText(statusKey(config.prefix), JSON.stringify(result, null, 2)).catch(() => undefined);
  return result;
}

/**
 * Disaster recovery: restores a backup into `targetUrl`, which must be an
 * empty database (create a new one; never restore over live data).
 */
export async function restoreBackup(config: BackupConfig, targetUrl: string, options: { file?: string } = {}): Promise<{ manifest: BackupManifest; counts: Record<string, number> }> {
  const existing = await listPublicTables(targetUrl);
  if (existing.length) {
    throw new Error(`The target database already has ${existing.length} table(s). Restore into a new, empty database, then point DATABASE_URL at it`);
  }
  const entry = await pick(config.store, config.prefix, options.file);
  return withTempDir(async (dir) => {
    const { manifest, dumpFile } = await fetchAndDecrypt(config, entry, dir);
    await restoreDump(targetUrl, dumpFile);
    const counts = await countRows(targetUrl);
    const mismatches = compareCounts(manifest.counts, counts);
    if (mismatches.length) throw new Error(`Restored, but ${mismatches.length} table(s) have the wrong number of rows: ${mismatches.map((m) => m.table).join(", ")}`);
    return { manifest, counts };
  });
}
