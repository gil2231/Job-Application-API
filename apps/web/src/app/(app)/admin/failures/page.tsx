import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { ADMIN_PAGE_SIZE, listAdminFailures } from "@autoapply/database";
import { adminFailureFiltersSchema } from "@autoapply/shared";
import { requireAdmin } from "@/lib/auth";
import { Pagination } from "@/components/data-table";
import { EmptyState } from "@/components/page-header";
import { FailureList } from "../failure-list";
import { FailureFilters } from "./failure-filters";

export const metadata: Metadata = { title: "Failing applications · Admin" };

export default async function AdminFailuresPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const raw = await searchParams;
  const filters = adminFailureFiltersSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const data = await listAdminFailures(filters);
  return (
    <div className="grid gap-4">
      <FailureFilters total={data.total} />
      {data.total === 0 ? (
        <div className="rounded-xl border">
          <EmptyState icon={CheckCircle2} title="Nothing failing here" description="No applications match these filters." />
        </div>
      ) : (
        <>
          <div className="bg-card rounded-xl border p-4">
            <FailureList items={data.items} />
          </div>
          <Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={ADMIN_PAGE_SIZE} />
        </>
      )}
    </div>
  );
}
