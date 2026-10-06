/**
 * Puts interview rounds on the user's calendar and keeps the events in step:
 * created when a round has a time, updated when it changes, deleted when the
 * round is cancelled or deleted. Rounds that came with a calendar invite are
 * already on the calendar and are left alone. Only events Applyance created
 * are ever changed.
 */
import { createHash } from "node:crypto";
import { interviewKindLabel, listCalendarRemovals, listRoundsForCalendar, setRoundCalendarState, settleCalendarRemoval, type CalendarRound } from "@autoapply/database";
import { ProviderAuthError } from "./http";
import type { CalendarClient, CalendarEventInput } from "./types";

export interface CalendarSyncReport {
  created: number;
  updated: number;
  removed: number;
  failed: number;
}

const DEFAULT_MINUTES = 60;

export function calendarEventFor(round: CalendarRound, appUrl: string): CalendarEventInput | null {
  if (round.status !== "SCHEDULED" || !round.scheduledAt || round.fromInvite) return null;
  const name = round.title || interviewKindLabel(round.kind);
  const { company, title } = round.application.job;
  const description = [
    `${title} at ${company}`,
    `Round: ${name}`,
    round.interviewers ? `With: ${round.interviewers}` : null,
    "",
    `Open in Applyance: ${appUrl.replace(/\/+$/, "")}/applications/${round.application.id}`,
    "Added by Applyance. Change the interview in Applyance and this event follows.",
  ]
    .filter((l) => l !== null)
    .join("\n");
  return {
    title: `Interview: ${company} (${name})`,
    description,
    start: round.scheduledAt,
    end: new Date(round.scheduledAt.getTime() + (round.durationMinutes ?? DEFAULT_MINUTES) * 60_000),
    location: round.location,
  };
}

export function eventHash(event: CalendarEventInput) {
  return createHash("sha256").update(JSON.stringify([event.title, event.description, event.start.toISOString(), event.end.toISOString(), event.location])).digest("hex").slice(0, 32);
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

export async function syncCalendar(
  input: { userId: string; connectionId: string; calendarSync: boolean },
  client: CalendarClient,
  options: { appUrl: string; now?: Date },
): Promise<CalendarSyncReport> {
  const report: CalendarSyncReport = { created: 0, updated: 0, removed: 0, failed: 0 };

  // Events whose rounds were deleted, or that belong to a calendar no longer used.
  for (const removal of await listCalendarRemovals(input.connectionId)) {
    try {
      await client.deleteEvent(removal.eventId);
      await settleCalendarRemoval(removal.id, true);
      report.removed++;
    } catch (error) {
      if (error instanceof ProviderAuthError) throw error;
      await settleCalendarRemoval(removal.id, false);
      report.failed++;
    }
  }
  if (!input.calendarSync) return report;

  const rounds = await listRoundsForCalendar(input.userId, options.now);
  for (const round of rounds) {
    try {
      // Created on another calendar the user has since switched away from: start over here.
      if (round.calendarEventId && round.calendarConnectionId && round.calendarConnectionId !== input.connectionId) continue;
      const event = calendarEventFor(round, options.appUrl);
      if (!event) {
        if (round.calendarEventId && round.status !== "COMPLETED") {
          await client.deleteEvent(round.calendarEventId);
          await setRoundCalendarState(round.id, { calendarConnectionId: null, calendarEventId: null, calendarHash: null, calendarSyncedAt: new Date(), calendarError: null });
          report.removed++;
        }
        continue;
      }
      // Only upcoming rounds get new events; past ones are history.
      if (!round.calendarEventId && event.end.getTime() < (options.now ?? new Date()).getTime()) continue;
      const hash = eventHash(event);
      if (round.calendarEventId && round.calendarHash === hash) continue;
      if (round.calendarEventId && (await client.updateEvent(round.calendarEventId, event))) {
        await setRoundCalendarState(round.id, { calendarHash: hash, calendarSyncedAt: new Date(), calendarError: null });
        report.updated++;
        continue;
      }
      // New, or the user deleted the event on their calendar: (re)create it.
      const eventId = await client.createEvent(event);
      await setRoundCalendarState(round.id, { calendarConnectionId: input.connectionId, calendarEventId: eventId, calendarHash: hash, calendarSyncedAt: new Date(), calendarError: null });
      report.created++;
    } catch (error) {
      if (error instanceof ProviderAuthError) throw error;
      await setRoundCalendarState(round.id, { calendarError: message(error) });
      report.failed++;
    }
  }
  return report;
}
