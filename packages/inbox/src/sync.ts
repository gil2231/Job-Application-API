/**
 * One sync of a connected account: read new job-related email into
 * Flightpath, then bring the calendar in step. The worker runs this on a
 * schedule; "Sync now" runs it from the web app. A lease on the connection
 * keeps two syncs of the same account from overlapping.
 */
import { resolveProvider, type AIProvider } from "@autoapply/ai";
import {
  claimMailSync,
  findKnownEmailIds,
  findThreadApplication,
  finishMailSync,
  getMailConnectionForSync,
  getUserSettings,
  listApplicationsForEmailMatching,
  markMailConnectionNeedsReconnect,
  recordStageSignal,
  saveEmailMessage,
  type EmailMatchCandidate,
  type EmailMessageInput,
  type MailConnectionForSync,
  type StageSignalResult,
} from "@autoapply/database";
import type { StageSignal } from "@autoapply/shared";
import { classifyWithAI, combineReadings } from "./ai";
import { syncCalendar, type CalendarSyncReport } from "./calendar";
import { classifyEmail, type EmailClassification } from "./classify";
import { createProviderClient, type ClientOptions } from "./clients";
import { ProviderAuthError } from "./http";
import { matchApplication, mightBeAboutApplications } from "./match";
import { isIgnoredSender } from "./senders";
import { senderDomain } from "./text";
import type { CalendarClient, MailClient, MailMessage } from "./types";

/** Provider ids written on the timeline ("Moved … (from Gmail)"). */
export const SIGNAL_PROVIDER = { GOOGLE: "Gmail", MICROSOFT: "Outlook" } as const;

/** How far back the first sync of a new connection reads. */
export const FIRST_SYNC_DAYS = 30;
/** Each sync re-reads a little before the last one, for mail that arrives late. */
const OVERLAP_MS = 2 * 60 * 60 * 1000;
const MAX_MESSAGES = 300;
const LEASE_MS = 5 * 60 * 1000;

export interface EmailSyncReport {
  scanned: number;
  read: number;
  moved: number;
  interviewsAdded: number;
  suggested: number;
  unmatched: number;
}

export interface SyncReport {
  status: "ok" | "busy" | "reconnect" | "error" | "missing";
  email?: EmailSyncReport;
  calendar?: CalendarSyncReport;
  error?: string;
}

export interface SyncOptions extends ClientOptions {
  now?: () => Date;
  /** Provide clients directly (tests). */
  client?: MailClient & CalendarClient;
  /** AI provider for unclear emails; defaults to the user's settings. null turns AI off. */
  ai?: AIProvider | null;
  appUrl?: string;
}

const OUTCOMES: Record<StageSignalResult["result"], EmailMessageInput["outcome"]> = {
  applied: "MOVED",
  interview_added: "INTERVIEW_ADDED",
  no_change: "NO_CHANGE",
  duplicate: "NO_CHANGE",
  suggested: "SUGGESTED",
  unmatched: "UNMATCHED",
  ambiguous: "AMBIGUOUS",
};

export function signalFor(email: { id: string; subject: string; fromName: string | null; receivedAt: Date }, reading: EmailClassification, applicationId: string, company: string): StageSignal {
  const sender = email.fromName ? ` from ${email.fromName}` : "";
  return {
    applicationId,
    company,
    stage: reading.stage!,
    occurredAt: email.receivedAt,
    confidence: reading.confidence,
    evidence: `"${email.subject.slice(0, 200)}"${sender}`,
    externalId: email.id,
    interview: reading.interview,
  };
}

export function interviewJson(reading: Pick<EmailClassification, "interview">) {
  const i = reading.interview;
  if (!i) return null;
  return { scheduledAt: i.scheduledAt?.toISOString() ?? null, durationMinutes: i.durationMinutes ?? null, location: i.location ?? null, kind: i.kind ?? null, fromInvite: i.fromInvite ?? false };
}

async function readEmail(connection: MailConnectionForSync, client: MailClient, options: SyncOptions, now: Date): Promise<EmailSyncReport> {
  const report: EmailSyncReport = { scanned: 0, read: 0, moved: 0, interviewsAdded: 0, suggested: 0, unmatched: 0 };
  const applications = await listApplicationsForEmailMatching(connection.userId);
  if (applications.length === 0) return report;
  const settings = await getUserSettings(connection.userId);
  const timeZone = settings.timezone || "UTC";
  const ai = options.ai !== undefined ? options.ai : resolveProvider({ provider: settings.aiProvider, model: settings.aiModel }).provider;

  const firstSync = new Date(now.getTime() - FIRST_SYNC_DAYS * 86_400_000);
  const since = connection.syncedThrough ? new Date(Math.max(connection.syncedThrough.getTime() - OVERLAP_MS, firstSync.getTime())) : firstSync;
  const companies = [...new Set(applications.map((a) => a.company))];
  const summaries = await client.listRecent(since, { limit: MAX_MESSAGES, companies });
  report.scanned = summaries.length;
  const known = await findKnownEmailIds(connection.id, summaries.map((s) => s.id));
  // Oldest first, so a rejection after an interview invite lands last.
  const fresh = summaries.filter((s) => !known.has(s.id)).sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());
  const byId = new Map<string, EmailMatchCandidate>(applications.map((a) => [a.id, a]));
  const minConfidence = connection.autoUpdate ? 90 : 101;

  for (const summary of fresh) {
    const domain = senderDomain(summary.fromAddress);
    if (!summary.fromAddress || summary.fromAddress === connection.email || isIgnoredSender(domain)) continue;
    if (!mightBeAboutApplications(summary, companies)) continue;
    let message: MailMessage;
    try {
      message = await client.getMessage(summary.id);
    } catch (error) {
      if (error instanceof ProviderAuthError) throw error;
      continue;
    }
    report.read++;
    let reading = classifyEmail(message, timeZone);
    if (ai && (!reading || reading.confidence < 90)) {
      try {
        reading = combineReadings(reading, await classifyWithAI(ai, message, timeZone), message);
      } catch (error) {
        console.warn("[inbox] AI classification failed; using the rules", (error as Error).message);
      }
    }
    if (!reading) continue;

    const threadApp = message.threadId ? await findThreadApplication(connection.id, message.threadId) : null;
    const match = matchApplication(message, applications, threadApp);
    const base: EmailMessageInput = {
      externalId: message.id,
      threadId: message.threadId,
      fromName: message.fromName,
      fromAddress: message.fromAddress,
      subject: message.subject || "(no subject)",
      snippet: (message.snippet || message.text).replace(/\s+/g, " ").trim().slice(0, 240),
      receivedAt: message.receivedAt,
      kind: reading.kind,
      stage: reading.stage,
      confidence: reading.confidence,
      outcome: "NO_CHANGE",
      interview: interviewJson(reading),
    };

    if (match.result !== "matched") {
      // An unmatched "thanks for applying" is about something applied to elsewhere: not kept.
      if (reading.kind === "CONFIRMATION") continue;
      await saveEmailMessage(connection.userId, connection.id, { ...base, outcome: match.result === "ambiguous" ? "AMBIGUOUS" : "UNMATCHED" });
      report.unmatched++;
      continue;
    }
    const app = byId.get(match.applicationId)!;
    if (!reading.stage) {
      await saveEmailMessage(connection.userId, connection.id, { ...base, applicationId: app.id });
      continue;
    }
    // A company named only in the body is a weaker match: suggest, don't move.
    if (match.strength === "body") reading = { ...reading, confidence: Math.min(reading.confidence, 85) };
    const result = await recordStageSignal(connection.userId, SIGNAL_PROVIDER[connection.provider], signalFor(message, reading, app.id, app.company), { minConfidence, quietWhenNotForward: true });
    const outcome = OUTCOMES[result.result];
    await saveEmailMessage(connection.userId, connection.id, { ...base, confidence: reading.confidence, outcome, applicationId: "applicationId" in result ? result.applicationId : app.id });
    if (outcome === "MOVED") report.moved++;
    if (outcome === "INTERVIEW_ADDED") report.interviewsAdded++;
    if (outcome === "SUGGESTED") report.suggested++;
  }
  return report;
}

/** Sync one connection. Never throws; the report says what happened. */
export async function syncMailConnection(connectionId: string, options: SyncOptions = {}): Promise<SyncReport> {
  const now = options.now?.() ?? new Date();
  if (!(await claimMailSync(connectionId, LEASE_MS, now))) return { status: "busy" };
  const connection = await getMailConnectionForSync(connectionId);
  if (!connection) return { status: "missing" };
  const report: SyncReport = { status: "ok" };
  try {
    const client = options.client ?? createProviderClient(connection, options);
    if (connection.readEmail) report.email = await readEmail(connection, client, options, now);
    report.calendar = await syncCalendar(
      { userId: connection.userId, connectionId: connection.id, calendarSync: connection.calendarSync },
      client,
      { appUrl: options.appUrl ?? process.env.APP_URL ?? "http://localhost:3000", now },
    );
    await finishMailSync(connection.id, { finishedAt: new Date(), syncedThrough: connection.readEmail ? now : undefined });
    return report;
  } catch (error) {
    if (error instanceof ProviderAuthError) {
      await markMailConnectionNeedsReconnect(connection.id, error.message);
      return { ...report, status: "reconnect", error: error.message };
    }
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`[inbox] sync of ${connection.id} failed`, error);
    await finishMailSync(connection.id, { finishedAt: new Date(), error: msg });
    return { ...report, status: "error", error: msg };
  }
}

/**
 * Bring a user's calendar in step now (after they add or change an interview).
 * Waits briefly if a full sync holds the account; the next sync catches up otherwise.
 */
export async function syncUserCalendar(userId: string, connectionId: string, options: SyncOptions = {}): Promise<SyncReport> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const now = options.now?.() ?? new Date();
    if (await claimMailSync(connectionId, LEASE_MS, now)) {
      const connection = await getMailConnectionForSync(connectionId);
      if (!connection || connection.userId !== userId) {
        await finishMailSync(connectionId, { finishedAt: connection?.lastSyncedAt ?? new Date() });
        return { status: "missing" };
      }
      try {
        const client = options.client ?? createProviderClient(connection, options);
        const calendar = await syncCalendar({ userId, connectionId, calendarSync: connection.calendarSync }, client, { appUrl: options.appUrl ?? process.env.APP_URL ?? "http://localhost:3000", now });
        // Keep the scheduled sync's timing: this was only the calendar.
        await finishMailSync(connectionId, { finishedAt: connection.lastSyncedAt ?? new Date(0), error: connection.lastError });
        return { status: "ok", calendar };
      } catch (error) {
        if (error instanceof ProviderAuthError) {
          await markMailConnectionNeedsReconnect(connectionId, error.message);
          return { status: "reconnect", error: error.message };
        }
        await finishMailSync(connectionId, { finishedAt: connection.lastSyncedAt ?? new Date(0), error: connection.lastError });
        return { status: "error", error: (error as Error).message };
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { status: "busy" };
}
