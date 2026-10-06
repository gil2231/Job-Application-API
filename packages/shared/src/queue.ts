/** Names shared by the web app (producer) and the worker (consumer). */
export const QUEUE_NAMES = {
  applications: "autoapply-applications",
} as const;

/** Redis key the worker refreshes while it is running (JSON, short TTL). */
export const WORKER_HEARTBEAT_KEY = "autoapply:worker:heartbeat";
export const WORKER_HEARTBEAT_TTL_SECONDS = 30;

export interface WorkerHeartbeat {
  workerId: string;
  startedAt: string;
  updatedAt: string;
  /** Platforms the running worker has adapters for. */
  adapters: string[];
  activeJobs: number;
}
