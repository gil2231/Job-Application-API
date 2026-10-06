import type { Metadata } from "next";
import { getAutomationRule, prisma } from "@autoapply/database";
import { requireUser } from "@/lib/auth";
import { rescoreJobsAction } from "@/actions/ingestion";
import { ActionButton } from "@/components/action-button";
import { PageHeader } from "@/components/page-header";
import { RulesForm } from "./rules-form";

export const metadata: Metadata = { title: "Rules" };

export default async function RulesPage() {
  const user = await requireUser();
  const [rule, counts] = await Promise.all([
    getAutomationRule(user.id),
    prisma.job.groupBy({
      by: ["status"],
      where: { userId: user.id, deletedAt: null, application: null, status: { in: ["QUALIFIED", "NOT_QUALIFIED", "NEEDS_DETAILS"] } },
      _count: { _all: true },
    }),
  ]);
  const count = (status: string) => counts.find((c) => c.status === status)?._count._all ?? 0;
  const total = count("QUALIFIED") + count("NOT_QUALIFIED") + count("NEEDS_DETAILS");
  return (
    <div className="grid gap-5">
      <PageHeader
        title="Rules"
        description="Decide which jobs qualify, how they're scored, and when AutoApply may submit on its own."
        actions={
          <ActionButton size="sm" variant="outline" action={rescoreJobsAction} disabled={total === 0}>
            Re-score jobs
          </ActionButton>
        }
      />
      {total > 0 && (
        <p className="text-muted-foreground text-sm" data-testid="rules-summary">
          Of {total} job{total === 1 ? "" : "s"} waiting to be applied to, <span className="text-foreground font-medium">{count("QUALIFIED")} qualify</span>,{" "}
          {count("NOT_QUALIFIED")} don&apos;t, and {count("NEEDS_DETAILS")} need a description. Saving re-checks them all.
        </p>
      )}
      <RulesForm rule={rule} />
    </div>
  );
}
