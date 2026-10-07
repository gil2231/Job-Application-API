/**
 * Gmail (read-only) and Google Calendar over their REST APIs.
 * https://developers.google.com/gmail/api/reference/rest
 * https://developers.google.com/calendar/api/v3/reference/events
 */
import type { AuthorizedClient } from "../auth";
import { json, mapLimit } from "../http";
import type { ProviderEndpoints } from "../oauth";
import { htmlToText, parseAddress, parseIcs } from "../text";
import type { CalendarClient, CalendarEventInput, MailClient, MailMessage, MailSummary } from "../types";
import { ATS_SENDER_DOMAINS } from "../senders";

interface GmailHeader {
  name: string;
  value: string;
}
interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailPart[];
}
interface GmailMessage {
  id: string;
  threadId?: string;
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

const decode = (data: string) => Buffer.from(data, "base64url").toString("utf8");
const header = (m: GmailMessage, name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";

function summaryOf(m: GmailMessage): MailSummary {
  const from = parseAddress(header(m, "From"));
  return {
    id: m.id,
    threadId: m.threadId ?? null,
    fromName: from.name,
    fromAddress: from.address,
    subject: header(m, "Subject"),
    snippet: htmlToText(m.snippet ?? ""),
    receivedAt: new Date(Number(m.internalDate ?? Date.now())),
  };
}

/** Gmail search operators can't take arbitrary characters; keep names that are safe to quote. */
function companyTerms(companies: string[]) {
  return [...new Set(companies.map((c) => c.replace(/["{}()]/g, " ").replace(/\s+/g, " ").trim()).filter((c) => c.length >= 2))].slice(0, 80);
}

export function gmailQuery(since: Date, companies: string[]) {
  const after = `after:${Math.floor(since.getTime() / 1000)}`;
  const names = companyTerms(companies).map((c) => `"${c}"`);
  const senders = ATS_SENDER_DOMAINS.map((d) => `from:${d}`);
  // Only email that mentions a company applied to, or comes from a hiring system.
  return `${after} -in:sent -in:chats -in:drafts -category:promotions -category:social {${[...names, ...senders].join(" ")}}`;
}

export class GoogleMailClient implements MailClient, CalendarClient {
  constructor(
    private readonly http: AuthorizedClient,
    private readonly endpoints: ProviderEndpoints,
  ) {}

  async listRecent(since: Date, options: { limit: number; companies: string[] }): Promise<MailSummary[]> {
    const ids: string[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`${this.endpoints.api}/users/me/messages`);
      url.searchParams.set("q", gmailQuery(since, options.companies));
      url.searchParams.set("maxResults", String(Math.min(100, options.limit)));
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const page = await json<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(await this.http.fetch(url.toString(), {}, "Gmail list"));
      ids.push(...(page.messages ?? []).map((m) => m.id));
      pageToken = page.nextPageToken;
    } while (pageToken && ids.length < options.limit);

    const summaries = await mapLimit(ids.slice(0, options.limit), 5, async (id) => {
      const url = new URL(`${this.endpoints.api}/users/me/messages/${encodeURIComponent(id)}`);
      url.searchParams.set("format", "metadata");
      for (const h of ["From", "Subject", "Date"]) url.searchParams.append("metadataHeaders", h);
      const res = await this.http.fetch(url.toString(), {}, "Gmail message");
      if (res.status === 404) return null;
      return summaryOf(await json<GmailMessage>(res));
    });
    return summaries.filter((s): s is MailSummary => !!s);
  }

  async getMessage(id: string): Promise<MailMessage> {
    const res = await this.http.fetch(`${this.endpoints.api}/users/me/messages/${encodeURIComponent(id)}?format=full`, {}, "Gmail message");
    const m = await json<GmailMessage>(res);
    let plain = "";
    let html = "";
    let ics: string | null = null;
    const walk = async (part: GmailPart | undefined) => {
      if (!part) return;
      const type = (part.mimeType ?? "").toLowerCase();
      if (type === "text/calendar" || part.filename?.toLowerCase().endsWith(".ics")) {
        if (!ics) {
          if (part.body?.data) ics = decode(part.body.data);
          else if (part.body?.attachmentId && (part.body.size ?? 0) < 200_000) {
            const a = await this.http.fetch(`${this.endpoints.api}/users/me/messages/${encodeURIComponent(id)}/attachments/${encodeURIComponent(part.body.attachmentId)}`, {}, "Gmail attachment");
            if (a.ok) ics = decode((await json<{ data?: string }>(a)).data ?? "");
          }
        }
      } else if (type === "text/plain" && part.body?.data && !part.filename) plain += decode(part.body.data);
      else if (type === "text/html" && part.body?.data && !part.filename) html += decode(part.body.data);
      for (const child of part.parts ?? []) await walk(child);
    };
    await walk(m.payload);
    const invite = ics ? parseIcs(ics) : null;
    return { ...summaryOf(m), text: plain.trim() || htmlToText(html), invite };
  }

  private eventBody(event: CalendarEventInput) {
    return {
      summary: event.title,
      description: event.description,
      location: event.location ?? undefined,
      start: { dateTime: event.start.toISOString() },
      end: { dateTime: event.end.toISOString() },
      source: { title: "Applyance", url: event.description.match(/https?:\/\/\S+/)?.[0] },
    };
  }

  async createEvent(event: CalendarEventInput): Promise<string> {
    const res = await this.http.fetch(`${this.endpoints.calendar}/calendars/primary/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(this.eventBody(event)) }, "Calendar create");
    return (await json<{ id: string }>(res)).id;
  }

  async updateEvent(eventId: string, event: CalendarEventInput): Promise<boolean> {
    const res = await this.http.fetch(`${this.endpoints.calendar}/calendars/primary/events/${encodeURIComponent(eventId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(this.eventBody(event)) }, "Calendar update");
    if (res.status === 404 || res.status === 410) return false;
    // A deleted event still exists with status "cancelled"; treat it as gone.
    return (await json<{ status?: string }>(res)).status !== "cancelled";
  }

  async deleteEvent(eventId: string): Promise<void> {
    await this.http.fetch(`${this.endpoints.calendar}/calendars/primary/events/${encodeURIComponent(eventId)}`, { method: "DELETE" }, "Calendar delete");
  }
}
