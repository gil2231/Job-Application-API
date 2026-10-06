"use server";

import { redirect } from "next/navigation";
import {
  audit,
  authenticate,
  consumeAuthToken,
  createAuthToken,
  createUser,
  EmailTakenError,
  findUserIdByEmail,
  getAccountFlags,
  getTwoFactorStatus,
  markEmailVerified,
  resetPasswordWithToken,
  verifySecondFactor,
} from "@autoapply/database";
import { forgotPasswordSchema, resetPasswordSchema, signInSchema, signUpSchema, twoFactorCodeSchema } from "@autoapply/shared";
import { endSession, getSession, startSession } from "@/lib/auth";
import { authedAction, formToObject, validationFailed, type ActionResult } from "@/lib/action";
import { linkEmail, sendEmail } from "@/lib/mailer";
import { clearPendingSignIn, getPendingSignIn, setPendingSignIn } from "@/lib/pending-sign-in";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { getRequestContext } from "@/lib/request";
import { appUrl } from "@/lib/stripe";

/** Only allow same-site relative redirects after sign-in. */
function safeNext(value: FormDataEntryValue | string | null): string {
  const next = typeof value === "string" ? value : "";
  return next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/dashboard";
}

export async function signInAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = signInSchema.safeParse(formToObject(formData));
  if (!parsed.success) return validationFailed(parsed.error);
  const ctx = await getRequestContext();

  const byIp = rateLimit(`signin:ip:${ctx.ipAddress}`, LIMITS.signIn.limit, LIMITS.signIn.windowMs);
  const byEmail = rateLimit(`signin:email:${parsed.data.email}`, LIMITS.signIn.limit, LIMITS.signIn.windowMs);
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
  const next = safeNext(formData.get("next"));
  if ((await getTwoFactorStatus(result.user.id)).enabled) {
    // The password was right; a session starts only after the second factor.
    await setPendingSignIn(result.user.id, next);
    await audit(result.user.id, "auth.two_factor_challenged", { context: ctx });
    redirect("/sign-in/two-factor");
  }
  await startSession(result.user.id, ctx);
  await audit(result.user.id, "auth.sign_in", { context: ctx });
  redirect(next);
}

export async function verifyTwoFactorSignInAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const pending = await getPendingSignIn();
  if (!pending) return { ok: false, message: "Your sign-in timed out. Enter your email and password again." };
  const parsed = twoFactorCodeSchema.safeParse(formToObject(formData));
  if (!parsed.success) return validationFailed(parsed.error);
  const ctx = await getRequestContext();
  const limit = rateLimit(`2fa:${pending.userId}`, LIMITS.twoFactor.limit, LIMITS.twoFactor.windowMs);
  if (!limit.allowed) return { ok: false, message: `Too many codes tried. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.` };

  const check = await verifySecondFactor(pending.userId, parsed.data.code);
  if (!check.ok) {
    await audit(pending.userId, "auth.two_factor_failed", { context: ctx });
    return { ok: false, errors: { code: "That code didn't work" }, message: "That code didn't work. Check your authenticator app and try again." };
  }
  await clearPendingSignIn();
  await startSession(pending.userId, ctx);
  await audit(pending.userId, check.method === "recovery" ? "auth.sign_in_recovery_code" : "auth.sign_in", { context: ctx, metadata: { twoFactor: check.method } });
  redirect(safeNext(pending.next));
}

async function sendVerificationEmail(user: { id: string; email: string; name: string }) {
  const token = await createAuthToken(user.id, "EMAIL_VERIFY");
  await sendEmail(
    linkEmail({
      to: user.email,
      subject: "Confirm your email for Applyance",
      greeting: `Hi ${user.name.split(" ")[0]},`,
      body: "Confirm this is your email address so we can send you password resets and important account notices.",
      button: "Confirm email",
      url: appUrl(`/verify-email?token=${encodeURIComponent(token)}`),
      footer: "The link works for 3 days. If you didn't create an Applyance account, you can ignore this email.",
    }),
  );
}

export async function signUpAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = signUpSchema.safeParse(formToObject(formData));
  if (!parsed.success) return validationFailed(parsed.error);
  const ctx = await getRequestContext();
  const limit = rateLimit(`signup:ip:${ctx.ipAddress}`, LIMITS.signUp.limit, LIMITS.signUp.windowMs);
  if (!limit.allowed) return { ok: false, message: "Too many accounts created from this network. Try again later." };

  try {
    const user = await createUser(parsed.data);
    await startSession(user.id, ctx);
    await audit(user.id, "auth.sign_up", { context: ctx });
    await sendVerificationEmail(user).catch((error) => console.error("[auth] couldn't send the verification email", error));
  } catch (error) {
    if (error instanceof EmailTakenError) return { ok: false, errors: { email: error.message }, message: error.message };
    throw error;
  }
  redirect("/welcome");
}

export async function resendVerificationAction(): Promise<ActionResult> {
  return authedAction(async (user) => {
    if ((await getAccountFlags(user.id)).emailVerified) return { ok: true, message: "Your email is already confirmed" };
    const limit = rateLimit(`verify-email:${user.id}`, LIMITS.emailSend.limit, LIMITS.emailSend.windowMs);
    if (!limit.allowed) return { ok: false, message: `You've asked for several emails. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.` };
    await sendVerificationEmail(user);
    return { ok: true, message: `Sent a new link to ${user.email}` };
  });
}

/** Used by the /verify-email page. */
export async function verifyEmailToken(token: string): Promise<boolean> {
  const userId = await consumeAuthToken(token, "EMAIL_VERIFY");
  if (!userId) return false;
  await markEmailVerified(userId);
  await audit(userId, "account.email_verified", { context: await getRequestContext() });
  return true;
}

const FORGOT_SENT = "If an account uses that email, we've sent it a link to reset the password. It works for one hour.";

export async function forgotPasswordAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(formToObject(formData));
  if (!parsed.success) return validationFailed(parsed.error);
  const ctx = await getRequestContext();
  const byIp = rateLimit(`forgot:ip:${ctx.ipAddress}`, LIMITS.emailSend.limit * 2, LIMITS.emailSend.windowMs);
  const byEmail = rateLimit(`forgot:email:${parsed.data.email}`, LIMITS.emailSend.limit, LIMITS.emailSend.windowMs);
  // The reply is the same whether or not the account exists, so this can't be used to find accounts.
  if (!byIp.allowed || !byEmail.allowed) return { ok: true, message: FORGOT_SENT };

  const user = await findUserIdByEmail(parsed.data.email);
  if (user) {
    const token = await createAuthToken(user.id, "PASSWORD_RESET");
    await sendEmail(
      linkEmail({
        to: user.email,
        subject: "Reset your Applyance password",
        greeting: `Hi ${user.name.split(" ")[0]},`,
        body: "Someone asked to reset the password for your Applyance account. If it was you, choose a new password with the button below.",
        button: "Reset password",
        url: appUrl(`/reset-password?token=${encodeURIComponent(token)}`),
        footer: "The link works once, for one hour. If you didn't ask for this, ignore this email; your password stays the same.",
      }),
    ).catch((error) => console.error("[auth] couldn't send the reset email", error));
    await audit(user.id, "auth.password_reset_requested", { context: ctx });
  }
  return { ok: true, message: FORGOT_SENT };
}

export async function resetPasswordAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse(formToObject(formData));
  if (!parsed.success) return validationFailed(parsed.error);
  const userId = await resetPasswordWithToken(parsed.data.token, parsed.data.password);
  if (!userId) return { ok: false, message: "This reset link has expired or was already used. Ask for a new one." };
  await audit(userId, "auth.password_reset", { context: await getRequestContext() });
  await clearPendingSignIn();
  redirect("/sign-in?reset=1");
}

export async function signOutAction(): Promise<void> {
  const session = await getSession();
  if (session) await audit(session.user.id, "auth.sign_out", { context: await getRequestContext() });
  await endSession();
  redirect("/sign-in");
}
