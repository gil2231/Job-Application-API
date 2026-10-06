import { describe, expect, it } from "vitest";
import { backupHealthChecks, runHealthChecks } from "../src/health";

describe("runHealthChecks", () => {
  it("fails overall when any component fails, times out slow checks, and hides errors", async () => {
    const report = await runHealthChecks(
      {
        database: async () => ({ state: "ok" }),
        redis: async () => {
          throw new Error("connect ECONNREFUSED 10.0.0.5:6379 password=hunter2");
        },
        worker: () => new Promise(() => undefined),
        backups: async () => ({ state: "off" }),
      },
      50,
    );
    expect(report.status).toBe("fail");
    expect(report.components).toEqual({
      database: { state: "ok" },
      redis: { state: "fail" },
      worker: { state: "fail", note: "timed out" },
      backups: { state: "off" },
    });
    expect(JSON.stringify(report)).not.toContain("hunter2");
  });

  it("passes when nothing fails", async () => {
    const report = await runHealthChecks({ a: async () => ({ state: "ok" }), b: async () => ({ state: "off" }) });
    expect(report.status).toBe("ok");
  });

  it("reports backups as off when they aren't set up", async () => {
    expect(await backupHealthChecks({})).toEqual({ backups: { state: "off" }, restoreTest: { state: "off" } });
  });
});
