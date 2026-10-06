"use server";

import { revalidatePath } from "next/cache";
import {
  audit,
  changePassword,
  revokeOtherSessions,
  revokeSession,
  saveAutomationRule,
  saveUserSettings,
  updateUserName,
} from "@autoapply/database";
import { automationRuleSchema, changePasswordSchema, MATCH_DIMENSIONS, userSettingsSchema } from "@autoapply/shared";
import { rescoreJobs } from "@autoapply/ingestion";
import { authedAction, formToObject, validationFailed, type ActionResult } from "@/lib/action";

export async function saveRulesAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return authedAction(async (user) => {
    const raw = formToObject(formData);
    const input = {
      ...raw,
      workArrangements: formData.getAll("workArrangements"),
      employmentTypes: formData.getAll("employmentTypes"),
      matchWeights: Object.fromEntries(MATCH_DIMENSIONS.map((d) => [d, raw[`weight_${d}`]])),
    };
    const parsed = automationRuleSchema.safeParse(input);
    if (!parsed.success) return validationFailed(parsed.error);
    await saveAutomationRule(user.id, parsed.data);
    await audit(user.id, "rules.updated", { entityType: "AutomationRule", metadata: { autoSubmitEnabled: parsed.data.autoSubmitEnabled, minMatchScore: parsed.data.minMatchScore } });
    // Rules decide scores and qualification, so every waiting job is re-checked now.
    const result = await rescoreJobs(user.id);
    revalidatePath("/rules");
    revalidatePath("/jobs");
    revalidatePath("/dashboard");
    return {
      ok: true,
      message: result.rescored ? `Rules saved. ${result.qualified} of ${result.rescored} waiting jobs qualify.` : "Rules saved",
    };
  });
}

export async function saveSettingsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return authedAction(async (user) => {
    const parsed = userSettingsSchema.safeParse(formToObject(formData));
    if (!parsed.success) return validationFailed(parsed.error);
    await saveUserSettings(user.id, parsed.data);
    await audit(user.id, "settings.updated", { entityType: "UserSetting" });
    revalidatePath("/settings");
    return { ok: true, message: "Settings saved" };
  });
}

export async function updateNameAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return authedAction(async (user) => {
    const name = String(formData.get("name") ?? "").trim();
    if (!name || name.length > 120) return { ok: false, errors: { name: "Enter your name" }, message: "Enter your name" };
    await updateUserName(user.id, name);
    await audit(user.id, "account.name_updated");
    revalidatePath("/", "layout");
    return { ok: true, message: "Name updated" };
  });
}

export async function changePasswordAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return authedAction(async (user) => {
    const parsed = changePasswordSchema.safeParse(formToObject(formData));
    if (!parsed.success) return validationFailed(parsed.error);
    const ok = await changePassword(user.id, parsed.data.currentPassword, parsed.data.newPassword);
    if (!ok) return { ok: false, errors: { currentPassword: "Current password is incorrect" }, message: "Current password is incorrect" };
    // A password change signs out every other device.
    await revokeOtherSessions(user.id, user.sessionId);
    await audit(user.id, "account.password_changed");
    revalidatePath("/settings");
    return { ok: true, message: "Password changed. Other sessions were signed out." };
  });
}

export async function revokeSessionAction(sessionId: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    if (sessionId === user.sessionId) return { ok: false, message: "Use Sign out to end this session" };
    const ok = await revokeSession(user.id, sessionId);
    if (!ok) return { ok: false, message: "Session not found" };
    await audit(user.id, "account.session_revoked", { entityType: "Session", entityId: sessionId });
    revalidatePath("/settings");
    return { ok: true, message: "Session signed out" };
  });
}

export async function revokeOtherSessionsAction(): Promise<ActionResult> {
  return authedAction(async (user) => {
    const count = await revokeOtherSessions(user.id, user.sessionId);
    await audit(user.id, "account.other_sessions_revoked", { metadata: { count } });
    revalidatePath("/settings");
    return { ok: true, message: `Signed out ${count} other session${count === 1 ? "" : "s"}` };
  });
}
