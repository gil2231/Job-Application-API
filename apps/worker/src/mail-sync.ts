import { findDueMailConnections } from "@autoapply/database";
import { syncMailConnection, type SyncOptions } from "@autoapply/inbox";

/**
 * Syncs connected Gmail and Outlook accounts in the background: every minute
 * it picks the accounts not synced within the interval and runs them one at a
 * time (each sync holds a lease, so a "Sync now" click never overlaps it).
 */
export class MailSyncLoop {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running: Promise<void> | null = null;
  private stopped = false;

  constructor(
    private readonly intervalMs: number,
    private readonly options: SyncOptions = {},
    private readonly checkEveryMs = 60_000,
  ) {}

  start() {
    if (this.intervalMs <= 0) return;
    this.timer = setInterval(() => void this.tick(), this.checkEveryMs);
    void this.tick();
  }

  async stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }

  tick(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        const due = await findDueMailConnections(this.intervalMs);
        for (const { id } of due) {
          if (this.stopped) break;
          const report = await syncMailConnection(id, this.options);
          if (report.status === "error" || report.status === "reconnect") console.warn(`[mail] ${id}: ${report.status}${report.error ? ` (${report.error})` : ""}`);
        }
      } catch (error) {
        console.error("[mail] sync loop failed", error);
      }
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }
}
