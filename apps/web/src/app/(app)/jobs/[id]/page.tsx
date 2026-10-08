import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, CircleHelp, ExternalLink, XCircle } from "lucide-react";
import { resolveProvider } from "@autoapply/ai";
import { getFullProfile, getGeneratedForJob, getJob, getUserSettings, NotFoundError } from "@autoapply/database";
import {
  canonicalSkillKey,
  EDUCATION_LEVEL_LABELS,
  enumLabel,
  LISTING_SITE_LABELS,
  listingSite,
  MATCH_DIMENSION_LABELS,
  SENIORITY_LABELS,
  type JobAnalysis,
  type MatchBreakdownItem,
  type QualificationResult,
  type RuleCheck,
} from "@autoapply/shared";
import { requireUser } from "@/lib/auth";
import { formatDate, formatRelative, formatSalary } from "@/lib/format";
import { MatchScore, StatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { EditJobDialog } from "./edit-job-dialog";
import { JobActions, ReanalyzeButton } from "./job-actions";
import { TailoredDocuments } from "./tailored-documents";
import { WhereToApply } from "./where-to-apply";

export const metadata: Metadata = { title: "Job" };

const OUTCOME_ICON: Record<RuleCheck["outcome"], React.ReactNode> = {
  pass: <CheckCircle2 className="text-success size-4" aria-label="Passes" />,
  fail: <XCircle className="text-destructive size-4" aria-label="Fails" />,
  unknown: <CircleHelp className="text-muted-foreground size-4" aria-label="Unknown" />,
};

function List({ items, empty }: { items: string[]; empty: string }) {
  if (!items.length) return <p className="text-muted-foreground text-[13px]">{empty}</p>;
  return (
    <ul className="grid gap-1 text-[13px]">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2">
          <span className="text-muted-foreground">•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export default async function JobPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const [job, profile, generated, settings] = await Promise.all([
    getJob(user.id, id).catch((e) => {
      if (e instanceof NotFoundError) notFound();
      throw e;
    }),
    getFullProfile(user.id),
    getGeneratedForJob(user.id, id),
    getUserSettings(user.id),
  ]);
  const { provider } = resolveProvider({ provider: settings.aiProvider, model: settings.aiModel });
  const breakdown = (Array.isArray(job.matchBreakdown) ? job.matchBreakdown : []) as unknown as MatchBreakdownItem[];
  const analysis = (job.analysis && typeof job.analysis === "object" ? job.analysis : null) as unknown as JobAnalysis | null;
  const qualification = (job.qualification && typeof job.qualification === "object" ? job.qualification : null) as unknown as QualificationResult | null;
  const ownedSkills = new Set([...profile.skills.map((s) => s.name), ...profile.employment.flatMap((e) => e.skills)].map(canonicalSkillKey));
  const canEdit = !job.application;
  const applyUrl = job.applicationUrl ?? job.url;
  const fromListing = listingSite(applyUrl);
  const status = job.application?.status ?? job.status;
  const editable = {
    id: job.id,
    title: job.title,
    company: job.company,
    location: job.location,
    workArrangement: job.workArrangement,
    salaryText: job.salaryText,
    applicationUrl: job.applicationUrl,
    description: job.description,
  };

  const facts: Array<[string, React.ReactNode]> = [
    ["Location", job.location ?? "—"],
    ["Arrangement", job.workArrangement === "UNKNOWN" ? "—" : enumLabel(job.workArrangement)],
    ["Type", job.employmentType ? enumLabel(job.employmentType) : "—"],
    ["Salary", job.salaryMax != null ? `${formatSalary(job)}${job.salaryText ? ` (“${job.salaryText}”)` : ""}` : (job.salaryText ?? "—")],
    ["Platform", job.platform === "UNKNOWN" ? "—" : enumLabel(job.platform)],
    ["Source", job.source?.name ?? enumLabel(job.sourceType)],
    ["Job ID", job.externalId ?? "—"],
    ["Saved", formatDate(job.savedAt)],
    ["Posted", formatDate(job.postedAt)],
  ];

  const analysisFacts: Array<[string, React.ReactNode]> = analysis
    ? [
        ["Department", analysis.department ?? "—"],
        ["Seniority", analysis.seniority ? SENIORITY_LABELS[analysis.seniority] : "—"],
        ["Industry", analysis.industry ?? "—"],
        ["Experience", analysis.experienceYearsMin != null ? `${analysis.experienceYearsMin}+ years` : "Not stated"],
        [
          "Education",
          analysis.education ? `${EDUCATION_LEVEL_LABELS[analysis.education.level]}${analysis.education.equivalentExperienceAccepted ? " or equivalent experience" : ""}` : "Not stated",
        ],
        ["Sponsorship", analysis.sponsorship.available === true ? "Offered" : analysis.sponsorship.available === false ? "Not offered" : "Not mentioned"],
        ["Travel", analysis.travel.percent != null ? `Up to ${analysis.travel.percent}%` : analysis.travel.required === true ? "Required" : analysis.travel.required === false ? "None" : "Not mentioned"],
        ["Pay", analysis.commissionOnly ? "Commission-only" : analysis.salary ? analysis.salary.text : "Not listed"],
      ]
    : [];

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
            <StatusBadge status={status} />
            <MatchScore score={job.matchScore} />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={job.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink /> Open job
            </a>
          </Button>
          {canEdit && <EditJobDialog job={editable} />}
          {canEdit && status !== "ANALYZING" && <ReanalyzeButton jobId={job.id} />}
          <JobActions jobId={job.id} applicationId={job.application?.id ?? null} applicationStatus={job.application?.status ?? null} jobStatus={job.status} />
        </div>
      </div>

      {fromListing && !job.application && (
        <WhereToApply
          jobId={job.id}
          company={job.company}
          site={LISTING_SITE_LABELS[fromListing]}
          listingUrl={applyUrl}
          searchesJSearch={!!process.env.JSEARCH_API_KEY?.trim() || process.env.E2E_FAKE_JOB_SOURCES === "1"}
        />
      )}

      {job.status === "NEEDS_DETAILS" && !job.application && (
        <div role="status" className="border-warning/40 bg-warning/10 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm">
          <AlertTriangle className="size-4 shrink-0" />
          <span className="flex-1">
            {job.description
              ? "This job couldn't be fully analyzed. Check the description, then save it again."
              : "This job has no description yet, so its requirements can't be checked. Paste the description from the posting to score and qualify it."}
          </span>
          <EditJobDialog job={editable} label="Add description" />
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid content-start gap-4 lg:col-span-2">
          {qualification && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">{qualification.qualified ? "Qualifies under your rules" : qualification.status === "NEEDS_DETAILS" ? "Can't be qualified yet" : "Doesn't qualify under your rules"}</CardTitle>
                <CardDescription>
                  Checked {formatRelative(qualification.evaluatedAt)}. Change these on the <Link href="/rules" className="underline">Rules</Link> page.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="grid gap-2" data-testid="rule-checks">
                  {qualification.checks.map((check) => (
                    <li key={check.rule} className="flex items-start gap-2.5 text-[13px]" data-outcome={check.outcome}>
                      <span className="mt-0.5">{OUTCOME_ICON[check.outcome]}</span>
                      <span>
                        <span className="font-medium">{check.label}</span>
                        <span className="text-muted-foreground"> · {check.detail}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {analysis && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Job analysis</CardTitle>
                <CardDescription>
                  {analysis.method === "ai" ? `Extracted by ${analysis.model ?? "AI"}` : "Extracted by the built-in analyzer"} {formatRelative(analysis.analyzedAt)}.
                  {analysis.fallbackReason && ` AI analysis failed (${analysis.fallbackReason}), so the built-in analyzer was used.`}
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-5">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-4">
                  {analysisFacts.map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-muted-foreground text-xs">{k}</dt>
                      <dd>{v}</dd>
                    </div>
                  ))}
                </dl>
                <div className="grid gap-2">
                  <p className="text-xs font-medium">Skills mentioned</p>
                  {analysis.skills.length ? (
                    <div className="flex flex-wrap gap-1.5" data-testid="job-skills">
                      {analysis.skills.map((skill) => {
                        const owned = ownedSkills.has(canonicalSkillKey(skill));
                        return (
                          <Badge key={skill} variant={owned ? "success" : "muted"} title={owned ? "In your Master Profile" : "Not in your Master Profile"}>
                            {owned && <CheckCircle2 />}
                            {skill}
                          </Badge>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-[13px]">No specific skills found.</p>
                  )}
                </div>
                <div className="grid gap-5 sm:grid-cols-2">
                  <div className="grid content-start gap-2">
                    <p className="text-xs font-medium">Required qualifications</p>
                    <List items={analysis.requiredQualifications} empty="None listed separately." />
                  </div>
                  <div className="grid content-start gap-2">
                    <p className="text-xs font-medium">Preferred qualifications</p>
                    <List items={analysis.preferredQualifications} empty="None listed." />
                  </div>
                </div>
                {(analysis.sponsorship.text || analysis.travel.text || analysis.education?.text) && (
                  <div className="text-muted-foreground grid gap-1 text-xs">
                    {analysis.education?.text && <p>Education: “{analysis.education.text}”</p>}
                    {analysis.sponsorship.text && <p>Sponsorship: “{analysis.sponsorship.text}”</p>}
                    {analysis.travel.text && <p>Travel: “{analysis.travel.text}”</p>}
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          <TailoredDocuments jobId={job.id} generated={generated} ai={{ on: !!provider, model: provider?.model ?? null }} />

          <Card>
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
        </div>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Why this match score</CardTitle>
              <CardDescription>
                {job.matchScore == null
                  ? status === "ANALYZING" || status === "IMPORTED"
                    ? "Analysis is in progress."
                    : status === "NEEDS_DETAILS"
                      ? "Add the job description and it's scored against your profile."
                      : "This job hasn't been scored against your profile yet."
                  : "Each part is weighted as set on the Rules page. Parts the posting doesn't cover get half credit."}
              </CardDescription>
            </CardHeader>
            {breakdown.length > 0 && (
              <CardContent className="grid gap-4" data-testid="match-breakdown">
                {breakdown.map((b) => {
                  const points = Math.round(b.score * b.weight * 10) / 10;
                  return (
                    <div key={b.dimension} className="grid gap-1.5">
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="font-medium">
                          {MATCH_DIMENSION_LABELS[b.dimension]} <span className="text-muted-foreground font-normal">({b.weight}%)</span>
                          {b.known === false && (
                            <Badge variant="muted" className="ml-1.5 px-1.5 py-0 text-[10px]">
                              not enough info
                            </Badge>
                          )}
                        </span>
                        <span className="tabular-nums">
                          {points} / {b.weight}
                        </span>
                      </div>
                      <div className="bg-muted relative h-1.5 overflow-hidden rounded-full">
                        <div
                          className={cn("absolute inset-y-0 left-0 rounded-full", b.known === false ? "bg-muted-foreground/40" : b.score >= 0.75 ? "bg-success" : b.score >= 0.4 ? "bg-warning" : "bg-destructive")}
                          style={{ width: `${Math.round(b.score * 100)}%` }}
                        />
                      </div>
                      <p className="text-muted-foreground text-xs">{b.reason}</p>
                      {b.details?.map((d) => (
                        <p key={d} className="text-muted-foreground text-xs">
                          {d}
                        </p>
                      ))}
                    </div>
                  );
                })}
              </CardContent>
            )}
          </Card>
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
        </div>
      </div>
    </div>
  );
}
