import type { AuthTokenKind } from "@prisma/client";
import { prisma } from "../client";
import { decryptString, isEncrypted, randomToken, sha256 } from "../crypto";
import { isBillingEnabled } from "@autoapply/shared";
import { hashPassword, verifyPassword } from "./auth";
import { countResumes } from "./documents";
import { getFullProfile, profileCompleteness } from "./profile";

// ── Emailed links (verify email, reset password) ─────────────────────────────

const TOKEN_TTL_MS: Record<AuthTokenKind, number> = {
  EMAIL_VERIFY: 3 * 24 * 60 * 60 * 1000,
  PASSWORD_RESET: 60 * 60 * 1000,
};

/** Create a single-use link token. Earlier unused tokens of the same kind stop working. */
export async function createAuthToken(userId: string, kind: AuthTokenKind): Promise<string> {
  const token = randomToken(32);
  await prisma.$transaction([
    prisma.authToken.deleteMany({ where: { userId, kind, usedAt: null } }),
    prisma.authToken.create({ data: { userId, kind, tokenHash: sha256(token), expiresAt: new Date(Date.now() + TOKEN_TTL_MS[kind]) } }),
  ]);
  return token;
}

/** Use a token once. Returns the user id, or null when it's unknown, used or expired. */
export async function consumeAuthToken(token: string, kind: AuthTokenKind): Promise<string | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const row = await prisma.authToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row || row.kind !== kind || row.usedAt || row.expiresAt <= new Date()) return null;
  const { count } = await prisma.authToken.updateMany({ where: { id: row.id, usedAt: null }, data: { usedAt: new Date() } });
  return count === 1 ? row.userId : null;
}

export async function findUserIdByEmail(email: string): Promise<{ id: string; name: string; email: string } | null> {
  return prisma.user.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true, name: true, email: true } });
}

export async function getAccountFlags(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { emailVerifiedAt: true, totpEnabledAt: true, onboardingDismissedAt: true },
  });
  return { emailVerified: !!user.emailVerifiedAt, twoFactorEnabled: !!user.totpEnabledAt, onboardingDismissed: !!user.onboardingDismissedAt };
}

export async function markEmailVerified(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } });
}

/** Set a new password from a reset link: clears any lockout and signs out every session. */
export async function resetPasswordWithToken(token: string, newPassword: string): Promise<string | null> {
  const userId = await consumeAuthToken(token, "PASSWORD_RESET");
  if (!userId) return null;
  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      // The link proved the person controls the inbox, so the address is verified too.
      data: { passwordHash: await hashPassword(newPassword), failedLoginCount: 0, lockedUntil: null, emailVerifiedAt: new Date() },
    }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
  return userId;
}

export async function checkPassword(userId: string, password: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  return !!user && (await verifyPassword(user.passwordHash, password));
}

// ── Onboarding ──────────────────────────────────────────────────────────────

export type OnboardingStep = "resume" | "profile" | "rules" | "jobs" | "security" | "plan";

export interface OnboardingStatus {
  /** Steps in order; "plan" is only listed when billing is on. */
  steps: Array<{ key: OnboardingStep; done: boolean }>;
  profilePercent: number;
  done: number;
  total: number;
  dismissed: boolean;
}

/** Getting-started progress, worked out from what the account already has. */
export async function getOnboardingStatus(userId: string): Promise<OnboardingStatus> {
  const [user, profile, resumeFiles, resumes, rule, jobs, sub] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { onboardingDismissedAt: true, totpEnabledAt: true } }),
    getFullProfile(userId),
    prisma.document.count({ where: { userId, type: "RESUME" } }),
    countResumes(userId),
    prisma.automationRule.findUnique({ where: { userId }, select: { createdAt: true, updatedAt: true } }),
    prisma.job.count({ where: { userId, deletedAt: null } }),
    prisma.subscription.findUnique({ where: { userId }, select: { stripeSubscriptionId: true } }),
  ]);
  const completeness = profileCompleteness(profile, { resumes });
  const steps: OnboardingStatus["steps"] = [
    { key: "resume", done: resumeFiles > 0 },
    { key: "profile", done: completeness.percent >= 80 },
    // Rules start with defaults; saving them once counts as reviewing them.
    { key: "rules", done: !!rule && rule.updatedAt.getTime() - rule.createdAt.getTime() > 1000 },
    { key: "jobs", done: jobs > 0 },
    { key: "security", done: !!user.totpEnabledAt },
  ];
  if (isBillingEnabled()) steps.push({ key: "plan", done: !!sub?.stripeSubscriptionId });
  const done = steps.filter((s) => s.done).length;
  return { steps, profilePercent: completeness.percent, done, total: steps.length, dismissed: !!user.onboardingDismissedAt };
}

export async function dismissOnboarding(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { onboardingDismissedAt: new Date() } });
}

// ── Export ──────────────────────────────────────────────────────────────────

/** Decrypt every encrypted string so the export is readable by its owner. */
function decryptDeep(value: unknown): unknown {
  if (typeof value === "string") return isEncrypted(value) ? decryptString(value) : value;
  if (Array.isArray(value)) return value.map(decryptDeep);
  if (value && typeof value === "object" && !(value instanceof Date)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decryptDeep(v)]));
  }
  return value;
}

/**
 * Everything Applyance stores about the account, as plain JSON. Left out:
 * password and two-factor secrets, session and link tokens, and the saved
 * browser cookies for application sites (they are sign-ins, not your data).
 * A new table with a userId must be added here too.
 */
export async function exportUserData(userId: string) {
  const where = { userId };
  const [user, profile, documents, resumes, coverLetters, answers, jobSources, jobImports, jobs, applications, interviewRounds, automationRule, settings, browserSessions, sessions, auditLogs, subscription, usage] =
    await Promise.all([
      prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, email: true, name: true, emailVerifiedAt: true, totpEnabledAt: true, lastLoginAt: true, createdAt: true, updatedAt: true },
      }),
      prisma.masterProfile.findUnique({ where, include: { education: true, employment: true, skills: true } }),
      prisma.document.findMany({ where, omit: { storageKey: true } }),
      prisma.resume.findMany({ where }),
      prisma.coverLetter.findMany({ where }),
      prisma.applicationAnswer.findMany({ where }),
      prisma.jobSource.findMany({ where }),
      prisma.jobImport.findMany({ where }),
      prisma.job.findMany({ where }),
      prisma.application.findMany({
        where,
        include: { questions: { include: { answer: true } }, events: true, attempts: { omit: { browserSessionId: true } } },
      }),
      prisma.interviewRound.findMany({ where }),
      prisma.automationRule.findUnique({ where }),
      prisma.userSetting.findUnique({ where }),
      prisma.browserSession.findMany({ where, omit: { storageStateEncrypted: true } }),
      prisma.session.findMany({ where, omit: { tokenHash: true } }),
      prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 1000 }),
      prisma.subscription.findUnique({ where, omit: { id: true } }),
      prisma.usageCounter.findMany({ where }),
    ]);
  return decryptDeep({
    format: "applyance-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    user,
    profile,
    documents,
    resumes,
    coverLetters,
    answerLibrary: answers,
    jobSources,
    jobImports,
    jobs,
    applications,
    interviewRounds,
    automationRule,
    settings,
    applicationSiteSignIns: browserSessions,
    sessions,
    securityLog: auditLogs,
    subscription,
    usage,
  }) as Record<string, unknown>;
}

/** Stored files for the export: each document's key and a safe name. */
export async function listExportFiles(userId: string) {
  return prisma.document.findMany({ where: { userId }, select: { id: true, storageKey: true, fileName: true } });
}

// ── Delete ──────────────────────────────────────────────────────────────────

/** Every storage key the account owns: documents and screenshots taken by the worker. */
async function storageKeysFor(userId: string): Promise<string[]> {
  const [documents, attempts] = await Promise.all([
    prisma.document.findMany({ where: { userId }, select: { storageKey: true } }),
    prisma.applicationAttempt.findMany({ where: { application: { userId } }, select: { screenshots: true } }),
  ]);
  const keys = documents.map((d) => d.storageKey);
  for (const a of attempts) {
    if (!Array.isArray(a.screenshots)) continue;
    for (const s of a.screenshots) {
      const key = s && typeof s === "object" && "key" in s ? (s as { key: unknown }).key : null;
      if (typeof key === "string" && key.startsWith(`users/${userId}/`)) keys.push(key);
    }
  }
  return keys;
}

/**
 * Delete the account and everything in it. Rows go in one statement (every
 * table cascades from User); the returned storage keys are for the caller to
 * remove from file storage. The security log keeps one entry without any
 * personal details, so the deletion itself is on record.
 */
export async function deleteUserAccount(userId: string): Promise<{ storageKeys: string[] }> {
  const storageKeys = await storageKeysFor(userId);
  await prisma.$transaction([
    prisma.auditLog.deleteMany({ where: { userId } }),
    prisma.user.delete({ where: { id: userId } }),
    prisma.auditLog.create({ data: { userId: null, action: "account.deleted", entityType: "User", entityId: userId } }),
  ]);
  return { storageKeys };
}
