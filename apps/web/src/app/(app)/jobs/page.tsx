import type { Metadata } from "next";
import { getJobFilterOptions, listJobs, prisma } from "@autoapply/database";
import { jobFiltersSchema } from "@autoapply/shared";
import { requireUser } from "@/lib/auth";
import { ActionButton } from "@/components/action-button";
import { PageHeader } from "@/components/page-header";
import { applyToAllQualifiedAction } from "@/actions/jobs";
import { AddJobDialog } from "./add-job-dialog";
import { JobsTable } from "./jobs-table";
import { JobsToolbar } from "./jobs-toolbar";

export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const raw = await searchParams;
  const filters = jobFiltersSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const [data, options, qualifiedWaiting] = await Promise.all([
    listJobs(user.id, filters),
    getJobFilterOptions(user.id),
    prisma.job.count({ where: { userId: user.id, deletedAt: null, status: "QUALIFIED", application: null } }),
  ]);
  const hasFilters = ["q", "status", "platform", "remote", "minMatch", "company", "location", "minSalary", "savedFrom", "savedTo"].some((k) => raw[k]);

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Jobs"
        description="Every job you've saved, with its match and where it is in the pipeline."
        actions={
          <>
            <ActionButton variant="outline" size="sm" disabled={qualifiedWaiting === 0} action={applyToAllQualifiedAction}>
              Apply to all qualified ({qualifiedWaiting})
            </ActionButton>
            <AddJobDialog />
          </>
        }
      />
      <JobsToolbar companies={options.companies} platforms={options.platforms} />
      <JobsTable data={data} hasFilters={hasFilters} />
    </div>
  );
}
