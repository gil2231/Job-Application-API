import { NextResponse, type NextRequest } from "next/server";
import { contentSecurityPolicy, createNonce } from "./lib/csp";
import { SESSION_COOKIE, sessionCookieOptions } from "./lib/session-cookie";

const PUBLIC_PATHS = ["/sign-in", "/sign-up", "/api/health", "/unsubscribe", "/api/unsubscribe"];
const PUBLIC_PATHS = ["/sign-in", "/sign-up", "/api/health", "/terms", "/privacy", "/help"];
const PUBLIC_PATHS = ["/sign-in", "/sign-up", "/api/health", "/api/client-errors"];

/**
 * Optimistic routing only: sends visitors without a session cookie to sign-in.
 * Every page, action and route handler still validates the session against
 * the database (requireUser), so a forged cookie gets nothing.
 *
 * Also sets this request's Content Security Policy and script nonce.
 */
export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!token && !isPublic) {
    if (pathname.startsWith("/api/")) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const url = new URL("/sign-in", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  const nonce = createNonce();
  const csp = contentSecurityPolicy(nonce, { dev: process.env.NODE_ENV !== "production", https: request.nextUrl.protocol === "https:" });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  // Sliding cookie lifetime; the database session decides validity. Only on
  // page loads: refreshing it on a POST would re-set the cookie a sign-out
  // server action is deleting in the same response.
  if (token && request.method === "GET") response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return response;
}

export const config = {
  // The app icon, manifest, service worker and offline page load before anyone signs in.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|apple-icon.png|manifest.webmanifest|sw.js|offline.html|icons/).*)"],
};
