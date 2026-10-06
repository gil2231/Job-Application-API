import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getJob, NotFoundError } from "@autoapply/database";
import { enumLabel, MATCH_DIMENSION_LABELS, type MatchBreakdownItem } from "@autoapply/shared";
import { requireUser } from "@/lib/auth";
import { formatDate, formatSalary } from "@/lib/format";
import { MatchScore, StatusBadge } from "@/components/status";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { JobActions } from "./job-actions";

export const metadata: Metadata = { title: "Job" };

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const job = await getJob(user.id, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const breakdown = (Array.isArray(job.matchBreakdown) ? job.matchBreakdown : []) as unknown as MatchBreakdownItem[];
  const facts: Array<[string, React.ReactNode]> = [
    ["Location", job.location ?? "—"],
    ["Arrangement", job.workArrangement === "UNKNOWN" ? "—" : enumLabel(job.workArrangement)],
    ["Salary", job.salaryText ? `${formatSalary(job)} (“${job.salaryText}”)` : "—"],
    ["Platform", job.platform === "UNKNOWN" ? "—" : enumLabel(job.platform)],
    ["Source", job.source?.name ?? enumLabel(job.sourceType)],
    ["Saved", formatDate(job.savedAt)],
    ["Posted", formatDate(job.postedAt)],
  ];

  return (
    <div className="grid gap-6">
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link href="/jobs">
          <ArrowLeft /> Jobs
        </Link>
      </Button>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-muted-foreground text-sm">{job.company}</p>
          <h1 className="text-xl font-semibold tracking-tight">{job.title}</h1>
          <div className="mt-2 flex items-center gap-3">
            <StatusBadge status={job.application?.status ?? job.status} />
            <MatchScore score={job.matchScore} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={job.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Open job
            </a>
          </Button>
          <JobActions jobId={job.id} applicationId={job.application?.id ?? null} applicationStatus={job.application?.status ?? null} jobStatus={job.status} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Job description</CardTitle>
          </CardHeader>
          <CardContent>
            {job.description ? (
              <div className="text-sm leading-relaxed whitespace-pre-wrap">{job.description}</div>
            ) : (
              <p className="text-muted-foreground text-sm">No description saved for this job.</p>
            )}
          </CardContent>
        </Card>
        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Details</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-2 text-sm">
                {facts.map(([k, v]) => (
                  <div key={k} className="grid grid-cols-[96px_1fr] gap-2">
                    <dt className="text-muted-foreground">{k}</dt>
                    <dd className="break-words">{v}</dd>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Why this match score</CardTitle>
              {job.matchScore == null && <CardDescription>This job hasn&apos;t been analyzed against your profile yet.</CardDescription>}
            </CardHeader>
            {breakdown.length > 0 && (
              <CardContent className="grid gap-3">
                {breakdown.map((b) => (
                  <div key={b.dimension} className="grid gap-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-medium">
                        {MATCH_DIMENSION_LABELS[b.dimension]} <span className="text-muted-foreground">({b.weight}%)</span>
                      </span>
                      <span className="tabular-nums">{Math.round(b.score * b.weight)} pts</span>
                    </div>
                    <p className="text-muted-foreground text-xs">{b.reason}</p>
                  </div>
                ))}
              </CardContent>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
