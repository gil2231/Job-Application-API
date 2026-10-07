import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Queue, QueueEvents } from "bullmq";
import Redis from "ioredis";
import { describe, expect, it } from "vitest";
import { listBackups, LocalBackupStore } from "@autoapply/ops/backup";
import { MAINTENANCE_QUEUE, startMaintenance } from "../src/maintenance";

const url = process.env.REDIS_URL ?? "redis://localhost:6379";
const hasPgDump = (() => {
  try {
    execFileSync("pg_dump", ["--version"]);
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasPgDump)("scheduled backups", () => {
  it("registers the nightly schedule and runs a backup job", async () => {
    const probe = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1 });
    try {
      await probe.connect();
    } catch {
      console.warn("Redis not reachable; skipping maintenance test");
      return;
    }
    probe.disconnect();
    const dir = await mkdtemp(join(tmpdir(), "worker-backups-"));
    const env = { ...process.env, BACKUP_ENCRYPTION_KEY: randomBytes(32).toString("base64"), BACKUP_LOCAL_DIR: dir, BACKUP_SCHEDULE: "0 2 * * *", BACKUP_VERIFY_DATABASE_URL: "" };
    const maintenance = await startMaintenance(url, env);
    const queue = new Queue(MAINTENANCE_QUEUE, { connection: { url } });
    const events = new QueueEvents(MAINTENANCE_QUEUE, { connection: { url } });
    try {
      expect(maintenance).not.toBeNull();
      const schedulers = await queue.getJobSchedulers();
      expect(schedulers.map((s) => [s.key, s.pattern])).toEqual([["database-backup", "0 2 * * *"]]);
      await events.waitUntilReady();
      const job = await queue.add("database-backup", {});
      await job.waitUntilFinished(events, 30_000);
      const backups = await listBackups(new LocalBackupStore(dir), "database/");
      expect(backups).toHaveLength(1);
    } finally {
      await queue.removeJobScheduler("database-backup");
      await maintenance?.close();
      await events.close();
      await queue.obliterate({ force: true });
      await queue.close();
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stays off when backups aren't configured", async () => {
    expect(await startMaintenance(url, { NODE_ENV: "test" })).toBeNull();
  });
});
