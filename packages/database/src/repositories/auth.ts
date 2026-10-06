import { hash, verify } from "@node-rs/argon2";
import type { Session, User } from "@prisma/client";
import { prisma } from "../client";
import { randomToken, sha256 } from "../crypto";
import { DEFAULT_MATCH_WEIGHTS } from "@autoapply/shared";

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** Extend a session when it is used and has less than this much time left. */
const SESSION_REFRESH_MS = 15 * 24 * 60 * 60 * 1000;
/** Throttle lastSeenAt writes. */
const LAST_SEEN_RESOLUTION_MS = 5 * 60 * 1000;

export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

// OWASP-recommended argon2id parameters (19 MiB, 2 iterations).
const ARGON_OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// A real hash so failed lookups cost the same as a wrong password (no user enumeration by timing).
let dummyHash: Promise<string> | null = null;
const getDummyHash = () => (dummyHash ??= hashPassword("autoapply-timing-equalizer-0"));

export type PublicUser = Pick<User, "id" | "email" | "name" | "role" | "createdAt">;

const toPublicUser = (u: User): PublicUser => ({ id: u.id, email: u.email, name: u.name, role: u.role, createdAt: u.createdAt });

export class EmailTakenError extends Error {
  constructor() {
    super("An account with this email already exists");
  }
}

/** Create a user with their profile, default rules and settings in one transaction. */
export async function createUser(input: { name: string; email: string; password: string }): Promise<PublicUser> {
  const email = input.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (existing) throw new EmailTakenError();
  const passwordHash = await hashPassword(input.password);
  try {
    const user = await prisma.user.create({
      data: {
        email,
        name: input.name.trim(),
        passwordHash,
        profile: { create: { email } },
        settings: { create: {} },
        automationRule: { create: { matchWeights: DEFAULT_MATCH_WEIGHTS } },
        jobSources: { create: { type: "MANUAL", name: "Manual entry" } },
      },
    });
    return toPublicUser(user);
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") throw new EmailTakenError();
    throw error;
  }
}

export type AuthResult =
  | { ok: true; user: PublicUser }
  | { ok: false; reason: "invalid" | "locked"; lockedUntil?: Date };

/**
 * Check credentials. Locks the account for LOCKOUT_MS after MAX_FAILED_LOGINS
 * consecutive failures. Error reasons never reveal whether the email exists.
 */
export async function authenticate(emailInput: string, password: string): Promise<AuthResult> {
  const email = emailInput.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    await verifyPassword(await getDummyHash(), password);
    return { ok: false, reason: "invalid" };
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    return { ok: false, reason: "locked", lockedUntil: user.lockedUntil };
  }
  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    const failed = user.failedLoginCount + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: lock ? 0 : failed, lockedUntil: lock ? new Date(Date.now() + LOCKOUT_MS) : null },
    });
    return lock ? { ok: false, reason: "locked", lockedUntil: new Date(Date.now() + LOCKOUT_MS) } : { ok: false, reason: "invalid" };
  }
  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
  });
  return { ok: true, user: toPublicUser(user) };
}

export async function changePassword(userId: string, currentPassword: string, newPassword: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || !(await verifyPassword(user.passwordHash, currentPassword))) return false;
  await prisma.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(newPassword) } });
  return true;
}

export async function updateUserName(userId: string, name: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { name: name.trim() } });
}

/** Create a session and return the raw token for the cookie. Only its hash is stored. */
export async function createSession(
  userId: string,
  meta: { ipAddress?: string | null; userAgent?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256(token),
      expiresAt,
      ipAddress: meta.ipAddress?.slice(0, 64) ?? null,
      userAgent: meta.userAgent?.slice(0, 512) ?? null,
    },
  });
  return { token, expiresAt };
}

export interface ValidatedSession {
  session: Pick<Session, "id" | "expiresAt">;
  user: PublicUser;
  /** Set when the session's expiry was extended and the cookie should be re-issued. */
  refreshedExpiresAt?: Date;
}

export async function validateSessionToken(token: string | undefined | null): Promise<ValidatedSession | null> {
  if (!token || token.length < 20 || token.length > 200) return null;
  const session = await prisma.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session) return null;
  const now = Date.now();
  if (session.expiresAt.getTime() <= now) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }

  const data: { lastSeenAt?: Date; expiresAt?: Date } = {};
  if (now - session.lastSeenAt.getTime() > LAST_SEEN_RESOLUTION_MS) data.lastSeenAt = new Date(now);
  if (session.expiresAt.getTime() - now < SESSION_REFRESH_MS) data.expiresAt = new Date(now + SESSION_TTL_MS);
  if (Object.keys(data).length > 0) {
    await prisma.session.update({ where: { id: session.id }, data }).catch(() => undefined);
  }

  return {
    session: { id: session.id, expiresAt: data.expiresAt ?? session.expiresAt },
    user: toPublicUser(session.user),
    refreshedExpiresAt: data.expiresAt,
  };
}

export async function revokeSessionToken(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: sha256(token) } });
}

export async function listSessions(userId: string) {
  return prisma.session.findMany({
    where: { userId, expiresAt: { gt: new Date() } },
    orderBy: { lastSeenAt: "desc" },
    select: { id: true, createdAt: true, lastSeenAt: true, ipAddress: true, userAgent: true, expiresAt: true },
  });
}

export async function revokeSession(userId: string, sessionId: string): Promise<boolean> {
  const { count } = await prisma.session.deleteMany({ where: { id: sessionId, userId } });
  return count > 0;
}

export async function revokeOtherSessions(userId: string, keepSessionId: string): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { userId, id: { not: keepSessionId } } });
  return count;
}

export async function purgeExpiredSessions(): Promise<number> {
  const { count } = await prisma.session.deleteMany({ where: { expiresAt: { lte: new Date() } } });
  return count;
}
