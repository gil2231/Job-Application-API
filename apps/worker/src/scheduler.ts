import type { Queue } from "bullmq";
import { findDispatchableApplications, prisma, recoverExpiredLeases, settlePauseAfterCurrent } from "@autoapply/database";
import { addApplicationJobs, type ApplicationJobData } from "@autoapply/queue";
import { createLogger } from "@autoapply/shared";

const log = createLogger("scheduler");

/**
 * Keeps BullMQ in step with Postgres: every few seconds (and whenever the web
 * app sends a wake-up) it returns applications from crashed workers to the
 * queue, turns "pause after current" into a pause once nothing is running, and
 * adds every due, unpaused QUEUED application to BullMQ. Adding an application
 * that is already waiting is a no-op, so this is safe to run as often as needed.
 */
export class Scheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private again = false;

  constructor(
    private readonly queue: Queue<ApplicationJobData>,
    private readonly intervalMs: number,
  ) {}

  start() {
    this.timer = setInterval(() => this.wake(), this.intervalMs);
    this.wake();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  wake(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        try {
          await this.tick();
        } catch (error) {
          log.error("Scheduler sweep failed", { error });
        }
      } while (this.again);
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  async tick() {
    await recoverExpiredLeases();
    const pausing = await prisma.userSetting.findMany({ where: { pauseAfterCurrent: true }, select: { userId: true }, take: 500 });
    for (const { userId } of pausing) await settlePauseAfterCurrent(userId);
    const due = await findDispatchableApplications();
    await addApplicationJobs(
      this.queue,
      due.map((a) => ({ applicationId: a.id, userId: a.userId, priority: Math.max(1, 1000 - a.priority) })),
    );
  }
}
