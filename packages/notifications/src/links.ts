import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type UnsubscribeKind = "attention" | "job_alerts";
const KINDS: readonly UnsubscribeKind[] = ["attention", "job_alerts"];

/** Public URL of the web app, for links in emails. */
export function appUrl(path = "/", env: NodeJS.ProcessEnv = process.env): string {
  const base = (env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function signingKey(env: NodeJS.ProcessEnv): Buffer {
  const secret = env.DATA_ENCRYPTION_KEY;
  if (!secret) throw new Error("DATA_ENCRYPTION_KEY is not set; it also signs unsubscribe links");
  // A separate key derived from the data key, so the data key itself is never used as an HMAC key.
  return createHash("sha256").update(`applyance-unsubscribe:${secret}`).digest();
}

function signature(userId: string, kind: UnsubscribeKind, env: NodeJS.ProcessEnv) {
  return createHmac("sha256", signingKey(env)).update(`${userId}.${kind}`).digest("base64url").slice(0, 32);
}

/** A token for a one-click unsubscribe link. It works without signing in, and only turns one kind of email off. */
export function createUnsubscribeToken(userId: string, kind: UnsubscribeKind, env: NodeJS.ProcessEnv = process.env): string {
  return `${userId}.${kind}.${signature(userId, kind, env)}`;
}

export function verifyUnsubscribeToken(token: string, env: NodeJS.ProcessEnv = process.env): { userId: string; kind: UnsubscribeKind } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [userId, kind, sig] = parts as [string, string, string];
  if (!/^[a-z0-9]{1,64}$/i.test(userId) || !KINDS.includes(kind as UnsubscribeKind)) return null;
  const expected = Buffer.from(signature(userId, kind as UnsubscribeKind, env));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  return { userId, kind: kind as UnsubscribeKind };
}

export function unsubscribeUrl(userId: string, kind: UnsubscribeKind, env: NodeJS.ProcessEnv = process.env): string {
  return appUrl(`/unsubscribe?token=${encodeURIComponent(createUnsubscribeToken(userId, kind, env))}`, env);
}

/** Headers that let mail apps show their own Unsubscribe button (RFC 8058 one-click). */
export function unsubscribeHeaders(userId: string, kind: UnsubscribeKind, env: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const url = appUrl(`/api/unsubscribe?token=${encodeURIComponent(createUnsubscribeToken(userId, kind, env))}`, env);
  return { "List-Unsubscribe": `<${url}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" };
}
