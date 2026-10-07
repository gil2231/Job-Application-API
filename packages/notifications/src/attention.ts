import {
  countWaitingApplications,
  findPendingAttentionEvents,
  lastNotificationAt,
  markEventsNotified,
  recordNotification,
  releaseEventsNotified,
  type PendingAttentionEvent,
} from "@autoapply/database";
import { ATTENTION_APPLICATION_STATUSES } from "@autoapply/shared";
import type { EmailSender } from "./email";
import { appUrl, unsubscribeHeaders, unsubscribeUrl } from "./links";
import { needsAttentionEmail, type AttentionItem } from "./templates";

export interface AttentionAlertOptions {
  sender: EmailSender;
  now?: Date;
  /** Wait this long after an application pauses, so several pauses in a row become one email. */
  settleMs?: number;
  /** At most one Needs Attention email per user in this window; later pauses wait and go out together. */
  cooldownMs?: number;
  /** Give up on alerts older than this (for example after a long email outage). */
  maxAgeMs?: number;
  env?: NodeJS.ProcessEnv;
}

export interface AttentionAlertResult {
  sent: number;
  failed: number;
  skipped: number;
}

export const ATTENTION_DEFAULTS = { settleMs: 2 * 60_000, cooldownMs: 15 * 60_000, maxAgeMs: 24 * 60 * 60_000 };

const isStillWaiting = (event: PendingAttentionEvent) => (ATTENTION_APPLICATION_STATUSES as readonly string[]).includes(event.application.status);

/**
 * Email people whose applications stopped and are waiting on them (CAPTCHA,
 * sign-in, questions to answer, final review). Each pause is covered by one
 * email at most; pauses the person already dealt with are dropped silently.
 */
export async function sendAttentionAlerts(options: AttentionAlertOptions): Promise<AttentionAlertResult> {
  const now = options.now ?? new Date();
  const settleMs = options.settleMs ?? ATTENTION_DEFAULTS.settleMs;
  const cooldownMs = options.cooldownMs ?? ATTENTION_DEFAULTS.cooldownMs;
  const maxAgeMs = options.maxAgeMs ?? ATTENTION_DEFAULTS.maxAgeMs;
  const env = options.env ?? process.env;
  const result: AttentionAlertResult = { sent: 0, failed: 0, skipped: 0 };

  const pending = await findPendingAttentionEvents({ before: new Date(now.getTime() - settleMs) });
  const byUser = new Map<string, PendingAttentionEvent[]>();
  for (const event of pending) byUser.set(event.userId, [...(byUser.get(event.userId) ?? []), event]);

  for (const [userId, events] of byUser) {
    const stale = events.filter((e) => now.getTime() - e.createdAt.getTime() > maxAgeMs);
    const fresh = events.filter((e) => !stale.includes(e));
    const waiting = fresh.filter(isStillWaiting);
    const wantsEmail = events[0]!.user.settings?.emailNotifications ?? true;

    // Nothing to tell them: already handled, too old, or they turned these emails off.
    const drop = wantsEmail ? [...stale, ...fresh.filter((e) => !isStillWaiting(e))] : events;
    if (drop.length) await markEventsNotified(drop.map((e) => e.id), now);
    if (!wantsEmail || !waiting.length) continue;

    const last = await lastNotificationAt(userId, "NEEDS_ATTENTION");
    if (last && now.getTime() - last.getTime() < cooldownMs) continue;

    const ids = waiting.map((e) => e.id);
    if ((await markEventsNotified(ids, now)) === 0) continue; // another worker is sending this one

    // One line per application, using its current state (it may have paused twice).
    const latest = new Map<string, PendingAttentionEvent>();
    for (const e of waiting) latest.set(e.application.id, e);
    const items: AttentionItem[] = [...latest.values()].map((e) => ({
      applicationId: e.application.id,
      title: e.application.job.title,
      company: e.application.job.company,
      reason: e.application.attentionReason,
      detail: e.application.attentionDetail ?? e.message,
    }));
    const { email, name } = events[0]!.user;
    const message = needsAttentionEmail({
      to: email,
      name,
      items,
      totalWaiting: await countWaitingApplications(userId),
      needsAttentionUrl: appUrl("/needs-attention", env),
      applicationUrl: (id) => appUrl(`/applications/${id}`, env),
      settingsUrl: appUrl("/settings#notifications", env),
      unsubscribeUrl: unsubscribeUrl(userId, "attention", env),
      headers: unsubscribeHeaders(userId, "attention", env),
    });
    const data = { applicationIds: items.map((i) => i.applicationId) };

    if (!options.sender.configured) {
      await recordNotification({ userId, createdAt: now, kind: "NEEDS_ATTENTION", status: "SKIPPED", recipient: email, subject: message.subject, data, error: "No email provider is set up" });
      result.skipped += 1;
      continue;
    }
    try {
      const sent = await options.sender.send(message);
      await recordNotification({ userId, createdAt: now, kind: "NEEDS_ATTENTION", status: "SENT", recipient: email, subject: message.subject, data, providerMessageId: sent.id });
      result.sent += 1;
    } catch (error) {
      // Try again after the cooldown, until the alert is too old to be useful.
      await releaseEventsNotified(ids);
      await recordNotification({ userId, createdAt: now, kind: "NEEDS_ATTENTION", status: "FAILED", recipient: email, subject: message.subject, data, error: error instanceof Error ? error.message : String(error) });
      result.failed += 1;
    }
  }
  return result;
}
