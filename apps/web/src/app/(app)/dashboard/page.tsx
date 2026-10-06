import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Circle, Inbox } from "lucide-react";
import { countResumes, getDashboardStats, getFullProfile, profileCompleteness } from "@autoapply/database";
import { requireUser } from "@/lib/auth";
import { formatRelative } from "@/lib/format";
import { getWorkerStatus } from "@/lib/worker-status";
import { EmptyState, PageHeader } from "@/components/page-header";
import { MatchScore, StatusBadge } from "@/components/status";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { QueueControls } from "./queue-controls";
import { WeeklyChart } from "./weekly-chart";

export const metadata: Metadata = { title: "Dashboard" };

const CARDS = [
  { key: "totalJobs", label: "Total jobs", href: "/jobs" },
  { key: "qualified", label: "Qualified", href: "/jobs?status=QUALIFIED" },
  { key: "applicationsSent", label: "Applications sent", href: "/applications?status=SUBMITTED,REJECTED" },
  { key: "needsReview", label: "Needs review", href: "/needs-attention" },
  { key: "failed", label: "Failed", href: "/applications?status=FAILED" },
] as const;

export default async function DashboardPage() {
  const user = await requireUser();
  const [stats, profile, resumes, worker] = await Promise.all([
    getDashboardStats(user.id),
    getFullProfile(user.id),
    countResumes(user.id),
    getWorkerStatus(),
  ]);
  const completeness = profileCompleteness(profile, { resumes });
  const funnelMax = Math.max(1, ...stats.funnel.map((f) => f.count));
  const firstName = user.name.split(" ")[0];

  return (
    <div className="grid gap-6">
      <PageHeader title={`Welcome back, ${firstName}`} description="Your application pipeline at a glance. Updates live as work progresses." />

      {completeness.percent < 100 && (
        <Card className="border-primary/25 bg-primary/[0.03]">
          <CardHeader>
            <CardTitle className="text-sm">Finish your Master Profile ({completeness.percent}%)</CardTitle>
            <CardDescription>Applications are filled only from facts in your profile. Missing facts become questions for you.</CardDescription>
            <CardAction>
              <Button asChild size="sm">
                <Link href="/profile">
                  Complete profile <ArrowRight />
                </Link>
              </Button>
            </CardAction>
          </CardHeader>
          <CardContent>
            <Progress value={completeness.percent} />
            <div className="text-muted-foreground mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              {completeness.missing.slice(0, 6).map((m) => (
                <span key={m} className="inline-flex items-center gap-1">
                  <Circle className="size-3" /> {m}
                </span>
              ))}
              {completeness.missing.length > 6 && <span>+{completeness.missing.length - 6} more</span>}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {CARDS.map((card) => (
          <Link key={card.key} href={card.href} className="group">
            <Card className="hover:border-primary/40 gap-2 py-4 transition-colors">
              <CardHeader className="px-4">
                <CardDescription className="text-[11px] font-semibold tracking-wider uppercase">{card.label}</CardDescription>
              </CardHeader>
              <CardContent className="flex items-end justify-between px-4">
                <span className="text-2xl font-semibold tabular-nums">{stats.cards[card.key].toLocaleString()}</span>
                <ArrowRight className="text-muted-foreground size-4 opacity-0 transition-opacity group-hover:opacity-100" />
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-sm">Weekly applications</CardTitle>
            <CardDescription>Submitted applications over the last 8 weeks</CardDescription>
          </CardHeader>
          <CardContent>
            <WeeklyChart data={stats.weekly} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Automation status</CardTitle>
            <CardDescription>
              {worker.state === "online"
                ? `Worker online · ${worker.heartbeat.activeJobs} active`
                : worker.state === "offline"
                  ? "Worker not running"
                  : "Queue service unreachable"}
            </CardDescription>
            <CardAction>
              {stats.automation.paused ? (
                <Badge variant="warning">Paused</Badge>
              ) : worker.state === "online" ? (
                <Badge variant="success">
                  <span className="bg-success size-1.5 animate-pulse rounded-full" /> Running
                </Badge>
              ) : (
                <Badge variant="muted">Idle</Badge>
              )}
            </CardAction>
          </CardHeader>
          <CardContent className="grid gap-4">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              {[
                ["Queued", stats.automation.queued],
                ["Processing", stats.automation.processing],
                ["Waiting on you", stats.automation.waiting],
                ["Ready to submit", stats.automation.ready],
              ].map(([label, value]) => (
                <div key={label as string} className="bg-muted/50 rounded-lg px-3 py-2">
                  <dt className="text-muted-foreground text-xs">{label}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            {stats.automation.pauseAfterCurrent && !stats.automation.paused && (
              <p className="text-muted-foreground text-xs">Will pause after the current application.</p>
            )}
            {worker.state !== "online" && stats.automation.queued > 0 && (
              <p className="text-muted-foreground text-xs">
                {stats.automation.queued} queued application{stats.automation.queued === 1 ? "" : "s"} will start when the worker is running.
              </p>
            )}
            <QueueControls paused={stats.automation.paused} pauseAfterCurrent={stats.automation.pauseAfterCurrent} processing={stats.automation.processing} />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Application funnel</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-2.5">
            {stats.funnel.map((stage) => (
              <div key={stage.stage} className="grid grid-cols-[88px_1fr_40px] items-center gap-3 text-sm">
                <span className="text-muted-foreground text-xs">{stage.stage}</span>
                <div className="bg-muted h-2 overflow-hidden rounded-full">
                  <div className="bg-chart-1 h-full rounded-full" style={{ width: `${(stage.count / funnelMax) * 100}%` }} />
                </div>
                <span className="text-right text-xs font-medium tabular-nums">{stage.count}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Responses</CardTitle>
            <CardDescription>Outcomes you&apos;ve recorded on submitted applications</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            {[
              ["Response rate", stats.responses.responseRate != null ? `${stats.responses.responseRate}%` : "—"],
              ["Interview rate", stats.responses.interviewRate != null ? `${stats.responses.interviewRate}%` : "—"],
              ["Interviews", stats.responses.interviews],
              ["Offers", stats.responses.offers],
            ].map(([label, value]) => (
              <div key={label as string}>
                <p className="text-muted-foreground text-xs">{label}</p>
                <p className="text-xl font-semibold tabular-nums">{value}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Average match score</CardTitle>
            <CardDescription>Across analyzed jobs</CardDescription>
          </CardHeader>
          <CardContent>
            {stats.averageMatchScore != null ? (
              <div className="flex items-end gap-2">
                <span className="text-4xl font-semibold tabular-nums">{stats.averageMatchScore}</span>
                <span className="text-muted-foreground mb-1 text-sm">/ 100</span>
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">No jobs have been scored yet. Scores appear once jobs are analyzed against your profile.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="gap-0 pb-0">
        <CardHeader className="border-b pb-4">
          <CardTitle className="text-sm">Recent applications</CardTitle>
          <CardAction>
            <Button asChild variant="ghost" size="sm">
              <Link href="/applications">
                View all <ArrowRight />
              </Link>
            </Button>
          </CardAction>
        </CardHeader>
        {stats.recent.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No applications yet"
            description="Add jobs, then choose Apply to queue them. Their progress shows up here."
            action={
              <Button asChild size="sm" variant="outline">
                <Link href="/jobs">Go to Jobs</Link>
              </Button>
            }
          />
        ) : (
          <ul className="divide-y">
            {stats.recent.map((app) => (
              <li key={app.id}>
                <Link href={`/applications/${app.id}`} className="hover:bg-muted/40 flex items-center gap-4 px-5 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{app.job.title}</p>
                    <p className="text-muted-foreground truncate text-xs">{app.job.company}</p>
                  </div>
                  <MatchScore score={app.matchScore} className="hidden sm:inline-flex" />
                  <StatusBadge status={app.status} />
                  <span className="text-muted-foreground hidden w-24 text-right text-xs md:block">{formatRelative(app.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {completeness.percent === 100 && (
        <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
          <CheckCircle2 className="text-success size-3.5" /> Master Profile complete
        </p>
      )}
    </div>
  );
}
