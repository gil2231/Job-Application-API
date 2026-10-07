"use server";

import { revalidatePath } from "next/cache";
import { audit, prisma, queueAllQualified, setQueueState, type QueueCommand } from "@autoapply/database";
import { authedAction, type ActionResult } from "@/lib/action";
import { notifyWorker, stopWorker } from "@/lib/worker-queue";

const COMMANDS: QueueCommand[] = ["pause", "resume", "pause_after_current", "stop"];
const MESSAGES: Record<QueueCommand, string> = {
  pause: "Queue paused. No new applications will start.",
  resume: "Queue resumed.",
  pause_after_current: "The queue will pause after the current application finishes.",
  stop: "Stopped. Running applications were returned to the queue and the queue is paused.",
};

export async function queueControlAction(command: QueueCommand): Promise<ActionResult> {
  return authedAction(async (user) => {
    if (!COMMANDS.includes(command)) return { ok: false, message: "Unknown command" };
    await setQueueState(user.id, command);
    if (command === "stop") await stopWorker(user.id);
    if (command === "resume") await notifyWorker(user.id);
    await audit(user.id, `queue.${command}`);
    revalidatePath("/", "layout");
    return { ok: true, message: MESSAGES[command] };
  });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * The Tasks page's Start button: un-pauses the queue so the worker picks up
 * queued applications. When nothing is queued it first adds the qualified jobs
 * (queueAllQualified), which keeps every safety rule: the user's default mode,
 * Review unless auto-submit is on, and the daily and concurrency limits.
 */
export async function startRunAction(): Promise<ActionResult> {
  return authedAction(async (user) => {
    const waiting = await prisma.application.count({ where: { userId: user.id, status: { in: ["QUEUED", "PROCESSING"] } } });
    let added: Awaited<ReturnType<typeof queueAllQualified>> | null = null;
    if (waiting === 0) {
      added = await queueAllQualified(user.id);
      if (added.queued === 0) return { ok: false, message: "Nothing to run yet. Choose Apply on jobs (or let jobs qualify) to add tasks." };
    }
    await setQueueState(user.id, "resume");
    await notifyWorker(user.id);
    await audit(user.id, "queue.start", { metadata: added ? { queued: added.queued, mode: added.mode } : { waiting } });
    revalidatePath("/", "layout");
    if (added) return { ok: true, message: `Started. ${plural(added.queued, "qualified job")} added in ${added.mode.toLowerCase()} mode.` };
    return { ok: true, message: `Started. Running ${plural(waiting, "task")}.` };
  });
}
