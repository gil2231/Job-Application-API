import type { Metadata } from "next";
import { getAutomationRule } from "@autoapply/database";
import { requireUser } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { RulesForm } from "./rules-form";

export const metadata: Metadata = { title: "Rules" };

export default async function RulesPage() {
  const user = await requireUser();
  const rule = await getAutomationRule(user.id);
  return (
    <div className="grid gap-5">
      <PageHeader title="Rules" description="Decide which jobs qualify, how they're scored, and when AutoApply may submit on its own." />
      <RulesForm rule={rule} />
    </div>
  );
}
