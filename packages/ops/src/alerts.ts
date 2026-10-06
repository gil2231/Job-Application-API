import { captureMessage } from "./errors";
import { scrubText } from "./scrub";

/**
 * Operational alerts for the owner (a backup failed, a restore test failed).
 *
 * Each alert goes to the error reporting service, which emails you, and to
 * ALERT_WEBHOOK_URL when set: a Slack or Discord incoming webhook, or any URL
 * that accepts JSON. The same alert is sent at most once an hour.
 */
export interface Alert {
  /** Stable key used to suppress repeats, e.g. "backup-failed". */
  key: string;
  title: string;
  detail?: string;
  severity?: "critical" | "warning";
}

const lastSent = new Map<string, number>();
const REPEAT_MS = 60 * 60_000;

export async function sendAlert(alert: Alert, env: NodeJS.ProcessEnv = process.env, fetchImpl: typeof fetch = fetch): Promise<void> {
  const now = Date.now();
  const previous = lastSent.get(alert.key);
  if (previous && now - previous < REPEAT_MS) return;
  lastSent.set(alert.key, now);

  const detail = alert.detail ? scrubText(alert.detail, 1500) : undefined;
  console.error(`[alert] ${alert.title}${detail ? `: ${detail}` : ""}`);
  captureMessage(alert.title, {
    level: alert.severity === "warning" ? "warning" : "error",
    tags: { alert: alert.key },
    extra: detail ? { detail } : undefined,
  });

  const url = env.ALERT_WEBHOOK_URL;
  if (!url) return;
  const icon = alert.severity === "warning" ? "⚠️" : "🚨";
  const text = `${icon} Applyance (${env.APP_ENV || env.NODE_ENV || "development"}): ${alert.title}${detail ? `\n${detail}` : ""}`;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // `text` is read by Slack, `content` by Discord.
      body: JSON.stringify({ text, content: text.slice(0, 2000) }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) console.error(`[alert] webhook returned HTTP ${res.status}`);
  } catch (err) {
    console.error("[alert] webhook failed:", (err as Error).message);
  }
}

/** For tests. */
export function resetAlertHistory(): void {
  lastSent.clear();
}
