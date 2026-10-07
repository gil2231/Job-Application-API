"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, ListTodo } from "lucide-react";
import type { Task } from "@autoapply/database";
import { enumLabel, type ApplicationStatus } from "@autoapply/shared";
import { useLiveProgress } from "@/components/shell/live-updates";
import { EmptyState } from "@/components/page-header";
import { TimeAgo } from "@/components/local-time";
import { PlatformLabel, StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

const FILTERS: Array<{ label: string; statuses: ApplicationStatus[] | null }> = [
  { label: "All", statuses: null },
  { label: "Running", statuses: ["PROCESSING"] },
  { label: "In line", statuses: ["QUEUED"] },
  { label: "Needs you", statuses: ["WAITING_FOR_USER", "REVIEW_REQUIRED", "READY"] },
  { label: "Submitted", statuses: ["SUBMITTED"] },
  { label: "Failed", statuses: ["FAILED"] },
];

const NEEDS_YOU: ApplicationStatus[] = ["WAITING_FOR_USER", "REVIEW_REQUIRED", "READY"];

/** What the task is doing right now, in a few words. */
function TaskDetail({ task, position }: { task: Task; position: number | null }) {
  const live = useLiveProgress()[task.id];
  if (task.status === "PROCESSING") {
    const step = live?.steps.findLast((s) => s.state === "running") ?? live?.steps.at(-1);
    return (
      <div className="grid min-w-0 gap-1.5">
        <span className="truncate text-[13px] font-medium">{step?.label ?? "Starting"}</span>
        <span className="bg-primary/15 relative block h-1 w-full max-w-40 overflow-hidden rounded-full" aria-hidden>
          <span className="bg-primary absolute inset-y-0 w-1/3 animate-[task-scan_1.4s_ease-in-out_infinite] rounded-full" />
        </span>
      </div>
    );
  }
  if (task.status === "QUEUED") {
    if (task.attemptCount > 0 && task.failureType) {
      return (
        <span className="text-muted-foreground text-[13px]">
          Retrying after {enumLabel(task.failureType).toLowerCase()} (try {task.attemptCount + 1})
        </span>
      );
    }
    return <span className="text-muted-foreground text-[13px]">{position != null ? `#${position} in line` : "In line"}</span>;
  }
  if (NEEDS_YOU.includes(task.status)) {
    return (
      <span className="text-[13px]">
        {task.status === "READY" ? "Waiting for your Submit" : task.attentionReason ? enumLabel(task.attentionReason) : "Waiting for you"}
      </span>
    );
  }
  if (task.status === "FAILED") return <span className="text-destructive line-clamp-1 text-[13px]">{task.lastError ?? (task.failureType ? enumLabel(task.failureType) : "Failed")}</span>;
  return <span className="text-muted-foreground text-[13px]">Submitted</span>;
}

function TaskAction({ task }: { task: Task }) {
  const href = NEEDS_YOU.includes(task.status) ? "/needs-attention" : `/applications/${task.id}`;
  return (
    <Button asChild size="sm" variant={NEEDS_YOU.includes(task.status) ? "default" : "ghost"}>
      <Link href={href} aria-label={`Open ${task.job.title} at ${task.job.company}`}>
        {NEEDS_YOU.includes(task.status) ? "Finish" : "Open"} <ArrowUpRight />
      </Link>
    </Button>
  );
}

const ModeLabel = ({ mode }: { mode: Task["mode"] }) => <span className="text-muted-foreground text-[13px]">{enumLabel(mode)}</span>;

/** Every application as a task, like a bot's task list, with live status. */
export function TaskList({ tasks }: { tasks: Task[] }) {
  const [filter, setFilter] = useState<string>("All");
  const active = FILTERS.find((f) => f.label === filter) ?? FILTERS[0]!;
  const shown = active.statuses ? tasks.filter((t) => active.statuses!.includes(t.status)) : tasks;
  // Position in line follows the worker's claim order, which is the list order.
  const positions = new Map(tasks.filter((t) => t.status === "QUEUED").map((t, i) => [t.id, i + 1]));
  const count = (statuses: ApplicationStatus[] | null) => (statuses ? tasks.filter((t) => statuses.includes(t.status)).length : tasks.length);

  return (
    <section className="bg-card min-w-0 rounded-xl border" aria-label="Task list">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3">
        <h2 className="text-sm font-semibold">Task list</h2>
        <div className="flex flex-wrap gap-1" role="tablist" aria-label="Filter tasks">
          {FILTERS.map((f) => (
            <button
              key={f.label}
              type="button"
              role="tab"
              aria-selected={filter === f.label}
              onClick={() => setFilter(f.label)}
              className={cn(
                "text-muted-foreground hover:text-foreground inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[13px] font-medium",
                filter === f.label && "bg-muted text-foreground",
              )}
            >
              {f.label}
              <span className="text-muted-foreground text-xs tabular-nums">{count(f.statuses)}</span>
            </button>
          ))}
        </div>
      </div>

      {shown.length === 0 ? (
        <EmptyState
          icon={ListTodo}
          title={tasks.length ? "No tasks here" : "No tasks yet"}
          description={tasks.length ? "Nothing matches this filter right now." : "Choose Apply on jobs to add tasks, or press Start to add every qualified job. Finished tasks stay here for a day."}
          action={
            tasks.length ? undefined : (
              <Button asChild size="sm" variant="outline">
                <Link href="/jobs">Go to Jobs</Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <ul className="divide-y md:hidden" data-testid="task-cards">
            {shown.map((task) => (
              <li key={task.id} className="grid gap-2 px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{task.job.title}</p>
                    <p className="text-muted-foreground truncate text-xs">
                      {task.job.company} · {enumLabel(task.mode)}
                    </p>
                  </div>
                  <StatusBadge status={task.status} />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <TaskDetail task={task} position={positions.get(task.id) ?? null} />
                  </div>
                  <TaskAction task={task} />
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden md:block">
            <Table data-testid="task-table">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 pl-4">#</TableHead>
                  <TableHead>Task</TableHead>
                  <TableHead>Site</TableHead>
                  <TableHead>Mode</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="min-w-44">Now</TableHead>
                  <TableHead>Updated</TableHead>
                  <TableHead className="w-24 pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((task, i) => (
                  <TableRow key={task.id} className={cn(task.status === "PROCESSING" && "bg-primary/[0.04]")}>
                    <TableCell className="text-muted-foreground pl-4 text-xs tabular-nums">{i + 1}</TableCell>
                    <TableCell className="max-w-64">
                      <p className="truncate text-sm font-medium">{task.job.title}</p>
                      <p className="text-muted-foreground truncate text-xs">{task.job.company}</p>
                    </TableCell>
                    <TableCell>
                      <PlatformLabel platform={task.platform} />
                    </TableCell>
                    <TableCell>
                      <ModeLabel mode={task.mode} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={task.status} />
                    </TableCell>
                    <TableCell className="max-w-64">
                      <TaskDetail task={task} position={positions.get(task.id) ?? null} />
                    </TableCell>
                    <TableCell>
                      <TimeAgo value={task.updatedAt} className="text-muted-foreground text-xs" />
                    </TableCell>
                    <TableCell className="pr-4 text-right">
                      <TaskAction task={task} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </section>
  );
}
