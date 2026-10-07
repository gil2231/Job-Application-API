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
  /** Whether the worker's browser is visible, so a person can finish CAPTCHAs and sign-ins in it. */
  interactive?: boolean;
  /** Whether paused CAPTCHAs are streamed to the app's CAPTCHA screen. */
  liveSolve?: boolean;
}

/** Pub/sub channel the web app uses to reach running workers (stop, wake). */
export const CONTROL_CHANNEL = "autoapply:control";

export type ControlMessage =
  /** Abort this user's running applications now. */
  | { type: "stop"; userId: string }
  /** Something became claimable for this user; check the queue now instead of on the next sweep. */
  | { type: "wake"; userId: string };

/** Pub/sub channel carrying live progress for one user's applications. */
export const progressChannel = (userId: string) => `autoapply:progress:${userId}`;
/** Latest progress snapshot for one application (JSON, expires). */
export const progressKey = (applicationId: string) => `autoapply:progress:app:${applicationId}`;
export const PROGRESS_TTL_SECONDS = 60 * 60;

export type ProgressStepState = "done" | "running" | "waiting" | "failed";

export interface ProgressStep {
  key: string;
  label: string;
  state: ProgressStepState;
  at: string;
}

/** What the worker reports while it processes one application. */
export interface ApplicationProgress {
  applicationId: string;
  userId: string;
  company: string;
  title: string;
  /** processing: the worker is on it; waiting: paused on a person; done/failed: the attempt ended. */
  phase: "processing" | "waiting" | "done" | "failed";
  steps: ProgressStep[];
  updatedAt: string;
}
