import { NextResponse } from "next/server";
import { authorizeUrl, oauthApp, pkcePair, providerFromSlug, redirectUri } from "@autoapply/inbox";
import { getSession } from "@/lib/auth";
import { appUrl } from "@/lib/mail";
import { OAUTH_COOKIE, oauthCookieOptions, randomState } from "../oauth-cookie";

export const dynamic = "force-dynamic";

/** Start connecting a Google or Microsoft account: send the browser to the provider's consent screen. */
export async function GET(_request: Request, ctx: { params: Promise<{ provider: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/sign-in?next=/integrations", appUrl()));
  const { provider: slug } = await ctx.params;
  const provider = providerFromSlug(slug);
  if (!provider) return new Response("Not found", { status: 404 });
  const { app } = oauthApp(provider);
  if (!app) return NextResponse.redirect(new URL(`/integrations?mail_error=not_configured`, appUrl()));

  const state = randomState();
  const { verifier, challenge } = pkcePair();
  const url = authorizeUrl(provider, app, { state, challenge, redirectUri: redirectUri(provider, appUrl()) });
  const response = NextResponse.redirect(url);
  // Ties the callback to this browser and this user; the PKCE verifier never leaves the server and this cookie.
  response.cookies.set(OAUTH_COOKIE, Buffer.from(JSON.stringify({ p: provider, s: state, v: verifier, u: session.user.id })).toString("base64url"), oauthCookieOptions);
  return response;
}
