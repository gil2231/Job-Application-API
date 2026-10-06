import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { createSession, revokeSessionToken, validateSessionToken, type PublicUser } from "@autoapply/database";
import { SESSION_COOKIE, sessionCookieOptions } from "./session-cookie";

/** The signed-in user for this request, or null. Deduplicated per request. */
export const getSession = cache(async () => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  return validateSessionToken(token);
});

/** Use at the top of every authenticated page, action and route handler. */
export async function requireUser(): Promise<PublicUser & { sessionId: string }> {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  return { ...session.user, sessionId: session.session.id };
}

export async function startSession(userId: string, meta: { ipAddress?: string | null; userAgent?: string | null }) {
  const { token } = await createSession(userId, meta);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, sessionCookieOptions);
}

export async function endSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await revokeSessionToken(token);
  store.delete(SESSION_COOKIE);
}

/**
 * Use at the top of every admin page. Anyone who is not an admin gets a
 * plain 404, so the panel's existence isn't revealed.
 */
export async function requireAdmin() {
  const user = await requireUser();
  if (user.role !== "ADMIN") notFound();
  return user;
}
