/**
 * Structured logging for the web app, the worker and the packages they share.
 *
 * In production (or with LOG_FORMAT=json) each entry is one JSON line on
 * stdout/stderr, ready for a log collector; in development it's a readable
 * line. LOG_LEVEL (debug, info, warn, error) sets the minimum level.
 *
 * Logs never carry personal data on purpose: fields whose names suggest
 * secrets or answers are redacted, and email addresses in messages are masked.
 */

export const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger that adds these fields to every entry. */
  child(fields: LogFields): Logger;
}

export interface LogEntry {
  time: string;
  level: LogLevel;
  scope: string;
  msg: string;
  [field: string]: unknown;
}

const SECRET_KEY = /pass(word)?|secret|token|cookie|authorization|api[-_]?key|session|storage[-_]?state|answer|ssn|salary/i;
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;

export function maskEmails(text: string): string {
  return text.replace(EMAIL, "[email]");
}

/** Make a value safe to log: redact secret-looking keys, mask emails, serialize errors, cap sizes. */
export function sanitizeLogValue(value: unknown, depth = 0): unknown {
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") return maskEmails(value.length > 2000 ? `${value.slice(0, 2000)}…` : value);
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) {
    const out: LogFields = { name: value.name, message: maskEmails(value.message.slice(0, 2000)) };
    if (value.stack) out.stack = maskEmails(value.stack.split("\n").slice(0, 8).join("\n"));
    const code = (value as { code?: unknown }).code;
    if (typeof code === "string" || typeof code === "number") out.code = code;
    return out;
  }
  if (depth >= 4) return "[nested]";
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => sanitizeLogValue(v, depth + 1));
  if (typeof value === "object") {
    const out: LogFields = {};
    for (const [k, v] of Object.entries(value as LogFields).slice(0, 50)) out[k] = SECRET_KEY.test(k) ? "[redacted]" : sanitizeLogValue(v, depth + 1);
    return out;
  }
  return String(value);
}

type Sink = (entry: LogEntry) => void;

function env(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env?.[name] : undefined;
}

function minimumLevel(): LogLevel {
  const configured = env("LOG_LEVEL")?.toLowerCase();
  if (configured && (LOG_LEVELS as readonly string[]).includes(configured)) return configured as LogLevel;
  return env("NODE_ENV") === "test" ? "warn" : "info";
}

function useJson(): boolean {
  const format = env("LOG_FORMAT")?.toLowerCase();
  if (format) return format === "json";
  return env("NODE_ENV") === "production";
}

function formatLine(entry: LogEntry): string {
  if (useJson()) return JSON.stringify(entry);
  const { time: _time, level, scope, msg, ...fields } = entry;
  const extra = Object.keys(fields).length ? ` ${JSON.stringify(fields)}` : "";
  return `${level === "info" || level === "debug" ? "" : `${level.toUpperCase()} `}[${scope}] ${msg}${extra}`;
}

const defaultSink: Sink = (entry) => {
  const toStderr = entry.level === "warn" || entry.level === "error";
  const line = formatLine(entry);
  if (typeof process !== "undefined" && typeof process.stdout === "object") (toStderr ? process.stderr : process.stdout).write(`${line}\n`);
  else console.warn(line);
};

let sink: Sink = defaultSink;

/** Send log entries somewhere else (tests capture them). Returns a function that restores the default. */
export function setLogSink(next: Sink): () => void {
  sink = next;
  return () => {
    sink = defaultSink;
  };
}

export function createLogger(scope: string, base: LogFields = {}): Logger {
  const write = (level: LogLevel, message: string, fields?: LogFields) => {
    if (LOG_LEVELS.indexOf(level) < LOG_LEVELS.indexOf(minimumLevel())) return;
    const safe = sanitizeLogValue({ ...base, ...fields }) as LogFields;
    try {
      sink({ time: new Date().toISOString(), level, scope, msg: maskEmails(message), ...safe });
    } catch {
      /* logging must never break the caller */
    }
  };
  return {
    debug: (m, f) => write("debug", m, f),
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    child: (fields) => createLogger(scope, { ...base, ...fields }),
  };
}
