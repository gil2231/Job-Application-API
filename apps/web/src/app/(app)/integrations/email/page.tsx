import type { Metadata } from "next";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { EMAIL_ACTIVITY_FILTERS, listApplicationsForEmailMatching, listEmailActivity, listMailConnections, type EmailActivityFilter } from "@autoapply/database";
import { requireUser } from "@/lib/auth";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Pagination } from "@/components/data-table";
import { cn } from "@/lib/utils";
import { EmailRow } from "./email-row";

export const metadata: Metadata = { title: "Email activity" };

const FILTER_LABEL: Record<EmailActivityFilter, string> = { all: "All", review: "To check", updated: "Updated Flightpath" };

export default async function EmailActivityPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const raw = await searchParams;
  const filterParam = typeof raw.filter === "string" ? raw.filter : "all";
  const filter = (EMAIL_ACTIVITY_FILTERS as readonly string[]).includes(filterParam) ? (filterParam as EmailActivityFilter) : "all";
  const page = Math.max(1, Number.parseInt(typeof raw.page === "string" ? raw.page : "1", 10) || 1);
  const [activity, connections, applications] = await Promise.all([listEmailActivity(user.id, { filter, page }), listMailConnections(user.id), listApplicationsForEmailMatching(user.id)]);
  const options = applications.map((a) => ({ id: a.id, label: `${a.company} · ${a.title}` })).sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Email activity"
        description="Job emails Applyance read from your connected accounts, and what it did with each. Match the ones it couldn't place."
        actions={
          <Button variant="outline" size="sm" asChild>
            <Link href="/integrations">Email settings</Link>
          </Button>
        }
      />
      <nav className="flex gap-1" aria-label="Filter emails">
        {EMAIL_ACTIVITY_FILTERS.map((f) => (
          <Link
            key={f}
            href={f === "all" ? "/integrations/email" : `/integrations/email?filter=${f}`}
            className={cn("rounded-md px-3 py-1.5 text-sm", f === filter ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground")}
            aria-current={f === filter ? "page" : undefined}
          >
            {FILTER_LABEL[f]}
            {f === "review" && activity.needsReview > 0 && <span className="bg-warning/20 ml-1.5 rounded px-1.5 text-xs tabular-nums">{activity.needsReview}</span>}
          </Link>
        ))}
      </nav>
      <Card>
        <CardContent className="p-0">
          {activity.rows.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={connections.length === 0 ? "No email connected" : filter === "all" ? "No job emails yet" : "Nothing here"}
              description={
                connections.length === 0
                  ? "Connect Gmail or Outlook on the Integrations page and replies from employers will show up here."
                  : "Replies from employers you applied to show up here after each sync."
              }
              action={
                connections.length === 0 ? (
                  <Button size="sm" asChild>
                    <Link href="/integrations">Connect email</Link>
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <ul className="divide-y" data-testid="email-activity">
              {activity.rows.map((row) => (
                <EmailRow
                  key={row.id}
                  email={{
                    id: row.id,
                    fromName: row.fromName,
                    fromAddress: row.fromAddress,
                    subject: row.subject,
                    snippet: row.snippet,
                    receivedAt: row.receivedAt.toISOString(),
                    kind: row.kind,
                    stage: row.stage,
                    outcome: row.outcome,
                    application: row.application ? { id: row.application.id, label: `${row.application.job.company} · ${row.application.job.title}` } : null,
                    provider: row.connection.provider,
                  }}
                  applications={options}
                />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      {activity.total > activity.pageSize && <Pagination page={activity.page} pageCount={activity.pageCount} total={activity.total} pageSize={activity.pageSize} />}
    </div>
  );
}
