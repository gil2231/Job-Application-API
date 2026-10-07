import type { Metadata } from "next";
import { getDailyUsage, getTaskBoard } from "@autoapply/database";
import { requireUser } from "@/lib/auth";
import { getWorkerStatus } from "@/lib/worker-status";
import { PageHeader } from "@/components/page-header";
import { ActivityLog } from "./activity-log";
import { ControlDeck } from "./control-deck";
import { TaskList } from "./task-list";

export const metadata: Metadata = { title: "Tasks" };

export default async function TasksPage() {
  const user = await requireUser();
  const [board, worker, usage] = await Promise.all([getTaskBoard(user.id), getWorkerStatus(), getDailyUsage(user.id)]);
  return (
    <div className="grid gap-5">
      <PageHeader
        title="Tasks"
        description="Every application is a task. Press Start and Applyance works through the queue, stopping for you at anything only a person should do."
      />
      <ControlDeck
        run={board.run}
        counts={board.counts}
        qualifiedWaiting={board.qualifiedWaiting}
        usage={usage}
        worker={worker.state === "online" ? { state: "online", interactive: worker.heartbeat.interactive ?? false } : { state: worker.state }}
      />
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <TaskList tasks={board.tasks} />
        <ActivityLog events={board.events} />
      </div>
    </div>
  );
}
