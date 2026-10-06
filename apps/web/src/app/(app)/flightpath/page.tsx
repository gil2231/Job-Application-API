import type { Metadata } from "next";
import { getTrackerBoard, listTrackerApplications } from "@autoapply/database";
import { trackerFiltersSchema } from "@autoapply/shared";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { FlightpathBoard } from "./board";
import { FlightpathTable } from "./table";
import { FlightpathToolbar } from "./toolbar";

export const metadata: Metadata = { title: "Flightpath" };

export default async function FlightpathPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const raw = await searchParams;
  const { view, ...filters } = trackerFiltersSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));

  return (
    <div className="grid min-w-0 gap-5">
      <PageHeader
        title="Flightpath"
        description="Every application from the queue to an offer. Drag a card to another stage, or use its menu. Stages after Submitted are yours to set."
      />
      <FlightpathToolbar view={view} />
      {view === "table" ? (
        <FlightpathTable data={await listTrackerApplications(user.id, filters)} />
      ) : (
        <FlightpathBoard board={await getTrackerBoard(user.id, { q: filters.q })} searching={!!filters.q} />
      )}
    </div>
  );
}
