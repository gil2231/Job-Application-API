import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getAdminUserDetail, NotFoundError } from "@autoapply/database";
import { APPLICATION_STATUSES, enumLabel } from "@autoapply/shared";
import { requireAdmin } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { getRequestContext } from "@/lib/request";
import { TimeAgo } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FailureList } from "../../failure-list";

export const metadata: Metadata = { title: "User · Admin" };

export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;
  if (!/^[a-z0-9]{20,40}$/i.test(id)) notFound();

  let detail: Awaited<ReturnType<typeof getAdminUserDetail>>;
  try {
    detail = await getAdminUserDetail(admin.id, id, await getRequestContext());
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  const { account } = detail;
  const totalApplications = Object.values(detail.statusCounts).reduce<number>((n, c) => n + (c ?? 0), 0);

  const facts: Array<[string, React.ReactNode]> = [
    ["Joined", formatDate(account.createdAt)],
    ["Last sign-in", account.lastLoginAt ? <TimeAgo value={account.lastLoginAt} /> : "Never"],
    ["Last active", detail.lastSeenAt ? <TimeAgo value={detail.lastSeenAt} /> : "No active session"],
    ["Signed-in devices", detail.activeSessions],
    ["Email verified", account.emailVerifiedAt ? formatDate(account.emailVerifiedAt) : "No"],
    ["Plan", <span key="plan" className="text-muted-foreground">Billing not connected yet</span>],
    ["Automation mode", detail.automationMode ? enumLabel(detail.automationMode) : "—"],
    ["Queue", detail.queuePaused ? "Paused" : "Running"],
    ["Jobs saved", detail.jobs],
    ["Documents", detail.documents],
  ];

  return (
    <div className="grid gap-4">
      <Link href="/admin/users" className="text-muted-foreground hover:text-foreground inline-flex w-fit items-center gap-1 text-sm">
        <ArrowLeft className="size-4" /> All users
      </Link>

      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{account.name}</h2>
        {account.role === "ADMIN" && <Badge variant="info">Admin</Badge>}
        {account.locked && <Badge variant="warning">Locked after {account.failedLoginCount} failed sign-ins</Badge>}
        <span className="text-muted-foreground w-full text-sm">{account.email}</span>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="text-sm">Account</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-2 text-sm">
              {facts.map(([label, value]) => (
                <div key={label} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>

        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="text-sm">Applications</CardTitle>
            <CardDescription>{totalApplications.toLocaleString()} in total</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              {APPLICATION_STATUSES.filter((s) => detail.statusCounts[s]).map((s) => (
                <div key={s} className="bg-muted/50 rounded-lg px-3 py-2">
                  <dt className="text-muted-foreground text-xs">{enumLabel(s)}</dt>
                  <dd className="text-lg font-semibold tabular-nums">{detail.statusCounts[s]}</dd>
                </div>
              ))}
            </dl>
            {totalApplications === 0 && <p className="text-muted-foreground text-sm">No applications yet.</p>}
          </CardContent>
        </Card>

        <Card className="gap-3">
          <CardHeader>
            <CardTitle className="text-sm">Recent sign-ins</CardTitle>
          </CardHeader>
          <CardContent>
            {detail.signIns.length === 0 ? (
              <p className="text-muted-foreground text-sm">None recorded.</p>
            ) : (
              <ul className="grid gap-1.5 text-sm">
                {detail.signIns.map((s) => (
                  <li key={s.id} className="flex justify-between gap-3">
                    <span>{s.action === "auth.sign_up" ? "Signed up" : "Signed in"}</span>
                    <TimeAgo value={s.createdAt} className="text-muted-foreground" />
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="gap-3">
        <CardHeader>
          <CardTitle className="text-sm">Failing and stuck applications</CardTitle>
          <CardDescription>The 10 most recent. Their profile, resumes and answers stay private.</CardDescription>
        </CardHeader>
        <CardContent>
          {detail.failures.length === 0 ? <p className="text-muted-foreground text-sm">Nothing failing.</p> : <FailureList items={detail.failures} showUser={false} />}
        </CardContent>
      </Card>
    </div>
  );
}
