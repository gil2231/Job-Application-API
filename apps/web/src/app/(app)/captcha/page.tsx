import type { Metadata } from "next";
import { prisma } from "@autoapply/database";
import { requireUser } from "@/lib/auth";
import { getLiveFrames } from "@/lib/live-solve";
import { getWorkerStatus } from "@/lib/worker-status";
import { PageHeader } from "@/components/page-header";
import { SolveGrid } from "./solve-grid";

export const metadata: Metadata = { title: "Solve CAPTCHAs" };

export default async function CaptchaPage() {
  const user = await requireUser();
  const [frames, waiting, worker, rule] = await Promise.all([
    getLiveFrames(user.id),
    // Paused on a CAPTCHA with no page held open: a fresh run opens a live window.
    prisma.application.findMany({
      where: { userId: user.id, attentionReason: "CAPTCHA", status: "WAITING_FOR_USER", lockedBy: null },
      orderBy: [{ priority: "desc" }, { updatedAt: "asc" }],
      select: { id: true, updatedAt: true, job: { select: { title: true, company: true } } },
      take: 50,
    }),
    getWorkerStatus(),
    prisma.automationRule.findUnique({ where: { userId: user.id }, select: { maxConcurrentApplications: true } }),
  ]);
  const liveAvailable = worker.state === "online" && worker.heartbeat.liveSolve === true;

  return (
    <div className="grid gap-5">
      <PageHeader
        title="Solve CAPTCHAs"
        description="Each application stopped by a CAPTCHA shows up here as a live window of the real page. Click and type in it to solve the check yourself, and the application carries on automatically."
      />
      <SolveGrid
        initialFrames={frames}
        waiting={waiting.map((a) => ({ id: a.id, company: a.job.company, title: a.job.title, updatedAt: a.updatedAt.toISOString() }))}
        maxWindows={rule?.maxConcurrentApplications ?? 1}
        workerState={worker.state === "online" ? (liveAvailable ? "live" : "no-live") : "offline"}
      />
    </div>
  );
}
