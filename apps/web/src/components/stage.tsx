"use client";

import { useState, useTransition } from "react";
import { ArrowRightLeft, ChevronDown, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { checkStageMove, isPostSubmitStage, STAGE_META, stageTargets, type TrackerStage } from "@autoapply/shared";
import { moveStageAction } from "@/actions/tracker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const TONE_BADGE = {
  neutral: "outline",
  info: "info",
  warning: "warning",
  danger: "destructive",
  success: "success",
  muted: "muted",
} as const;

export const STAGE_DOT: Record<TrackerStage, string> = {
  QUEUED: "bg-muted-foreground/50",
  PROCESSING: "bg-primary",
  NEEDS_YOU: "bg-warning",
  FAILED: "bg-destructive",
  SUBMITTED: "bg-chart-2",
  RESPONDED: "bg-chart-1",
  INTERVIEWING: "bg-chart-4",
  OFFER: "bg-success",
  ACCEPTED: "bg-success",
  REJECTED: "bg-muted-foreground/40",
  WITHDRAWN: "bg-muted-foreground/40",
  SKIPPED: "bg-muted-foreground/30",
};

export function StageBadge({ stage, className }: { stage: TrackerStage; className?: string }) {
  return (
    <Badge variant={TONE_BADGE[STAGE_META[stage].tone]} className={className}>
      {stage === "PROCESSING" && <span className="bg-primary size-1.5 animate-pulse rounded-full" />}
      {STAGE_META[stage].label}
    </Badge>
  );
}

export interface MovableCard {
  id: string;
  stage: TrackerStage;
  lockedBy: string | null;
}

/**
 * Moves applications between stages: checks the move, asks before "I applied
 * myself" moves, applies an optional optimistic update and reports the result.
 * Render `dialog` once wherever the hook is used.
 */
export function useStageMover(addOptimistic?: (move: { id: string; to: TrackerStage }) => void) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<{ id: string; to: TrackerStage; message: string } | null>(null);

  const execute = (id: string, to: TrackerStage) =>
    startTransition(async () => {
      addOptimistic?.({ id, to });
      const result = await moveStageAction(id, to);
      if (result.ok) {
        if (result.message) toast.success(result.message);
      } else toast.error(result.message ?? "Couldn't move it");
    });

  const move = (card: MovableCard, to: TrackerStage) => {
    const check = checkStageMove(card.stage, to, { locked: !!card.lockedBy });
    if (!check.allowed) return void toast.error(check.reason);
    if (check.kind === "none") return;
    if (check.confirm) setConfirming({ id: card.id, to, message: check.confirm });
    else execute(card.id, to);
  };

  const dialog = (
    <AlertDialog open={!!confirming} onOpenChange={(open) => !open && setConfirming(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Did you apply yourself?</AlertDialogTitle>
          <AlertDialogDescription>{confirming?.message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              if (confirming) execute(confirming.id, confirming.to);
              setConfirming(null);
            }}
          >
            Yes, mark submitted
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return { move, pending, dialog };
}

function targetLabel(from: TrackerStage, to: TrackerStage) {
  if (to === "QUEUED") return from === "FAILED" ? "Retry" : "Queue again";
  if (to === "SKIPPED") return "Skip";
  return STAGE_META[to].label;
}

/** "Move to" menu. `variant="badge"` shows the current stage as the trigger. */
export function StageMenu({
  card,
  onMove,
  pending,
  variant = "icon",
  align = "end",
}: {
  card: MovableCard;
  onMove: (to: TrackerStage) => void;
  pending?: boolean;
  variant?: "icon" | "badge" | "button";
  align?: "start" | "end";
}) {
  const targets = stageTargets(card.stage, { locked: !!card.lockedBy });
  const sent = targets.filter(isPostSubmitStage);
  const other = targets.filter((t) => !isPostSubmitStage(t));
  const unsent = !isPostSubmitStage(card.stage);

  if (targets.length === 0) {
    if (variant === "badge") return <StageBadge stage={card.stage} />;
    if (variant === "button") return null;
    return null;
  }

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        {variant === "badge" ? (
          <button
            type="button"
            className="focus-visible:ring-ring/50 inline-flex items-center gap-0.5 rounded-md outline-none focus-visible:ring-2"
            aria-label={`Stage: ${STAGE_META[card.stage].label}. Change stage`}
            disabled={pending}
          >
            <StageBadge stage={card.stage} />
            {pending ? <Loader2 className="text-muted-foreground size-3 animate-spin" /> : <ChevronDown className="text-muted-foreground size-3" />}
          </button>
        ) : variant === "button" ? (
          <Button size="sm" variant="outline" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />} Move to
          </Button>
        ) : (
          <Button size="icon-sm" variant="ghost" className="text-muted-foreground relative z-10 size-7" aria-label="Move to stage" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <ArrowRightLeft className="size-3.5" />}
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-52">
        {sent.length > 0 && (
          <>
            <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">{unsent ? "Applied yourself? Move to" : "Move to"}</DropdownMenuLabel>
            {sent.map((to) => (
              <DropdownMenuItem key={to} onSelect={() => onMove(to)}>
                <span className={cn("size-2 rounded-full", STAGE_DOT[to])} />
                {targetLabel(card.stage, to)}
              </DropdownMenuItem>
            ))}
          </>
        )}
        {other.length > 0 && (
          <>
            {sent.length > 0 && <DropdownMenuSeparator />}
            {other.map((to) => (
              <DropdownMenuItem key={to} onSelect={() => onMove(to)}>
                <span className={cn("size-2 rounded-full", STAGE_DOT[to])} />
                {targetLabel(card.stage, to)}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
