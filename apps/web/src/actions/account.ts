"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import {
  audit,
  beginTwoFactorSetup,
  checkPassword,
  confirmTwoFactorSetup,
  deleteUserAccount,
  disableTwoFactor,
  dismissOnboarding,
  getStripeCustomerId,
  getTwoFactorStatus,
  regenerateRecoveryCodes,
  revokeOtherSessions,
  verifySecondFactor,
} from "@autoapply/database";
import { getStorage } from "@autoapply/documents";
import { deleteAccountSchema, twoFactorCodeSchema } from "@autoapply/shared";
import { endSession } from "@/lib/auth";
import { authedAction, formToObject, validationFailed, type ActionResult } from "@/lib/action";
import { LIMITS, rateLimit } from "@/lib/rate-limit";
import { getRequestContext } from "@/lib/request";
import { getStripe } from "@/lib/stripe";

// ── Two-factor sign-in ──────────────────────────────────────────────────────

export async function startTwoFactorSetupAction(): Promise<ActionResult<{ secret: string; qrSvg: string }>> {
  return authedAction(async (user) => {
    if ((await getTwoFactorStatus(user.id)).enabled) return { ok: false, message: "Two-factor sign-in is already on" };
    const { secret, uri } = await beginTwoFactorSetup(user.id);
    const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, errorCorrectionLevel: "M" });
    return { ok: true, data: { secret, qrSvg } };
  });
}

export async function confirmTwoFactorSetupAction(_prev: ActionResult<{ recoveryCodes: string[] }>, formData: FormData): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  return authedAction(async (user) => {
    const parsed = twoFactorCodeSchema.safeParse(formToObject(formData));
    if (!parsed.success) return validationFailed(parsed.error);
    const limit = await rateLimit(`2fa:${user.id}`, LIMITS.twoFactor.limit, LIMITS.twoFactor.windowMs);
    if (!limit.allowed) return { ok: false, message: `Too many codes tried. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.` };
    const recoveryCodes = await confirmTwoFactorSetup(user.id, parsed.data.code);
    if (!recoveryCodes) return { ok: false, errors: { code: "That code didn't work" }, message: "That code didn't work. Make sure your phone's time is set automatically, then try the newest code." };
    // Anyone already signed in elsewhere signed in without the second factor.
    await revokeOtherSessions(user.id, user.sessionId);
    await audit(user.id, "account.two_factor_enabled", { context: await getRequestContext() });
    // No revalidate here: the page refreshes after the person has saved their recovery codes.
    return { ok: true, message: "Two-factor sign-in is on", data: { recoveryCodes } };
  });
}

export async function disableTwoFactorAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return authedAction(async (user) => {
    const password = String(formData.get("password") ?? "");
    const code = String(formData.get("code") ?? "").trim();
    if (!password || !code) return { ok: false, message: "Enter your password and a code from your app or a recovery code." };
    const limit = await rateLimit(`2fa:${user.id}`, LIMITS.twoFactor.limit, LIMITS.twoFactor.windowMs);
    if (!limit.allowed) return { ok: false, message: `Too many codes tried. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.` };
    if (!(await disableTwoFactor(user.id, password, code))) return { ok: false, message: "The password or code is incorrect." };
    await audit(user.id, "account.two_factor_disabled", { context: await getRequestContext() });
    return { ok: true, message: "Two-factor sign-in is off" };
  });
}

export async function regenerateRecoveryCodesAction(_prev: ActionResult<{ recoveryCodes: string[] }>, formData: FormData): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  return authedAction(async (user) => {
    const parsed = twoFactorCodeSchema.safeParse(formToObject(formData));
    if (!parsed.success) return validationFailed(parsed.error);
    const limit = await rateLimit(`2fa:${user.id}`, LIMITS.twoFactor.limit, LIMITS.twoFactor.windowMs);
    if (!limit.allowed) return { ok: false, message: `Too many codes tried. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.` };
    const recoveryCodes = await regenerateRecoveryCodes(user.id, parsed.data.code);
    if (!recoveryCodes) return { ok: false, errors: { code: "That code didn't work" }, message: "That code didn't work." };
    await audit(user.id, "account.recovery_codes_regenerated", { context: await getRequestContext() });
    return { ok: true, message: "New recovery codes made. The old ones no longer work.", data: { recoveryCodes } };
  });
}

// ── Onboarding ──────────────────────────────────────────────────────────────

export async function dismissOnboardingAction(): Promise<ActionResult> {
  return authedAction(async (user) => {
    await dismissOnboarding(user.id);
    revalidatePath("/dashboard");
    return { ok: true };
  });
}

// ── Delete account ──────────────────────────────────────────────────────────

export async function deleteAccountAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return authedAction(async (user) => {
    const parsed = deleteAccountSchema.safeParse(formToObject(formData));
    if (!parsed.success) return validationFailed(parsed.error);
    const limit = await rateLimit(`delete-account:${user.id}`, LIMITS.twoFactor.limit, LIMITS.twoFactor.windowMs);
    if (!limit.allowed) return { ok: false, message: `Too many attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.` };
    if (!(await checkPassword(user.id, parsed.data.password))) return { ok: false, errors: { password: "Incorrect password" }, message: "Incorrect password." };
    if ((await getTwoFactorStatus(user.id)).enabled) {
      if (!parsed.data.code) return { ok: false, errors: { code: "Enter a code" }, message: "Enter a code from your authenticator app or a recovery code." };
      if (!(await verifySecondFactor(user.id, parsed.data.code)).ok) return { ok: false, errors: { code: "That code didn't work" }, message: "That code didn't work." };
    }

    // Stop billing first: deleting the Stripe customer cancels its subscriptions at once.
    // If Stripe can't be reached the account stays, so nobody is charged for an account that's gone.
    const customer = await getStripeCustomerId(user.id);
    const stripe = getStripe();
    if (customer && stripe) {
      try {
        await stripe.customers.del(customer);
      } catch (error) {
        const missing = typeof error === "object" && error && "code" in error && error.code === "resource_missing";
        if (!missing) {
          console.error("[account] couldn't delete the Stripe customer", error);
          return { ok: false, message: "We couldn't cancel your subscription with Stripe just now, so nothing was deleted. Please try again in a few minutes." };
        }
      }
    }

    const { storageKeys } = await deleteUserAccount(user.id);
    const storage = getStorage();
    const results = await Promise.allSettled(storageKeys.map((key) => storage.delete(key)));
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed) console.error(`[account] ${failed} stored files of deleted user ${user.id} couldn't be removed`);
    await endSession();
    redirect("/?deleted=1");
  });
}
