/** The user settling an email Applyance couldn't place. */
import { ConflictError, getEmailMessage, NotFoundError, prisma, recordStageSignal, setEmailMessageResult } from "@autoapply/database";
import { INTERVIEW_KINDS, isPostSubmitStage, SENT_STATUSES, TRACKER_STAGES, type InterviewKind, type PostSubmitStage, type TrackerStage } from "@autoapply/shared";
import { SIGNAL_PROVIDER } from "./sync";

interface StoredInterview {
  scheduledAt?: string | null;
  durationMinutes?: number | null;
  location?: string | null;
  kind?: string | null;
  fromInvite?: boolean;
}

/**
 * Attach an email to one of the user's sent applications and apply it as if
 * it had matched: a confident forward move updates the card, anything else
 * becomes a note on its timeline.
 */
export async function linkEmailToApplication(userId: string, emailId: string, applicationId: string) {
  const email = await getEmailMessage(userId, emailId);
  const app = await prisma.application.findFirst({ where: { id: applicationId, userId, status: { in: [...SENT_STATUSES] } }, select: { id: true, job: { select: { company: true } } } });
  if (!app) throw new NotFoundError("Application");
  if (!email.stage || !(TRACKER_STAGES as readonly string[]).includes(email.stage) || !isPostSubmitStage(email.stage as TrackerStage)) {
    await setEmailMessageResult(userId, emailId, { outcome: "NO_CHANGE", applicationId: app.id });
    return { outcome: "NO_CHANGE" as const };
  }
  const i = (email.interview ?? null) as StoredInterview | null;
  const connection = await prisma.mailConnection.findUnique({ where: { id: email.connectionId }, select: { autoUpdate: true } });
  const result = await recordStageSignal(
    userId,
    SIGNAL_PROVIDER[email.connection.provider],
    {
      applicationId: app.id,
      company: app.job.company,
      stage: email.stage as PostSubmitStage,
      occurredAt: email.receivedAt,
      confidence: email.confidence,
      evidence: `"${email.subject.slice(0, 200)}"${email.fromName ? ` from ${email.fromName}` : ""}`,
      externalId: email.externalId,
      interview: i
        ? {
            scheduledAt: i.scheduledAt ? new Date(i.scheduledAt) : undefined,
            durationMinutes: i.durationMinutes ?? undefined,
            location: i.location ?? undefined,
            kind: i.kind && (INTERVIEW_KINDS as readonly string[]).includes(i.kind) ? (i.kind as InterviewKind) : undefined,
            fromInvite: i.fromInvite,
          }
        : undefined,
    },
    // The user picked the application, so anything not applied is left as a note rather than dropped.
    { minConfidence: connection?.autoUpdate === false ? 101 : 90 },
  );
  if (result.result === "unmatched" || result.result === "ambiguous") throw new ConflictError("That application can't take email updates.");
  const outcome = result.result === "applied" ? "MOVED" : result.result === "interview_added" ? "INTERVIEW_ADDED" : result.result === "suggested" ? "SUGGESTED" : "NO_CHANGE";
  await setEmailMessageResult(userId, emailId, { outcome, applicationId: app.id });
  return { outcome, result };
}

export async function dismissEmail(userId: string, emailId: string) {
  await setEmailMessageResult(userId, emailId, { outcome: "DISMISSED" });
}
