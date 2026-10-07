import { prisma } from "@autoapply/database";
import { ATTENTION_APPLICATION_STATUSES } from "@autoapply/shared";
import { requireUser } from "@/lib/auth";
import { LiveUpdatesProvider } from "@/components/shell/live-updates";
import { MobileNav, Sidebar } from "@/components/shell/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const [attentionCount, active, settings] = await Promise.all([
    prisma.application.count({ where: { userId: user.id, status: { in: [...ATTENTION_APPLICATION_STATUSES] } } }),
    prisma.application.count({ where: { userId: user.id, status: { in: ["QUEUED", "PROCESSING"] } } }),
    prisma.userSetting.findUnique({ where: { userId: user.id }, select: { queuePaused: true } }),
  ]);
  const run = { paused: settings?.queuePaused ?? false, active };
  return (
    <LiveUpdatesProvider>
      <div className="flex min-h-screen">
        <Sidebar user={user} attentionCount={attentionCount} run={run} />
        <div className="flex min-w-0 flex-1 flex-col">
          <MobileNav user={user} attentionCount={attentionCount} run={run} />
          <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 pt-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-8 sm:pt-8 md:pb-8">{children}</main>
        </div>
      </div>
    </LiveUpdatesProvider>
  );
}
