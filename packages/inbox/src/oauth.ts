/**
 * OAuth 2.0 (authorization code + PKCE) for Google and Microsoft accounts.
 *
 * The app registrations are the operator's: GOOGLE_CLIENT_ID/SECRET and
 * MICROSOFT_CLIENT_ID/SECRET (plus MICROSOFT_TENANT, default "common"). The
 * redirect URI each registration must allow is
 * `${APP_URL}/api/integrations/<google|microsoft>/callback`.
 *
 * GOOGLE_ENDPOINT_BASE and MICROSOFT_ENDPOINT_BASE point every endpoint of a
 * provider at one base URL. They exist for the local mock used in tests.
 */
import { createHash, randomBytes } from "node:crypto";
import { json, ProviderAuthError, ProviderError, request, type FetchLike } from "./http";
import type { MailProviderId } from "./types";

export const PROVIDER_SLUGS = { GOOGLE: "google", MICROSOFT: "microsoft" } as const satisfies Record<MailProviderId, string>;
export type ProviderSlug = (typeof PROVIDER_SLUGS)[MailProviderId];

export function providerFromSlug(slug: string): MailProviderId | null {
  if (slug === "google") return "GOOGLE";
  if (slug === "microsoft") return "MICROSOFT";
  return null;
}

export const PROVIDER_NAMES: Record<MailProviderId, { account: string; mail: string; calendar: string }> = {
  GOOGLE: { account: "Google", mail: "Gmail", calendar: "Google Calendar" },
  MICROSOFT: { account: "Microsoft", mail: "Outlook", calendar: "Outlook Calendar" },
};

const GOOGLE_MAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_SCOPES = ["openid", "email", GOOGLE_MAIL_SCOPE, GOOGLE_CALENDAR_SCOPE];
const MICROSOFT_SCOPES = ["openid", "email", "offline_access", "User.Read", "Mail.Read", "Calendars.ReadWrite"];

type Env = Record<string, string | undefined>;

export interface ProviderEndpoints {
  authorize: string;
  token: string;
  revoke: string | null;
  userinfo: string;
  /** Gmail REST base, or Microsoft Graph base. */
  api: string;
  /** Google Calendar REST base (Graph serves calendars itself). */
  calendar: string;
}

const trimSlash = (s: string) => s.replace(/\/+$/, "");

export function providerEndpoints(provider: MailProviderId, env: Env = process.env): ProviderEndpoints {
  if (provider === "GOOGLE") {
    const base = env.GOOGLE_ENDPOINT_BASE ? trimSlash(env.GOOGLE_ENDPOINT_BASE) : null;
    return {
      authorize: base ? `${base}/o/oauth2/v2/auth` : "https://accounts.google.com/o/oauth2/v2/auth",
      token: base ? `${base}/token` : "https://oauth2.googleapis.com/token",
      revoke: base ? `${base}/revoke` : "https://oauth2.googleapis.com/revoke",
      userinfo: base ? `${base}/v1/userinfo` : "https://openidconnect.googleapis.com/v1/userinfo",
      api: base ? `${base}/gmail/v1` : "https://gmail.googleapis.com/gmail/v1",
      calendar: base ? `${base}/calendar/v3` : "https://www.googleapis.com/calendar/v3",
    };
  }
  const tenant = encodeURIComponent(env.MICROSOFT_TENANT || "common");
  const base = env.MICROSOFT_ENDPOINT_BASE ? trimSlash(env.MICROSOFT_ENDPOINT_BASE) : null;
  const login = base ?? "https://login.microsoftonline.com";
  const graph = base ? `${base}/v1.0` : "https://graph.microsoft.com/v1.0";
  return {
    authorize: `${login}/${tenant}/oauth2/v2.0/authorize`,
    token: `${login}/${tenant}/oauth2/v2.0/token`,
    revoke: null,
    userinfo: `${graph}/me`,
    api: graph,
    calendar: graph,
  };
}

export interface OAuthApp {
  clientId: string;
  clientSecret: string;
}

/** The operator's app registration, or null with what is missing. */
export function oauthApp(provider: MailProviderId, env: Env = process.env): { app: OAuthApp | null; missing: string[] } {
  const prefix = provider === "GOOGLE" ? "GOOGLE" : "MICROSOFT";
  const clientId = env[`${prefix}_CLIENT_ID`]?.trim();
  const clientSecret = env[`${prefix}_CLIENT_SECRET`]?.trim();
  const missing = [!clientId && `${prefix}_CLIENT_ID`, !clientSecret && `${prefix}_CLIENT_SECRET`].filter((x): x is string => !!x);
  return { app: missing.length ? null : { clientId: clientId!, clientSecret: clientSecret! }, missing };
}

export function redirectUri(provider: MailProviderId, appUrl: string) {
  return `${trimSlash(appUrl)}/api/integrations/${PROVIDER_SLUGS[provider]}/callback`;
}

export function pkcePair() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function authorizeUrl(provider: MailProviderId, app: OAuthApp, input: { state: string; challenge: string; redirectUri: string; env?: Env }) {
  const url = new URL(providerEndpoints(provider, input.env).authorize);
  const params: Record<string, string> = {
    client_id: app.clientId,
    response_type: "code",
    redirect_uri: input.redirectUri,
    scope: (provider === "GOOGLE" ? GOOGLE_SCOPES : MICROSOFT_SCOPES).join(" "),
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
  };
  if (provider === "GOOGLE") {
    // A refresh token is only issued with offline access, and only on consent.
    Object.assign(params, { access_type: "offline", prompt: "consent", include_granted_scopes: "true" });
  } else {
    Object.assign(params, { response_mode: "query", prompt: "select_account" });
  }
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  scopes: string[];
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

async function tokenRequest(provider: MailProviderId, app: OAuthApp, body: Record<string, string>, fetchImpl: FetchLike, env?: Env): Promise<TokenSet> {
  const res = await fetchImpl(providerEndpoints(provider, env).token, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({ client_id: app.clientId, client_secret: app.clientSecret, ...body }).toString(),
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok || !data.access_token) {
    // invalid_grant: the refresh token was revoked or expired, or the code was used.
    if (data.error === "invalid_grant" || res.status === 401) throw new ProviderAuthError();
    throw new ProviderError(`Token request failed (${res.status})${data.error ? `: ${data.error}` : ""}${data.error_description ? ` (${data.error_description.slice(0, 200)})` : ""}`, res.status);
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in ? new Date(Date.now() + data.expires_in * 1000) : null,
    scopes: (data.scope ?? "").split(/\s+/).filter(Boolean),
  };
}

export function exchangeCode(provider: MailProviderId, app: OAuthApp, input: { code: string; verifier: string; redirectUri: string }, fetchImpl: FetchLike = fetch, env?: Env) {
  const body: Record<string, string> = { grant_type: "authorization_code", code: input.code, code_verifier: input.verifier, redirect_uri: input.redirectUri };
  if (provider === "MICROSOFT") body.scope = MICROSOFT_SCOPES.join(" ");
  return tokenRequest(provider, app, body, fetchImpl, env);
}

export function refreshAccessToken(provider: MailProviderId, app: OAuthApp, refreshToken: string, fetchImpl: FetchLike = fetch, env?: Env) {
  const body: Record<string, string> = { grant_type: "refresh_token", refresh_token: refreshToken };
  if (provider === "MICROSOFT") body.scope = MICROSOFT_SCOPES.join(" ");
  return tokenRequest(provider, app, body, fetchImpl, env);
}

/** The signed-in account's email address. */
export async function fetchAccountEmail(provider: MailProviderId, accessToken: string, fetchImpl: FetchLike = fetch, env?: Env): Promise<string> {
  const res = await request(fetchImpl, providerEndpoints(provider, env).userinfo, { headers: { authorization: `Bearer ${accessToken}` } }, "Account lookup");
  const data = await json<{ email?: string; mail?: string | null; userPrincipalName?: string }>(res);
  const email = data.email ?? data.mail ?? data.userPrincipalName;
  if (!email) throw new ProviderError("The account has no email address", 400);
  return email.toLowerCase();
}

/** Best effort: tell the provider to forget the grant. Microsoft has no per-app revoke; removing the app is done in the account settings. */
export async function revokeToken(provider: MailProviderId, token: string, fetchImpl: FetchLike = fetch, env?: Env) {
  const url = providerEndpoints(provider, env).revoke;
  if (!url) return false;
  try {
    const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ token }).toString(), signal: AbortSignal.timeout(10_000) });
    return res.ok;
  } catch {
    return false;
  }
}

/** Whether the granted scopes allow reading mail and writing calendar events. Google lets people untick scopes on the consent screen. */
export function grantedAccess(provider: MailProviderId, scopes: string[]) {
  if (provider === "GOOGLE") return { mail: scopes.includes(GOOGLE_MAIL_SCOPE), calendar: scopes.includes(GOOGLE_CALENDAR_SCOPE) };
  // Microsoft returns scopes as resource-qualified or bare names, in any case.
  const has = (s: string) => scopes.some((x) => x.toLowerCase().endsWith(s.toLowerCase()));
  // An empty list means the token response left them out; Microsoft grants all-or-nothing.
  return { mail: scopes.length === 0 || has("Mail.Read"), calendar: scopes.length === 0 || has("Calendars.ReadWrite") };
}
