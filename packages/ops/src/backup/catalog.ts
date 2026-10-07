import type { BackupStore } from "./store";

/** Reading what's in the backup store. Kept free of database code so the web app's health check can use it. */
export interface BackupManifest {
  version: 1;
  createdAt: string;
  /** Store key of the encrypted dump. */
  file: string;
  bytes: number;
  /** sha256 of the encrypted file as stored. */
  sha256: string;
  database: string;
  serverVersion: string;
  pgDumpVersion: string;
  encryption: "aes-256-gcm";
  keyId: string;
  /** Exact row counts per table, from the same snapshot as the dump. */
  counts: Record<string, number>;
  durationMs: number;
}

export interface BackupEntry {
  file: string;
  manifestKey: string;
  createdAt: Date;
  size: number;
}

export interface RestoreTestResult {
  ok: boolean;
  testedAt: string;
  backup: string;
  backupCreatedAt?: string;
  tables: number;
  rows: number;
  mismatches: { table: string; expected: number | null; restored: number | null }[];
  durationMs: number;
  error?: string;
}

export const DUMP_SUFFIX = ".dump.enc";
export const MANIFEST_SUFFIX = ".manifest.json";
export const statusKey = (prefix: string) => `${prefix}status/last-restore-test.json`;

/** Complete backups (dump and manifest both present), newest first. */
export async function listBackups(store: BackupStore, prefix: string): Promise<BackupEntry[]> {
  const objects = await store.list(prefix);
  const manifests = new Set(objects.filter((o) => o.key.endsWith(MANIFEST_SUFFIX)).map((o) => o.key));
  return objects
    .filter((o) => o.key.endsWith(DUMP_SUFFIX))
    .map((o) => ({ file: o.key, manifestKey: o.key.slice(0, -DUMP_SUFFIX.length) + MANIFEST_SUFFIX, createdAt: o.lastModified, size: o.size }))
    .filter((b) => manifests.has(b.manifestKey))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.file.localeCompare(a.file));
}

export async function lastRestoreTest(store: BackupStore, prefix: string): Promise<RestoreTestResult | null> {
  try {
    return JSON.parse(await store.getText(statusKey(prefix))) as RestoreTestResult;
  } catch {
    return null;
  }
}
