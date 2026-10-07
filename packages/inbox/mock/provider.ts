/**
 * A stand-in for Google (OAuth, Gmail, Calendar) and Microsoft (OAuth, Graph
 * mail and calendar), for tests and local development. It speaks the same
 * HTTP shapes the real APIs do, closely enough for the clients in src/.
 *
 * Use it as a fetch implementation (`mock.fetch`) or serve it
 * (`pnpm --filter @autoapply/inbox mock`, then point GOOGLE_ENDPOINT_BASE and
 * MICROSOFT_ENDPOINT_BASE at it). Test hooks live under /__mock.
 */
import { randomUUID } from "node:crypto";

export interface MockMail {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  body: string;
  html?: boolean;
  receivedAt: Date;
  /** Raw text/calendar content. */
  ics?: string;
  /** Outlook meeting request times (UTC). */
  meeting?: { start: Date; end: Date; location?: string };
  sent?: boolean;
}

export interface MockEvent {
  id: string;
  provider: "google" | "microsoft";
  title: string;
  description: string;
  start: string;
  end: string;
  location: string | null;
  status: "confirmed" | "cancelled";
}

interface TokenRecord {
  provider: "google" | "microsoft";
  email: string;
  expiresAt: number;
}

export class MockProvider {
  readonly mail: Record<"google" | "microsoft", MockMail[]> = { google: [], microsoft: [] };
  readonly events: MockEvent[] = [];
  readonly calls: Array<{ method: string; path: string }> = [];
  private readonly codes = new Map<string, { provider: "google" | "microsoft"; challenge: string; redirectUri: string; email: string }>();
  private readonly tokens = new Map<string, TokenRecord>();
  private readonly refreshTokens = new Map<string, TokenRecord>();
  /** Account the consent screen signs in as. */
  accounts = { google: "candidate@gmail.example", microsoft: "candidate@outlook.example" };
  /** Seconds an access token lives. */
  tokenLifetime = 3600;
  /** Scopes Google reports as granted (people can untick some). */
  googleScopes = "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/calendar.events";

  constructor(readonly base = "http://mock.local") {}

  reset() {
    this.mail.google.length = 0;
    this.mail.microsoft.length = 0;
    this.events.length = 0;
    this.calls.length = 0;
    this.tokens.clear();
    this.refreshTokens.clear();
    this.codes.clear();
  }

  addMail(provider: "google" | "microsoft", mail: Partial<MockMail> & Pick<MockMail, "from" | "subject" | "body">): MockMail {
    const full: MockMail = { id: randomUUID().replace(/-/g, ""), threadId: randomUUID().replace(/-/g, ""), receivedAt: new Date(), ...mail };
    this.mail[provider].push(full);
    return full;
  }

  /** Revoke every token (the user removed access in their account settings). */
  revokeAll() {
    this.tokens.clear();
    this.refreshTokens.clear();
  }

  /** Expire every access token now (refresh tokens keep working). */
  expireAccessTokens() {
    for (const t of this.tokens.values()) t.expiresAt = 0;
  }

  /** Issue tokens directly, as if the user had consented. */
  issue(provider: "google" | "microsoft", email = this.accounts[provider]) {
    const access = `at-${randomUUID()}`;
    const refresh = `rt-${randomUUID()}`;
    const record = { provider, email, expiresAt: Date.now() + this.tokenLifetime * 1000 };
    this.tokens.set(access, record);
    this.refreshTokens.set(refresh, { ...record });
    return { access, refresh };
  }

  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input.toString(), init);
    return this.handle(req);
  };

  async handle(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;
    this.calls.push({ method: req.method, path });
    try {
      if (path.startsWith("/__mock/")) return await this.admin(req, url);
      // ── Google ──
      if (path === "/o/oauth2/v2/auth") return this.consent("google", url);
      if (path === "/token") return await this.token("google", req);
      if (path === "/revoke") return new Response("{}", { status: 200 });
      if (path === "/v1/userinfo") return this.authed(req, "google", (t) => Response.json({ email: t.email, email_verified: true }));
      if (path.startsWith("/gmail/v1/users/me/messages")) return this.authed(req, "google", () => this.gmail(url));
      if (path.startsWith("/calendar/v3/calendars/primary/events")) return this.authed(req, "google", () => this.calendar("google", req, path.split("/")[6]));
      // ── Microsoft ──
      if (/^\/[^/]+\/oauth2\/v2\.0\/authorize$/.test(path)) return this.consent("microsoft", url);
      if (/^\/[^/]+\/oauth2\/v2\.0\/token$/.test(path)) return await this.token("microsoft", req);
      if (path === "/v1.0/me") return this.authed(req, "microsoft", (t) => Response.json({ mail: t.email, userPrincipalName: t.email }));
      if (path === "/v1.0/me/mailFolders/inbox/messages") return this.authed(req, "microsoft", () => this.graphList(url));
      if (path.startsWith("/v1.0/me/messages/")) return this.authed(req, "microsoft", () => this.graphMessage(decodeURIComponent(path.split("/")[4]!)));
      if (path.startsWith("/v1.0/me/events")) return this.authed(req, "microsoft", () => this.calendar("microsoft", req, path.split("/")[4]));
      return Response.json({ error: "not_found" }, { status: 404 });
    } catch (error) {
      return Response.json({ error: (error as Error).message }, { status: 500 });
    }
  }

  // ── OAuth ──

  /** The consent screen: one button that sends the browser back with a code. */
  private consent(provider: "google" | "microsoft", url: URL) {
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const challenge = url.searchParams.get("code_challenge") ?? "";
    if (url.searchParams.get("approve") === "1" || url.searchParams.get("approve") === "0") {
      const back = new URL(redirectUri);
      if (url.searchParams.get("approve") === "0") back.searchParams.set("error", "access_denied");
      else {
        const code = `code-${randomUUID()}`;
        this.codes.set(code, { provider, challenge, redirectUri, email: this.accounts[provider] });
        back.searchParams.set("code", code);
      }
      back.searchParams.set("state", state);
      return Response.redirect(back.toString(), 302);
    }
    const allow = new URL(url);
    allow.searchParams.set("approve", "1");
    const deny = new URL(url);
    deny.searchParams.set("approve", "0");
    const name = provider === "google" ? "Google" : "Microsoft";
    const html = `<!doctype html><title>Sign in with ${name} (mock)</title><body style="font-family:sans-serif;padding:40px">
      <h1>${name} (mock)</h1><p>Applyance wants to read your email and manage your calendar events as <b>${this.accounts[provider]}</b>.</p>
      <a href="${allow.pathname}${allow.search}" id="allow">Allow</a> &nbsp; <a href="${deny.pathname}${deny.search}" id="deny">Cancel</a></body>`;
    return new Response(html, { headers: { "content-type": "text/html" } });
  }

  private async token(provider: "google" | "microsoft", req: Request) {
    const form = new URLSearchParams(await req.text());
    const grant = form.get("grant_type");
    if (grant === "authorization_code") {
      const code = this.codes.get(form.get("code") ?? "");
      if (!code || code.provider !== provider) return Response.json({ error: "invalid_grant" }, { status: 400 });
      this.codes.delete(form.get("code")!);
      const { createHash } = await import("node:crypto");
      const expected = createHash("sha256").update(form.get("code_verifier") ?? "").digest("base64url");
      if (expected !== code.challenge || form.get("redirect_uri") !== code.redirectUri) return Response.json({ error: "invalid_grant" }, { status: 400 });
      const { access, refresh } = this.issue(provider, code.email);
      return Response.json({ access_token: access, refresh_token: refresh, expires_in: this.tokenLifetime, token_type: "Bearer", scope: provider === "google" ? this.googleScopes : "Mail.Read Calendars.ReadWrite User.Read openid email offline_access" });
    }
    if (grant === "refresh_token") {
      const record = this.refreshTokens.get(form.get("refresh_token") ?? "");
      if (!record || record.provider !== provider) return Response.json({ error: "invalid_grant" }, { status: 400 });
      const access = `at-${randomUUID()}`;
      this.tokens.set(access, { ...record, expiresAt: Date.now() + this.tokenLifetime * 1000 });
      // Microsoft rotates refresh tokens; Google keeps them.
      if (provider === "microsoft") {
        const rotated = `rt-${randomUUID()}`;
        this.refreshTokens.delete(form.get("refresh_token")!);
        this.refreshTokens.set(rotated, record);
        return Response.json({ access_token: access, refresh_token: rotated, expires_in: this.tokenLifetime });
      }
      return Response.json({ access_token: access, expires_in: this.tokenLifetime });
    }
    return Response.json({ error: "unsupported_grant_type" }, { status: 400 });
  }

  private authed(req: Request, provider: "google" | "microsoft", fn: (t: TokenRecord) => Response | Promise<Response>) {
    const token = req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const record = this.tokens.get(token);
    if (!record || record.provider !== provider || record.expiresAt < Date.now()) return Response.json({ error: { code: "unauthenticated" } }, { status: 401 });
    return fn(record);
  }

  // ── Gmail ──

  private gmail(url: URL) {
    const parts = url.pathname.split("/");
    const id = parts[6];
    if (!id) {
      const q = url.searchParams.get("q") ?? "";
      const after = Number(q.match(/after:(\d+)/)?.[1] ?? 0) * 1000;
      const list = this.mail.google
        .filter((m) => m.receivedAt.getTime() > after && !(m.sent && q.includes("-in:sent")))
        .sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
      const max = Number(url.searchParams.get("maxResults") ?? 100);
      const start = Number(url.searchParams.get("pageToken") ?? 0);
      const page = list.slice(start, start + max);
      return Response.json({ messages: page.map((m) => ({ id: m.id, threadId: m.threadId })), ...(start + max < list.length ? { nextPageToken: String(start + max) } : {}), resultSizeEstimate: list.length });
    }
    const mail = this.mail.google.find((m) => m.id === id);
    if (!mail) return Response.json({ error: { code: 404 } }, { status: 404 });
    if (parts[7] === "attachments") return Response.json({ data: Buffer.from(mail.ics ?? "").toString("base64url"), size: mail.ics?.length ?? 0 });
    const headers = [
      { name: "From", value: mail.from },
      { name: "Subject", value: mail.subject },
      { name: "Date", value: mail.receivedAt.toUTCString() },
    ];
    const snippet = mail.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 200);
    const base = { id: mail.id, threadId: mail.threadId, snippet, internalDate: String(mail.receivedAt.getTime()) };
    if (url.searchParams.get("format") === "metadata") return Response.json({ ...base, payload: { headers } });
    const b64 = (s: string) => Buffer.from(s).toString("base64url");
    const parts64 = [{ mimeType: mail.html ? "text/html" : "text/plain", body: { data: b64(mail.body), size: mail.body.length } }];
    if (mail.ics) parts64.push({ mimeType: "text/calendar", body: { data: b64(mail.ics), size: mail.ics.length } });
    return Response.json({ ...base, payload: { mimeType: "multipart/mixed", headers, parts: [{ mimeType: "multipart/alternative", parts: parts64 }] } });
  }

  // ── Graph mail ──

  private graphMessageJson(m: MockMail, full: boolean) {
    const [, name, address] = m.from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/) ?? [null, "", m.from];
    const base = {
      id: m.id,
      conversationId: m.threadId,
      subject: m.subject,
      from: { emailAddress: { name: name || address, address } },
      receivedDateTime: m.receivedAt.toISOString(),
      bodyPreview: m.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 255),
    };
    if (!full) return base;
    const graphTime = (d: Date) => ({ dateTime: d.toISOString().replace("Z", "0000"), timeZone: "UTC" });
    return {
      ...base,
      body: { contentType: m.html ? "html" : "text", content: m.body },
      ...(m.meeting
        ? { "@odata.type": "#microsoft.graph.eventMessageRequest", meetingMessageType: "meetingRequest", startDateTime: graphTime(m.meeting.start), endDateTime: graphTime(m.meeting.end), location: { displayName: m.meeting.location ?? "" } }
        : { "@odata.type": "#microsoft.graph.message" }),
    };
  }

  private graphList(url: URL) {
    const filter = url.searchParams.get("$filter") ?? "";
    const after = new Date(filter.match(/receivedDateTime ge (\S+)/)?.[1] ?? 0).getTime();
    const list = this.mail.microsoft.filter((m) => !m.sent && m.receivedAt.getTime() >= after).sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime());
    const top = Number(url.searchParams.get("$top") ?? 10);
    const skip = Number(url.searchParams.get("$skip") ?? 0);
    const page = list.slice(skip, skip + top);
    let next: string | undefined;
    if (skip + top < list.length) {
      const n = new URL(url);
      n.searchParams.set("$skip", String(skip + top));
      next = n.toString();
    }
    return Response.json({ value: page.map((m) => this.graphMessageJson(m, false)), ...(next ? { "@odata.nextLink": next } : {}) });
  }

  private graphMessage(id: string) {
    const m = this.mail.microsoft.find((x) => x.id === id);
    if (!m) return Response.json({ error: { code: "ErrorItemNotFound" } }, { status: 404 });
    return Response.json(this.graphMessageJson(m, true));
  }

  // ── Calendars ──

  private async calendar(provider: "google" | "microsoft", req: Request, id: string | undefined) {
    const event = id ? this.events.find((e) => e.id === id && e.provider === provider) : undefined;
    if (req.method === "POST") {
      const body = (await req.json()) as Record<string, unknown>;
      const e = this.toEvent(provider, randomUUID().replace(/-/g, ""), body);
      this.events.push(e);
      return Response.json(provider === "google" ? { id: e.id, status: "confirmed" } : { id: e.id });
    }
    if (!event || (provider === "microsoft" && event.status === "cancelled")) return Response.json({ error: { code: 404 } }, { status: provider === "google" && event ? 410 : 404 });
    if (req.method === "PATCH") {
      if (event.status === "cancelled") return Response.json({ id: event.id, status: "cancelled" });
      Object.assign(event, this.toEvent(provider, event.id, (await req.json()) as Record<string, unknown>));
      return Response.json({ id: event.id, status: event.status });
    }
    if (req.method === "DELETE") {
      event.status = "cancelled";
      return new Response(null, { status: 204 });
    }
    return Response.json({ id: event.id, status: event.status });
  }

  private toEvent(provider: "google" | "microsoft", id: string, body: Record<string, unknown>): MockEvent {
    if (provider === "google") {
      const b = body as { summary: string; description: string; location?: string; start: { dateTime: string }; end: { dateTime: string } };
      return { id, provider, title: b.summary, description: b.description, start: new Date(b.start.dateTime).toISOString(), end: new Date(b.end.dateTime).toISOString(), location: b.location ?? null, status: "confirmed" };
    }
    const b = body as { subject: string; body: { content: string }; start: { dateTime: string }; end: { dateTime: string }; location?: { displayName: string } };
    return { id, provider, title: b.subject, description: b.body.content, start: new Date(`${b.start.dateTime}Z`).toISOString(), end: new Date(`${b.end.dateTime}Z`).toISOString(), location: b.location?.displayName ?? null, status: "confirmed" };
  }

  // ── Test hooks ──

  private async admin(req: Request, url: URL) {
    if (url.pathname === "/__mock/reset" && req.method === "POST") {
      this.reset();
      return Response.json({ ok: true });
    }
    if (url.pathname === "/__mock/mail" && req.method === "POST") {
      const body = (await req.json()) as { provider: "google" | "microsoft"; from: string; subject: string; body: string; ics?: string; receivedAt?: string; meeting?: { start: string; end: string; location?: string } };
      const mail = this.addMail(body.provider, {
        from: body.from,
        subject: body.subject,
        body: body.body,
        ics: body.ics,
        receivedAt: body.receivedAt ? new Date(body.receivedAt) : new Date(),
        meeting: body.meeting ? { start: new Date(body.meeting.start), end: new Date(body.meeting.end), location: body.meeting.location } : undefined,
      });
      return Response.json({ id: mail.id });
    }
    if (url.pathname === "/__mock/events") return Response.json(this.events);
    if (url.pathname === "/__mock/revoke" && req.method === "POST") {
      this.revokeAll();
      return Response.json({ ok: true });
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  }
}
