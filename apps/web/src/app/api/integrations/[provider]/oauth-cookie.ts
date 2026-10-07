import { randomBytes, timingSafeEqual } from "node:crypto";

export const OAUTH_COOKIE = "applyance_oauth";

export const oauthCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  // Lax: the provider sends the browser back with a top-level GET.
  sameSite: "lax" as const,
  path: "/api/integrations",
  maxAge: 10 * 60,
};

export function readOAuthCookie(raw: string | undefined): { p: string; s: string; v: string; u: string } | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof value.p === "string" && typeof value.s === "string" && typeof value.v === "string" && typeof value.u === "string") return value as { p: string; s: string; v: string; u: string };
  } catch {
    // fall through
  }
  return null;
}

export const randomState = () => randomBytes(24).toString("base64url");

export function sameState(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
