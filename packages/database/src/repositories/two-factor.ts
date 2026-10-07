import { randomBytes } from "node:crypto";
import { prisma } from "../client";
import { decryptString, encryptString, sha256 } from "../crypto";
import { generateTotpSecret, matchTotp, otpauthUri } from "../totp";
import { verifyPassword } from "./auth";

export const RECOVERY_CODE_COUNT = 10;

/** Recovery codes look like "k3f9q-x7m2p": lowercase, no lookalike characters. */
const RECOVERY_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function newRecoveryCode(): string {
  const bytes = randomBytes(10);
  const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join("");
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
}

function normalizeRecoveryCode(code: string): string {
  const clean = code.toLowerCase().replace(/[^a-z0-9]/g, "");
  return clean.length === 10 ? `${clean.slice(0, 5)}-${clean.slice(5)}` : clean;
}

export async function getTwoFactorStatus(userId: string) {
  const [user, remaining] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { totpEnabledAt: true } }),
    prisma.recoveryCode.count({ where: { userId, usedAt: null } }),
  ]);
  return { enabled: !!user?.totpEnabledAt, enabledAt: user?.totpEnabledAt ?? null, recoveryCodesLeft: remaining };
}

/**
 * Start setting up an authenticator app: store a new pending secret (encrypted)
 * and return it with its otpauth URI for the QR code. Two-factor stays off
 * until confirmTwoFactorSetup gets a valid code.
 */
export async function beginTwoFactorSetup(userId: string): Promise<{ secret: string; uri: string }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { email: true, totpEnabledAt: true } });
  if (user.totpEnabledAt) throw new Error("Two-factor sign-in is already on");
  const secret = generateTotpSecret();
  await prisma.user.update({ where: { id: userId }, data: { totpSecret: encryptString(secret), totpLastStep: null } });
  return { secret, uri: otpauthUri(secret, user.email) };
}

async function replaceRecoveryCodes(userId: string): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  await prisma.$transaction([
    prisma.recoveryCode.deleteMany({ where: { userId } }),
    prisma.recoveryCode.createMany({ data: codes.map((code) => ({ userId, codeHash: sha256(code) })) }),
  ]);
  return codes;
}

/** Turn two-factor on once the person proves their app works. Returns the recovery codes, shown once. */
export async function confirmTwoFactorSetup(userId: string, code: string): Promise<string[] | null> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { totpSecret: true, totpEnabledAt: true } });
  if (!user.totpSecret || user.totpEnabledAt) return null;
  const step = matchTotp(decryptString(user.totpSecret), code);
  if (step === null) return null;
  await prisma.user.update({ where: { id: userId }, data: { totpEnabledAt: new Date(), totpLastStep: step } });
  return replaceRecoveryCodes(userId);
}

export type SecondFactorResult = { ok: true; method: "totp" | "recovery" } | { ok: false };

/**
 * Check an authenticator code or an unused recovery code. Each one works once:
 * the TOTP step is advanced and a recovery code is marked used, both with
 * conditional updates so two requests racing with the same code can't both pass.
 */
export async function verifySecondFactor(userId: string, rawCode: string): Promise<SecondFactorResult> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { totpSecret: true, totpEnabledAt: true, totpLastStep: true } });
  if (!user?.totpSecret || !user.totpEnabledAt) return { ok: false };
  const code = rawCode.replace(/\s+/g, "");

  if (/^\d{6}$/.test(code)) {
    const step = matchTotp(decryptString(user.totpSecret), code);
    if (step === null) return { ok: false };
    const { count } = await prisma.user.updateMany({
      where: { id: userId, OR: [{ totpLastStep: null }, { totpLastStep: { lt: step } }] },
      data: { totpLastStep: step },
    });
    return count === 1 ? { ok: true, method: "totp" } : { ok: false };
  }

  const { count } = await prisma.recoveryCode.updateMany({
    where: { userId, codeHash: sha256(normalizeRecoveryCode(code)), usedAt: null },
    data: { usedAt: new Date() },
  });
  return count === 1 ? { ok: true, method: "recovery" } : { ok: false };
}

export async function regenerateRecoveryCodes(userId: string, code: string): Promise<string[] | null> {
  const check = await verifySecondFactor(userId, code);
  if (!check.ok) return null;
  return replaceRecoveryCodes(userId);
}

/** Turning two-factor off needs the password and a current code. */
export async function disableTwoFactor(userId: string, password: string, code: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (!user || !(await verifyPassword(user.passwordHash, password))) return false;
  const check = await verifySecondFactor(userId, code);
  if (!check.ok) return false;
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { totpSecret: null, totpEnabledAt: null, totpLastStep: null } }),
    prisma.recoveryCode.deleteMany({ where: { userId } }),
  ]);
  return true;
}
