import type { Metadata } from "next";
import { getJobFilterOptions, getSavedBoardSearch, listJobs, prisma } from "@autoapply/database";
import { jobFiltersSchema } from "@autoapply/shared";
import { requireUser } from "@/lib/auth";
import { ActionButton } from "@/components/action-button";
import { PageHeader } from "@/components/page-header";
import { analyzePendingAction } from "@/actions/ingestion";
import { applyToAllQualifiedAction } from "@/actions/jobs";
import { Loader2 } from "lucide-react";
import { AddJobDialog } from "./add-job-dialog";
import { BoardSearchDialog } from "./board-search-dialog";
import { ImportDialog } from "./import-dialog";
import { JobsTable } from "./jobs-table";
import { JobsToolbar } from "./jobs-toolbar";

export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const raw = await searchParams;
  const filters = jobFiltersSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const [data, options, qualifiedWaiting, analyzing, savedBoardSearch] = await Promise.all([
    listJobs(user.id, filters),
    getJobFilterOptions(user.id),
    prisma.job.count({ where: { userId: user.id, deletedAt: null, status: "QUALIFIED", application: null } }),
    prisma.job.count({ where: { userId: user.id, deletedAt: null, status: { in: ["IMPORTED", "ANALYZING"] } } }),
    getSavedBoardSearch(user.id),
  ]);
  const hasFilters = ["q", "status", "platform", "remote", "minMatch", "company", "location", "minSalary", "savedFrom", "savedTo"].some((k) => raw[k]);

  // minmax(0, 1fr) keeps the wide table scrolling inside its container instead of widening the page.
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <PageHeader
        title="Jobs"
        description="Every job you've saved, with its match and where it is in the pipeline."
        actions={
          <>
            <ActionButton variant="outline" size="sm" disabled={qualifiedWaiting === 0} action={applyToAllQualifiedAction}>
              Apply to all qualified ({qualifiedWaiting})
            </ActionButton>
            <BoardSearchDialog saved={savedBoardSearch} />
            <ImportDialog />
            <AddJobDialog />
          </>
        }
      />
      {analyzing > 0 && (
        <div role="status" className="bg-primary/5 border-primary/20 flex flex-wrap items-center gap-3 rounded-lg border px-3 py-2 text-sm">
          <Loader2 className="text-primary size-4 animate-spin" />
          <span className="flex-1">
            Analyzing {analyzing} job{analyzing === 1 ? "" : "s"} against your profile and rules. Scores appear as each one finishes.
          </span>
          <ActionButton size="xs" variant="ghost" action={analyzePendingAction}>
            Restart analysis
          </ActionButton>
        </div>
      )}
      <JobsToolbar companies={options.companies} platforms={options.platforms} />
      <JobsTable data={data} hasFilters={hasFilters} />
    </div>
  );
}
