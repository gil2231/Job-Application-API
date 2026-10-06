import { afterEach, describe, expect, it } from "vitest";
import { createLogger, sanitizeLogValue, setLogSink, type LogEntry } from "../src/logger";

let restore: (() => void) | null = null;
afterEach(() => {
  restore?.();
  delete process.env.LOG_LEVEL;
});

function capture() {
  const entries: LogEntry[] = [];
  restore = setLogSink((e) => entries.push(e));
  return entries;
}

describe("logger", () => {
  it("writes structured entries with scope, level and child fields", () => {
    process.env.LOG_LEVEL = "debug";
    const entries = capture();
    createLogger("worker", { workerId: "w1" }).child({ applicationId: "a1" }).info("Attempt finished", { result: "submitted" });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ level: "info", scope: "worker", msg: "Attempt finished", workerId: "w1", applicationId: "a1", result: "submitted" });
    expect(Date.parse(entries[0]!.time)).not.toBeNaN();
  });

  it("drops entries below LOG_LEVEL", () => {
    process.env.LOG_LEVEL = "warn";
    const entries = capture();
    const log = createLogger("web");
    log.info("hidden");
    log.debug("hidden");
    log.error("shown");
    expect(entries.map((e) => e.msg)).toEqual(["shown"]);
  });

  it("redacts secrets and masks email addresses", () => {
    const entries = capture();
    createLogger("auth").error("Sign-in failed for jordan@example.com", { password: "hunter2", apiKey: "sk-1", nested: { token: "t", ok: 1 }, error: new Error("bad login for jordan@example.com") });
    const e = entries[0]!;
    expect(e.msg).toBe("Sign-in failed for [email]");
    expect(e.password).toBe("[redacted]");
    expect(e.apiKey).toBe("[redacted]");
    expect(e.nested).toEqual({ token: "[redacted]", ok: 1 });
    expect((e.error as { message: string }).message).toBe("bad login for [email]");
  });

  it("never throws on odd values", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(() => sanitizeLogValue(circular)).not.toThrow();
    expect(sanitizeLogValue(10n)).toBe("10");
  });
});
