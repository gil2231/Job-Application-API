import { S3Client } from "@aws-sdk/client-s3";
import { parseKey } from "./crypto";
import { LocalBackupStore, S3BackupStore, type BackupStore } from "./store";

export interface BackupConfig {
  databaseUrl: string;
  store: BackupStore;
  /** Key new backups are encrypted with. */
  key: Buffer;
  /** Every key a restore may use: the current one first, then retired ones. */
  keys: Buffer[];
  prefix: string;
  retentionDays: number;
  /** Never delete the newest N backups, however old they are. */
  keepMin: number;
  schedule: string;
  verifySchedule: string;
  timezone: string;
  /** Scratch database the weekly restore test restores into. It is wiped each time. */
  verifyDatabaseUrl?: string;
  /** The health check fails when the newest backup is older than this. */
  maxAgeHours: number;
}

const int = (v: string | undefined, fallback: number, min = 0) => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
};

/** True when a backup destination and key are configured, i.e. backups are expected to run. */
export function backupsConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(env.BACKUP_ENCRYPTION_KEY && (env.BACKUP_S3_BUCKET || env.BACKUP_LOCAL_DIR));
}

export function createBackupStore(env: NodeJS.ProcessEnv = process.env): BackupStore {
  if (env.BACKUP_S3_BUCKET) {
    // Backup credentials fall back to the document storage ones, but a separate
    // bucket (ideally a separate account or provider) is what makes a backup safe.
    const accessKeyId = env.BACKUP_S3_ACCESS_KEY_ID || env.S3_ACCESS_KEY_ID;
    const secretAccessKey = env.BACKUP_S3_SECRET_ACCESS_KEY || env.S3_SECRET_ACCESS_KEY;
    const client = new S3Client({
      region: env.BACKUP_S3_REGION || env.S3_REGION || "us-east-1",
      endpoint: env.BACKUP_S3_ENDPOINT || env.S3_ENDPOINT || undefined,
      forcePathStyle: (env.BACKUP_S3_FORCE_PATH_STYLE || env.S3_FORCE_PATH_STYLE) === "true",
      credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    });
    return new S3BackupStore(client, env.BACKUP_S3_BUCKET);
  }
  if (env.BACKUP_LOCAL_DIR) return new LocalBackupStore(env.BACKUP_LOCAL_DIR);
  throw new Error("Set BACKUP_S3_BUCKET (or BACKUP_LOCAL_DIR for local testing) to choose where backups go");
}

export function loadBackupConfig(env: NodeJS.ProcessEnv = process.env): BackupConfig {
  // pg_dump needs a direct connection; a pooled DATABASE_URL can be overridden for backups.
  const databaseUrl = env.BACKUP_DATABASE_URL || env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL is not set");
  if (!env.BACKUP_ENCRYPTION_KEY) throw new Error("BACKUP_ENCRYPTION_KEY is not set (generate one with: openssl rand -base64 32, and keep a copy in your password manager)");
  const key = parseKey(env.BACKUP_ENCRYPTION_KEY);
  if (env.DATA_ENCRYPTION_KEY && env.DATA_ENCRYPTION_KEY.trim() === env.BACKUP_ENCRYPTION_KEY.trim()) {
    throw new Error("BACKUP_ENCRYPTION_KEY must be different from DATA_ENCRYPTION_KEY");
  }
  const previous = (env.BACKUP_PREVIOUS_ENCRYPTION_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => parseKey(k, "BACKUP_PREVIOUS_ENCRYPTION_KEYS"));
  const verifyDatabaseUrl = env.BACKUP_VERIFY_DATABASE_URL || undefined;
  if (verifyDatabaseUrl && [databaseUrl, env.DATABASE_URL].some((u) => u && sameDatabase(verifyDatabaseUrl, u))) {
    throw new Error("BACKUP_VERIFY_DATABASE_URL points at the live database. It must be a separate, empty scratch database because the restore test wipes it");
  }
  const prefix = (env.BACKUP_PREFIX ?? "database/").replace(/^\/+/, "");
  return {
    databaseUrl,
    store: createBackupStore(env),
    key,
    keys: [key, ...previous],
    prefix: prefix && !prefix.endsWith("/") ? `${prefix}/` : prefix,
    retentionDays: int(env.BACKUP_RETENTION_DAYS, 30, 1),
    keepMin: int(env.BACKUP_KEEP_MIN, 7, 1),
    schedule: env.BACKUP_SCHEDULE || "0 3 * * *",
    verifySchedule: env.BACKUP_VERIFY_SCHEDULE || "30 4 * * 0",
    timezone: env.BACKUP_TIMEZONE || "UTC",
    verifyDatabaseUrl,
    maxAgeHours: int(env.BACKUP_MAX_AGE_HOURS, 26, 1),
  };
}

/** Same host, port and database name, whatever the credentials or options. */
export function sameDatabase(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    const host = (u: URL) => (u.hostname === "127.0.0.1" || u.hostname === "::1" ? "localhost" : u.hostname.toLowerCase());
    return host(ua) === host(ub) && (ua.port || "5432") === (ub.port || "5432") && ua.pathname === ub.pathname;
  } catch {
    return a === b;
  }
}
