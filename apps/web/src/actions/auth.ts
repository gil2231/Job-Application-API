"use server";

import { redirect } from "next/navigation";
import { audit, authenticate, createUser, EmailTakenError } from "@autoapply/database";
import { signInSchema, signUpSchema } from "@autoapply/shared";
import { endSession, getSession, startSession } from "@/lib/auth";
import { formToObject, validationFailed, type ActionResult } from "@/lib/action";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { getRequestContext } from "@/lib/request";

/** Only allow same-site relative redirects after sign-in. */
function safeNext(value: FormDataEntryValue | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/dashboard";
}

export async function signInAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = signInSchema.safeParse(formToObject(formData));
  if (!parsed.success) return validationFailed(parsed.error);
  const ctx = await getRequestContext();

  const byIp = await rateLimit(`signin:ip:${ctx.ipAddress}`, LIMITS.signIn.limit, LIMITS.signIn.windowMs);
  const byEmail = await rateLimit(`signin:email:${parsed.data.email}`, LIMITS.signIn.limit, LIMITS.signIn.windowMs);
  if (!byIp.allowed || !byEmail.allowed) {
    return { ok: false, message: `Too many sign-in attempts. Try again in ${Math.ceil(Math.max(byIp.retryAfterSeconds, byEmail.retryAfterSeconds) / 60)} minutes.` };
  }

  const result = await authenticate(parsed.data.email, parsed.data.password);
  if (!result.ok) {
    await audit(null, result.reason === "locked" ? "auth.sign_in_locked" : "auth.sign_in_failed", { metadata: { email: parsed.data.email }, context: ctx });
    return {
      ok: false,
      message: result.reason === "locked" ? "Too many failed attempts. This account is locked for 15 minutes." : "Incorrect email or password.",
    };
  }
  await startSession(result.user.id, ctx);
  await audit(result.user.id, "auth.sign_in", { context: ctx });
  redirect(safeNext(formData.get("next")));
}

export async function signUpAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = signUpSchema.safeParse(formToObject(formData));
  if (!parsed.success) return validationFailed(parsed.error);
  const ctx = await getRequestContext();
  const limit = await rateLimit(`signup:ip:${ctx.ipAddress}`, LIMITS.signUp.limit, LIMITS.signUp.windowMs);
  if (!limit.allowed) return { ok: false, message: "Too many accounts created from this network. Try again later." };

  try {
    const user = await createUser(parsed.data);
    await startSession(user.id, ctx);
    await audit(user.id, "auth.sign_up", { context: ctx });
  } catch (error) {
    if (error instanceof EmailTakenError) return { ok: false, errors: { email: error.message }, message: error.message };
    throw error;
  }
  redirect("/profile");
}

export async function signOutAction(): Promise<void> {
  const session = await getSession();
  if (session) await audit(session.user.id, "auth.sign_out", { context: await getRequestContext() });
  await endSession();
  redirect("/sign-in");
}
