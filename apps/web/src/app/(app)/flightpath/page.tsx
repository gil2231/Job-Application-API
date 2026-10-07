import type { Metadata } from "next";
import Link from "next/link";
import { countEmailsToReview, getTrackerBoard, listMailConnections, listTrackerApplications } from "@autoapply/database";
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

  const [mail, toReview] = await Promise.all([listMailConnections(user.id), countEmailsToReview(user.id)]);
  const reading = mail.filter((c) => c.readEmail && c.status === "ACTIVE");

  return (
    <div className="grid min-w-0 gap-5">
      <PageHeader
        title="Flightpath"
        description={
          <>
            Every application from the queue to an offer. Drag a card to another stage, or use its menu.{" "}
            {reading.length ? (
              <>
                Replies in {reading.map((c) => (c.provider === "GOOGLE" ? "Gmail" : "Outlook")).join(" and ")} move cards too.{" "}
                <Link href={toReview ? "/integrations/email?filter=review" : "/integrations/email"} className="text-primary hover:underline" data-testid="email-activity-link">
                  {toReview ? `${toReview} email${toReview === 1 ? "" : "s"} to match` : "Email activity"}
                </Link>
              </>
            ) : (
              <>
                Stages after Submitted are yours to set, or{" "}
                <Link href="/integrations" className="text-primary hover:underline">
                  connect your email
                </Link>{" "}
                to update them from replies.
              </>
            )}
          </>
        }
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
