"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, createInterviewRound, deleteInterviewRound, moveApplicationStage, setInterviewStatus, updateInterviewRound } from "@autoapply/database";
import { INTERVIEW_STATUSES, interviewRoundSchema, STAGE_META, trackerStageSchema } from "@autoapply/shared";
import { authedAction, formToObject, parseIds, validationFailed, type ActionResult } from "@/lib/action";
import { notifyWorker } from "@/lib/worker-queue";

function refresh(applicationId?: string) {
  revalidatePath("/flightpath");
  revalidatePath("/applications");
  revalidatePath("/needs-attention");
  revalidatePath("/jobs");
  revalidatePath("/dashboard");
  if (applicationId) revalidatePath(`/applications/${applicationId}`);
}

const one = (id: unknown) => parseIds([id])[0];

/** Move an application to a Flightpath stage (drag and drop, or the Move to menu). */
export async function moveStageAction(applicationId: string, stage: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    const id = one(applicationId);
    const to = trackerStageSchema.safeParse(stage);
    if (!id || !to.success) return { ok: false, message: "Invalid request" };
    const result = await moveApplicationStage(user.id, id, to.data);
    if (result.kind === "none") return { ok: true };
    await audit(user.id, "application.stage_changed", { entityType: "Application", entityId: id, metadata: { from: result.from, to: result.to, kind: result.kind } });
    if (result.kind === "retry" || result.kind === "requeue") await notifyWorker(user.id);
    refresh(id);
    const label = STAGE_META[result.to].label;
    const message =
      result.kind === "retry" ? "Back in the queue for another try" : result.kind === "requeue" ? "Queued again" : result.kind === "skip" ? "Skipped" : result.kind === "mark_submitted" ? `Marked submitted and moved to ${label}` : `Moved to ${label}`;
    return { ok: true, message };
  });
}

export async function addInterviewAction(applicationId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return authedAction(async (user) => {
    const id = one(applicationId);
    if (!id) return { ok: false, message: "Invalid request" };
    const parsed = interviewRoundSchema.safeParse(formToObject(formData));
    if (!parsed.success) return validationFailed(parsed.error);
    const round = await createInterviewRound(user.id, id, parsed.data);
    await audit(user.id, "interview.created", { entityType: "InterviewRound", entityId: round.id, metadata: { applicationId: id } });
    refresh(id);
    return { ok: true, message: "Interview added" };
  });
}

export async function updateInterviewAction(roundId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return authedAction(async (user) => {
    const id = one(roundId);
    if (!id) return { ok: false, message: "Invalid request" };
    const parsed = interviewRoundSchema.safeParse(formToObject(formData));
    if (!parsed.success) return validationFailed(parsed.error);
    const round = await updateInterviewRound(user.id, id, parsed.data);
    await audit(user.id, "interview.updated", { entityType: "InterviewRound", entityId: id });
    refresh(round.applicationId);
    return { ok: true, message: "Interview saved" };
  });
}

/** Quick status change from the interview list (completed / cancelled / scheduled). */
export async function setInterviewStatusAction(roundId: string, status: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    const id = one(roundId);
    const parsed = z.enum(INTERVIEW_STATUSES).safeParse(status);
    if (!id || !parsed.success) return { ok: false, message: "Invalid request" };
    const round = await setInterviewStatus(user.id, id, parsed.data);
    await audit(user.id, "interview.updated", { entityType: "InterviewRound", entityId: id, metadata: { status: parsed.data } });
    refresh(round.applicationId);
    return { ok: true, message: parsed.data === "COMPLETED" ? "Marked completed" : parsed.data === "CANCELLED" ? "Marked cancelled" : "Marked scheduled" };
  });
}

export async function deleteInterviewAction(roundId: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    const id = one(roundId);
    if (!id) return { ok: false, message: "Invalid request" };
    const round = await deleteInterviewRound(user.id, id);
    await audit(user.id, "interview.deleted", { entityType: "InterviewRound", entityId: id });
    refresh(round.applicationId);
    return { ok: true, message: "Interview removed" };
  });
}
