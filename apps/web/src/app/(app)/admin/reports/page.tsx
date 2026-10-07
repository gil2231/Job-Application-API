import type { Metadata } from "next";
import Link from "next/link";
import { Inbox } from "lucide-react";
import { SUPPORT_PAGE_SIZE, listAdminSupportRequests } from "@autoapply/database";
import { adminSupportFiltersSchema, SUPPORT_CATEGORY_LABELS } from "@autoapply/shared";
import { requireAdmin } from "@/lib/auth";
import { Pagination } from "@/components/data-table";
import { LocalTime, TimeAgo } from "@/components/local-time";
import { EmptyState } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { ReportActions } from "./report-actions";
import { ReportFilters } from "./report-filters";

export const metadata: Metadata = { title: "Reports · Admin" };

export default async function AdminReportsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const raw = await searchParams;
  const filters = adminSupportFiltersSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const data = await listAdminSupportRequests(filters);
  return (
    <div className="grid gap-4">
      <ReportFilters total={data.total} />
      {data.total === 0 ? (
        <div className="rounded-xl border">
          <EmptyState
            icon={Inbox}
            title={filters.status === "open" ? "No open reports" : "No reports here"}
            description="Messages people send with Report a problem or the help center's contact form show up here."
          />
        </div>
      ) : (
        <>
          <ul className="grid gap-3" data-testid="admin-reports">
            {data.items.map((r) => (
              <li key={r.id} className="bg-card grid gap-3 rounded-xl border p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="grid gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{r.subject}</span>
                      <Badge variant="outline">{SUPPORT_CATEGORY_LABELS[r.category]}</Badge>
                      {r.status === "RESOLVED" && <Badge variant="secondary">Resolved</Badge>}
                    </div>
                    <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                      {r.user ? (
                        <Link href={`/admin/users/${r.user.id}`} className="hover:text-foreground underline-offset-2 hover:underline">
                          {r.user.name} · {r.email}
                        </Link>
                      ) : (
                        <span>
                          {r.name ? `${r.name} · ` : ""}
                          {r.email} (not signed in)
                        </span>
                      )}
                      <span title={r.createdAt.toISOString()}>
                        Sent <TimeAgo value={r.createdAt} />
                      </span>
                      {r.pagePath && (
                        <span>
                          from <span className="font-mono">{r.pagePath}</span>
                        </span>
                      )}
                      {r.applicationId && <span>about one of their applications</span>}
                      {r.resolvedAt && (
                        <span>
                          Resolved <LocalTime value={r.resolvedAt} pattern="MMM d" />
                        </span>
                      )}
                    </div>
                  </div>
                  <ReportActions id={r.id} email={r.email} subject={r.subject} resolved={r.status === "RESOLVED"} />
                </div>
                <p className="bg-muted/50 rounded-md px-3 py-2 text-sm break-words whitespace-pre-wrap">{r.message}</p>
                {r.userAgent && <p className="text-muted-foreground truncate text-[11px]">{r.userAgent}</p>}
              </li>
            ))}
          </ul>
          <Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={SUPPORT_PAGE_SIZE} />
        </>
      )}
    </div>
  );
}
