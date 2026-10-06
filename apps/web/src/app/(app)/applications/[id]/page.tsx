import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, Circle, ExternalLink, FileText } from "lucide-react";
import { getApplicationDetail, NotFoundError } from "@autoapply/database";
import { enumLabel, isPostSubmitStage, STAGE_META, stageOf, trackerStageSchema, type ApplicationEventType } from "@autoapply/shared";
import { requireUser } from "@/lib/auth";
import { formatDate, formatRelative } from "@/lib/format";
import { AttentionBadge, MatchScore, PlatformLabel, StatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { LiveProgressCard } from "@/components/live-progress";
import { StageBadge } from "@/components/stage";
import { ApplicationActions, NoteForm } from "./application-actions";
import { InterviewsCard } from "./interviews";

export const metadata: Metadata = { title: "Application" };

const TIMELINE: Array<{ label: string; event?: ApplicationEventType; key?: "imported" | "analyzed" }> = [
  { label: "Job imported", key: "imported" },
  { label: "Job analyzed", key: "analyzed" },
  { label: "Match calculated", event: "MATCH_CALCULATED" },
  { label: "Platform detected", event: "PLATFORM_DETECTED" },
  { label: "Browser launched", event: "BROWSER_LAUNCHED" },
  { label: "Profile loaded", event: "PROFILE_LOADED" },
  { label: "Resume uploaded", event: "RESUME_UPLOADED" },
  { label: "Questions answered", event: "QUESTIONS_ANSWERED" },
  { label: "Validation completed", event: "VALIDATION_COMPLETED" },
  { label: "Submitted", event: "SUBMITTED" },
];

interface Screenshot {
  key: string;
  caption?: string;
  takenAt?: string;
}

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const app = await getApplicationDetail(user.id, id).catch((e) => {
    if (e instanceof NotFoundError) notFound();
    throw e;
  });
  const { job } = app;

  const eventAt = (type: ApplicationEventType) => app.events.find((e) => e.type === type)?.createdAt ?? null;
  const timeline = TIMELINE.map((step) => {
    const at = step.key === "imported" ? job.createdAt : step.key === "analyzed" ? job.analyzedAt : step.event === "MATCH_CALCULATED" ? (eventAt("MATCH_CALCULATED") ?? (job.matchScore != null ? job.analyzedAt : null)) : step.event === "QUESTIONS_ANSWERED" ? (eventAt("QUESTIONS_ANSWERED") ?? eventAt("FIELDS_MAPPED")) : step.event === "SUBMITTED" ? (eventAt("SUBMITTED") ?? app.submittedAt) : eventAt(step.event!);
    return { ...step, at };
  });
  const screenshots = app.attempts.flatMap((a) => ((Array.isArray(a.screenshots) ? a.screenshots : []) as unknown as Screenshot[]).map((s) => ({ ...s, attempt: a.attemptNumber })));
  const errors = [
    ...(app.lastError ? [{ at: app.updatedAt, type: app.failureType, message: app.lastError, source: "Latest" }] : []),
    ...app.attempts.filter((a) => a.errorMessage).map((a) => ({ at: a.endedAt ?? a.startedAt, type: a.failureType, message: a.errorMessage!, source: `Attempt ${a.attemptNumber}` })),
    ...app.events.filter((e) => e.level === "ERROR").map((e) => ({ at: e.createdAt, type: null, message: e.message, source: enumLabel(e.type) })),
  ];
  const stage = stageOf(app);
  // Stage moves after submission, oldest first, for the end of the timeline.
  const moves = app.events.flatMap((e) => {
    if (e.type !== "STAGE_CHANGED") return [];
    const data = (e.data && typeof e.data === "object" ? e.data : {}) as Record<string, unknown>;
    const to = trackerStageSchema.safeParse(data.to);
    if (!to.success) return [];
    return [{ id: e.id, to: to.data, at: e.createdAt, provider: data.source === "integration" && typeof data.provider === "string" ? data.provider : null }];
  });
  const snapshot = (app.profileSnapshot && typeof app.profileSnapshot === "object" ? app.profileSnapshot : null) as Record<string, unknown> | null;

  return (
    <div className="grid gap-6">
      <Button asChild variant="ghost" size="sm" className="w-fit">
        <Link href="/applications">
          <ArrowLeft /> Applications
        </Link>
      </Button>

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="text-muted-foreground text-sm">{job.company}</p>
          <h1 className="text-xl font-semibold tracking-tight">{job.title}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {isPostSubmitStage(stage) ? <StageBadge stage={stage} /> : <StatusBadge status={app.status} />}
            {app.attentionReason && <AttentionBadge reason={app.attentionReason} />}
            <Badge variant="outline">{enumLabel(app.mode)} mode</Badge>
            <MatchScore score={app.matchScore} className="ml-1" />
          </div>
        </div>
        <ApplicationActions
          applicationId={app.id}
          status={app.status}
          stage={stage}
          lockedBy={app.lockedBy}
          jobUrl={job.applicationUrl ?? job.url}
          attentionReason={app.attentionReason}
          hasOpenQuestions={app.questions.some((q) => q.status === "NEEDS_REVIEW")}
        />
      </div>

      {app.attentionDetail && (
        <div className="border-warning/40 bg-warning/10 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm">
          <AlertTriangle className="text-warning mt-0.5 size-4 shrink-0" />
          <div>
            {app.attentionDetail}{" "}
            <Link href="/needs-attention" className="text-primary font-medium hover:underline">
              Resolve in Needs Attention
            </Link>
          </div>
        </div>
      )}

      <LiveProgressCard applicationId={app.id} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="grid content-start gap-4 lg:col-span-2">
          <InterviewsCard applicationId={app.id} rounds={app.interviews} canAdd={isPostSubmitStage(stage)} />

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Questions &amp; answers</CardTitle>
              <CardDescription>Fields found on the application and the values used for them.</CardDescription>
            </CardHeader>
            <CardContent>
              {app.questions.length === 0 ? (
                <p className="text-muted-foreground text-sm">No fields recorded yet. They appear once the worker opens the application.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Question</TableHead>
                      <TableHead>Answer</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>Confidence</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {app.questions.map((q) => (
                      <TableRow key={q.id}>
                        <TableCell className="max-w-64 whitespace-normal">
                          {q.label}
                          {q.required && <span className="text-destructive"> *</span>}
                          {q.mappedField && <span className="text-muted-foreground block font-mono text-[11px]">{q.mappedField}</span>}
                          {q.status === "NEEDS_REVIEW" && q.reviewReason && <span className="text-muted-foreground block text-[12px]">{q.reviewReason}</span>}
                        </TableCell>
                        <TableCell className="max-w-72 whitespace-normal text-[13px]">
                          {q.answer ? (q.answer.sensitive ? <span className="text-muted-foreground italic">Hidden (sensitive)</span> : q.answer.value) : "—"}
                        </TableCell>
                        <TableCell className="text-[13px]">{q.answer ? enumLabel(q.answer.source) : "—"}</TableCell>
                        <TableCell className="text-[13px] tabular-nums">{q.answer?.confidence ?? q.confidence ?? "—"}</TableCell>
                        <TableCell>
                          <Badge variant={q.status === "NEEDS_REVIEW" ? "warning" : q.status === "SKIPPED" ? "muted" : "secondary"}>{enumLabel(q.status)}</Badge>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Job description</CardTitle>
            </CardHeader>
            <CardContent>
              {job.description ? (
                <div className="max-h-96 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap">{job.description}</div>
              ) : (
                <p className="text-muted-foreground text-sm">No description saved.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Screenshots</CardTitle>
            </CardHeader>
            <CardContent>
              {screenshots.length === 0 ? (
                <p className="text-muted-foreground text-sm">Screenshots are captured at each step while the application is being filled.</p>
              ) : (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {screenshots.map((s) => (
                    <a key={s.key} href={`/api/files?key=${encodeURIComponent(s.key)}`} target="_blank" rel="noopener noreferrer" className="group rounded-lg border p-2">
                      {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-gated file route */}
                      <img src={`/api/files?key=${encodeURIComponent(s.key)}`} alt={s.caption ?? "Screenshot"} loading="lazy" className="bg-muted aspect-video w-full rounded object-cover object-top" />
                      <p className="mt-1.5 truncate text-xs font-medium">{s.caption ?? "Screenshot"}</p>
                      <p className="text-muted-foreground text-[11px]">Attempt {s.attempt}</p>
                    </a>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Activity log</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4">
              <NoteForm applicationId={app.id} />
              <ol className="grid gap-3">
                {[...app.events].reverse().map((e) => (
                  <li key={e.id} className="grid grid-cols-[auto_1fr_auto] items-start gap-3 text-sm">
                    <span
                      className={cn(
                        "mt-1.5 size-2 rounded-full",
                        e.level === "ERROR" ? "bg-destructive" : e.level === "WARNING" ? "bg-warning" : "bg-muted-foreground/40",
                      )}
                    />
                    <div>
                      <p>{e.message}</p>
                      <p className="text-muted-foreground text-xs">{enumLabel(e.type)}</p>
                    </div>
                    <time className="text-muted-foreground text-xs whitespace-nowrap" dateTime={e.createdAt.toISOString()} title={e.createdAt.toISOString()}>
                      {formatRelative(e.createdAt)}
                    </time>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="grid content-start gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Timeline</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="grid gap-0">
                {timeline.map((step, i) => (
                  <li key={step.label} className="relative grid grid-cols-[20px_1fr] gap-3 pb-4 last:pb-0">
                    {(i < timeline.length - 1 || moves.length > 0) && <span className={cn("absolute top-5 left-[9px] h-[calc(100%-12px)] w-px", step.at ? "bg-success/50" : "bg-border")} />}
                    <span className={cn("z-10 mt-0.5 grid size-5 place-items-center rounded-full", step.at ? "bg-success text-white" : "bg-muted text-muted-foreground")}>
                      {step.at ? <Check className="size-3" /> : <Circle className="size-2" />}
                    </span>
                    <div>
                      <p className={cn("text-sm", !step.at && "text-muted-foreground")}>{step.label}</p>
                      {step.at && <p className="text-muted-foreground text-xs">{formatDate(step.at, "MMM d, h:mm a")}</p>}
                    </div>
                  </li>
                ))}
                {moves.map((m, i) => (
                  <li key={m.id} className="relative grid grid-cols-[20px_1fr] gap-3 pb-4 last:pb-0" data-testid="timeline-stage">
                    {i < moves.length - 1 && <span className="bg-success/50 absolute top-5 left-[9px] h-[calc(100%-12px)] w-px" />}
                    <span className={cn("z-10 mt-0.5 grid size-5 place-items-center rounded-full text-white", ["REJECTED", "WITHDRAWN", "SUBMITTED"].includes(m.to) ? "bg-muted-foreground/60" : "bg-success")}>
                      <Check className="size-3" />
                    </span>
                    <div>
                      <p className="text-sm">{STAGE_META[m.to].label}</p>
                      <p className="text-muted-foreground text-xs">
                        {formatDate(m.at, "MMM d, h:mm a")}
                        {m.provider ? ` · from ${m.provider}` : ""}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Materials</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm">
              <div>
                <p className="text-muted-foreground text-xs">Resume</p>
                {app.resume ? (
                  app.resume.document ? (
                    <a className="text-primary inline-flex items-center gap-1 hover:underline" href={`/api/documents/${app.resume.document.id}`}>
                      <FileText className="size-3.5" /> {app.resume.name}
                    </a>
                  ) : (
                    <p>{app.resume.name}</p>
                  )
                ) : (
                  <p className="text-muted-foreground">
                    None. <Link className="text-primary hover:underline" href="/documents">Upload a resume</Link>
                  </p>
                )}
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Cover letter</p>
                {app.coverLetter ? (
                  app.coverLetter.document ? (
                    <a className="text-primary inline-flex items-center gap-1 hover:underline" href={`/api/documents/${app.coverLetter.document.id}`}>
                      <FileText className="size-3.5" /> {app.coverLetter.name}
                    </a>
                  ) : (
                    <p>{app.coverLetter.name}</p>
                  )
                ) : (
                  <p className="text-muted-foreground">None</p>
                )}
              </div>
              <div>
                <p className="text-muted-foreground text-xs">Profile used</p>
                {snapshot ? (
                  <dl className="mt-1 grid gap-1 text-xs">
                    {Object.entries(snapshot)
                      .filter(([, v]) => typeof v === "string" || typeof v === "number")
                      .slice(0, 12)
                      .map(([k, v]) => (
                        <div key={k} className="grid grid-cols-[110px_1fr] gap-2">
                          <dt className="text-muted-foreground">{k}</dt>
                          <dd className="truncate">{String(v)}</dd>
                        </div>
                      ))}
                  </dl>
                ) : (
                  <p className="text-muted-foreground">
                    Captured from your <Link className="text-primary hover:underline" href="/profile">Master Profile</Link> when processing starts.
                  </p>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs">Platform</span>
                <PlatformLabel platform={app.platform} />
              </div>
              <a href={job.url} target="_blank" rel="noopener noreferrer" className="text-primary inline-flex items-center gap-1 text-xs hover:underline">
                <ExternalLink className="size-3" /> Open job posting
              </a>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Errors</CardTitle>
            </CardHeader>
            <CardContent>
              {errors.length === 0 ? (
                <p className="text-muted-foreground text-sm">No errors.</p>
              ) : (
                <ul className="grid gap-3 text-sm">
                  {errors.map((e, i) => (
                    <li key={i} className="border-destructive/20 bg-destructive/5 rounded-md border p-2.5">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-medium">{e.type ? enumLabel(e.type) : e.source}</span>
                        <span className="text-muted-foreground">{formatRelative(e.at)}</span>
                      </div>
                      <p className="mt-1 text-[13px] break-words">{e.message}</p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
