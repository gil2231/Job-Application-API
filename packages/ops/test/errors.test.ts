import { describe, expect, it, vi } from "vitest";
import { createReporter, parseDsn, parseStack } from "../src/errors";

const DSN = "https://publickey123@o42.ingest.sentry.io/4507";

function fakeFetch() {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return new Response("{}", { status: 200 });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}

describe("parseDsn", () => {
  it("builds the envelope endpoint", () => {
    expect(parseDsn(DSN)).toEqual({ url: "https://o42.ingest.sentry.io/api/4507/envelope/", publicKey: "publickey123", raw: DSN });
    expect(parseDsn("https://key@glitchtip.example.com/sub/7")?.url).toBe("https://glitchtip.example.com/sub/api/7/envelope/");
    expect(parseDsn("not a dsn")).toBeNull();
    expect(parseDsn("https://sentry.io/1")).toBeNull();
  });
});

describe("parseStack", () => {
  it("parses V8 frames oldest first and marks library code", () => {
    const err = new Error("boom");
    err.stack = "Error: boom\n    at handler (/app/apps/api/src/server.ts:10:5)\n    at Object.run (/app/node_modules/fastify/lib/x.js:3:1)\n    at node:internal/process/task_queues:95:5";
    const frames = parseStack(err.stack);
    expect(frames.map((f) => [f.function, f.in_app])).toEqual([
      [undefined, false],
      ["Object.run", false],
      ["handler", true],
    ]);
    expect(frames[2]).toMatchObject({ filename: "/app/apps/api/src/server.ts", lineno: 10, colno: 5 });
  });
});

describe("createReporter", () => {
  it("does nothing without a DSN", () => {
    const { fn, calls } = fakeFetch();
    const reporter = createReporter({ service: "api", fetchImpl: fn });
    expect(reporter.enabled).toBe(false);
    expect(reporter.captureException(new Error("x"))).toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  it("sends a scrubbed Sentry envelope with the error chain", async () => {
    const { fn, calls } = fakeFetch();
    const reporter = createReporter({ service: "worker", dsn: DSN, environment: "production", release: "abc123", fetchImpl: fn });
    const cause = new Error("connect ECONNREFUSED for bob@example.com");
    const id = reporter.captureException(new Error("Saving application failed", { cause }), {
      tags: { queue: "applications" },
      extra: { applicationId: "app_1", resumeText: "secret resume", note: "ping bob@example.com" },
      userId: "user_1",
    });
    await reporter.flush();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe("https://o42.ingest.sentry.io/api/4507/envelope/");
    expect((init.headers as Record<string, string>)["x-sentry-auth"]).toContain("sentry_key=publickey123");
    const [header, item, eventJson] = String(init.body).split("\n");
    expect(JSON.parse(header!)).toMatchObject({ event_id: id, dsn: DSN });
    expect(JSON.parse(item!)).toEqual({ type: "event", content_type: "application/json" });
    const event = JSON.parse(eventJson!);
    expect(event).toMatchObject({
      level: "error",
      environment: "production",
      release: "abc123",
      tags: { service: "worker", queue: "applications" },
      user: { id: "user_1" },
      extra: { applicationId: "app_1", resumeText: "[redacted]", note: "ping [email]" },
    });
    expect(event.exception.values.map((v: { value: string }) => v.value)).toEqual(["connect ECONNREFUSED for [email]", "Saving application failed"]);
    expect(String(init.body)).not.toContain("bob@example.com");
  });

  it("caps events per minute", async () => {
    const { fn, calls } = fakeFetch();
    const reporter = createReporter({ service: "web", dsn: DSN, fetchImpl: fn, maxPerMinute: 3 });
    for (let i = 0; i < 10; i++) reporter.captureMessage(`m${i}`);
    await reporter.flush();
    expect(calls).toHaveLength(3);
  });

  it("never throws when the service is unreachable", async () => {
    const fn = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const reporter = createReporter({ service: "api", dsn: DSN, fetchImpl: fn });
    expect(() => reporter.captureException(new Error("x"))).not.toThrow();
    await reporter.flush();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
