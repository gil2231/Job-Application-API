"use server";

import { revalidatePath } from "next/cache";
import { audit, createAnswer, deleteAnswer, getAnswerSuggestions, updateAnswer } from "@autoapply/database";
import { answerSchema } from "@autoapply/shared";
import { authedAction, formToObject, validationFailed, type ActionResult } from "@/lib/action";

const ID = /^[a-z0-9]{20,40}$/i;

export async function saveAnswerAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return authedAction(async (user) => {
    const parsed = answerSchema.safeParse(formToObject(formData));
    if (!parsed.success) return validationFailed(parsed.error);
    const id = formData.get("id");
    if (typeof id === "string" && ID.test(id)) {
      await updateAnswer(user.id, id, parsed.data);
      await audit(user.id, "answer.updated", { entityType: "ApplicationAnswer", entityId: id, metadata: { category: parsed.data.category } });
    } else {
      // Mark the source as PROFILE only when the answer is exactly what the profile states.
      const suggestion = parsed.data.questionKey ? (await getAnswerSuggestions(user.id)).find((s) => s.key === parsed.data.questionKey) : undefined;
      const fromProfile = !!suggestion?.derived && suggestion.derived.answer === parsed.data.answer;
      const created = await createAnswer(user.id, parsed.data, fromProfile ? "PROFILE" : "USER");
      await audit(user.id, "answer.created", { entityType: "ApplicationAnswer", entityId: created.id, metadata: { category: parsed.data.category } });
    }
    revalidatePath("/answers");
    return { ok: true, message: "Answer saved" };
  });
}

export async function deleteAnswerAction(id: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    if (!ID.test(id)) return { ok: false, message: "Invalid id" };
    await deleteAnswer(user.id, id);
    await audit(user.id, "answer.deleted", { entityType: "ApplicationAnswer", entityId: id });
    revalidatePath("/answers");
    return { ok: true, message: "Answer deleted" };
  });
}
