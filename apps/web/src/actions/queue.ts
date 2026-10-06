"use server";

import { revalidatePath } from "next/cache";
import { audit, setQueueState, type QueueCommand } from "@autoapply/database";
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
