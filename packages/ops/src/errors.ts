import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { scrubText, scrubValue } from "./scrub";

/**
 * Error reporting for the web app, API and worker.
 *
 * Events go to any Sentry-compatible service (Sentry, or self-hosted
 * GlitchTip) through its public envelope endpoint, so no SDK has to hook into
 * Next.js, Fastify or Playwright. Nothing is sent unless ERROR_REPORTING_DSN
 * is set, and every message, stack and extra is scrubbed of personal data
 * first: reports never include request bodies, cookies or headers.
 */
export type ServiceName = "web" | "api" | "worker" | "ops";
export type Level = "fatal" | "error" | "warning" | "info";

export interface ReportContext {
  /** Short, low-cardinality labels for filtering (route, queue, job name). */
  tags?: Record<string, string | number | boolean | undefined>;
  /** Extra detail; scrubbed and size-limited. */
  extra?: Record<string, unknown>;
  /** The signed-in user's id only (never their email or name). */
  userId?: string;
  level?: Level;
}

interface Dsn {
  url: string;
  publicKey: string;
  raw: string;
}

export function parseDsn(dsn: string): Dsn | null {
  try {
    const u = new URL(dsn);
    const projectId = u.pathname.split("/").filter(Boolean).pop();
    if (!u.username || !projectId || !/^https?:$/.test(u.protocol)) return null;
    const prefix = u.pathname.slice(0, u.pathname.lastIndexOf(`/${projectId}`));
    return { url: `${u.protocol}//${u.host}${prefix}/api/${projectId}/envelope/`, publicKey: u.username, raw: dsn };
  } catch {
    return null;
  }
}

interface Frame {
  function?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  in_app: boolean;
}

/** Parses a V8 stack into Sentry frames (oldest call first). */
export function parseStack(stack: string | undefined): Frame[] {
  if (!stack) return [];
  const frames: Frame[] = [];
  for (const line of stack.split("\n").slice(1, 60)) {
    const m = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!m) continue;
    const filename = m[2]!.replace(/^file:\/\//, "");
    frames.push({
      function: m[1],
      filename,
      lineno: Number(m[3]),
      colno: Number(m[4]),
      in_app: !/node_modules|^node:|^internal\//.test(filename),
    });
  }
  return frames.reverse();
}

function exceptionValues(error: unknown) {
  const values: { type: string; value: string; stacktrace?: { frames: Frame[] } }[] = [];
  let current: unknown = error;
  for (let depth = 0; current != null && depth < 5; depth++) {
    if (current instanceof Error) {
      const frames = parseStack(current.stack);
      values.push({ type: current.name || "Error", value: scrubText(current.message), ...(frames.length ? { stacktrace: { frames } } : {}) });
      current = (current as { cause?: unknown }).cause;
    } else {
      values.push({ type: "NonError", value: scrubText(typeof current === "string" ? current : JSON.stringify(scrubValue(current))) });
      break;
    }
  }
  // Sentry lists the outermost exception last.
  return values.reverse();
}

export interface Reporter {
  readonly enabled: boolean;
  captureException(error: unknown, context?: ReportContext): string | undefined;
  captureMessage(message: string, context?: ReportContext): string | undefined;
  /** Waits for queued sends, for short-lived processes (the backup CLI) and shutdown. */
  flush(timeoutMs?: number): Promise<void>;
}

export interface ReporterOptions {
  service: ServiceName;
  dsn?: string;
  environment?: string;
  release?: string;
  /** Events allowed per minute; the rest are dropped so a crash loop can't flood the service. */
  maxPerMinute?: number;
  fetchImpl?: typeof fetch;
}

export function createReporter(options: ReporterOptions): Reporter {
  const dsn = options.dsn ? parseDsn(options.dsn) : null;
  if (options.dsn && !dsn) console.error("[ops] ERROR_REPORTING_DSN is not a valid DSN; error reporting is off");
  const send = options.fetchImpl ?? fetch;
  const maxPerMinute = options.maxPerMinute ?? 30;
  const pending = new Set<Promise<unknown>>();
  let windowStart = 0;
  let sentInWindow = 0;

  function allow(): boolean {
    const now = Date.now();
    if (now - windowStart > 60_000) {
      windowStart = now;
      sentInWindow = 0;
    }
    return ++sentInWindow <= maxPerMinute;
  }

  function dispatch(payload: Record<string, unknown>, context: ReportContext | undefined): string | undefined {
    if (!dsn || !allow()) return undefined;
    const eventId = randomUUID().replace(/-/g, "");
    const tags: Record<string, string> = { service: options.service };
    for (const [k, v] of Object.entries(context?.tags ?? {})) if (v !== undefined) tags[k] = scrubText(String(v), 200);
    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: "node",
      level: context?.level ?? "error",
      server_name: hostname(),
      environment: options.environment ?? "development",
      ...(options.release ? { release: options.release } : {}),
      tags,
      ...(context?.extra ? { extra: scrubValue(context.extra) } : {}),
      ...(context?.userId ? { user: { id: context.userId } } : {}),
      ...payload,
    };
    const body = [
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString(), dsn: dsn.raw }),
      JSON.stringify({ type: "event", content_type: "application/json" }),
      JSON.stringify(event),
    ].join("\n");
    const request = send(dsn.url, {
      method: "POST",
      headers: {
        "content-type": "application/x-sentry-envelope",
        "x-sentry-auth": `Sentry sentry_version=7, sentry_client=applyance-ops/1.0, sentry_key=${dsn.publicKey}`,
      },
      body,
      signal: AbortSignal.timeout(5000),
    })
      .then((res) => {
        if (!res.ok && res.status !== 429) console.error(`[ops] error report rejected with HTTP ${res.status}`);
      })
      .catch((err: unknown) => console.error("[ops] could not send error report:", (err as Error).message))
      .finally(() => pending.delete(request));
    pending.add(request);
    return eventId;
  }

  return {
    enabled: dsn != null,
    captureException(error, context) {
      return dispatch({ exception: { values: exceptionValues(error) } }, context);
    },
    captureMessage(message, context) {
      return dispatch({ message: { formatted: scrubText(message) } }, { level: "warning", ...context });
    },
    async flush(timeoutMs = 5000) {
      if (!pending.size) return;
      await Promise.race([Promise.allSettled([...pending]), new Promise((r) => setTimeout(r, timeoutMs).unref())]);
    },
  };
}

// ─── Process-wide reporter ──────────────────────────────────────────────────

// Kept on globalThis: Next.js bundles instrumentation and each route separately,
// so a module-level variable would leave routes with their own, uninitialized copy.
const GLOBAL_KEY = Symbol.for("applyance.ops.reporter");
type GlobalWithReporter = typeof globalThis & { [GLOBAL_KEY]?: { service: ServiceName; reporter: Reporter } };
const holder = globalThis as GlobalWithReporter;

function reporterFromEnv(service: ServiceName, env: NodeJS.ProcessEnv): Reporter {
  return createReporter({
    service,
    dsn: env.ERROR_REPORTING_DSN || undefined,
    environment: env.APP_ENV || env.NODE_ENV || "development",
    release: env.APP_RELEASE || env.RENDER_GIT_COMMIT || env.RAILWAY_GIT_COMMIT_SHA || env.VERCEL_GIT_COMMIT_SHA || undefined,
  });
}

/** Sets up error reporting for this process from the environment. Safe to call more than once. */
export function initErrorReporting(service: ServiceName, env: NodeJS.ProcessEnv = process.env): Reporter {
  const reporter = reporterFromEnv(service, env);
  holder[GLOBAL_KEY] = { service, reporter };
  return reporter;
}

function current(): Reporter {
  // Report even if nothing called initErrorReporting (the service tag is then "ops").
  holder[GLOBAL_KEY] ??= { service: "ops", reporter: reporterFromEnv("ops", process.env) };
  return holder[GLOBAL_KEY].reporter;
}

export function captureException(error: unknown, context?: ReportContext): string | undefined {
  return current().captureException(error, context);
}

export function captureMessage(message: string, context?: ReportContext): string | undefined {
  return current().captureMessage(message, context);
}

export function flushErrorReports(timeoutMs?: number): Promise<void> {
  return current().flush(timeoutMs);
}

let handlersInstalled = false;

/**
 * Reports crashes that nothing else caught. An uncaught exception still ends
 * the process (after the report is sent), because its state can't be trusted.
 */
export function installProcessHandlers(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  process.on("unhandledRejection", (reason) => {
    console.error("[ops] unhandled promise rejection", reason);
    captureException(reason, { tags: { kind: "unhandledRejection" } });
  });
  process.on("uncaughtException", (error) => {
    console.error("[ops] uncaught exception", error);
    captureException(error, { level: "fatal", tags: { kind: "uncaughtException" } });
    void flushErrorReports(2000).finally(() => process.exit(1));
  });
}
