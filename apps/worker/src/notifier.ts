import { runDueJobAlerts, sendAttentionAlerts, type EmailSender } from "@autoapply/notifications";

/**
 * Sends alerts on a timer: Needs Attention emails for applications that
 * paused for the person, and the daily job alert emails for saved searches.
 * Both are safe to run from several workers at once (each alert is claimed in
 * the database before it is sent), and a run never overlaps the previous one.
 */
export class Notifier {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;

  constructor(
    private readonly sender: EmailSender,
    private readonly intervalMs: number,
  ) {}

  start() {
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    void this.tick();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }

  tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        const attention = await sendAttentionAlerts({ sender: this.sender });
        if (attention.sent || attention.failed) console.warn(`[notifier] Needs Attention emails: ${attention.sent} sent, ${attention.failed} failed`);
      } catch (error) {
        console.error("[notifier] Needs Attention alerts failed", error);
      }
      try {
        const alerts = await runDueJobAlerts({ sender: this.sender });
        if (alerts.usersRun) console.warn(`[notifier] job alerts: ran for ${alerts.usersRun} users, ${alerts.emailsSent} emails sent, ${alerts.failed} failed`);
      } catch (error) {
        console.error("[notifier] job alerts failed", error);
      }
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }
}
