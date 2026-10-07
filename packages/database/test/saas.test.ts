import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PLANS } from "@autoapply/shared";
import { prisma } from "../src/client";
import { encryptString, isEncrypted } from "../src/crypto";
import { totpCode, totpStep, matchTotp, base32Decode, base32Encode } from "../src/totp";
import {
  beginTwoFactorSetup, confirmTwoFactorSetup, disableTwoFactor, getTwoFactorStatus, regenerateRecoveryCodes, verifySecondFactor,
} from "../src/repositories/two-factor";
import {
  applyStripeSubscription, claimStripeEvent, consumeUsage, getEffectivePlan, getUsage, refundUsage, saveStripeCustomer,
} from "../src/repositories/billing";
import {
  consumeAuthToken, createAuthToken, deleteUserAccount, exportUserData, getOnboardingStatus, resetPasswordWithToken,
} from "../src/repositories/account";
import { authenticate, createSession, validateSessionToken } from "../src/repositories/auth";
import { queueApplications } from "../src/repositories/applications";
import { makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

const ORIGINAL_STRIPE_KEY = process.env.STRIPE_SECRET_KEY;
afterEach(() => {
  if (ORIGINAL_STRIPE_KEY === undefined) delete process.env.STRIPE_SECRET_KEY;
  else process.env.STRIPE_SECRET_KEY = ORIGINAL_STRIPE_KEY;
});

describe("totp", () => {
  it("matches the RFC 6238 SHA-1 test vectors", () => {
    // RFC 6238 appendix B: secret "12345678901234567890", 8-digit codes; the last 6 digits are the 6-digit code.
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    expect(totpCode(secret, Math.floor(59 / 30))).toBe("287082");
    expect(totpCode(secret, Math.floor(1111111109 / 30))).toBe("081804");
    expect(totpCode(secret, Math.floor(2000000000 / 30))).toBe("279037");
    expect(base32Decode(secret).toString()).toBe("12345678901234567890");
  });

  it("accepts one step of clock drift and nothing further", () => {
    const secret = base32Encode(Buffer.from("12345678901234567890"));
    const now = 1_700_000_000_000;
    const step = totpStep(now);
    expect(matchTotp(secret, totpCode(secret, step - 1), now)).toBe(step - 1);
    expect(matchTotp(secret, totpCode(secret, step + 1), now)).toBe(step + 1);
    expect(matchTotp(secret, totpCode(secret, step + 2), now)).toBeNull();
    expect(matchTotp(secret, "12345", now)).toBeNull();
  });
});

async function enableTwoFactor(userId: string) {
  const { secret, uri } = await beginTwoFactorSetup(userId);
  expect(uri).toMatch(/^otpauth:\/\/totp\/Applyance%3A/);
  const codes = await confirmTwoFactorSetup(userId, totpCode(secret, totpStep() - 1));
  expect(codes).toHaveLength(10);
  return { secret, codes: codes! };
}

describe("two-factor sign-in", () => {
  it("stores the secret encrypted and stays off until a code is confirmed", async () => {
    const user = await makeUser();
    const { secret } = await beginTwoFactorSetup(user.id);
    const row = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(isEncrypted(row.totpSecret)).toBe(true);
    expect(row.totpSecret).not.toContain(secret);
    expect((await getTwoFactorStatus(user.id)).enabled).toBe(false);
    expect(await confirmTwoFactorSetup(user.id, "000000")).toBeNull();
    expect(await verifySecondFactor(user.id, totpCode(secret, totpStep()))).toEqual({ ok: false });
  });

  it("accepts each code once, and each recovery code once", async () => {
    const user = await makeUser();
    const { secret, codes } = await enableTwoFactor(user.id);
    const status = await getTwoFactorStatus(user.id);
    expect(status).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });

    // The setup code (step - 1) can't be reused; the current one works once.
    expect(await verifySecondFactor(user.id, totpCode(secret, totpStep() - 1))).toEqual({ ok: false });
    const current = totpCode(secret, totpStep());
    expect(await verifySecondFactor(user.id, current)).toEqual({ ok: true, method: "totp" });
    expect(await verifySecondFactor(user.id, current)).toEqual({ ok: false });

    // Recovery codes: any case and spacing, once each; only hashes are stored.
    expect(await verifySecondFactor(user.id, codes[0]!.toUpperCase().replace("-", " "))).toEqual({ ok: true, method: "recovery" });
    expect(await verifySecondFactor(user.id, codes[0]!)).toEqual({ ok: false });
    const stored = await prisma.recoveryCode.findMany({ where: { userId: user.id } });
    expect(stored.some((r) => codes.includes(r.codeHash))).toBe(false);
    expect((await getTwoFactorStatus(user.id)).recoveryCodesLeft).toBe(9);
  });

  it("regenerates recovery codes and turns off only with the password and a code", async () => {
    const user = await makeUser();
    const { secret, codes } = await enableTwoFactor(user.id);
    const fresh = await regenerateRecoveryCodes(user.id, codes[1]!);
    expect(fresh).toHaveLength(10);
    expect(await verifySecondFactor(user.id, codes[2]!)).toEqual({ ok: false });

    expect(await disableTwoFactor(user.id, "wrong-password-1", fresh![0]!)).toBe(false);
    expect(await disableTwoFactor(user.id, "correct-horse-1", "000000")).toBe(false);
    expect(await disableTwoFactor(user.id, "correct-horse-1", totpCode(secret, totpStep()))).toBe(true);
    expect(await getTwoFactorStatus(user.id)).toMatchObject({ enabled: false, recoveryCodesLeft: 0 });
  });
});

describe("plans and usage", () => {
  it("gives every account the paid limits when billing is off", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const user = await makeUser();
    expect((await getEffectivePlan(user.id)).id).toBe("pro");
  });

  it("limits free accounts and grants only what is left", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    const user = await makeUser();
    const limit = PLANS.free.limits.applications;
    expect(await consumeUsage(user.id, "applications", limit - 2)).toBe(limit - 2);
    expect(await consumeUsage(user.id, "applications", 5)).toBe(2);
    expect(await consumeUsage(user.id, "applications", 1)).toBe(0);
    await refundUsage(user.id, "applications", 1);
    expect(await consumeUsage(user.id, "applications", 3)).toBe(1);
    // A new month starts from zero.
    expect(await consumeUsage(user.id, "applications", 1, new Date(Date.UTC(2099, 0, 5)))).toBe(1);
  });

  it("never grants more than the limit to requests at the same moment", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    const user = await makeUser();
    const limit = PLANS.free.limits.tailoredDocuments;
    const grants = await Promise.all(Array.from({ length: limit + 8 }, () => consumeUsage(user.id, "tailoredDocuments")));
    expect(grants.reduce((a, b) => a + b, 0)).toBe(limit);
  });

  it("queues only as many applications as the plan has left", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    const user = await makeUser();
    const limit = PLANS.free.limits.applications;
    await consumeUsage(user.id, "applications", limit - 1);
    const jobs = await Promise.all(
      [1, 2, 3].map((n) => prisma.job.create({ data: { userId: user.id, title: `Role ${n}`, company: "Acme", url: `https://acme.example/${n}`, canonicalUrl: `https://acme.example/${n}`, fingerprint: `fp-${n}`, sourceType: "MANUAL" } })),
    );
    const result = await queueApplications(user.id, jobs.map((j) => j.id));
    expect(result).toMatchObject({ queued: 1, overLimit: 2, monthlyLimit: limit });
    const usage = await getUsage(user.id);
    expect(usage.metrics.find((m) => m.metric === "applications")).toMatchObject({ used: limit, limit });
  });

  it("switches plans from Stripe subscription state and ignores repeated events", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    const user = await makeUser();
    await saveStripeCustomer(user.id, "cus_123");
    expect((await getEffectivePlan(user.id)).id).toBe("free");
    const state = {
      stripeCustomerId: "cus_123", stripeSubscriptionId: "sub_1", stripePriceId: "price_pro", plan: "pro",
      status: "ACTIVE" as const, interval: "month", currentPeriodEnd: new Date(Date.now() + 86_400_000), cancelAtPeriodEnd: false,
    };
    expect(await applyStripeSubscription(state)).toBe(true);
    expect((await getEffectivePlan(user.id)).id).toBe("pro");
    expect(await applyStripeSubscription({ ...state, status: "CANCELED" })).toBe(true);
    expect((await getEffectivePlan(user.id)).id).toBe("free");
    expect(await applyStripeSubscription({ ...state, stripeCustomerId: "cus_unknown", stripeSubscriptionId: "sub_2" })).toBe(false);

    expect(await claimStripeEvent("evt_1", "customer.subscription.updated")).toBe(true);
    expect(await claimStripeEvent("evt_1", "customer.subscription.updated")).toBe(false);
  });
});

describe("account", () => {
  it("resets a password with a single-use link and signs out every session", async () => {
    const user = await makeUser();
    const { token: sessionToken } = await createSession(user.id);
    const first = await createAuthToken(user.id, "PASSWORD_RESET");
    const second = await createAuthToken(user.id, "PASSWORD_RESET");
    expect(await consumeAuthToken(first, "PASSWORD_RESET")).toBeNull();
    expect(await resetPasswordWithToken(second, "brand-new-pass-2")).toBe(user.id);
    expect(await resetPasswordWithToken(second, "another-pass-3")).toBeNull();
    expect(await validateSessionToken(sessionToken)).toBeNull();
    expect(await authenticate(user.email, "brand-new-pass-2")).toMatchObject({ ok: true });
    const verify = await createAuthToken(user.id, "EMAIL_VERIFY");
    expect(await consumeAuthToken(verify, "PASSWORD_RESET")).toBeNull();
  });

  it("exports readable data without secrets", async () => {
    const user = await makeUser();
    await enableTwoFactor(user.id);
    await createSession(user.id);
    await prisma.applicationAnswer.create({
      data: { userId: user.id, questionKey: "gender", question: "Gender", answer: encryptString("Prefer not to say"), category: "DEMOGRAPHIC", isSensitive: true },
    });
    await prisma.browserSession.create({ data: { userId: user.id, domain: "jobs.example", storageStateEncrypted: encryptString("{\"cookies\":[]}") } });
    const data = await exportUserData(user.id);
    const json = JSON.stringify(data);
    expect(data).toMatchObject({ format: "applyance-export", user: { email: user.email } });
    expect(json).toContain("Prefer not to say");
    expect(json).not.toMatch(/passwordHash|totpSecret|tokenHash|codeHash|storageStateEncrypted|enc:v1:/);
  });

  it("deletes the account and everything in it", async () => {
    const user = await makeUser();
    const other = await makeUser("Other");
    await prisma.document.create({ data: { userId: user.id, type: "RESUME", name: "CV", fileName: "cv.pdf", mimeType: "application/pdf", sizeBytes: 1, storageKey: `users/${user.id}/resume/x.pdf`, sha256: "x" } });
    await saveStripeCustomer(user.id, "cus_del");
    const { storageKeys } = await deleteUserAccount(user.id);
    expect(storageKeys).toEqual([`users/${user.id}/resume/x.pdf`]);
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(await prisma.document.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.subscription.count({ where: { userId: user.id } })).toBe(0);
    expect(await prisma.auditLog.findFirst({ where: { action: "account.deleted", entityId: user.id } })).toMatchObject({ userId: null });
    expect(await prisma.user.findUnique({ where: { id: other.id } })).not.toBeNull();
  });

  it("tracks getting-started steps from what the account has", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const user = await makeUser();
    const start = await getOnboardingStatus(user.id);
    expect(start.steps.map((s) => s.key)).toEqual(["resume", "profile", "rules", "jobs", "security"]);
    expect(start.done).toBe(0);
    await prisma.job.create({ data: { userId: user.id, title: "Role", company: "Acme", url: "https://acme.example/1", canonicalUrl: "https://acme.example/1", fingerprint: "fp", sourceType: "MANUAL" } });
    await enableTwoFactor(user.id);
    expect((await getOnboardingStatus(user.id)).done).toBe(2);
    process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
    expect((await getOnboardingStatus(user.id)).steps.at(-1)).toEqual({ key: "plan", done: false });
  });
});
