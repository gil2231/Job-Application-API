import type { Metadata } from "next";
import { listApplications } from "@autoapply/database";
import { applicationFiltersSchema } from "@autoapply/shared";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { ApplicationsView } from "./applications-view";

export const metadata: Metadata = { title: "Applications" };

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const raw = await searchParams;
  const filters = applicationFiltersSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const data = await listApplications(user.id, filters);
  return (
    <div className="grid gap-5">
      <PageHeader title="Applications" description="Every application Applyance has queued, is working on, or has finished." />
      <ApplicationsView data={data} />
    </div>
  );
}
