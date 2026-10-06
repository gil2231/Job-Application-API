"use client";

import Link from "next/link";
import { Check, Circle, Hourglass, Loader2, X } from "lucide-react";
import type { ApplicationProgress, ProgressStep } from "@autoapply/shared";
import { useLiveProgress } from "@/components/shell/live-updates";
import { cn } from "@/lib/utils";

const PHASE_LABEL: Record<ApplicationProgress["phase"], string> = {
  processing: "Processing",
  waiting: "Waiting for you",
  done: "Finished",
  failed: "Stopped",
};

function StepIcon({ state }: { state: ProgressStep["state"] }) {
  if (state === "done") return <Check className="text-success size-3.5" />;
  if (state === "running") return <Loader2 className="text-primary size-3.5 animate-spin" />;
  if (state === "waiting") return <Hourglass className="text-warning size-3.5" />;
  if (state === "failed") return <X className="text-destructive size-3.5" />;
  return <Circle className="text-muted-foreground size-3" />;
}

export function ProgressChecklist({ progress, showTitle = true }: { progress: ApplicationProgress; showTitle?: boolean }) {
  return (
    <div className="grid gap-2" aria-live="polite">
      {showTitle && (
        <div className="flex items-center justify-between gap-2">
          <Link href={`/applications/${progress.applicationId}`} className="min-w-0 truncate text-sm font-medium hover:underline">
            {progress.company} · {progress.title}
          </Link>
          <span
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 text-xs font-medium",
              progress.phase === "processing" ? "text-primary" : progress.phase === "waiting" ? "text-warning" : progress.phase === "failed" ? "text-destructive" : "text-success",
            )}
          >
            {progress.phase === "processing" && <span className="bg-primary size-1.5 animate-pulse rounded-full" />}
            {PHASE_LABEL[progress.phase]}
          </span>
        </div>
      )}
      <ol className="grid gap-1">
        {progress.steps.map((step) => (
          <li key={step.key} className={cn("flex items-center gap-2 text-[13px]", step.state === "running" ? "font-medium" : step.state === "done" ? "text-foreground" : "text-muted-foreground")}>
            <StepIcon state={step.state} />
            {step.label}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Live checklists for every application the worker is on right now. */
export function LiveRuns({ empty }: { empty?: React.ReactNode }) {
  const progress = useLiveProgress();
  const runs = Object.values(progress).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4);
  if (!runs.length) return <>{empty ?? null}</>;
  return (
    <div className="grid min-w-0 gap-4">
      {runs.map((p) => (
        <div key={p.applicationId} className="bg-muted/40 min-w-0 rounded-lg border p-3">
          <ProgressChecklist progress={p} />
        </div>
      ))}
    </div>
  );
}

/** A card with the live checklist, shown only while the worker is on this application. */
export function LiveProgressCard({ applicationId }: { applicationId: string }) {
  const progress = useLiveProgress()[applicationId];
  if (!progress) return null;
  return (
    <section className="bg-card rounded-xl border p-4" aria-label="Live progress">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Live progress</h2>
        <span className="text-muted-foreground text-xs">{PHASE_LABEL[progress.phase]}</span>
      </div>
      <ProgressChecklist progress={progress} showTitle={false} />
    </section>
  );
}
