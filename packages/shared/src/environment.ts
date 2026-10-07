/**
 * Startup configuration checks for the web app and the worker. Problems that
 * would leave a production deployment insecure or broken are errors (the
 * process refuses to start); anything merely unusual is a warning. Outside
 * production everything is a warning, so local development just works.
 */

export interface EnvironmentReport {
  errors: string[];
  warnings: string[];
}

type Env = Record<string, string | undefined>;

function base64Bytes(value: string): number {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return 0;
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  return (value.length * 3) / 4 - padding;
}

export function checkEnvironment(env: Env, role: "web" | "worker"): EnvironmentReport {
  const production = env.NODE_ENV === "production";
  const errors: string[] = [];
  const warnings: string[] = [];
  const problem = (message: string) => (production ? errors : warnings).push(message);

  if (!env.DATABASE_URL) errors.push("DATABASE_URL is not set.");

  const key = env.DATA_ENCRYPTION_KEY ?? "";
  if (!key) problem("DATA_ENCRYPTION_KEY is not set; sensitive answers and saved site sessions can't be stored. Generate one with: openssl rand -base64 32");
  else if (base64Bytes(key) !== 32) problem("DATA_ENCRYPTION_KEY must be 32 bytes, base64 encoded (openssl rand -base64 32).");

  if (!env.REDIS_URL) (role === "worker" ? errors : warnings).push("REDIS_URL is not set; the queue, live progress and shared rate limits need Redis.");

  const driver = env.STORAGE_DRIVER ?? "local";
  if (driver === "s3") {
    for (const name of ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) if (!env[name]) problem(`${name} is required when STORAGE_DRIVER is "s3".`);
  } else if (driver === "local") {
    if (production) warnings.push("STORAGE_DRIVER is \"local\": documents live on this machine's disk. Use \"s3\" when running more than one server.");
  } else {
    errors.push(`STORAGE_DRIVER must be "local" or "s3", not "${driver}".`);
  }

  if (role === "web") {
    const appUrl = env.APP_URL ?? "";
    if (!appUrl) problem("APP_URL is not set.");
    else if (production && !appUrl.startsWith("https://")) errors.push("APP_URL must use https in production so session cookies stay secure.");
  }

  const provider = (env.AI_PROVIDER ?? "").toLowerCase();
  if (provider === "anthropic" && !env.ANTHROPIC_API_KEY) warnings.push("AI_PROVIDER is \"anthropic\" but ANTHROPIC_API_KEY is empty; the built-in fallbacks are used instead.");

  if (role === "worker" && /^(1|true|yes|on)$/i.test(env.AUTOMATION_ALLOW_ALL_HOSTS ?? "") && !production) {
    warnings.push("AUTOMATION_ALLOW_ALL_HOSTS is on outside production: the worker may open real employer sites.");
  }

  const level = env.LOG_LEVEL?.toLowerCase();
  if (level && !["debug", "info", "warn", "error"].includes(level)) warnings.push(`LOG_LEVEL "${env.LOG_LEVEL}" isn't one of debug, info, warn, error; using the default.`);

  return { errors, warnings };
}
