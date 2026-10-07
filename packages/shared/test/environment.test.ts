import { describe, expect, it } from "vitest";
import { checkEnvironment } from "../src/environment";

const KEY = Buffer.alloc(32, 7).toString("base64");
const good = { NODE_ENV: "production", DATABASE_URL: "postgres://x", DATA_ENCRYPTION_KEY: KEY, REDIS_URL: "redis://x", STORAGE_DRIVER: "s3", S3_BUCKET: "b", S3_ACCESS_KEY_ID: "a", S3_SECRET_ACCESS_KEY: "s", APP_URL: "https://applyance.example" };

describe("checkEnvironment", () => {
  it("passes a complete production configuration", () => {
    expect(checkEnvironment(good, "web")).toEqual({ errors: [], warnings: [] });
    expect(checkEnvironment(good, "worker")).toEqual({ errors: [], warnings: [] });
  });

  it("refuses to start production without encryption, https or storage credentials", () => {
    const { errors } = checkEnvironment({ ...good, DATA_ENCRYPTION_KEY: "short", APP_URL: "http://applyance.example", S3_BUCKET: "" }, "web");
    expect(errors).toHaveLength(3);
    expect(errors.join(" ")).toMatch(/DATA_ENCRYPTION_KEY.*32 bytes/);
    expect(errors.join(" ")).toMatch(/https/);
    expect(errors.join(" ")).toMatch(/S3_BUCKET/);
  });

  it("only warns in development", () => {
    const report = checkEnvironment({ NODE_ENV: "development", DATABASE_URL: "postgres://x", REDIS_URL: "redis://x", APP_URL: "http://localhost:3000" }, "web");
    expect(report.errors).toEqual([]);
    expect(report.warnings.join(" ")).toContain("DATA_ENCRYPTION_KEY is not set");
  });

  it("requires Redis for the worker but not the web app", () => {
    const { REDIS_URL: _omit, ...noRedis } = good;
    expect(checkEnvironment(noRedis, "worker").errors.join(" ")).toContain("REDIS_URL");
    expect(checkEnvironment(noRedis, "web").errors).toEqual([]);
  });
});
