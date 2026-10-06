import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CreditCard } from "lucide-react";
import { getAdminOverview } from "@autoapply/database";
import { backupHealthChecks } from "@autoapply/ops";
import { enumLabel } from "@autoapply/shared";
import { requireAdmin } from "@/lib/auth";
import { getWorkerStatus } from "@/lib/worker-status";
import { TimeAgo } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Admin" };

export default async function AdminOverviewPage() {
  await requireAdmin();
  const [overview, worker, backups] = await Promise.all([
    getAdminOverview(),
    getWorkerStatus(),
    backupHealthChecks().catch(() => ({ backups: { state: "fail" as const, note: "can't reach the backup bucket" }, restoreTest: { state: "off" as const } })),
  ]);
  const { users, applications } = overview;

  const cards = [
    { label: "Users", value: users.total, detail: `${users.new7d} new this week · ${users.new30d} in 30 days`, href: "/admin/users" },
    { label: "Active this week", value: users.active7d, detail: "Used Applyance in the last 7 days", href: "/admin/users" },
    { label: "Submitted this week", value: applications.submitted7d, detail: `${applications.total.toLocaleString()} applications in total`, href: null },
    { label: "Failed this week", value: applications.failed7d, detail: `${applications.failedTotal.toLocaleString()} failed in total`, href: "/admin/failures" },
    { label: "Stuck on users", value: applications.stuck, detail: "Waiting on the user for over 3 days", href: "/admin/failures?scope=stuck" },
  ];
  const maxType = Math.max(1, ...overview.failuresByType.map((f) => f.count));

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        {cards.map((card) => {
          const body = (
            <Card className="hover:border-primary/40 h-full gap-1.5 py-4 transition-colors" data-testid={`admin-card-${card.label}`}>
              <CardHeader className="px-4">
                <CardDescription className="text-[11px] font-semibold tracking-wider uppercase">{card.label}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-0.5 px-4">
                <span className="text-2xl font-semibold tabular-nums">{card.value.toLocaleString()}</span>
                <span className="text-muted-foreground text-xs">{card.detail}</span>
              </CardContent>
            </Card>
          );
          return card.href ? (
            <Link key={card.label} href={card.href}>
              {body}
            </Link>
          ) : (
            <div key={card.label}>{body}</div>
          );
        })}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Failures by cause</CardTitle>
            <CardDescription>Failed applications, last 30 days</CardDescription>
          </CardHeader>
          <CardContent>
            {overview.failuresByType.length === 0 ? (
              <p className="text-muted-foreground text-sm">No failures in the last 30 days.</p>
            ) : (
              <ul className="grid gap-2.5">
                {overview.failuresByType.map((f) => (
                  <li key={f.failureType}>
                    <Link href={`/admin/failures?failureType=${f.failureType}`} className="group grid gap-1">
                      <span className="flex justify-between text-sm">
                        <span className="group-hover:underline">{enumLabel(f.failureType)}</span>
                        <span className="tabular-nums">{f.count}</span>
                      </span>
                      <span className="bg-muted h-1.5 overflow-hidden rounded-full">
                        <span className="bg-destructive/70 block h-full rounded-full" style={{ width: `${(f.count / maxType) * 100}%` }} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Sites failing most</CardTitle>
            <CardDescription>Often a sign a site changed and its adapter needs updating</CardDescription>
          </CardHeader>
          <CardContent>
            {overview.failingSites.length === 0 ? (
              <p className="text-muted-foreground text-sm">No failures in the last 30 days.</p>
            ) : (
              <ul className="grid gap-1.5 text-sm">
                {overview.failingSites.map((s) => (
                  <li key={s.host} className="flex justify-between gap-3">
                    <span className="truncate font-mono text-[13px]">{s.host}</span>
                    <span className="tabular-nums">{s.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <div className="grid content-start gap-4">
          <Card className="gap-3">
            <CardHeader>
              <CardTitle className="text-sm">Automation worker</CardTitle>
              <CardDescription>
                {worker.state === "online"
                  ? `${worker.heartbeat.activeJobs} running now`
                  : worker.state === "offline"
                    ? "Not running, so queued applications are waiting"
                    : "Queue service unreachable"}
              </CardDescription>
              <CardAction>
                {worker.state === "online" ? <Badge variant="success">Online</Badge> : <Badge variant="destructive">{worker.state === "offline" ? "Offline" : "Unreachable"}</Badge>}
              </CardAction>
            </CardHeader>
          </Card>

          <Card className="gap-3" data-testid="admin-backups">
            <CardHeader>
              <CardTitle className="text-sm">Database backups</CardTitle>
              <CardDescription>
                {backups.backups.state === "off"
                  ? "Not set up yet. See docs/operations/monitoring-and-backups.md"
                  : [backups.backups.note, backups.restoreTest.state !== "off" ? `restore test ${backups.restoreTest.note}` : null].filter(Boolean).join(" · ")}
              </CardDescription>
              <CardAction>
                {backups.backups.state === "off" ? (
                  <Badge variant="outline">Off</Badge>
                ) : backups.backups.state === "ok" && backups.restoreTest.state !== "fail" ? (
                  <Badge variant="success">OK</Badge>
                ) : (
                  <Badge variant="destructive">Needs attention</Badge>
                )}
              </CardAction>
            </CardHeader>
          </Card>

          <Card className="gap-3">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <CreditCard className="text-muted-foreground size-4" /> Plans and payments
              </CardTitle>
              <CardDescription>Billing isn&apos;t connected yet. Once it is, each user&apos;s plan, revenue and payment history show here.</CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle className="text-sm">Newest users</CardTitle>
          <CardAction>
            <Button asChild variant="ghost" size="sm">
              <Link href="/admin/users">
                All users <ArrowRight />
              </Link>
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          {overview.recentUsers.length === 0 ? (
            <p className="text-muted-foreground text-sm">No one has signed up yet.</p>
          ) : (
            <ul className="divide-y">
              {overview.recentUsers.map((u) => (
                <li key={u.id}>
                  <Link href={`/admin/users/${u.id}`} className="hover:bg-muted/50 -mx-2 flex items-center justify-between gap-3 rounded-md px-2 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{u.name}</span>
                      <span className="text-muted-foreground block truncate text-xs">{u.email}</span>
                    </span>
                    <TimeAgo value={u.createdAt} className="text-muted-foreground shrink-0 text-xs" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
