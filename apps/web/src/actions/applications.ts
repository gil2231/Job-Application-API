"use server";

import { revalidatePath } from "next/cache";
import {
  addApplicationNote,
  approveQuestionAnswer,
  audit,
  markHumanStepComplete,
  markSubmittedByUser,
  retryApplications,
  setApplicationOutcome,
  skipApplication,
  skipQuestion,
} from "@autoapply/database";
import { applicationOutcomeSchema } from "@autoapply/shared";
import { authedAction, parseIds, type ActionResult } from "@/lib/action";

function refresh(applicationId?: string) {
  revalidatePath("/applications");
  revalidatePath("/needs-attention");
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  if (applicationId) revalidatePath(`/applications/${applicationId}`);
}

const one = (id: string) => parseIds([id])[0];

export async function retryApplicationsAction(ids: string[]): Promise<ActionResult> {
  return authedAction(async (user) => {
    const result = await retryApplications(user.id, parseIds(ids));
    await audit(user.id, "application.retried", { metadata: { ids, ...result } });
    refresh();
    return result.retried ? { ok: true, message: `Requeued ${result.retried} application${result.retried === 1 ? "" : "s"}` } : { ok: false, message: "Only failed applications can be retried." };
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

export async function setOutcomeAction(id: string, outcome: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    const appId = one(id);
    const parsed = applicationOutcomeSchema.safeParse(outcome);
    if (!appId || !parsed.success) return { ok: false, message: "Invalid request" };
    await setApplicationOutcome(user.id, appId, parsed.data);
    await audit(user.id, "application.outcome_set", { entityType: "Application", entityId: appId, metadata: { outcome: parsed.data } });
    refresh(appId);
    return { ok: true, message: "Outcome recorded" };
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

export async function approveAnswerAction(questionId: string, editedValue?: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    const qid = one(questionId);
    if (!qid) return { ok: false, message: "Invalid id" };
    if (editedValue != null && (typeof editedValue !== "string" || editedValue.length > 10_000)) return { ok: false, message: "Answer is too long" };
    await approveQuestionAnswer(user.id, qid, editedValue);
    await audit(user.id, editedValue != null ? "attention.answer_edited" : "attention.answer_approved", { entityType: "ApplicationQuestion", entityId: qid });
    refresh();
    return { ok: true, message: "Answer approved" };
  });
}

export async function skipQuestionAction(questionId: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    const qid = one(questionId);
    if (!qid) return { ok: false, message: "Invalid id" };
    await skipQuestion(user.id, qid);
    await audit(user.id, "attention.question_skipped", { entityType: "ApplicationQuestion", entityId: qid });
    refresh();
    return { ok: true, message: "Question skipped" };
  });
}

export async function completeHumanStepAction(applicationId: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    const appId = one(applicationId);
    if (!appId) return { ok: false, message: "Invalid id" };
    await markHumanStepComplete(user.id, appId);
    await audit(user.id, "attention.step_completed", { entityType: "Application", entityId: appId });
    refresh(appId);
    return { ok: true, message: "Thanks. The application is back in the queue and will resume." };
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
