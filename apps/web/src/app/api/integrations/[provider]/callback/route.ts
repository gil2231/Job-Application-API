import { NextResponse, after, type NextRequest } from "next/server";
import { audit, saveMailConnection, updateMailConnectionSettings } from "@autoapply/database";
import { exchangeCode, fetchAccountEmail, grantedAccess, oauthApp, PROVIDER_SLUGS, providerFromSlug, redirectUri, syncMailConnection } from "@autoapply/inbox";
import { getSession } from "@/lib/auth";
import { appUrl } from "@/lib/mail";
import { OAUTH_COOKIE, oauthCookieOptions, readOAuthCookie, sameState } from "../oauth-cookie";

export const dynamic = "force-dynamic";

function back(params: Record<string, string>) {
  const url = new URL("/integrations", appUrl());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const response = NextResponse.redirect(url);
  response.cookies.set(OAUTH_COOKIE, "", { ...oauthCookieOptions, maxAge: 0 });
  return response;
}

/** The provider sends the browser back here after the consent screen. */
export async function GET(request: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL("/sign-in?next=/integrations", appUrl()));
  const { provider: slug } = await ctx.params;
  const provider = providerFromSlug(slug);
  if (!provider) return new Response("Not found", { status: 404 });

  const params = request.nextUrl.searchParams;
  const saved = readOAuthCookie(request.cookies.get(OAUTH_COOKIE)?.value);
  const state = params.get("state") ?? "";
  if (!saved || saved.p !== provider || saved.u !== session.user.id || !state || !sameState(saved.s, state)) return back({ mail_error: "state" });
  if (params.get("error")) return back({ mail_error: params.get("error") === "access_denied" ? "denied" : "provider" });
  const code = params.get("code");
  const { app } = oauthApp(provider);
  if (!code || !app) return back({ mail_error: "provider" });

  try {
    const tokens = await exchangeCode(provider, app, { code, verifier: saved.v, redirectUri: redirectUri(provider, appUrl()) });
    const access = grantedAccess(provider, tokens.scopes);
    if (!access.mail && !access.calendar) return back({ mail_error: "scopes" });
    const email = await fetchAccountEmail(provider, tokens.accessToken);
    const connection = await saveMailConnection(session.user.id, {
      provider,
      email,
      scopes: tokens.scopes,
      calendar: access.calendar,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
    });
    // Without mail access (unticked on the consent screen) there is nothing to read.
    if (!access.mail) await updateMailConnectionSettings(session.user.id, connection.id, { readEmail: false });
    await audit(session.user.id, "mail.connected", { entityType: "MailConnection", entityId: connection.id, metadata: { provider, mail: access.mail, calendar: access.calendar } });
    after(() => syncMailConnection(connection.id, { appUrl: appUrl() }).then(() => undefined).catch((error) => console.error("[mail] first sync failed", error)));
    return back({ connected: PROVIDER_SLUGS[provider], ...(access.mail ? {} : { mail_error: "no_mail_scope" }) });
  } catch (error) {
    console.error("[mail] connecting failed", error);
    return back({ mail_error: "provider" });
  }
}
