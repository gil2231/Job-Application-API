"use client";

import { useSyncExternalStore } from "react";
import { format, formatDistanceToNowStrict, isPast } from "date-fns";

const subscribe = () => () => {};

/**
 * A date formatted in the viewer's own time zone. The server doesn't know it,
 * so the text is filled in once the page hydrates (no hydration mismatch).
 */
export function LocalTime({ value, pattern = "EEE, MMM d · h:mm a", className }: { value: Date | string; pattern?: string; className?: string }) {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const date = new Date(value);
  return (
    <time dateTime={date.toISOString()} className={className}>
      {hydrated ? format(date, pattern) : ""}
    </time>
  );
}

/** "3 days ago", computed in the browser so server and client never disagree. */
export function TimeAgo({ value, className }: { value: Date | string | null | undefined; className?: string }) {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  if (!value) return <span className={className}>—</span>;
  const date = new Date(value);
  return (
    <time dateTime={date.toISOString()} className={className}>
      {hydrated ? `${formatDistanceToNowStrict(date)} ago` : ""}
    </time>
  );
}

/** "in 9 minutes" (or "now" once it's due), computed in the browser. */
export function TimeUntil({ value, className }: { value: Date | string; className?: string }) {
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  const date = new Date(value);
  return (
    <time dateTime={date.toISOString()} className={className}>
      {hydrated ? (isPast(date) ? "now" : `in ${formatDistanceToNowStrict(date)}`) : ""}
    </time>
  );
}
