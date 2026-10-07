import type { Metadata } from "next";
import Link from "next/link";
import { Activity, CheckCircle2, CircleAlert, Clock, Hand, RefreshCw, ServerCrash, ShieldAlert } from "lucide-react";
import { getAutomationHealth } from "@autoapply/database";
import { enumLabel, FAILURE_INFO, HEALTH_PERIODS, type HealthPeriod } from "@autoapply/shared";
import { retryScheduledNowAction } from "@/actions/applications";
import { requireUser } from "@/lib/auth";
import { getSiteCooldowns, getWorkerStatus } from "@/lib/worker-status";
import { ActionButton } from "@/components/action-button";
import { LiveRuns } from "@/components/live-progress";
import { LocalTime, TimeUntil } from "@/components/local-time";
import { EmptyState, PageHeader } from "@/components/page-header";
import { PlatformLabel, StatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { RunsChart } from "./runs-chart";

export const metadata: Metadata = { title: "Automation health" };

function parsePeriod(value: string | string[] | undefined): HealthPeriod {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (HEALTH_PERIODS as readonly number[]).includes(n) ? (n as HealthPeriod) : 30;
}

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  if (s < 90) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 90 ? `${m}m ${s % 60}s` : `${Math.round(m / 60)}h`;
}

const pct = (value: number | null) => (value == null ? "—" : `${value}%`);

export default async function AutomationHealthPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const days = parsePeriod((await searchParams).days);
  const [health, worker, cooldowns] = await Promise.all([getAutomationHealth(user.id, days), getWorkerStatus(), getSiteCooldowns()]);

  const kpis = [
    { label: "Success rate", value: pct(health.successRate), detail: `${health.totals.completed} of ${health.runs} runs submitted or ready for your review`, icon: CheckCircle2, tone: "text-emerald-600 dark:text-emerald-400" },
    { label: "Needed you", value: pct(health.neededYouRate), detail: `${health.totals.needed_you} runs stopped for a CAPTCHA, sign-in or question`, icon: Hand, tone: "text-amber-600 dark:text-amber-400" },
    { label: "Failure rate", value: pct(health.failureRate), detail: `${health.totals.failed} runs hit an error`, icon: CircleAlert, tone: "text-destructive" },
    {
      label: "Retries",
      value: String(health.retries),
      detail: health.retriedApplications ? `${health.recoveredApplications} of ${health.retriedApplications} failed applications recovered on a later try` : "No application needed a retry",
      icon: RefreshCw,
      tone: "text-primary",
    },
    { label: "Typical time to submit", value: formatDuration(health.medianSubmitMs), detail: "Median run that ended in a submission", icon: Clock, tone: "text-muted-foreground" },
  ];

  return (
    <div className="grid min-w-0 gap-6">
      <PageHeader
        title="Automation health"
        description="How Applyance's runs are going: what finished, what failed and why, and what's being retried. Updates live."
        actions={
          <div className="bg-muted inline-flex rounded-lg p-0.5" role="group" aria-label="Period">
            {HEALTH_PERIODS.map((p) => (
              <Link
                key={p}
                href={`/automation?days=${p}`}
                aria-current={p === days ? "page" : undefined}
                className={cn("rounded-md px-3 py-1 text-sm transition-colors", p === days ? "bg-background font-medium shadow-sm" : "text-muted-foreground hover:text-foreground")}
              >
                {p} days
              </Link>
            ))}
          </div>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="automation-status">
        <StatusTile
          icon={Activity}
          label="Worker"
          value={worker.state === "online" ? "Online" : worker.state === "offline" ? "Not running" : "Unreachable"}
          tone={worker.state === "online" ? "good" : "bad"}
          detail={worker.state === "online" ? `${worker.heartbeat.activeJobs} running now · ${worker.heartbeat.interactive ? "visible browser" : "headless"}` : "Start it with pnpm dev:worker. Queued applications wait until it's back."}
        />
        <StatusTile icon={RefreshCw} label="Waiting to retry" value={String(health.scheduled.length)} tone={health.scheduled.length ? "warn" : "good"} detail={health.scheduled[0] ? <>Next <TimeUntil value={health.scheduled[0].nextAttemptAt} /></> : "Nothing is backing off"} />
        <StatusTile icon={ShieldAlert} label="Gave up after retries" value={String(health.gaveUp)} tone={health.gaveUp ? "bad" : "good"} detail={health.gaveUp ? <Link href="/needs-attention" className="underline underline-offset-2">Review in Needs Attention</Link> : "None waiting on you"} />
        <StatusTile icon={ServerCrash} label="Sites on hold" value={String(cooldowns.length)} tone={cooldowns.length ? "warn" : "good"} detail={cooldowns.length ? cooldowns.map((c) => c.host).join(", ") : "Every site is reachable"} />
      </div>

      <LiveRuns />

      {health.runs === 0 && health.totals.stopped === 0 ? (
        <Card>
          <EmptyState icon={Activity} title={`No runs in the last ${days} days`} description="Once the worker starts filling applications, success rates, failures and retries show up here." action={<Link className="text-primary text-sm underline-offset-2 hover:underline" href="/jobs">Queue applications from Jobs</Link>} />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" data-testid="health-kpis">
            {kpis.map((k) => (
              <Card key={k.label} className="gap-1 py-4">
                <CardHeader className="px-4">
                  <CardDescription className="flex items-center gap-1.5 text-xs">
                    <k.icon className={cn("size-3.5", k.tone)} /> {k.label}
                  </CardDescription>
                  <CardTitle className="text-2xl tabular-nums">{k.value}</CardTitle>
                </CardHeader>
                <CardContent className="text-muted-foreground px-4 text-xs">{k.detail}</CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Runs per day</CardTitle>
              <CardDescription>Each attempt counts once. Runs you stopped aren't counted. Days are in {health.timeZone}.</CardDescription>
            </CardHeader>
            <CardContent>
              <RunsChart data={health.daily} />
            </CardContent>
          </Card>

          <div className="grid gap-6 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">Why runs failed</CardTitle>
                <CardDescription>Errors by class. Temporary ones are retried with growing waits; the rest come to you.</CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                {health.failures.length ? (
                  <Table data-testid="failure-classes">
                    <TableHeader>
                      <TableRow>
                        <TableHead className="pl-6">Failure</TableHead>
                        <TableHead className="text-right">Runs</TableHead>
                        <TableHead>Handling</TableHead>
                        <TableHead className="pr-6">What you can do</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {health.failures.map((f) => (
                        <TableRow key={f.type}>
                          <TableCell className="pl-6 align-top">
                            <div className="font-medium">{FAILURE_INFO[f.type].label}</div>
                            <div className="bg-muted mt-1.5 h-1.5 w-24 overflow-hidden rounded-full">
                              <div className="bg-destructive h-full" style={{ width: `${f.share}%` }} />
                            </div>
                          </TableCell>
                          <TableCell className="text-right align-top tabular-nums">
                            {f.count} <span className="text-muted-foreground text-xs">({f.share}%)</span>
                          </TableCell>
                          <TableCell className="align-top">
                            <Badge variant={FAILURE_INFO[f.type].retried ? "secondary" : "outline"}>{FAILURE_INFO[f.type].retried ? "Retried" : "Comes to you"}</Badge>
                          </TableCell>
                          <TableCell className="text-muted-foreground max-w-xs pr-6 align-top text-xs whitespace-normal">{FAILURE_INFO[f.type].fix}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                ) : (
                  <p className="text-muted-foreground px-6 text-sm">No failures in this period.</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-sm">By site type</CardTitle>
                <CardDescription>How runs went on each kind of application site.</CardDescription>
              </CardHeader>
              <CardContent className="px-0">
                <Table data-testid="platform-health">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="pl-6">Site</TableHead>
                      <TableHead className="text-right">Runs</TableHead>
                      <TableHead className="text-right">Success</TableHead>
                      <TableHead className="pr-6">Most common failure</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {health.platforms.map((p) => (
                      <TableRow key={p.platform}>
                        <TableCell className="pl-6">
                          <PlatformLabel platform={p.platform} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{p.runs}</TableCell>
                        <TableCell className="text-right tabular-nums">{pct(p.successRate)}</TableCell>
                        <TableCell className="text-muted-foreground pr-6">{p.topFailure ? FAILURE_INFO[p.topFailure].label : "—"}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {health.pauses.length > 0 && (
                  <div className="mt-4 border-t px-6 pt-4">
                    <p className="text-sm font-medium">Why runs stopped for you</p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {health.pauses.map((p) => (
                        <Badge key={p.reason} variant="outline">
                          {enumLabel(p.reason)} · {p.count}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Waiting to retry</CardTitle>
            <CardDescription>Applications backing off after a temporary failure. They run again on their own.</CardDescription>
            {health.scheduled.length > 1 && (
              <CardAction>
                <ActionButton size="sm" variant="outline" action={retryScheduledNowAction.bind(null, health.scheduled.map((s) => s.id))}>
                  Retry all now
                </ActionButton>
              </CardAction>
            )}
          </CardHeader>
          <CardContent>
            {health.scheduled.length ? (
              <ul className="divide-y" data-testid="scheduled-retries">
                {health.scheduled.map((s) => (
                  <li key={s.id} className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <div className="min-w-0">
                      <Link href={`/applications/${s.id}`} className="font-medium hover:underline">
                        {s.title} · {s.company}
                      </Link>
                      <p className="text-muted-foreground text-xs">
                        {s.failureType ? FAILURE_INFO[s.failureType].label : "Waiting"} · attempt {s.attempts} · next try <TimeUntil value={s.nextAttemptAt} />
                      </p>
                    </div>
                    <ActionButton size="xs" variant="outline" action={retryScheduledNowAction.bind(null, [s.id])}>
                      Retry now
                    </ActionButton>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">Nothing is waiting to retry.</p>
            )}
            {cooldowns.length > 0 && (
              <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs" data-testid="site-cooldowns">
                <p className="font-medium">Sites on hold</p>
                <ul className="text-muted-foreground mt-1 grid gap-1">
                  {cooldowns.map((c) => (
                    <li key={c.host}>
                      {c.host}: {c.reason}. Applications to it wait until <LocalTime value={c.until} pattern="h:mm a" /> without using up attempts.
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recent failures</CardTitle>
            <CardDescription>The latest errors, newest first.</CardDescription>
          </CardHeader>
          <CardContent>
            {health.recentFailures.length ? (
              <ul className="divide-y" data-testid="recent-failures">
                {health.recentFailures.map((f) => (
                  <li key={f.attemptId} className="grid gap-1 py-3 first:pt-0 last:pb-0">
                    <div className="flex items-center justify-between gap-3">
                      <Link href={`/applications/${f.applicationId}`} className="min-w-0 truncate font-medium hover:underline">
                        {f.title} · {f.company}
                      </Link>
                      <StatusBadge status={f.applicationStatus} />
                    </div>
                    <p className="text-muted-foreground text-xs">
                      <span className="text-foreground">{FAILURE_INFO[f.failureType].label}</span> on attempt {f.attempt} · <LocalTime value={f.at} pattern="MMM d, h:mm a" />
                    </p>
                    {f.message && <p className="text-muted-foreground line-clamp-2 text-xs">{f.message}</p>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground text-sm">No failures in the last {days} days.</p>
            )}
          </CardContent>
        </Card>
      </div>
      {health.truncated && <p className="text-muted-foreground text-xs">This period has more runs than the page can total; figures cover the most recent ones read.</p>}
    </div>
  );
}

function StatusTile({ icon: Icon, label, value, detail, tone }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; detail: React.ReactNode; tone: "good" | "warn" | "bad" }) {
  return (
    <Card className="gap-1 py-4">
      <CardHeader className="px-4">
        <CardDescription className="flex items-center gap-1.5 text-xs">
          <span className={cn("size-2 rounded-full", tone === "good" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : "bg-destructive")} aria-hidden />
          <Icon className="size-3.5" /> {label}
        </CardDescription>
        <CardTitle className="text-lg">{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-muted-foreground truncate px-4 text-xs">{detail}</CardContent>
    </Card>
  );
}
