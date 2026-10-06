import { enumLabel, type AttentionReason, type PipelineStatus, type Platform } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type Variant = "success" | "warning" | "destructive" | "info" | "muted" | "secondary" | "outline";

const STATUS_VARIANT: Record<PipelineStatus, Variant> = {
  IMPORTED: "secondary",
  ANALYZING: "info",
  QUALIFIED: "info",
  NOT_QUALIFIED: "muted",
  QUEUED: "outline",
  PROCESSING: "info",
  WAITING_FOR_USER: "warning",
  REVIEW_REQUIRED: "warning",
  READY: "info",
  SUBMITTED: "success",
  FAILED: "destructive",
  REJECTED: "muted",
  SKIPPED: "muted",
};

export function StatusBadge({ status, className }: { status: PipelineStatus; className?: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status]} className={className}>
      {status === "PROCESSING" && <span className="bg-primary size-1.5 animate-pulse rounded-full" />}
      {enumLabel(status)}
    </Badge>
  );
}

export function AttentionBadge({ reason }: { reason: AttentionReason }) {
  return <Badge variant="warning">{enumLabel(reason)}</Badge>;
}

export function PlatformLabel({ platform }: { platform: Platform }) {
  return <span className={cn("text-[13px]", platform === "UNKNOWN" && "text-muted-foreground")}>{platform === "UNKNOWN" ? "—" : enumLabel(platform)}</span>;
}

export function MatchScore({ score, className }: { score: number | null | undefined; className?: string }) {
  if (score == null) return <span className={cn("text-muted-foreground text-[13px]", className)}>Not scored</span>;
  const tone = score >= 75 ? "bg-success" : score >= 50 ? "bg-warning" : "bg-destructive";
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="bg-muted relative h-1.5 w-12 overflow-hidden rounded-full">
        <span className={cn("absolute inset-y-0 left-0 rounded-full", tone)} style={{ width: `${score}%` }} />
      </span>
      <span className="text-[13px] font-medium tabular-nums">{score}</span>
    </span>
  );
}
