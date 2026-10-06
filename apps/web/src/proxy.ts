import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, sessionCookieOptions } from "./lib/session-cookie";

const PUBLIC_PATHS = ["/sign-in", "/sign-up", "/api/health"];

/**
 * Optimistic routing only: sends visitors without a session cookie to sign-in.
 * Every page, action and route handler still validates the session against
 * the database (requireUser), so a forged cookie gets nothing.
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
  const response = NextResponse.next();
  // Sliding cookie lifetime; the database session decides validity.
  if (token) response.cookies.set(SESSION_COOKIE, token, sessionCookieOptions);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg).*)"],
};
