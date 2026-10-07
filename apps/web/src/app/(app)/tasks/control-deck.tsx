"use client";

import Link from "next/link";
import { Loader2, Pause, Play, PlusCircle, ShieldCheck, Square, TimerReset } from "lucide-react";
import { applyToAllQualifiedAction } from "@/actions/jobs";
import { queueControlAction, startRunAction } from "@/actions/queue";
import { ActionButton, useServerAction } from "@/components/action-button";
import { cn } from "@/lib/utils";

interface ControlDeckProps {
  run: { paused: boolean; pauseAfterCurrent: boolean; mode: string; autoSubmitEnabled: boolean; concurrency: number };
  counts: { running: number; queued: number; needsYou: number; submitted: number; failed: number };
  qualifiedWaiting: number;
  usage: { started: number; limit: number };
  worker: { state: "online"; interactive: boolean } | { state: "offline" | "unreachable" };
}

type DeckState = "running" | "idle" | "paused" | "empty";

const STATE_LABEL: Record<DeckState, string> = {
  running: "Running",
  idle: "Ready",
  paused: "Paused",
  empty: "No tasks",
};

const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? "" : "s"}`;

/**
 * The big Start button and run controls. Start un-pauses the queue (adding the
 * qualified jobs when nothing is queued); Pause, Pause after current and Stop
 * are the same queue commands the dashboard uses.
 */
export function ControlDeck({ run, counts, qualifiedWaiting, usage, worker }: ControlDeckProps) {
  const { pending, run: runAction } = useServerAction();
  const hasWork = counts.queued + counts.running > 0;
  const state: DeckState = run.paused ? "paused" : hasWork ? "running" : qualifiedWaiting > 0 ? "idle" : "empty";
  const canStart = state === "paused" ? hasWork || qualifiedWaiting > 0 : state === "idle";
  const isRunning = state === "running";
  const limitReached = usage.started >= usage.limit;

  const hint =
    state === "running"
      ? run.pauseAfterCurrent
        ? "Pausing after the current application"
        : `${plural(counts.running, "task")} running · ${counts.queued.toLocaleString()} in line`
      : state === "paused"
        ? hasWork
          ? `${plural(counts.queued + counts.running, "task")} waiting to start`
          : qualifiedWaiting > 0
            ? `Start adds ${plural(qualifiedWaiting, "qualified job")}`
            : "Nothing queued"
        : state === "idle"
          ? `Start adds ${plural(qualifiedWaiting, "qualified job")}`
          : "Choose Apply on jobs to add tasks";

  const onBigButton = () => {
    if (isRunning) runAction(() => queueControlAction("pause"));
    else if (canStart) runAction(() => startRunAction());
  };

  return (
    <section
      aria-label="Run controls"
      className="dark bg-sidebar text-sidebar-foreground border-sidebar-border relative overflow-hidden rounded-2xl border"
      data-testid="control-deck"
      data-state={state}
    >
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_85%_0%,oklch(0.55_0.18_259/0.28),transparent_55%),radial-gradient(ellipse_at_0%_100%,oklch(0.75_0.02_255/0.1),transparent_50%)]" />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_right,#ffffff08_1px,transparent_1px),linear-gradient(to_bottom,#ffffff08_1px,transparent_1px)] bg-[size:28px_28px]" />

      <div className="relative grid gap-6 p-5 sm:p-6 md:grid-cols-[auto_minmax(0,1fr)] md:items-center md:gap-8">
        <div className="flex flex-col items-center gap-3">
          <button
            type="button"
            onClick={onBigButton}
            disabled={pending || (!isRunning && !canStart)}
            aria-label={isRunning ? "Pause" : "Start"}
            data-testid="start-button"
            className={cn(
              "group relative grid size-36 place-items-center rounded-full transition-transform outline-none select-none focus-visible:ring-4 focus-visible:ring-[var(--glow)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 sm:size-40",
              !isRunning && canStart && "shadow-[0_0_48px_var(--glow)] hover:shadow-[0_0_64px_var(--glow)]",
            )}
          >
            {/* Brushed steel bezel, with a turning blue arc while the queue runs. */}
            <span className="absolute inset-0 rounded-full bg-[conic-gradient(from_200deg,#f5f7fb,#8d96a5,#e3e7ed,#6c7583,#f5f7fb)] p-[3px]">
              <span className="block size-full rounded-full bg-[oklch(0.22_0.03_262)]" />
            </span>
            {isRunning && (
              <span className="absolute inset-1 animate-[spin_2.4s_linear_infinite] rounded-full bg-[conic-gradient(from_0deg,transparent_0deg,transparent_250deg,oklch(0.7_0.17_255)_330deg,transparent_360deg)] [mask:radial-gradient(farthest-side,transparent_calc(100%-4px),#000_calc(100%-3px))]" />
            )}
            <span
              className={cn(
                "relative grid size-[7.5rem] place-items-center rounded-full sm:size-[8.25rem]",
                isRunning
                  ? "bg-[radial-gradient(circle_at_50%_35%,oklch(0.36_0.04_262),oklch(0.24_0.03_262))]"
                  : "bg-[radial-gradient(circle_at_50%_30%,oklch(0.68_0.17_257),oklch(0.5_0.2_260)_70%)] shadow-[inset_0_2px_0_oklch(1_0_0/0.35),inset_0_-6px_14px_oklch(0.3_0.12_262/0.6)]",
              )}
            >
              <span className="flex flex-col items-center gap-1 text-white">
                {pending ? <Loader2 className="size-7 animate-spin" /> : isRunning ? <Pause className="size-7" /> : <Play className="size-7 fill-current" />}
                <span className="text-sm font-bold tracking-[0.25em]">{isRunning ? "PAUSE" : "START"}</span>
              </span>
            </span>
          </button>
          <div className="text-center">
            <p className="flex items-center justify-center gap-2 text-sm font-semibold text-white" data-testid="run-state">
              <span
                className={cn(
                  "size-2 rounded-full",
                  state === "running" ? "bg-success animate-pulse" : state === "paused" ? "bg-warning" : "bg-muted-foreground",
                )}
              />
              {STATE_LABEL[state]}
            </p>
            <p className="text-muted-foreground mt-0.5 max-w-52 text-xs">{hint}</p>
          </div>
        </div>

        <div className="grid min-w-0 gap-5">
          <dl className="grid grid-cols-3 gap-2 sm:grid-cols-5" title="Submitted and Failed count the last 24 hours">
            {[
              { label: "Running", value: counts.running, tone: "text-primary" },
              { label: "In line", value: counts.queued, tone: "text-white" },
              { label: "Needs you", value: counts.needsYou, tone: counts.needsYou ? "text-warning" : "text-white", href: "/needs-attention" },
              { label: "Submitted", value: counts.submitted, tone: "text-success" },
              { label: "Failed", value: counts.failed, tone: counts.failed ? "text-destructive" : "text-white" },
            ].map((stat) => {
              const body = (
                <>
                  <dt className="text-muted-foreground truncate text-[10px] font-semibold tracking-wider uppercase sm:text-[11px]">{stat.label}</dt>
                  <dd className={cn("text-xl font-semibold tabular-nums sm:text-2xl", stat.tone)}>{stat.value.toLocaleString()}</dd>
                </>
              );
              return stat.href ? (
                <Link key={stat.label} href={stat.href} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 transition-colors hover:bg-white/[0.08]">
                  {body}
                </Link>
              ) : (
                <div key={stat.label} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5">
                  {body}
                </div>
              );
            })}
          </dl>

          <div className="grid gap-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Started today</span>
              <span className="font-medium text-white tabular-nums">
                {usage.started} / {usage.limit}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/10" role="progressbar" aria-label="Daily application limit used" aria-valuenow={usage.started} aria-valuemax={usage.limit}>
              <div className="h-full rounded-full bg-[linear-gradient(90deg,oklch(0.8_0.02_255),oklch(0.66_0.17_257))]" style={{ width: `${Math.min(100, (usage.started / Math.max(1, usage.limit)) * 100)}%` }} />
            </div>
            {limitReached && <p className="text-muted-foreground text-xs">Daily limit reached. Tasks in line start again tomorrow (change it in Rules).</p>}
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1">
              <ShieldCheck className="text-primary size-3.5" />
              {run.mode === "AUTO" ? "Auto-submit is on" : run.mode === "MANUAL" ? "Manual mode: you submit" : "Review mode: you press Submit"}
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1">
              <span className={cn("size-1.5 rounded-full", worker.state === "online" ? "bg-success" : "bg-muted-foreground")} />
              {worker.state === "online" ? `Worker online${worker.interactive ? " · visible browser" : ""}` : worker.state === "offline" ? "Worker not running" : "Queue service unreachable"}
            </span>
            <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1">Up to {run.concurrency} at a time</span>
            <Link href="/rules" className="text-primary hover:underline">
              Change in Rules
            </Link>
          </div>

          <div className="flex flex-wrap gap-2">
            {isRunning && !run.pauseAfterCurrent && counts.running > 0 && (
              <ActionButton size="sm" variant="secondary" action={() => queueControlAction("pause_after_current")}>
                <TimerReset /> Pause after current
              </ActionButton>
            )}
            {counts.running > 0 && (
              <ActionButton size="sm" variant="secondary" className="text-destructive" action={() => queueControlAction("stop")}>
                <Square /> Stop now
              </ActionButton>
            )}
            {qualifiedWaiting > 0 && hasWork && (
              <ActionButton size="sm" variant="secondary" action={() => applyToAllQualifiedAction()}>
                <PlusCircle /> Add {plural(qualifiedWaiting, "qualified job")}
              </ActionButton>
            )}
          </div>

          <p className="text-muted-foreground text-xs">
            CAPTCHAs pop up live on{" "}
            <Link href="/captcha" className="text-primary hover:underline">
              Solve CAPTCHAs
            </Link>{" "}
            for you to solve, and sign-ins and questions Applyance isn&apos;t sure about stop in Needs Attention. It never skips a site&apos;s security checks.
          </p>
        </div>
      </div>
    </section>
  );
}
