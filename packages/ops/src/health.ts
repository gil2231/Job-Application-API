import { createBackupStore } from "./backup/config";
import { lastRestoreTest, listBackups } from "./backup/catalog";

/**
 * Readiness checks for uptime monitoring. Each component reports ok, fail
 * or off (not set up); the overall status fails if any component fails, so
 * one uptime monitor on the readiness URL catches a stopped worker or a
 * missed backup as well as a down database. Responses carry no error text.
 */
export type ComponentState = "ok" | "fail" | "off";

export interface ComponentResult {
  state: ComponentState;
  /** Short, non-sensitive detail, e.g. "last backup 3h ago". */
  note?: string;
}

export interface HealthReport {
  status: "ok" | "fail";
  checkedAt: string;
  components: Record<string, ComponentResult>;
}

export type HealthCheck = () => Promise<ComponentResult>;

export async function runHealthChecks(checks: Record<string, HealthCheck>, timeoutMs = 4000): Promise<HealthReport> {
  const entries = await Promise.all(
    Object.entries(checks).map(async ([name, check]): Promise<[string, ComponentResult]> => {
      let timer: NodeJS.Timeout | undefined;
      try {
        const timeout = new Promise<ComponentResult>((resolve) => {
          timer = setTimeout(() => resolve({ state: "fail", note: "timed out" }), timeoutMs);
        });
        return [name, await Promise.race([check(), timeout])];
      } catch {
        return [name, { state: "fail" }];
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  const components = Object.fromEntries(entries);
  return {
    status: entries.some(([, r]) => r.state === "fail") ? "fail" : "ok",
    checkedAt: new Date().toISOString(),
    components,
  };
}

const hoursAgo = (iso: string | Date, now: number) => (now - new Date(iso).getTime()) / 3_600_000;
const ago = (hours: number) => (hours < 1 ? `${Math.max(0, Math.round(hours * 60))}m ago` : hours < 48 ? `${Math.round(hours)}h ago` : `${Math.round(hours / 24)}d ago`);

interface Cached {
  at: number;
  backups: ComponentResult;
  restoreTest: ComponentResult;
}
let cache: Cached | null = null;
const CACHE_MS = 5 * 60_000;

/**
 * Backup freshness and the latest restore test, read from the backup store.
 * Cached for five minutes so frequent uptime pings don't list the bucket.
 */
export async function backupHealthChecks(env: NodeJS.ProcessEnv = process.env): Promise<{ backups: ComponentResult; restoreTest: ComponentResult }> {
  // Only the bucket is needed to check on backups; the encryption key stays with the worker.
  if (!env.BACKUP_S3_BUCKET && !env.BACKUP_LOCAL_DIR) return { backups: { state: "off" }, restoreTest: { state: "off" } };
  const now = Date.now();
  if (cache && now - cache.at < CACHE_MS) return cache;
  const maxAge = Number.parseInt(env.BACKUP_MAX_AGE_HOURS ?? "", 10) || 26;
  const prefixRaw = (env.BACKUP_PREFIX ?? "database/").replace(/^\/+/, "");
  const prefix = prefixRaw && !prefixRaw.endsWith("/") ? `${prefixRaw}/` : prefixRaw;
  const store = createBackupStore(env);
  const [latest] = await listBackups(store, prefix);
  const backups: ComponentResult = !latest
    ? { state: "fail", note: "no backups yet" }
    : hoursAgo(latest.createdAt, now) > maxAge
      ? { state: "fail", note: `last backup ${ago(hoursAgo(latest.createdAt, now))}` }
      : { state: "ok", note: `last backup ${ago(hoursAgo(latest.createdAt, now))}` };
  // A restore test that has run before is expected to keep running weekly.
  const last = await lastRestoreTest(store, prefix);
  let restoreTest: ComponentResult;
  if (!last) restoreTest = env.BACKUP_VERIFY_DATABASE_URL ? { state: "ok", note: "not run yet" } : { state: "off" };
  else if (!last.ok) restoreTest = { state: "fail", note: `failed ${ago(hoursAgo(last.testedAt, now))}` };
  // Weekly by default; allow a day's slack.
  else if (hoursAgo(last.testedAt, now) > 8 * 24) restoreTest = { state: "fail", note: `last passed ${ago(hoursAgo(last.testedAt, now))}` };
  else restoreTest = { state: "ok", note: `passed ${ago(hoursAgo(last.testedAt, now))}` };
  cache = { at: now, backups, restoreTest };
  return cache;
}

/** For tests. */
export function resetHealthCache(): void {
  cache = null;
}
