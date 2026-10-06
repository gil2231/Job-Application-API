"use server";

import { revalidatePath } from "next/cache";
import { audit, saveRecommendationKeywords } from "@autoapply/database";
import { recommendationKeywordsSchema } from "@autoapply/shared";
import { authedAction, formToObject, validationFailed, type ActionResult } from "@/lib/action";

export async function saveRecommendationKeywordsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return authedAction(async (user) => {
    const parsed = recommendationKeywordsSchema.safeParse(formToObject(formData));
    if (!parsed.success) return validationFailed(parsed.error);
    await saveRecommendationKeywords(user.id, parsed.data.keywords);
    await audit(user.id, "recommendations.keywords_updated", { entityType: "MasterProfile", metadata: { count: parsed.data.keywords.length } });
    revalidatePath("/recommended");
    return { ok: true, message: parsed.data.keywords.length ? "Keywords saved. Recommendations updated." : "Keywords cleared. Recommendations now use your match score only." };
  });
}
