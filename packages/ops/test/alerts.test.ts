import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAlertHistory, sendAlert } from "../src/alerts";

describe("sendAlert", () => {
  beforeEach(() => {
    resetAlertHistory();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("posts to the webhook in a Slack and Discord compatible shape, once an hour per key", async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      bodies.push(String(init?.body));
      return new Response("ok");
    }) as unknown as typeof fetch;
    const env = { ALERT_WEBHOOK_URL: "https://hooks.example.com/x", APP_ENV: "production" };
    await sendAlert({ key: "backup-failed", title: "Database backup failed", detail: "pg_dump failed for postgres://u:pw@h/db" }, env, fetchImpl);
    await sendAlert({ key: "backup-failed", title: "Database backup failed" }, env, fetchImpl);
    expect(bodies).toHaveLength(1);
    const body = JSON.parse(bodies[0]!);
    expect(body.text).toContain("Applyance (production): Database backup failed");
    expect(body.text).not.toContain("pw@");
    expect(body.content).toBe(body.text);
  });

  it("skips the webhook when none is configured", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await sendAlert({ key: "k", title: "t" }, {}, fetchImpl);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
