import { clearScreenshots, encryptSensitiveAnswers, findExpiredScreenshots, purgeExpiredSessionData } from "@autoapply/database";
import type { StorageDriver } from "@autoapply/documents";
import { createLogger } from "@autoapply/shared";

const log = createLogger("maintenance");

/**
 * Periodic housekeeping: enforce data retention (expired sessions, saved site
 * cookies past expiry, screenshots past each person's "Keep screenshots"
 * setting), and encrypt any saved answers in sensitive categories that are
 * still plain text. Safe to run from several workers at once: every step is idempotent.
 */
export async function runMaintenance(storage: StorageDriver, now: Date = new Date()) {
  const encrypted = await encryptSensitiveAnswers();
  if (encrypted.answers || encrypted.filled) log.info("Encrypted sensitive answers", encrypted);
  const sessions = await purgeExpiredSessionData(now);
  let screenshots = 0;
  // Bounded batches so one sweep never runs for long.
  for (let batch = 0; batch < 10; batch++) {
    const expired = await findExpiredScreenshots(now);
    if (!expired.length) break;
    for (const { keys } of expired) {
      for (const key of keys) {
        await storage.delete(key).catch((error) => log.warn("Couldn't delete an expired screenshot", { key, error }));
      }
      screenshots += keys.length;
    }
    await clearScreenshots(expired.map((e) => e.attemptId));
  }
  const result = { ...sessions, screenshots, encrypted };
  if (sessions.sessions || sessions.browserSessions || screenshots) log.info("Retention sweep", result);
  return result;
}

/** Run maintenance shortly after start, then every `intervalMs`. */
export function startMaintenance(storage: StorageDriver, intervalMs = 60 * 60_000) {
  const run = () => void runMaintenance(storage).catch((error) => log.error("Maintenance failed", { error }));
  // Encrypting answers that became sensitive shouldn't wait for the first sweep.
  void encryptSensitiveAnswers()
    .then((encrypted) => (encrypted.answers || encrypted.filled ? log.info("Encrypted sensitive answers", encrypted) : undefined))
    .catch((error) => log.error("Encrypting sensitive answers failed", { error }));
  const first = setTimeout(run, 60_000);
  const timer = setInterval(run, intervalMs);
  return {
    stop() {
      clearTimeout(first);
      clearInterval(timer);
    },
  };
}
