import "server-only";
import { publishControl } from "@autoapply/queue";

/**
 * Nudge running workers after something became claimable (new applications,
 * a resumed queue, an answered question). If Redis is down the worker's
 * scheduler still finds the work on its next sweep.
 */
export function notifyWorker(userId: string) {
  return publishControl({ type: "wake", userId });
}

/** Tell running workers to abort this user's applications right now. */
export function stopWorker(userId: string) {
  return publishControl({ type: "stop", userId });
}
