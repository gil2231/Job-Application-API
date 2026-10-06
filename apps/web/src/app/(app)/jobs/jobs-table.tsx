"use client";

import Link from "next/link";
import { useState } from "react";
import { Briefcase, ExternalLink, Eye, MoreHorizontal, RefreshCw, RotateCcw, Send, SkipForward, Trash2 } from "lucide-react";
import type { JobListRow } from "@autoapply/database";
import { enumLabel } from "@autoapply/shared";
import { reanalyzeJobsAction } from "@/actions/ingestion";
import { applyToJobsAction, deleteJobsAction, retryJobsAction, skipJobsAction } from "@/actions/jobs";
import { useServerAction } from "@/components/action-button";
import { Pagination, SortableHead } from "@/components/data-table";
import { EmptyState } from "@/components/page-header";
import { MatchScore, PlatformLabel, StatusBadge } from "@/components/status";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDate, formatSalary } from "@/lib/format";

type Row = JobListRow;

const canApply = (r: Row) => !r.application;
const canSkip = (r: Row) => (!r.application && r.status !== "SKIPPED") || (!!r.application && ["QUEUED", "FAILED", "WAITING_FOR_USER", "REVIEW_REQUIRED", "READY"].includes(r.application.status));
const canRetry = (r: Row) => r.application?.status === "FAILED";
const canDelete = (r: Row) => r.application?.status !== "PROCESSING";

export function JobsTable({ data, hasFilters }: { data: { rows: Row[]; total: number; page: number; pageCount: number; pageSize: number }; hasFilters: boolean }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const { pending, run } = useServerAction();

  // Selections that are no longer on the page (after filtering or deleting) are ignored.
  const selectedRows = data.rows.filter((r) => selected.has(r.id));
  const allSelected = data.rows.length > 0 && selectedRows.length === data.rows.length;
  const clear = () => setSelected(new Set());
  const act = (fn: () => Promise<{ ok: boolean; message?: string }>) => run(fn, { onSuccess: clear });

  if (data.total === 0) {
    return (
      <div className="rounded-xl border">
        <EmptyState
          icon={Briefcase}
          title={hasFilters ? "No jobs match these filters" : "No jobs yet"}
          description={hasFilters ? "Try removing a filter." : "Import your LinkedIn saved jobs or paste job URLs with Import, or add one job with Add job."}
        />
      </div>
    );
  }

  const bulk = {
    apply: selectedRows.filter(canApply).map((r) => r.id),
    skip: selectedRows.filter(canSkip).map((r) => r.id),
    retry: selectedRows.filter(canRetry).map((r) => r.id),
    del: selectedRows.filter(canDelete).map((r) => r.id),
  };

  return (
    <div className="grid gap-3">
      {selectedRows.length > 0 && (
        <div className="bg-primary/5 border-primary/20 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2">
          <span className="mr-2 text-sm font-medium">{selectedRows.length} selected</span>
          <Button size="xs" disabled={pending || !bulk.apply.length} onClick={() => act(() => applyToJobsAction(bulk.apply))}>
            <Send /> Apply{bulk.apply.length !== selectedRows.length && bulk.apply.length > 0 ? ` (${bulk.apply.length})` : ""}
          </Button>
          <Button size="xs" variant="outline" disabled={pending || !bulk.skip.length} onClick={() => act(() => skipJobsAction(bulk.skip))}>
            <SkipForward /> Skip
          </Button>
          <Button size="xs" variant="outline" disabled={pending || !bulk.retry.length} onClick={() => act(() => retryJobsAction(bulk.retry))}>
            <RotateCcw /> Retry
          </Button>
          <Button size="xs" variant="outline" className="text-destructive" disabled={pending || !bulk.del.length} onClick={() => setConfirmDelete(bulk.del)}>
            <Trash2 /> Delete
          </Button>
          <Button size="xs" variant="ghost" className="ml-auto" onClick={clear}>
            Clear selection
          </Button>
        </div>
      )}
      <div className="bg-card rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10 pl-4">
                <Checkbox
                  aria-label="Select all"
                  checked={allSelected ? true : selectedRows.length ? "indeterminate" : false}
                  onCheckedChange={(v) => setSelected(v ? new Set(data.rows.map((r) => r.id)) : new Set())}
                />
              </TableHead>
              <SortableHead column="company" defaultSort="savedAt">Company</SortableHead>
              <TableHead>Position</TableHead>
              <TableHead>Location</TableHead>
              <SortableHead column="matchScore" defaultSort="savedAt">Match</SortableHead>
              <SortableHead column="salary" defaultSort="savedAt">Salary</SortableHead>
              <TableHead>Platform</TableHead>
              <TableHead>Status</TableHead>
              <SortableHead column="savedAt" defaultSort="savedAt">Date saved</SortableHead>
              <SortableHead column="appliedAt" defaultSort="savedAt">Date applied</SortableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.rows.map((r) => (
              <TableRow key={r.id} data-state={selected.has(r.id) ? "selected" : undefined}>
                <TableCell className="pl-4">
                  <Checkbox
                    aria-label={`Select ${r.title}`}
                    checked={selected.has(r.id)}
                    onCheckedChange={(v) =>
                      setSelected((prev) => {
                        const next = new Set(prev);
                        if (v) next.add(r.id);
                        else next.delete(r.id);
                        return next;
                      })
                    }
                  />
                </TableCell>
                <TableCell className="font-medium">{r.company}</TableCell>
                <TableCell className="max-w-72">
                  <Link href={`/jobs/${r.id}`} className="block truncate hover:underline">
                    {r.title}
                  </Link>
                  {r.easyApply && <span className="text-muted-foreground text-xs">Easy Apply</span>}
                </TableCell>
                <TableCell className="text-muted-foreground max-w-48 truncate text-[13px]">
                  {r.location ?? "—"}
                  {r.workArrangement !== "UNKNOWN" && <span className="block text-xs">{enumLabel(r.workArrangement)}</span>}
                </TableCell>
                <TableCell>
                  <MatchScore score={r.matchScore} />
                </TableCell>
                <TableCell className="text-[13px] tabular-nums">{formatSalary(r)}</TableCell>
                <TableCell>
                  <PlatformLabel platform={r.platform} />
                </TableCell>
                <TableCell>
                  <StatusBadge status={r.pipelineStatus} />
                </TableCell>
                <TableCell className="text-muted-foreground text-[13px]">{formatDate(r.savedAt, "MMM d")}</TableCell>
                <TableCell className="text-muted-foreground text-[13px]">{formatDate(r.application?.submittedAt, "MMM d")}</TableCell>
                <TableCell className="pr-3">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${r.title}`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-44">
                      {canApply(r) && (
                        <DropdownMenuItem disabled={pending} onSelect={() => run(() => applyToJobsAction([r.id]))}>
                          <Send /> Apply
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem asChild>
                        <Link href={r.application ? `/applications/${r.application.id}` : `/jobs/${r.id}`}>
                          <Eye /> Review
                        </Link>
                      </DropdownMenuItem>
                      {!r.application && r.status !== "ANALYZING" && (
                        <DropdownMenuItem disabled={pending} onSelect={() => run(() => reanalyzeJobsAction([r.id]))}>
                          <RefreshCw /> Re-analyze
                        </DropdownMenuItem>
                      )}
                      {canRetry(r) && (
                        <DropdownMenuItem disabled={pending} onSelect={() => run(() => retryJobsAction([r.id]))}>
                          <RotateCcw /> Retry
                        </DropdownMenuItem>
                      )}
                      {canSkip(r) && (
                        <DropdownMenuItem disabled={pending} onSelect={() => run(() => skipJobsAction([r.id]))}>
                          <SkipForward /> Skip
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem asChild>
                        <a href={r.url} target="_blank" rel="noopener noreferrer">
                          <ExternalLink /> Open job
                        </a>
                      </DropdownMenuItem>
                      {canDelete(r) && (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmDelete([r.id])}>
                            <Trash2 /> Delete
                          </DropdownMenuItem>
                        </>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.pageSize} />

      <AlertDialog open={confirmDelete !== null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.length === 1 ? "this job" : `${confirmDelete?.length} jobs`}?</AlertDialogTitle>
            <AlertDialogDescription>
              Deleted jobs are hidden and won&apos;t be re-imported. Pending applications for them are withdrawn; submitted ones stay in your history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => confirmDelete && act(() => deleteJobsAction(confirmDelete))}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
