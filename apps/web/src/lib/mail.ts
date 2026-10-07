import "server-only";
import { after } from "next/server";
import { getCalendarConnectionId } from "@autoapply/database";
import { oauthApp, syncUserCalendar, type MailProviderId } from "@autoapply/inbox";

export const MAIL_PROVIDERS: MailProviderId[] = ["GOOGLE", "MICROSOFT"];

export function appUrl() {
  return (process.env.APP_URL || "http://localhost:3000").replace(/\/+$/, "");
}

/** Whether the server has an app registration for each provider (env vars set). */
export function mailProviderSetup() {
  return Object.fromEntries(MAIL_PROVIDERS.map((p) => [p, oauthApp(p).missing])) as Record<MailProviderId, string[]>;
}

/**
 * Bring the user's calendar in step with their interview rounds once the
 * response is sent. The scheduled sync is the safety net if this one fails.
 */
export function syncCalendarSoon(userId: string) {
  after(async () => {
    try {
      const connectionId = await getCalendarConnectionId(userId);
      if (connectionId) await syncUserCalendar(userId, connectionId, { appUrl: appUrl() });
    } catch (error) {
      console.error("[mail] calendar sync failed", error);
    }
  });
}
