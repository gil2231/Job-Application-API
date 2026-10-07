import { Queue, Worker, type Job } from "bullmq";
import { captureException, sendAlert } from "@autoapply/ops";
import { backupsConfigured, loadBackupConfig, runBackup, testRestore, type BackupConfig } from "@autoapply/ops/backup";
import { createRedis } from "@autoapply/queue";

/**
 * Nightly database backups and the weekly restore test, run by the worker on
 * BullMQ job schedulers. A scheduler fires once per slot however many
 * workers are running, and a backup that fails is retried before anyone is
 * alerted.
 */
export const MAINTENANCE_QUEUE = "autoapply-maintenance";
const BACKUP_JOB = "database-backup";
const RESTORE_TEST_JOB = "restore-test";
const BACKUP_ATTEMPTS = 3;

export interface Maintenance {
  close(): Promise<void>;
}

async function runMaintenanceJob(config: BackupConfig, job: Job): Promise<unknown> {
  if (job.name === BACKUP_JOB) {
    const m = await runBackup(config);
    console.warn(`[maintenance] backup ${m.file} done (${Object.keys(m.counts).length} tables, ${Math.round(m.durationMs / 1000)}s)`);
    return { file: m.file, bytes: m.bytes };
  }
  if (job.name === RESTORE_TEST_JOB) {
    const r = await testRestore(config);
    if (!r.ok) throw new Error(r.error ?? "Restore test failed");
    console.warn(`[maintenance] restore test passed for ${r.backup} (${r.tables} tables, ${r.rows} rows)`);
    return { backup: r.backup, rows: r.rows };
  }
  throw new Error(`Unknown maintenance job ${job.name}`);
}

export async function startMaintenance(redisUrl: string, env: NodeJS.ProcessEnv = process.env): Promise<Maintenance | null> {
  if (!backupsConfigured(env)) {
    if (env.NODE_ENV === "production") console.warn("[maintenance] database backups are OFF: set BACKUP_ENCRYPTION_KEY and BACKUP_S3_BUCKET");
    return null;
  }
  let config: BackupConfig;
  try {
    config = loadBackupConfig(env);
  } catch (err) {
    await sendAlert({ key: "backup-config", title: "Database backups are misconfigured and not running", detail: (err as Error).message });
    return null;
  }

  const connection = createRedis(redisUrl);
  const queue = new Queue(MAINTENANCE_QUEUE, { connection });
  await queue.upsertJobScheduler(
    BACKUP_JOB,
    { pattern: config.schedule, tz: config.timezone },
    {
      name: BACKUP_JOB,
      opts: { attempts: BACKUP_ATTEMPTS, backoff: { type: "exponential", delay: 5 * 60_000 }, removeOnComplete: 30, removeOnFail: 30 },
    },
  );
  if (config.verifyDatabaseUrl) {
    await queue.upsertJobScheduler(
      RESTORE_TEST_JOB,
      { pattern: config.verifySchedule, tz: config.timezone },
      { name: RESTORE_TEST_JOB, opts: { attempts: 1, removeOnComplete: 10, removeOnFail: 10 } },
    );
  } else {
    await queue.removeJobScheduler(RESTORE_TEST_JOB);
  }

  const workerConnection = createRedis(redisUrl);
  const worker = new Worker(MAINTENANCE_QUEUE, (job) => runMaintenanceJob(config, job), {
    connection: workerConnection,
    concurrency: 1,
    lockDuration: 5 * 60_000,
  });
  worker.on("failed", (job, error) => {
    if (!job) return;
    const final = job.attemptsMade >= (job.opts.attempts ?? 1);
    console.error(`[maintenance] ${job.name} failed (attempt ${job.attemptsMade}${final ? ", giving up" : ", will retry"}):`, error.message);
    if (!final) return;
    captureException(error, { tags: { job: job.name } });
    void sendAlert(
      job.name === BACKUP_JOB
        ? { key: "backup-failed", title: "Nightly database backup failed", detail: `${error.message} (tried ${job.attemptsMade} times)` }
        : { key: "restore-test-failed", title: "Weekly backup restore test failed", detail: error.message },
    );
  });

  console.warn(
    `[maintenance] backups to ${config.store.description} on "${config.schedule}" ${config.timezone}` +
      (config.verifyDatabaseUrl ? `, restore test on "${config.verifySchedule}"` : ", restore test off (BACKUP_VERIFY_DATABASE_URL not set)"),
  );
  return {
    async close() {
      await worker.close().catch(() => undefined);
      await queue.close().catch(() => undefined);
      connection.disconnect();
      workerConnection.disconnect();
    },
  };
}
