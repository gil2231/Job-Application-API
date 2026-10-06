"use server";

import { revalidatePath } from "next/cache";
import {
  addApplicationNote,
  approveForSubmission,
  approveQuestionAnswer,
  audit,
  markHumanStepComplete,
  markSubmittedByUser,
  prisma,
  recheckQuestion,
  rememberApprovedAnswer,
  retryApplications,
  retryScheduledNow,
  revokeBrowserSession,
  skipApplication,
  skipQuestion,
} from "@autoapply/database";
import { matchStandardQuestion } from "@autoapply/automation";
import { authedAction, parseIds, type ActionResult } from "@/lib/action";
import { notifyWorker } from "@/lib/worker-queue";

function refresh(applicationId?: string) {
  revalidatePath("/applications");
  revalidatePath("/flightpath");
  revalidatePath("/needs-attention");
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  revalidatePath("/automation");
  if (applicationId) revalidatePath(`/applications/${applicationId}`);
}

const one = (id: string) => parseIds([id])[0];

export async function retryApplicationsAction(ids: string[]): Promise<ActionResult> {
  return authedAction(async (user) => {
    const result = await retryApplications(user.id, parseIds(ids));
    await audit(user.id, "application.retried", { metadata: { ids, ...result } });
    if (result.retried) await notifyWorker(user.id);
    refresh();
    return result.retried ? { ok: true, message: `Requeued ${result.retried} application${result.retried === 1 ? "" : "s"}` } : { ok: false, message: "Only failed applications can be retried." };
  });
}

/** Skip the backoff wait on applications scheduled to retry later. */
export async function retryScheduledNowAction(ids: string[]): Promise<ActionResult> {
  return authedAction(async (user) => {
    const count = await retryScheduledNow(user.id, parseIds(ids));
    if (!count) return { ok: false, message: "Nothing is waiting to retry." };
    await audit(user.id, "application.retry_now", { metadata: { ids, count } });
    await notifyWorker(user.id);
    refresh();
    revalidatePath("/automation");
    return { ok: true, message: count === 1 ? "Retrying now" : `Retrying ${count} applications now` };
  });
}

export async function skipApplicationAction(id: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    const appId = one(id);
    if (!appId) return { ok: false, message: "Invalid id" };
    await skipApplication(user.id, appId);
    await audit(user.id, "application.skipped", { entityType: "Application", entityId: appId });
    refresh(appId);
    return { ok: true, message: "Application skipped" };
  });
}

export async function addNoteAction(id: string, note: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    const appId = one(id);
    const text = typeof note === "string" ? note.trim() : "";
    if (!appId || !text) return { ok: false, message: "Write a note first" };
    await addApplicationNote(user.id, appId, text);
    refresh(appId);
    return { ok: true, message: "Note added" };
  });
}

/** Approve a suggested answer, optionally after editing it, and optionally save it to the Answer Library. */
export async function approveAnswerAction(questionId: string, editedValue?: string, remember = false): Promise<ActionResult> {
  return authedAction(async (user) => {
    const qid = one(questionId);
    if (!qid) return { ok: false, message: "Invalid id" };
    if (editedValue != null && (typeof editedValue !== "string" || editedValue.length > 10_000)) return { ok: false, message: "Answer is too long" };
    await approveQuestionAnswer(user.id, qid, editedValue);
    await audit(user.id, editedValue != null ? "attention.answer_edited" : "attention.answer_approved", { entityType: "ApplicationQuestion", entityId: qid });
    if (remember === true) {
      const question = await prisma.applicationQuestion.findFirst({ where: { id: qid, application: { userId: user.id } }, select: { label: true, normalizedKey: true } });
      if (question && (await rememberApprovedAnswer(user.id, qid, matchStandardQuestion(question.label) ?? question.normalizedKey))) {
        await audit(user.id, "answer.remembered", { entityType: "ApplicationQuestion", entityId: qid });
      }
    }
    await notifyWorker(user.id);
    refresh();
    return { ok: true, message: remember ? "Answer approved and saved to your Answer Library" : "Answer approved" };
  });
}

export async function skipQuestionAction(questionId: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    const qid = one(questionId);
    if (!qid) return { ok: false, message: "Invalid id" };
    await skipQuestion(user.id, qid);
    await audit(user.id, "attention.question_skipped", { entityType: "ApplicationQuestion", entityId: qid });
    await notifyWorker(user.id);
    refresh();
    return { ok: true, message: "Question skipped" };
  });
}

export async function recheckQuestionAction(questionId: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    const qid = one(questionId);
    if (!qid) return { ok: false, message: "Invalid id" };
    await recheckQuestion(user.id, qid);
    await audit(user.id, "attention.question_rechecked", { entityType: "ApplicationQuestion", entityId: qid });
    await notifyWorker(user.id);
    refresh();
    return { ok: true, message: "AutoApply will check it again" };
  });
}

export async function completeHumanStepAction(applicationId: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    const appId = one(applicationId);
    if (!appId) return { ok: false, message: "Invalid id" };
    await markHumanStepComplete(user.id, appId);
    await audit(user.id, "attention.step_completed", { entityType: "Application", entityId: appId });
    await notifyWorker(user.id);
    refresh(appId);
    return { ok: true, message: "Thanks. The application is back in the queue and will resume." };
  });
}

/** Review mode's final step: let AutoApply submit the filled application. */
export async function approveSubmissionAction(applicationId: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    const appId = one(applicationId);
    if (!appId) return { ok: false, message: "Invalid id" };
    await approveForSubmission(user.id, appId);
    await audit(user.id, "application.submission_approved", { entityType: "Application", entityId: appId });
    await notifyWorker(user.id);
    refresh(appId);
    return { ok: true, message: "Approved. AutoApply will submit it next." };
  });
}

export async function markSubmittedAction(applicationId: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    const appId = one(applicationId);
    if (!appId) return { ok: false, message: "Invalid id" };
    await markSubmittedByUser(user.id, appId);
    await audit(user.id, "application.marked_submitted", { entityType: "Application", entityId: appId });
    refresh(appId);
    return { ok: true, message: "Marked as submitted" };
  });
}

export async function revokeBrowserSessionAction(id: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    const sessionId = one(id);
    if (!sessionId || !(await revokeBrowserSession(user.id, sessionId))) return { ok: false, message: "Session not found" };
    await audit(user.id, "browser_session.revoked", { entityType: "BrowserSession", entityId: sessionId });
    revalidatePath("/settings");
    return { ok: true, message: "Saved session removed. AutoApply will ask you to sign in again on that site." };
  });
}
