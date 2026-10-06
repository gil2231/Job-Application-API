import type Redis from "ioredis";
import { PROGRESS_TTL_SECONDS, progressChannel, progressKey, type ApplicationProgress, type ProgressStep, type ProgressStepState } from "@autoapply/shared";

/**
 * Live progress for one application: an ordered checklist the dashboard shows
 * as it happens ("✓ Profile loaded … ● Validating"). Published over Redis
 * pub/sub to the web app's event stream, with the latest snapshot kept under a
 * short-lived key for pages that open mid-run. Progress is best effort; the
 * durable record is the application's timeline in Postgres.
 */
export class ProgressReporter {
  private steps: ProgressStep[] = [];
  private phase: ApplicationProgress["phase"] = "processing";

  constructor(
    private readonly redis: Redis | null,
    private readonly base: { applicationId: string; userId: string; company: string; title: string },
  ) {}

  running(key: string, label: string) {
    return this.set(key, label, "running");
  }
  done(key: string, label: string) {
    return this.set(key, label, "done");
  }
  waiting(key: string, label: string) {
    this.phase = "waiting";
    return this.set(key, label, "waiting");
  }
  failed(key: string, label: string) {
    return this.set(key, label, "failed");
  }

  /** Mark the run finished; any step still running ends in the given state. */
  finish(phase: ApplicationProgress["phase"]) {
    this.phase = phase;
    const end: ProgressStepState = phase === "failed" ? "failed" : phase === "waiting" ? "waiting" : "done";
    this.steps = this.steps.map((s) => (s.state === "running" ? { ...s, state: end } : s));
    return this.publish();
  }

  resume() {
    this.phase = "processing";
    this.steps = this.steps.map((s) => (s.state === "waiting" ? { ...s, state: "done" } : s));
    return this.publish();
  }

  snapshot(): ApplicationProgress {
    return { ...this.base, phase: this.phase, steps: this.steps, updatedAt: new Date().toISOString() };
  }

  private set(key: string, label: string, state: ProgressStepState) {
    const at = new Date().toISOString();
    const i = this.steps.findIndex((s) => s.key === key);
    // Starting a new step completes the one before it.
    if (state === "running") this.steps = this.steps.map((s) => (s.state === "running" ? { ...s, state: "done" } : s));
    if (i >= 0) this.steps[i] = { key, label, state, at };
    else this.steps.push({ key, label, state, at });
    if (state !== "waiting" && this.phase === "waiting") this.phase = "processing";
    return this.publish();
  }

  private async publish() {
    if (!this.redis) return;
    const payload = JSON.stringify(this.snapshot());
    try {
      await this.redis.multi().set(progressKey(this.base.applicationId), payload, "EX", PROGRESS_TTL_SECONDS).publish(progressChannel(this.base.userId), payload).exec();
    } catch {
      /* progress is best effort */
    }
  }
}
