import { describe, expect, it } from "vitest";
import Redis from "ioredis";
import { WORKER_HEARTBEAT_KEY } from "@autoapply/shared";
import { startHeartbeat } from "../src/heartbeat";

const url = process.env.REDIS_URL ?? "redis://localhost:6379";

describe("worker heartbeat", () => {
  it("publishes and clears its heartbeat", async () => {
    const redis = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
    try {
      await redis.connect();
    } catch {
      console.warn("Redis not reachable; skipping heartbeat test");
      return;
    }
    const hb = startHeartbeat(redis, { adapters: () => ["GENERIC"], activeJobs: () => 0 }, 50);
    await new Promise((r) => setTimeout(r, 120));
    const raw = await redis.get(WORKER_HEARTBEAT_KEY);
    expect(JSON.parse(raw!)).toMatchObject({ workerId: hb.workerId, adapters: ["GENERIC"] });
    expect(await redis.ttl(WORKER_HEARTBEAT_KEY)).toBeGreaterThan(0);
    await hb.stop();
    expect(await redis.get(WORKER_HEARTBEAT_KEY)).toBeNull();
    redis.disconnect();
  });
});
