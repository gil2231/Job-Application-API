"use client";

import Link from "next/link";
import { useOptimistic } from "react";
import { Send } from "lucide-react";
import type { TrackerTable } from "@autoapply/database";
import { enumLabel, STAGE_META, type TrackerStage } from "@autoapply/shared";
import { Pagination, SortableHead } from "@/components/data-table";
import { EmptyState } from "@/components/page-header";
import { LocalTime, TimeAgo } from "@/components/local-time";
import { StageMenu, useStageMover } from "@/components/stage";
import { MatchScore } from "@/components/status";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useSearchParamsState } from "@/lib/use-search-params-state";
import { cn } from "@/lib/utils";

const GROUPS: Array<{ label: string; stages: TrackerStage[] | null }> = [
  { label: "All", stages: null },
  { label: "In progress", stages: ["QUEUED", "PROCESSING", "NEEDS_YOU", "FAILED"] },
  { label: "Applied", stages: ["SUBMITTED", "RESPONDED"] },
  { label: "Interviewing", stages: ["INTERVIEWING"] },
  { label: "Offers", stages: ["OFFER", "ACCEPTED"] },
  { label: "Closed", stages: ["REJECTED", "WITHDRAWN"] },
  { label: "Skipped", stages: ["SKIPPED"] },
];

export function FlightpathTable({ data }: { data: TrackerTable }) {
  const { params, set } = useSearchParamsState();
  const [rows, addOptimistic] = useOptimistic(data.rows, (state, move: { id: string; to: TrackerStage }) =>
    state.map((r) => (r.id === move.id ? { ...r, stage: move.to, stageChangedAt: new Date() } : r)),
  );
  const mover = useStageMover(addOptimistic);
  const current = params.get("stage") ?? "";
  const count = (stages: TrackerStage[] | null) => (stages ?? (Object.keys(data.counts) as TrackerStage[])).reduce((n, s) => n + (data.counts[s] ?? 0), 0);
  // A single stage picked from the board's "view all" link has no chip of its own; keep it visible as the active filter.
  const known = GROUPS.some((g) => (g.stages?.join(",") ?? "") === current);

  return (
    <div className="grid gap-4">
      {mover.dialog}
      <div className="flex flex-wrap gap-1" role="tablist" aria-label="Stage">
        {GROUPS.map((g) => {
          const value = g.stages?.join(",") ?? "";
          const active = current === value;
          return (
            <button
              key={g.label}
              role="tab"
              aria-selected={active}
              onClick={() => set({ stage: value || null })}
              className={cn("text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium", active && "bg-muted text-foreground")}
            >
              {g.label}
              <span className="text-muted-foreground text-xs tabular-nums">{count(g.stages)}</span>
            </button>
          );
        })}
        {!known && current && (
          <button role="tab" aria-selected className="bg-muted text-foreground inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium" onClick={() => set({ stage: null })}>
            {current
              .split(",")
              .map((s) => STAGE_META[s as TrackerStage]?.label ?? s)
              .join(", ")}
            <span className="text-muted-foreground text-xs">✕</span>
          </button>
        )}
      </div>

      {data.total === 0 ? (
        <div className="rounded-xl border">
          <EmptyState icon={Send} title="No applications here" description="Applications appear here as soon as they're queued, and stay as they move through each stage." />
        </div>
      ) : (
        <>
          {/* Phones get a stacked list; the full table starts at tablet width. */}
          <ul className="bg-card divide-y rounded-xl border md:hidden" data-testid="flightpath-list">
            {rows.map((a) => {
              const next = a.interviews[0];
              return (
                <li key={a.id} className="relative flex items-start gap-3 px-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-muted-foreground truncate text-xs">{a.job.company}</p>
                    <Link href={`/applications/${a.id}`} className="line-clamp-2 text-sm leading-snug font-medium after:absolute after:inset-0">
                      {a.job.title}
                    </Link>
                    <div className="text-muted-foreground mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      <MatchScore score={a.matchScore} />
                      {next?.scheduledAt ? (
                        <span className="text-foreground">
                          {next.title || enumLabel(next.kind)} · <LocalTime value={next.scheduledAt} pattern="MMM d, h:mm a" />
                        </span>
                      ) : (
                        <span>
                          Moved <TimeAgo value={a.stageChangedAt ?? a.submittedAt ?? a.queuedAt} />
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="relative z-10 shrink-0">
                    <StageMenu card={a} onMove={(to) => mover.move(a, to)} variant="badge" align="end" />
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="bg-card hidden rounded-xl border md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortableHead column="company" defaultSort="updatedAt" className="pl-4">
                    Company
                  </SortableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Next interview</TableHead>
                  <SortableHead column="submittedAt" defaultSort="updatedAt">
                    Applied
                  </SortableHead>
                  <TableHead>Last moved</TableHead>
                  <SortableHead column="matchScore" defaultSort="updatedAt">
                    Match
                  </SortableHead>
                  <SortableHead column="updatedAt" defaultSort="updatedAt" className="pr-4">
                    Updated
                  </SortableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((a) => {
                  const next = a.interviews[0];
                  return (
                    <TableRow key={a.id} className="relative" data-testid="flightpath-row">
                      <TableCell className="pl-4 font-medium">
                        <Link href={`/applications/${a.id}`} className="after:absolute after:inset-0">
                          {a.job.company}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-72 truncate">{a.job.title}</TableCell>
                      <TableCell>
                        <div className="relative z-10 w-fit">
                          <StageMenu card={a} onMove={(to) => mover.move(a, to)} variant="badge" align="start" />
                        </div>
                      </TableCell>
                      <TableCell className="text-[13px]">
                        {next?.scheduledAt ? (
                          <span>
                            {next.title || enumLabel(next.kind)} · <LocalTime value={next.scheduledAt} pattern="MMM d, h:mm a" />
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-[13px]">{a.submittedAt ? <LocalTime value={a.submittedAt} pattern="MMM d" /> : "—"}</TableCell>
                      <TableCell className="text-muted-foreground text-[13px]">
                        <TimeAgo value={a.stageChangedAt ?? a.submittedAt ?? a.queuedAt} />
                      </TableCell>
                      <TableCell>
                        <MatchScore score={a.matchScore} />
                      </TableCell>
                      <TableCell className="text-muted-foreground pr-4 text-[13px]">
                        <TimeAgo value={a.updatedAt} />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.pageSize} />
        </>
      )}
    </div>
  );
}
