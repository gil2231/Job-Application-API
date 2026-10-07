import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pruneBackups, restoreBackup, runBackup, testRestore } from "../src/backup/backup";
import { listBackups } from "../src/backup/catalog";
import { loadBackupConfig, sameDatabase, type BackupConfig } from "../src/backup/config";
import { backupHealthChecks, resetHealthCache } from "../src/health";

/**
 * End-to-end backup and restore against a real Postgres: three throwaway
 * databases next to TEST_DATABASE_URL (live copy, restore-test scratch, and
 * an empty disaster-recovery target).
 */
const baseUrl = process.env.TEST_DATABASE_URL;
const hasPgDump = (() => {
  try {
    execFileSync("pg_dump", ["--version"]);
    return true;
  } catch {
    return false;
  }
})();

const dbUrl = (name: string) => {
  const u = new URL(baseUrl!);
  u.pathname = `/${name}`;
  return u.toString();
};
const SOURCE = "applyance_ops_test_source";
const SCRATCH = "applyance_ops_test_scratch";
const TARGET = "applyance_ops_test_target";

async function admin<T>(fn: (c: pg.Client) => Promise<T>, url = baseUrl!): Promise<T> {
  const u = new URL(url);
  u.search = "";
  const c = new pg.Client({ connectionString: u.toString() });
  await c.connect();
  try {
    return await fn(c);
  } finally {
    await c.end();
  }
}

async function recreate(name: string) {
  await admin(async (c) => {
    await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await c.query(`CREATE DATABASE ${name}`);
  });
}

let dir: string;
let config: BackupConfig;
let env: NodeJS.ProcessEnv;

describe.skipIf(!baseUrl || !hasPgDump)("database backups", () => {
  beforeAll(async () => {
    await Promise.all([recreate(SOURCE), recreate(SCRATCH), recreate(TARGET)]);
    await admin(async (c) => {
      await c.query(`CREATE TYPE "Status" AS ENUM ('QUEUED', 'SUBMITTED')`);
      await c.query(`CREATE TABLE "User" (id text PRIMARY KEY, email text NOT NULL UNIQUE, "createdAt" timestamptz NOT NULL DEFAULT now())`);
      await c.query(`CREATE TABLE "Application" (id serial PRIMARY KEY, "userId" text NOT NULL REFERENCES "User"(id), status "Status" NOT NULL, notes text)`);
      await c.query(`INSERT INTO "User" (id, email) SELECT 'u' || g, 'user' || g || '@example.com' FROM generate_series(1, 250) g`);
      await c.query(`INSERT INTO "Application" ("userId", status, notes) SELECT 'u' || (1 + g % 250), CASE WHEN g % 2 = 0 THEN 'QUEUED'::"Status" ELSE 'SUBMITTED'::"Status" END, repeat('note ', 20) FROM generate_series(1, 4000) g`);
    }, dbUrl(SOURCE));
    dir = await mkdtemp(join(tmpdir(), "ops-backup-"));
    env = {
      DATABASE_URL: `${dbUrl(SOURCE)}?schema=public`,
      BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
      BACKUP_LOCAL_DIR: dir,
      BACKUP_VERIFY_DATABASE_URL: dbUrl(SCRATCH),
    };
    config = loadBackupConfig(env);
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
    await admin(async (c) => {
      for (const name of [SOURCE, SCRATCH, TARGET]) await c.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    });
  });

  beforeEach(() => resetHealthCache());

  it("backs up, encrypts and records exact row counts", async () => {
    const m = await runBackup(config);
    expect(m.counts).toEqual({ User: 250, Application: 4000 });
    expect(m.file).toMatch(/^database\/\d{4}\/\d{2}\/applyance-\d{8}T\d{6}Z\.dump\.enc$/);
    const stored = await readFile(join(dir, m.file));
    expect(stored.includes(Buffer.from("user1@example.com"))).toBe(false);
    expect(stored.subarray(0, 8).toString()).toBe("APLBK001");
    expect((await listBackups(config.store, config.prefix))[0]?.file).toBe(m.file);
  });

  it("passes the restore test and leaves the scratch database empty", async () => {
    const result = await testRestore(config);
    expect(result).toMatchObject({ ok: true, tables: 2, rows: 4250, mismatches: [] });
    const left = await admin((c) => c.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname = 'public'"), dbUrl(SCRATCH));
    expect(left.rows[0].n).toBe(0);
    const health = await backupHealthChecks(env);
    expect(health.backups.state).toBe("ok");
    expect(health.restoreTest.state).toBe("ok");
  });

  it("fails the restore test when a backup was tampered with, and the health check reports it", async () => {
    const [latest] = await listBackups(config.store, config.prefix);
    const path = join(dir, latest!.file);
    const original = await readFile(path);
    const bad = Buffer.from(original);
    bad[bad.length - 100] = bad[bad.length - 100]! ^ 0xff;
    await writeFile(path, bad);
    const result = await testRestore(config);
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/checksum/);
    expect((await backupHealthChecks(env)).restoreTest.state).toBe("fail");
    await writeFile(path, original);
  });

  it("records counts from the dump's own snapshot while the app keeps writing", async () => {
    let writing = true;
    const writer = admin(async (c) => {
      while (writing) await c.query(`INSERT INTO "Application" ("userId", status) VALUES ('u1', 'QUEUED')`);
    }, dbUrl(SOURCE));
    let manifest;
    try {
      // Let some writes land first so the dump overlaps them.
      await new Promise((r) => setTimeout(r, 50));
      manifest = await runBackup(config, new Date(Date.now() + 500));
    } finally {
      writing = false;
      await writer;
    }
    expect(manifest.counts.Application).toBeGreaterThan(4000);
    const result = await testRestore(config);
    expect(result.ok).toBe(true);
    await admin((c) => c.query(`DELETE FROM "Application" WHERE id > 4000`), dbUrl(SOURCE));
    // Drop this backup so the next tests see only the first one.
    const [latest, ...rest] = await listBackups(config.store, config.prefix);
    await rm(join(dir, latest!.file));
    await rm(join(dir, latest!.manifestKey));
    expect(rest.length).toBe(1);
  });

  it("restores into an empty database and refuses one that has data", async () => {
    const { counts } = await restoreBackup(config, dbUrl(TARGET));
    expect(counts).toEqual({ User: 250, Application: 4000 });
    const sample = await admin((c) => c.query(`SELECT email FROM "User" WHERE id = 'u7'`), dbUrl(TARGET));
    expect(sample.rows[0].email).toBe("user7@example.com");
    await expect(restoreBackup(config, dbUrl(TARGET))).rejects.toThrow(/already has 2 table/);
  });

  it("keeps the newest backups and deletes ones past retention", async () => {
    await runBackup(config, new Date(Date.now() + 1000));
    const all = await listBackups(config.store, config.prefix);
    expect(all.length).toBe(2);
    const old = new Date(Date.now() - 40 * 86_400_000);
    for (const b of all.slice(1)) await utimes(join(dir, b.file), old, old);
    expect(await pruneBackups({ ...config, keepMin: 1 })).toEqual([all[1]!.file]);
    expect((await listBackups(config.store, config.prefix)).map((b) => b.file)).toEqual([all[0]!.file]);
  });

  it("reports a stale backup as failing", async () => {
    const [latest] = await listBackups(config.store, config.prefix);
    const old = new Date(Date.now() - 30 * 3_600_000);
    await utimes(join(dir, latest!.file), old, old);
    expect((await backupHealthChecks(env)).backups).toEqual({ state: "fail", note: "last backup 30h ago" });
  });

  it("refuses a restore-test database that is the live one", () => {
    expect(() => loadBackupConfig({ ...env, BACKUP_VERIFY_DATABASE_URL: dbUrl(SOURCE).replace("localhost", "127.0.0.1") })).toThrow(/live database/);
    expect(sameDatabase("postgresql://a:b@db:5432/app?schema=x", "postgres://c@db/app")).toBe(true);
    expect(sameDatabase("postgresql://a@db/app", "postgresql://a@db/app_scratch")).toBe(false);
  });

  it("refuses to share a key with DATA_ENCRYPTION_KEY", () => {
    expect(() => loadBackupConfig({ ...env, DATA_ENCRYPTION_KEY: env.BACKUP_ENCRYPTION_KEY })).toThrow(/different/);
  });
});
