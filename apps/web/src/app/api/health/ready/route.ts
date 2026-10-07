import { prisma } from "@autoapply/database";
import { backupHealthChecks, runHealthChecks } from "@autoapply/ops";
import { getWorkerStatus } from "@/lib/worker-status";

export const dynamic = "force-dynamic";

/**
 * Readiness for uptime monitoring: the database, Redis, a running worker,
 * a recent backup and a passing restore test. Returns 503 if any of them is
 * failing, so one monitor on this URL covers the whole service. Components
 * that aren't set up report "off" and don't fail the check.
 */
export async function GET() {
  const worker = getWorkerStatus();
  const backups = backupHealthChecks();
  const report = await runHealthChecks({
    database: async () => {
      await prisma.$queryRaw`SELECT 1`;
      return { state: "ok" };
    },
    redis: async () => ((await worker).state === "unreachable" ? { state: "fail" } : { state: "ok" }),
    worker: async () => {
      const status = await worker;
      if (status.state === "online") return { state: "ok", note: `${status.heartbeat.activeJobs} running` };
      return { state: "fail", note: status.state === "offline" ? "no worker running" : "can't check" };
    },
    backups: async () => (await backups).backups,
    restoreTest: async () => (await backups).restoreTest,
  });
  return Response.json(report, { status: report.status === "ok" ? 200 : 503, headers: { "cache-control": "no-store" } });
}
