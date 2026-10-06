import type { UserSettingsInput } from "@autoapply/shared";
import { prisma } from "../client";

export async function getUserSettings(userId: string) {
  return prisma.userSetting.upsert({ where: { userId }, update: {}, create: { userId } });
}
export type UserSettingsView = Awaited<ReturnType<typeof getUserSettings>>;

export async function saveUserSettings(userId: string, input: UserSettingsInput) {
  await prisma.userSetting.upsert({ where: { userId }, update: input, create: { userId, ...input } });
}

export type QueueCommand = "pause" | "resume" | "pause_after_current" | "stop";

/**
 * Queue controls. The worker reads queuePaused / pauseAfterCurrent before
 * claiming the next application. "stop" also returns in-flight applications
 * to the queue so nothing is left half-processed.
 */
export async function setQueueState(userId: string, command: QueueCommand) {
  await prisma.$transaction(async (tx) => {
    switch (command) {
      case "pause":
        await tx.userSetting.update({ where: { userId }, data: { queuePaused: true, pauseAfterCurrent: false } });
        break;
      case "pause_after_current":
        await tx.userSetting.update({ where: { userId }, data: { pauseAfterCurrent: true } });
        break;
      case "resume":
        await tx.userSetting.update({ where: { userId }, data: { queuePaused: false, pauseAfterCurrent: false } });
        break;
      case "stop": {
        await tx.userSetting.update({ where: { userId }, data: { queuePaused: true, pauseAfterCurrent: false } });
        const running = await tx.application.findMany({ where: { userId, status: "PROCESSING" }, select: { id: true } });
        if (running.length) {
          await tx.application.updateMany({ where: { id: { in: running.map((r) => r.id) } }, data: { status: "QUEUED" } });
          await tx.applicationEvent.createMany({
            data: running.map((r) => ({ applicationId: r.id, userId, type: "STATUS_CHANGED" as const, level: "WARNING" as const, message: "Stopped by user; returned to queue" })),
          });
        }
        break;
      }
    }
  });
}
