import "server-only";
import { prisma } from "@autoapply/database";
import { LIVE_SOLVE_INPUT_CHANNEL, liveSolveFrameKey, type LiveSolveFrame, type LiveSolveInput, type LiveSolveInputMessage } from "@autoapply/shared";
import { getRedis } from "./redis";

/** Applications a worker is holding open on a CAPTCHA for this user. */
function heldCaptchas(userId: string) {
  return prisma.application.findMany({
    where: { userId, attentionReason: "CAPTCHA", status: { in: ["WAITING_FOR_USER", "QUEUED"] }, lockedBy: { not: null } },
    select: { id: true },
    take: 50,
  });
}

/** The latest frame of every live CAPTCHA window this user has. */
export async function getLiveFrames(userId: string): Promise<LiveSolveFrame[]> {
  const held = await heldCaptchas(userId);
  if (!held.length) return [];
  try {
    const redis = await getRedis();
    if (!redis) return [];
    const raw = await redis.mget(held.map((a) => liveSolveFrameKey(a.id)));
    return raw.flatMap((r) => {
      if (!r) return [];
      const frame = JSON.parse(r) as LiveSolveFrame;
      return frame.userId === userId ? [frame] : [];
    });
  } catch {
    return [];
  }
}

/** Short cache so a burst of mouse moves doesn't hit the database each time. */
const owned = new Map<string, number>();

async function ownsLiveWindow(userId: string, applicationId: string) {
  const key = `${userId}:${applicationId}`;
  const until = owned.get(key);
  if (until && until > Date.now()) return true;
  const app = await prisma.application.findFirst({
    where: { id: applicationId, userId, attentionReason: "CAPTCHA", status: { in: ["WAITING_FOR_USER", "QUEUED"] }, lockedBy: { not: null } },
    select: { id: true },
  });
  if (!app) {
    owned.delete(key);
    return false;
  }
  if (owned.size > 1000) owned.clear();
  owned.set(key, Date.now() + 5000);
  return true;
}

/** Send the person's click or keystroke to the worker holding the page. */
export async function sendLiveInput(userId: string, applicationId: string, input: LiveSolveInput): Promise<"sent" | "not_found" | "unavailable"> {
  if (!(await ownsLiveWindow(userId, applicationId))) return "not_found";
  try {
    const redis = await getRedis();
    if (!redis) return "unavailable";
    const message: LiveSolveInputMessage = { applicationId, userId, input };
    await redis.publish(LIVE_SOLVE_INPUT_CHANNEL, JSON.stringify(message));
    return "sent";
  } catch {
    return "unavailable";
  }
}
