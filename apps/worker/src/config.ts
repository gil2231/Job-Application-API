/** Worker settings, read once from the environment. */
export interface WorkerConfig {
  redisUrl: string;
  /** Applications one worker process runs at once (each user's own limit still applies). */
  concurrency: number;
  /** Run the browser without a window. Set WORKER_HEADLESS=false so a person can finish CAPTCHAs and sign-ins in it. */
  headless: boolean;
  /** With a visible browser, how long to keep a page open waiting for the person before releasing it. */
  interactiveWaitMs: number;
  leaseMs: number;
  schedulerIntervalMs: number;
  /** Hosts automation may open. Real employer sites are off unless allowAllHosts is set. */
  allowedHosts: string[];
  allowAllHosts: boolean;
  chromiumExecutable?: string;
  navigationTimeoutMs: number;
  /** Send Needs Attention and daily job alert emails from this worker. */
  notificationsEnabled: boolean;
  notifierIntervalMs: number;
}

const bool = (v: string | undefined, fallback: boolean) => (v == null || v === "" ? fallback : /^(1|true|yes|on)$/i.test(v));
const int = (v: string | undefined, fallback: number, min = 0) => {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  return {
    redisUrl: env.REDIS_URL ?? "redis://localhost:6379",
    concurrency: int(env.WORKER_CONCURRENCY, 2, 1),
    headless: bool(env.WORKER_HEADLESS, true),
    interactiveWaitMs: int(env.WORKER_INTERACTIVE_WAIT_MS, 15 * 60_000, 1000),
    leaseMs: int(env.WORKER_LEASE_MS, 90_000, 5000),
    schedulerIntervalMs: int(env.WORKER_SCHEDULER_INTERVAL_MS, 5000, 500),
    allowedHosts: (env.AUTOMATION_ALLOWED_HOSTS ?? "localhost,127.0.0.1")
      .split(",")
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
    allowAllHosts: bool(env.AUTOMATION_ALLOW_ALL_HOSTS, false),
    chromiumExecutable: env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    navigationTimeoutMs: int(env.WORKER_NAVIGATION_TIMEOUT_MS, 30_000, 1000),
    notificationsEnabled: bool(env.WORKER_NOTIFICATIONS, true),
    notifierIntervalMs: int(env.WORKER_NOTIFIER_INTERVAL_MS, 60_000, 1000),
  };
}
