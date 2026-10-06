/** Shared by the proxy and server code; must not import server-only modules. */
export const SESSION_COOKIE = process.env.NODE_ENV === "production" ? "__Host-autoapply_session" : "autoapply_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
};
