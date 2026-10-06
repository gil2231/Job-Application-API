"use client";

import Link from "next/link";
import { useOptimistic, useState } from "react";
import { CalendarClock, Inbox } from "lucide-react";
import type { TrackerBoard, TrackerCard } from "@autoapply/database";
import { checkStageMove, enumLabel, STAGE_META, type AttentionReason, type TrackerStage } from "@autoapply/shared";
import { EmptyState } from "@/components/page-header";
import { LocalTime, TimeAgo } from "@/components/local-time";
import { STAGE_DOT, StageMenu, useStageMover } from "@/components/stage";
import { MatchScore } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Column = TrackerBoard["columns"][number];

/** Optimistically move a card so the board reacts the moment it's dropped. */
function applyMove(columns: Column[], move: { id: string; to: TrackerStage }): Column[] {
  const card = columns.flatMap((c) => c.cards).find((c) => c.id === move.id);
  if (!card || card.stage === move.to) return columns;
  const moved: TrackerCard = { ...card, stage: move.to, stageChangedAt: new Date() };
  return columns.map((c) => {
    if (c.stage === card.stage) return { ...c, total: c.total - 1, cards: c.cards.filter((x) => x.id !== card.id) };
    if (c.stage === move.to) return { ...c, total: c.total + 1, cards: [moved, ...c.cards] };
    return c;
  });
}

export function FlightpathBoard({ board, searching }: { board: TrackerBoard; searching: boolean }) {
  const [columns, addOptimistic] = useOptimistic(board.columns, applyMove);
  const mover = useStageMover(addOptimistic);
  const [dragging, setDragging] = useState<TrackerCard | null>(null);
  const [over, setOver] = useState<TrackerStage | null>(null);
  const empty = columns.every((c) => c.total === 0);

  if (empty) {
    return (
      <div className="rounded-xl border">
        <EmptyState
          icon={Inbox}
          title={searching ? "Nothing matches that search" : "No applications yet"}
          description={searching ? "Try a company, role or city." : "Choose Apply on a job to queue it. Each application shows up here and moves across as it progresses."}
        />
      </div>
    );
  }

  return (
    <>
      {mover.dialog}
      <nav aria-label="Jump to stage" className="flex flex-wrap items-center gap-1.5">
        {columns.map((column) => (
          <button
            key={column.stage}
            type="button"
            onClick={() => document.getElementById(`stage-${column.stage}`)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" })}
            className={cn(
              "hover:bg-muted inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
              column.stage === "SUBMITTED" && "sm:ml-3",
              column.total === 0 && "text-muted-foreground",
            )}
          >
            <span className={cn("size-1.5 rounded-full", STAGE_DOT[column.stage])} />
            {STAGE_META[column.stage].label}
            <span className="text-muted-foreground tabular-nums">{column.total}</span>
          </button>
        ))}
      </nav>
      <div className="-mx-4 scroll-px-4 overflow-x-auto px-4 pb-2 md:-mx-6 md:scroll-px-6 md:px-6" role="list" aria-label="Flightpath board">
        <div className="flex min-w-max gap-3">
          {columns.map((column) => {
            const allowed = dragging ? checkStageMove(dragging.stage, column.stage, { locked: !!dragging.lockedBy }) : null;
            const canDrop = !!allowed?.allowed && dragging?.stage !== column.stage;
            const hidden = column.total - column.cards.length;
            // Empty columns fold into a slim strip so the busy ones fit on screen; they still take drops.
            const collapsed = column.cards.length === 0;
            return (
              <section
                key={column.stage}
                id={`stage-${column.stage}`}
                role="listitem"
                aria-label={`${STAGE_META[column.stage].label}, ${column.total}`}
                data-stage={column.stage}
                className={cn(
                  "bg-muted/40 flex shrink-0 flex-col rounded-xl border transition-colors",
                  collapsed ? "w-11" : "w-64",
                  column.stage === "SUBMITTED" && "ml-3",
                  dragging && !canDrop && dragging.stage !== column.stage && "opacity-50",
                  canDrop && "border-primary/40 border-dashed",
                  over === column.stage && canDrop && "bg-primary/5 border-primary",
                )}
                onDragOver={(e) => {
                  if (!canDrop) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (over !== column.stage) setOver(column.stage);
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver((o) => (o === column.stage ? null : o));
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  const card = dragging;
                  setDragging(null);
                  setOver(null);
                  if (card) mover.move(card, column.stage);
                }}
              >
                {collapsed ? (
                  <header className="flex flex-1 flex-col items-center gap-2 py-3" title={`${STAGE_META[column.stage].label}: ${STAGE_META[column.stage].description}`}>
                    <span className={cn("size-2 shrink-0 rounded-full", STAGE_DOT[column.stage])} />
                    <span className="text-muted-foreground text-xs tabular-nums">0</span>
                    <h2 className="text-muted-foreground text-[13px] font-medium whitespace-nowrap [writing-mode:vertical-rl]">{STAGE_META[column.stage].label}</h2>
                  </header>
                ) : (
                  <>
                    <header className="flex items-center gap-2 px-3 pt-3 pb-2" title={STAGE_META[column.stage].description}>
                      <span className={cn("size-2 rounded-full", STAGE_DOT[column.stage])} />
                      <h2 className="text-[13px] font-semibold">{STAGE_META[column.stage].label}</h2>
                      <span className="text-muted-foreground text-xs tabular-nums">{column.total}</span>
                    </header>
                    <ol className="grid max-h-[calc(100vh-17rem)] min-h-24 content-start gap-2 overflow-y-auto px-2 pb-2">
                      {column.cards.map((card) => (
                        <BoardCard
                          key={card.id}
                          card={card}
                          dragging={dragging?.id === card.id}
                          onDragStart={() => setDragging(card)}
                          onDragEnd={() => {
                            setDragging(null);
                            setOver(null);
                          }}
                          onMove={(to) => mover.move(card, to)}
                        />
                      ))}
                    </ol>
                  </>
                )}
                {hidden > 0 && (
                  <Link href={`/flightpath?view=table&stage=${column.stage}`} className="text-muted-foreground hover:text-foreground border-t px-3 py-2 text-xs">
                    +{hidden.toLocaleString()} more · view all in table
                  </Link>
                )}
              </section>
            );
          })}
        </div>
      </div>
      {board.counts.SKIPPED > 0 && (
        <p className="text-muted-foreground text-xs">
          {board.counts.SKIPPED} skipped application{board.counts.SKIPPED === 1 ? " is" : "s are"} hidden from the board.{" "}
          <Link href="/flightpath?view=table&stage=SKIPPED" className="text-primary hover:underline">
            Show in table
          </Link>
        </p>
      )}
    </>
  );
}

const ATTENTION_TEXT: Record<AttentionReason, string> = {
  CAPTCHA: "CAPTCHA for you to finish",
  MFA: "Verification code needed",
  AUTH_REQUIRED: "Sign-in needed",
  QUESTION_REVIEW: "Questions for you to answer",
  LOW_CONFIDENCE_MAPPING: "Fields for you to check",
  UNSUPPORTED_SITE: "Site needs you to apply",
  VALIDATION_ERROR: "Form errors to fix",
  REPEATED_FAILURE: "Kept failing; needs a look",
  CONTRADICTION: "Conflicting answers to check",
  FINAL_REVIEW: "Ready for your final review",
};

function CardDetail({ card }: { card: TrackerCard }) {
  switch (card.stage) {
    case "QUEUED":
      return (
        <>
          {enumLabel(card.mode)} mode · queued <TimeAgo value={card.queuedAt} />
        </>
      );
    case "PROCESSING":
      return <>Filling out now</>;
    case "NEEDS_YOU":
      return <>{card.attentionReason ? ATTENTION_TEXT[card.attentionReason] : card.status === "READY" ? "Ready for you to submit" : "Waiting on you"}</>;
    case "FAILED":
      return <>{card.failureType ? enumLabel(card.failureType) : "Failed"}</>;
    case "SUBMITTED":
      return card.submittedAt ? (
        <>
          Applied <LocalTime value={card.submittedAt} pattern="MMM d" />
        </>
      ) : (
        <>Submitted</>
      );
    case "SKIPPED":
      return <>Skipped</>;
    default:
      return (
        <>
          {STAGE_META[card.stage].label} <TimeAgo value={card.stageChangedAt ?? card.submittedAt} />
        </>
      );
  }
}

function BoardCard({
  card,
  dragging,
  onDragStart,
  onDragEnd,
  onMove,
}: {
  card: TrackerCard;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onMove: (to: TrackerStage) => void;
}) {
  // A card moved optimistically keeps its old status until the server answers, so derive what the menu offers from the stage.
  const movable = card.stage !== "PROCESSING" && !(card.stage === "QUEUED" && card.lockedBy);
  const next = card.interviews[0];
  return (
    <li
      draggable={movable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", card.id);
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      data-testid="flightpath-card"
      data-stage={card.stage}
      className={cn(
        "bg-card group relative grid gap-1.5 rounded-lg border p-3 shadow-xs transition-shadow hover:shadow-sm",
        movable && "cursor-grab active:cursor-grabbing",
        dragging && "opacity-40",
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-muted-foreground truncate text-xs">{card.job.company}</p>
          <Link href={`/applications/${card.id}`} className="line-clamp-2 text-[13px] leading-snug font-medium after:absolute after:inset-0" draggable={false}>
            {card.job.title}
          </Link>
        </div>
        <StageMenu card={card} onMove={onMove} />
      </div>
      {card.job.location && <p className="text-muted-foreground truncate text-xs">{card.job.location}</p>}
      {next?.scheduledAt ? (
        <p className="text-foreground flex items-center gap-1.5 text-xs font-medium">
          <CalendarClock className="text-chart-4 size-3.5 shrink-0" />
          <span className="truncate">
            {next.title || enumLabel(next.kind)} · <LocalTime value={next.scheduledAt} pattern="EEE, MMM d · h:mm a" />
          </span>
        </p>
      ) : (
        <p className={cn("text-muted-foreground truncate text-xs", card.stage === "FAILED" && "text-destructive", card.stage === "NEEDS_YOU" && "text-foreground")}>
          <CardDetail card={card} />
        </p>
      )}
      <div className="flex items-center justify-between gap-2">
        <MatchScore score={card.matchScore} />
        {card._count.interviews > 0 && (
          <Badge variant="muted" className="text-[11px]">
            {card._count.interviews} round{card._count.interviews === 1 ? "" : "s"}
          </Badge>
        )}
      </div>
    </li>
  );
}
