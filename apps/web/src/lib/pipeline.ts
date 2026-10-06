import "server-only";
import { after } from "next/server";
import { analyzeJobs, rescoreJobs } from "@autoapply/ingestion";

/**
 * Analysis runs in the web process after the response is sent, one run per
 * user at a time; the jobs table updates live as results land. (Phase 3 moves
 * this onto the worker queue.)
 */
const running = new Map<string, Promise<void>>();
const rerun = new Set<string>();

async function drain(userId: string) {
  // Each pass picks up every job waiting in IMPORTED; another pass runs if more arrived mid-run.
  do {
    rerun.delete(userId);
    await analyzeJobs(userId);
  } while (rerun.has(userId));
}

export function analyzeInBackground(userId: string) {
  if (running.has(userId)) {
    rerun.add(userId);
    return;
  }
  const task = drain(userId)
    .catch((error) => console.error("[pipeline] background analysis failed", error))
    .finally(() => running.delete(userId));
  running.set(userId, task);
  after(() => task);
}

/** Re-score after profile or rules changes, without delaying the response. */
export function rescoreInBackground(userId: string) {
  after(() => rescoreJobs(userId).then(() => undefined).catch((error) => console.error("[pipeline] rescore failed", error)));
}
