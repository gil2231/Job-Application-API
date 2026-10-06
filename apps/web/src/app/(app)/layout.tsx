import { prisma } from "@autoapply/database";
import { ATTENTION_APPLICATION_STATUSES } from "@autoapply/shared";
import { requireUser } from "@/lib/auth";
import { LiveUpdates } from "@/components/shell/live-updates";
import { MobileNav, Sidebar } from "@/components/shell/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const attentionCount = await prisma.application.count({
    where: { userId: user.id, status: { in: [...ATTENTION_APPLICATION_STATUSES] } },
  });
  return (
    <div className="flex min-h-screen">
      <Sidebar user={user} attentionCount={attentionCount} />
      <div className="flex min-w-0 flex-1 flex-col">
        <MobileNav user={user} attentionCount={attentionCount} />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 sm:px-8 sm:py-8">{children}</main>
      </div>
      <LiveUpdates />
    </div>
  );
}
