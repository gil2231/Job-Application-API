import type { Metadata } from "next";
import { getJobFilterOptions, getSavedBoardSearch, getSearchPreferences, listJobs, listRecommendationCandidates, prisma } from "@autoapply/database";
import { rankRecommendations } from "@autoapply/matching";
import { jobFiltersSchema, parsePreferences } from "@autoapply/shared";
import { formatSalary } from "@/lib/format";
import { requireUser } from "@/lib/auth";
import { ActionButton } from "@/components/action-button";
import { PageHeader } from "@/components/page-header";
import { analyzePendingAction } from "@/actions/ingestion";
import { applyToAllQualifiedAction } from "@/actions/jobs";
import { Loader2 } from "lucide-react";
import { AddJobDialog } from "./add-job-dialog";
import { BoardSearchDialog } from "./board-search-dialog";
import { ImportDialog } from "./import-dialog";
import { JobFinder } from "./job-finder";
import type { RecommendedRow } from "./recommended-list";
import { JobsTable } from "./jobs-table";
import { JobsToolbar } from "./jobs-toolbar";

export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const raw = await searchParams;
  const filters = jobFiltersSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const [data, options, qualifiedWaiting, analyzing, savedBoardSearch, preferences, candidates] = await Promise.all([
    listJobs(user.id, filters),
    getJobFilterOptions(user.id),
    prisma.job.count({ where: { userId: user.id, deletedAt: null, status: "QUALIFIED", application: null } }),
    prisma.job.count({ where: { userId: user.id, deletedAt: null, status: { in: ["IMPORTED", "ANALYZING"] } } }),
    getSavedBoardSearch(user.id),
    getSearchPreferences(user.id),
    listRecommendationCandidates(user.id),
  ]);
  const saved: RecommendedRow[] = rankRecommendations(candidates, parsePreferences(preferences.text), 5).map((r) => ({
    id: r.job.id,
    title: r.job.title,
    company: r.job.company,
    location: r.job.location,
    matchScore: r.job.matchScore,
    status: r.job.status,
    platform: r.job.platform,
    salary: r.job.salaryMin != null || r.job.salaryMax != null ? formatSalary(r.job) : null,
    relevance: r.relevance,
    titleKeywords: r.titleKeywords,
    descriptionKeywords: r.descriptionKeywords,
  }));
  const fakeSources = process.env.E2E_FAKE_JOB_SOURCES === "1";
  const searchesLinkedIn = !!process.env.JSEARCH_API_KEY?.trim() || fakeSources;
  const searchesAdzuna = !!(process.env.ADZUNA_APP_ID?.trim() && process.env.ADZUNA_APP_KEY?.trim()) || fakeSources;
  const hasFilters = ["q", "status", "platform", "remote", "minMatch", "company", "location", "minSalary", "savedFrom", "savedTo"].some((k) => raw[k]);

  // minmax(0, 1fr) keeps the wide table scrolling inside its container instead of widening the page.
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <PageHeader
        title="Jobs"
        description="Search every job site at once, see what's recommended for you, and track every job you've saved."
        actions={
          <>
            <ActionButton variant="outline" size="sm" disabled={qualifiedWaiting === 0} action={applyToAllQualifiedAction}>
              Apply to all qualified ({qualifiedWaiting})
            </ActionButton>
            <BoardSearchDialog saved={savedBoardSearch} label="Search specific boards" />
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
      <JobFinder preferences={preferences} saved={saved} searchesLinkedIn={searchesLinkedIn} searchesAdzuna={searchesAdzuna} />
      <h2 className="-mb-2 text-sm font-semibold">Your jobs</h2>
      <JobsToolbar companies={options.companies} platforms={options.platforms} />
      <JobsTable data={data} hasFilters={hasFilters} />
    </div>
  );
}
