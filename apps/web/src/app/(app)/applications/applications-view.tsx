"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Search, Send } from "lucide-react";
import type { ApplicationListRow } from "@autoapply/database";
import { APPLICATION_STATUSES, enumLabel, type ApplicationStatus } from "@autoapply/shared";
import { Pagination, SortableHead } from "@/components/data-table";
import { EmptyState } from "@/components/page-header";
import { AttentionBadge, MatchScore, PlatformLabel, StatusBadge } from "@/components/status";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatRelative } from "@/lib/format";
import { useSearchParamsState } from "@/lib/use-search-params-state";
import { cn } from "@/lib/utils";

const GROUPS: Array<{ label: string; statuses: ApplicationStatus[] | null }> = [
  { label: "All", statuses: null },
  { label: "In progress", statuses: ["QUEUED", "PROCESSING", "READY"] },
  { label: "Needs you", statuses: ["WAITING_FOR_USER", "REVIEW_REQUIRED"] },
  { label: "Submitted", statuses: ["SUBMITTED", "REJECTED"] },
  { label: "Failed", statuses: ["FAILED"] },
  { label: "Skipped", statuses: ["SKIPPED"] },
];

export function ApplicationsView({
  data,
}: {
  data: { rows: ApplicationListRow[]; total: number; page: number; pageCount: number; pageSize: number; statusCounts: Partial<Record<ApplicationStatus, number>> };
}) {
  const { params, set } = useSearchParamsState();
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    const t = setTimeout(() => set({ q }), 300);
    return () => clearTimeout(t);
  }, [q, params, set]);

  const current = params.get("status") ?? "";
  const count = (statuses: ApplicationStatus[] | null) =>
    (statuses ?? [...APPLICATION_STATUSES]).reduce((n, s) => n + (data.statusCounts[s] ?? 0), 0);

  return (
    <div className="grid gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap gap-1" role="tablist">
          {GROUPS.map((g) => {
            const value = g.statuses?.join(",") ?? "";
            const active = current === value;
            return (
              <button
                key={g.label}
                role="tab"
                aria-selected={active}
                onClick={() => set({ status: value || null })}
                className={cn(
                  "text-muted-foreground hover:text-foreground inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium",
                  active && "bg-muted text-foreground",
                )}
              >
                {g.label}
                <span className="text-muted-foreground text-xs tabular-nums">{count(g.statuses)}</span>
              </button>
            );
          })}
        </div>
        <div className="relative w-full lg:w-64">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company or position" className="h-8 pl-8" aria-label="Search applications" />
        </div>
      </div>

      {data.total === 0 ? (
        <div className="rounded-xl border">
          <EmptyState icon={Send} title="No applications here" description="Choose Apply on a job to queue an application. One application is ever created per job." />
        </div>
      ) : (
        <>
          <div className="bg-card rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="pl-4">Company</TableHead>
                  <TableHead>Position</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Platform</TableHead>
                  <SortableHead column="matchScore" defaultSort="updatedAt">Match</SortableHead>
                  <TableHead>Attempts</TableHead>
                  <SortableHead column="createdAt" defaultSort="updatedAt">Queued</SortableHead>
                  <SortableHead column="submittedAt" defaultSort="updatedAt">Submitted</SortableHead>
                  <SortableHead column="updatedAt" defaultSort="updatedAt" className="pr-4">Updated</SortableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.rows.map((a) => (
                  <TableRow key={a.id} className="relative">
                    <TableCell className="pl-4 font-medium">
                      <Link href={`/applications/${a.id}`} className="after:absolute after:inset-0">
                        {a.job.company}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-72 truncate">{a.job.title}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={a.status} />
                        {a.attentionReason && <AttentionBadge reason={a.attentionReason} />}
                      </div>
                    </TableCell>
                    <TableCell className="text-[13px]">{enumLabel(a.mode)}</TableCell>
                    <TableCell>
                      <PlatformLabel platform={a.platform} />
                    </TableCell>
                    <TableCell>
                      <MatchScore score={a.matchScore} />
                    </TableCell>
                    <TableCell className="text-[13px] tabular-nums">{a.attemptCount}</TableCell>
                    <TableCell className="text-muted-foreground text-[13px]">{formatDate(a.createdAt, "MMM d")}</TableCell>
                    <TableCell className="text-muted-foreground text-[13px]">{formatDate(a.submittedAt, "MMM d")}</TableCell>
                    <TableCell className="text-muted-foreground pr-4 text-[13px]">{formatRelative(a.updatedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.pageSize} />
        </>
      )}
    </div>
  );
}
