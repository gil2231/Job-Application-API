"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";
import type { JobStatus, Platform } from "@autoapply/shared";
import { applyToJobsAction } from "@/actions/jobs";
import { useServerAction } from "@/components/action-button";
import { ApplyButton } from "@/components/apply-button";
import { EmptyState } from "@/components/page-header";
import { MatchScore, PlatformLabel, StatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

export interface RecommendedRow {
  id: string;
  title: string;
  company: string;
  location: string | null;
  matchScore: number | null;
  status: string;
  platform: Platform;
  salary: string | null;
  relevance: number;
  titleKeywords: string[];
  descriptionKeywords: string[];
}

function Row({ row }: { row: RecommendedRow }) {
  const { pending, run } = useServerAction();
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-testid="recommendation">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/jobs/${row.id}`} className="font-medium hover:underline">
            {row.title}
          </Link>
          <StatusBadge status={row.status as JobStatus} />
        </div>
        <p className="text-muted-foreground truncate text-[13px]">{[row.company, row.location, row.salary].filter(Boolean).join(" · ")}</p>
        {(row.titleKeywords.length > 0 || row.descriptionKeywords.length > 0) && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {row.titleKeywords.map((k) => (
              <Badge key={k} variant="info">
                {k}
              </Badge>
            ))}
            {row.descriptionKeywords.map((k) => (
              <Badge key={k} variant="muted" title="Mentioned in the description">
                {k}
              </Badge>
            ))}
          </div>
        )}
      </div>
      <div className="text-muted-foreground hidden w-28 text-xs sm:block">
        <PlatformLabel platform={row.platform} />
      </div>
      <div className="w-24" title={row.matchScore == null ? "Scored once the description is added" : "Match score"}>
        <MatchScore score={row.matchScore} />
      </div>
      <ApplyButton size="xs" disabled={pending} onApply={(mode) => run(() => applyToJobsAction([row.id], mode))} />
    </li>
  );
}

export function RecommendedList({ rows, hasKeywords }: { rows: RecommendedRow[]; hasKeywords: boolean }) {
  if (!rows.length) {
    return (
      <Card className="py-0">
        <EmptyState
          icon={Sparkles}
          title="No recommendations yet"
          description={
            hasKeywords
              ? "None of your saved jobs mention your preferences yet."
              : "Add preferences, or import jobs and fill in your Master Profile so they can be scored."
          }
        />
      </Card>
    );
  }
  return (
    <div className="rounded-lg border">
      <ul className="divide-y" data-testid="recommendations">
        {rows.map((row) => (
          <Row key={row.id} row={row} />
        ))}
      </ul>
    </div>
  );
}
