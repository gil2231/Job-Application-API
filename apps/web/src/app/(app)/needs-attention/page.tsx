import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { listAttentionItems } from "@autoapply/database";
import { requireUser } from "@/lib/auth";
import { EmptyState, PageHeader } from "@/components/page-header";
import { AttentionCard } from "./attention-card";

export const metadata: Metadata = { title: "Needs Attention" };

export default async function NeedsAttentionPage() {
  const user = await requireUser();
  const items = await listAttentionItems(user.id);
  return (
    <div className="grid gap-5">
      <PageHeader
        title="Needs Attention"
        description="Steps only you can do: CAPTCHAs, sign-ins, and answers Applyance isn't confident about. Once you finish, the application resumes."
      />
      {items.length === 0 ? (
        <div className="rounded-xl border">
          <EmptyState icon={CheckCircle2} title="Nothing needs you right now" description="When an application hits a CAPTCHA, sign-in, or a question it can't answer from your profile, it pauses here." />
        </div>
      ) : (
        <div className="grid gap-4">
          {items.map((item) => (
            <AttentionCard key={item.id} item={item} />
          ))}
        </div>
      )}
    </div>
  );
}
