"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { format } from "date-fns";
import type { TaskBoard } from "@autoapply/database";
import { cn } from "@/lib/utils";

const subscribe = () => () => {};

const LEVEL_DOT: Record<string, string> = {
  INFO: "bg-primary",
  WARNING: "bg-warning",
  ERROR: "bg-destructive",
};

/** The last day of worker events, newest first, like a bot's console. */
export function ActivityLog({ events }: { events: TaskBoard["events"] }) {
  // Times are shown in the viewer's time zone, so they appear once the page hydrates.
  const hydrated = useSyncExternalStore(subscribe, () => true, () => false);
  return (
    <section className="dark bg-sidebar text-sidebar-foreground border-sidebar-border min-w-0 overflow-hidden rounded-xl border" aria-label="Activity log">
      <div className="border-sidebar-border flex items-center justify-between border-b px-4 py-3">
        <h2 className="text-sm font-semibold text-white">Activity log</h2>
        <span className="text-muted-foreground text-xs">Last 24 hours</span>
      </div>
      {events.length === 0 ? (
        <p className="text-muted-foreground px-4 py-8 text-center font-mono text-xs">Waiting for activity…</p>
      ) : (
        <ol className="max-h-[28rem] overflow-y-auto px-2 py-2 font-mono text-[12px] leading-relaxed" data-testid="activity-log">
          {events.map((event) => (
            <li key={event.id}>
              <Link href={`/applications/${event.application.id}`} className="grid grid-cols-[auto_auto_minmax(0,1fr)] items-baseline gap-2 rounded-md px-2 py-1 hover:bg-white/[0.05]">
                <time dateTime={event.createdAt.toISOString()} className="text-muted-foreground tabular-nums">
                  {hydrated ? format(event.createdAt, "HH:mm:ss") : "--:--:--"}
                </time>
                <span className={cn("size-1.5 translate-y-[-1px] rounded-full", LEVEL_DOT[event.level] ?? "bg-muted-foreground")} />
                <span className="min-w-0">
                  <span className="text-white">{event.application.job.company}</span> <span className="text-muted-foreground">{event.message}</span>
                </span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
