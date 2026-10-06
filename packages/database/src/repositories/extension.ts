import { randomInt } from "node:crypto";
import { ATTENTION_APPLICATION_STATUSES } from "@autoapply/shared";
import { prisma } from "../client";
import { randomToken, sha256 } from "../crypto";
import type { PublicUser } from "./auth";
import { ConflictError, NotFoundError } from "./errors";
import { markHumanStepComplete } from "./applications";
import { addApplicationEvent, saveBrowserSession } from "./worker";

// ─── Connecting the browser extension ───────────────────────────────────────

export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;
/** Throttle lastUsedAt writes. */
const LAST_USED_RESOLUTION_MS = 5 * 60 * 1000;
/** No 0/O, 1/I/L: the code is read off one screen and typed into another. */
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const EXTENSION_TOKEN_PREFIX = "apx_";

/** "abcd-2345" and "ABCD2345" are the same code. */
export const normalizePairingCode = (code: string) => code.toUpperCase().replace(/[^A-Z0-9]/g, "");

/**
 * A one-time code the signed-in person types into the extension. It lasts ten
 * minutes and replaces any earlier unused code, so only the newest one works.
 */
export async function createExtensionPairingCode(userId: string): Promise<{ code: string; expiresAt: Date }> {
  const raw = Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
  await prisma.$transaction([
    prisma.extensionConnection.deleteMany({ where: { userId, tokenHash: null } }),
    prisma.extensionConnection.create({ data: { userId, pairingCodeHash: sha256(raw), pairingExpiresAt: expiresAt } }),
  ]);
  return { code: `${raw.slice(0, 4)}-${raw.slice(4)}`, expiresAt };
}

/** Trade a pairing code for the extension's own token. Returns null for a wrong, used or expired code. */
export async function connectExtension(code: string, meta: { browser?: string | null } = {}): Promise<{ token: string; connectionId: string; user: PublicUser } | null> {
  const normalized = normalizePairingCode(code);
  if (normalized.length !== 8) return null;
  const pending = await prisma.extensionConnection.findUnique({ where: { pairingCodeHash: sha256(normalized) }, include: { user: true } });
  if (!pending || pending.tokenHash || pending.revokedAt || !pending.pairingExpiresAt || pending.pairingExpiresAt < new Date()) return null;
  const token = EXTENSION_TOKEN_PREFIX + randomToken(32);
  const now = new Date();
  // Conditional on the code still being unused, so two racing requests can't both connect.
  const { count } = await prisma.extensionConnection.updateMany({
    where: { id: pending.id, tokenHash: null, pairingCodeHash: pending.pairingCodeHash },
    data: { tokenHash: sha256(token), pairingCodeHash: null, pairingExpiresAt: null, connectedAt: now, lastUsedAt: now, browser: meta.browser?.slice(0, 100) || null },
  });
  if (count !== 1) return null;
  const u = pending.user;
  return { token, connectionId: pending.id, user: { id: u.id, email: u.email, name: u.name, createdAt: u.createdAt } };
}

export async function validateExtensionToken(token: string | null | undefined): Promise<{ connectionId: string; user: PublicUser } | null> {
  if (!token || !token.startsWith(EXTENSION_TOKEN_PREFIX) || token.length > 200) return null;
  const row = await prisma.extensionConnection.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!row || row.revokedAt) return null;
  if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > LAST_USED_RESOLUTION_MS) {
    await prisma.extensionConnection.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } });
  }
  const u = row.user;
  return { connectionId: row.id, user: { id: u.id, email: u.email, name: u.name, createdAt: u.createdAt } };
}

export async function listExtensionConnections(userId: string) {
  return prisma.extensionConnection.findMany({
    where: { userId, tokenHash: { not: null }, revokedAt: null },
    orderBy: { connectedAt: "desc" },
    select: { id: true, browser: true, connectedAt: true, lastUsedAt: true },
  });
}

/** Disconnect an extension from Settings. Its token stops working at once. */
export async function revokeExtensionConnection(userId: string, id: string): Promise<boolean> {
  const { count } = await prisma.extensionConnection.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: new Date(), tokenHash: null } });
  return count > 0;
}

// ─── Finishing applications in the person's own browser ────────────────────

const handoffSelect = {
  id: true,
  status: true,
  mode: true,
  platform: true,
  attentionReason: true,
  attentionDetail: true,
  updatedAt: true,
  job: { select: { id: true, title: true, company: true, url: true, applicationUrl: true } },
} as const;

/** Applications waiting for the person, newest first, for the extension's list. */
export async function listApplicationsWaitingForUser(userId: string, limit = 20) {
  const [rows, total] = await Promise.all([
    prisma.application.findMany({ where: { userId, status: { in: [...ATTENTION_APPLICATION_STATUSES] } }, orderBy: [{ updatedAt: "desc" }], take: limit, select: handoffSelect }),
    prisma.application.count({ where: { userId, status: { in: [...ATTENTION_APPLICATION_STATUSES] } } }),
  ]);
  return { rows, total };
}

/** An application the person can finish in their own browser right now. */
export async function getApplicationForHandoff(userId: string, applicationId: string) {
  const app = await prisma.application.findFirst({ where: { id: applicationId, userId, status: { in: [...ATTENTION_APPLICATION_STATUSES] } }, select: handoffSelect });
  if (!app) throw new NotFoundError("Application waiting for you");
  return app;
}

/**
 * Cookies the person's browser holds for the application site, kept only when
 * they belong to that site (the host itself or a parent domain of it).
 */
export interface BrowserCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

export function cookiesForHost(cookies: BrowserCookie[], host: string): BrowserCookie[] {
  const h = host.toLowerCase();
  return cookies.filter((c) => {
    const d = c.domain.toLowerCase().replace(/^\./, "");
    // A bare top-level domain ("com") would match every site.
    return d.includes(".") || d === "localhost" ? h === d || h.endsWith(`.${d}`) : false;
  });
}

/**
 * The person signed in (or entered a verification code) in their own browser.
 * Their cookies for that site are saved, encrypted, the same way a sign-in in
 * the worker's own window is, and the application goes back to the queue. The
 * worker re-checks the page, so a sign-in that didn't take just comes back here.
 */
export async function continueAfterBrowserSignIn(userId: string, applicationId: string, cookies: BrowserCookie[]) {
  const app = await getApplicationForHandoff(userId, applicationId);
  if (app.status !== "WAITING_FOR_USER" || (app.attentionReason !== "AUTH_REQUIRED" && app.attentionReason !== "MFA")) {
    throw new ConflictError("This application isn't waiting for a sign-in");
  }
  const host = new URL(app.job.applicationUrl ?? app.job.url).hostname;
  const kept = cookiesForHost(cookies, host);
  if (!kept.length) throw new ConflictError(`Your browser has no sign-in for ${host} yet. Sign in on the application page first.`);
  await saveBrowserSession(userId, host, app.platform, { cookies: kept, origins: [] });
  await markHumanStepComplete(userId, applicationId);
  await addApplicationEvent(applicationId, userId, "NOTE", `Signed in to ${host} in your own browser; Applyance saved that sign-in and is carrying on`);
  return { host, cookies: kept.length };
}

/** The person pressed Submit on the site in their own browser. */
export async function markSubmittedInBrowser(userId: string, applicationId: string, details: { confirmation?: string | null; detected: boolean }) {
  const now = new Date();
  const { count } = await prisma.application.updateMany({
    where: { id: applicationId, userId, status: { in: [...ATTENTION_APPLICATION_STATUSES] } },
    data: { status: "SUBMITTED", submittedAt: now, completedAt: now, attentionReason: null, attentionDetail: null, confirmationNumber: details.confirmation?.slice(0, 100) || undefined },
  });
  if (count === 0) throw new NotFoundError("Application waiting for submission");
  const how = details.detected ? "the site showed its confirmation" : "you marked it submitted";
  await addApplicationEvent(applicationId, userId, "SUBMITTED", `Submitted by you in your own browser (${how})${details.confirmation ? `, confirmation ${details.confirmation}` : ""}`);
}
