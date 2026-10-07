/**
 * Outlook mail (read-only) and calendar over Microsoft Graph.
 * https://learn.microsoft.com/graph/api/resources/message
 * https://learn.microsoft.com/graph/api/resources/event
 */
import type { AuthorizedClient } from "../auth";
import { json, ProviderError } from "../http";
import type { ProviderEndpoints } from "../oauth";
import { htmlToText, zonedToUtc } from "../text";
import type { CalendarClient, CalendarEventInput, MailClient, MailInvite, MailMessage, MailSummary } from "../types";

interface GraphDateTime {
  dateTime: string;
  timeZone: string;
}
interface GraphMessage {
  id: string;
  conversationId?: string;
  subject?: string | null;
  from?: { emailAddress?: { name?: string; address?: string } } | null;
  receivedDateTime?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
  "@odata.type"?: string;
  meetingMessageType?: string;
  startDateTime?: GraphDateTime;
  endDateTime?: GraphDateTime;
  location?: { displayName?: string };
}

const SUMMARY_FIELDS = "id,conversationId,subject,from,receivedDateTime,bodyPreview";

/** Graph times come as wall-clock time plus a zone name (UTC unless asked otherwise). */
function graphTime(t: GraphDateTime | undefined): Date | null {
  if (!t?.dateTime) return null;
  const m = t.dateTime.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const zone = t.timeZone && t.timeZone !== "UTC" && t.timeZone !== "tzone://Microsoft/Utc" ? t.timeZone : "UTC";
  try {
    return zonedToUtc(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, zone);
  } catch {
    return zonedToUtc(+m[1]!, +m[2]!, +m[3]!, +m[4]!, +m[5]!, "UTC");
  }
}

function summaryOf(m: GraphMessage): MailSummary {
  return {
    id: m.id,
    threadId: m.conversationId ?? null,
    fromName: m.from?.emailAddress?.name?.trim() || null,
    fromAddress: (m.from?.emailAddress?.address ?? "").toLowerCase(),
    subject: m.subject ?? "",
    snippet: m.bodyPreview ?? "",
    receivedAt: m.receivedDateTime ? new Date(m.receivedDateTime) : new Date(),
  };
}

export class MicrosoftMailClient implements MailClient, CalendarClient {
  constructor(
    private readonly http: AuthorizedClient,
    private readonly endpoints: ProviderEndpoints,
  ) {}

  async listRecent(since: Date, options: { limit: number }): Promise<MailSummary[]> {
    const out: MailSummary[] = [];
    const first = new URL(`${this.endpoints.api}/me/mailFolders/inbox/messages`);
    first.searchParams.set("$filter", `receivedDateTime ge ${since.toISOString()}`);
    first.searchParams.set("$orderby", "receivedDateTime desc");
    first.searchParams.set("$select", SUMMARY_FIELDS);
    first.searchParams.set("$top", String(Math.min(50, options.limit)));
    let next: string | undefined = first.toString();
    while (next && out.length < options.limit) {
      // Follow Graph's own paging links, but never to another host.
      if (!next.startsWith(this.endpoints.api)) throw new ProviderError("Unexpected paging link from Microsoft Graph", 0);
      const page: { value?: GraphMessage[]; "@odata.nextLink"?: string } = await json(await this.http.fetch(next, {}, "Outlook list"));
      out.push(...(page.value ?? []).map(summaryOf));
      next = page["@odata.nextLink"];
    }
    return out.slice(0, options.limit);
  }

  async getMessage(id: string): Promise<MailMessage> {
    const res = await this.http.fetch(`${this.endpoints.api}/me/messages/${encodeURIComponent(id)}`, { headers: { prefer: 'outlook.body-content-type="text"' } }, "Outlook message");
    const m = await json<GraphMessage>(res);
    const content = m.body?.content ?? "";
    const text = m.body?.contentType?.toLowerCase() === "html" ? htmlToText(content) : content;
    let invite: MailInvite | null = null;
    // Meeting requests arrive as eventMessage with the event's times on them.
    if (m["@odata.type"]?.includes("eventMessage") && m.meetingMessageType !== "meetingCancelled") {
      const start = graphTime(m.startDateTime);
      if (start) invite = { start, end: graphTime(m.endDateTime), location: m.location?.displayName || null, summary: m.subject ?? null };
    }
    return { ...summaryOf(m), text: text.trim(), invite };
  }

  private eventBody(event: CalendarEventInput) {
    const utc = (d: Date) => ({ dateTime: d.toISOString().replace(/Z$/, ""), timeZone: "UTC" });
    return {
      subject: event.title,
      body: { contentType: "text", content: event.description },
      start: utc(event.start),
      end: utc(event.end),
      ...(event.location ? { location: { displayName: event.location } } : {}),
    };
  }

  async createEvent(event: CalendarEventInput): Promise<string> {
    const res = await this.http.fetch(`${this.endpoints.calendar}/me/events`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(this.eventBody(event)) }, "Calendar create");
    return (await json<{ id: string }>(res)).id;
  }

  async updateEvent(eventId: string, event: CalendarEventInput): Promise<boolean> {
    const res = await this.http.fetch(`${this.endpoints.calendar}/me/events/${encodeURIComponent(eventId)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(this.eventBody(event)) }, "Calendar update");
    return res.status !== 404 && res.status !== 410;
  }

  async deleteEvent(eventId: string): Promise<void> {
    await this.http.fetch(`${this.endpoints.calendar}/me/events/${encodeURIComponent(eventId)}`, { method: "DELETE" }, "Calendar delete");
  }
}
