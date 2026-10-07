/**
 * What the email sync needs from a mail provider (Gmail, Outlook) and from a
 * calendar. Each provider implements these over its own HTTP API.
 */

/** A message as listed: headers and the provider's short preview only. */
export interface MailSummary {
  id: string;
  threadId: string | null;
  fromName: string | null;
  fromAddress: string;
  subject: string;
  /** The provider's preview text (a couple of hundred characters). */
  snippet: string;
  receivedAt: Date;
}

/** A calendar invite found in a message. */
export interface MailInvite {
  start: Date;
  end: Date | null;
  location: string | null;
  summary: string | null;
}

export interface MailMessage extends MailSummary {
  /** Plain text body (HTML is converted). */
  text: string;
  invite: MailInvite | null;
}

export interface MailClient {
  /** Messages received after `since`, newest first, at most `limit`. `companies` lets a provider narrow its own search. */
  listRecent(since: Date, options: { limit: number; companies: string[] }): Promise<MailSummary[]>;
  getMessage(id: string): Promise<MailMessage>;
}

export interface CalendarEventInput {
  title: string;
  description: string;
  start: Date;
  end: Date;
  location: string | null;
}

export interface CalendarClient {
  createEvent(event: CalendarEventInput): Promise<string>;
  /** Returns false when the event no longer exists. */
  updateEvent(eventId: string, event: CalendarEventInput): Promise<boolean>;
  /** Deleting an event that is already gone counts as done. */
  deleteEvent(eventId: string): Promise<void>;
}

export type MailProviderId = "GOOGLE" | "MICROSOFT";
