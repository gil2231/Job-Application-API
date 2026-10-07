import { z } from "zod";

/**
 * Live CAPTCHA solving: while an application waits on a CAPTCHA, the worker
 * keeps the real page open and streams it to the CAPTCHA screen in the app.
 * The person's clicks and keystrokes go back to that same page. Nothing here
 * solves a CAPTCHA, calls a solving service or moves tokens between pages:
 * the person solves the real check on the real site.
 */

/** Pub/sub channel carrying one user's live frames and "window closed" notices. */
export const liveSolveChannel = (userId: string) => `autoapply:live-solve:${userId}`;
/** Pub/sub channel the web app publishes the person's input on; every worker listens. */
export const LIVE_SOLVE_INPUT_CHANNEL = "autoapply:live-solve:input";
/** Latest frame of one live window (JSON LiveSolveFrame, expires so a dead worker's window disappears). */
export const liveSolveFrameKey = (applicationId: string) => `autoapply:live-solve:frame:${applicationId}`;
export const LIVE_SOLVE_FRAME_TTL_SECONDS = 30;

export interface LiveSolveFrame {
  applicationId: string;
  userId: string;
  company: string;
  title: string;
  /** Host of the page shown, so the person can see which site they are on. */
  host: string;
  /** JPEG, base64. */
  data: string;
  /** Size of the page's viewport in CSS pixels; input coordinates use the same space. */
  width: number;
  height: number;
  /** When the window closes if nobody solves it (ISO). */
  expiresAt: string;
  at: string;
}

export type LiveSolveEnd = "solved" | "timed_out" | "stopped";

export type LiveSolveEvent =
  | { type: "frame"; frame: LiveSolveFrame }
  | { type: "ended"; applicationId: string; outcome: LiveSolveEnd };

/** Keys the person may press besides typing text. */
export const LIVE_SOLVE_KEYS = [
  "Enter", "Tab", "Backspace", "Delete", "Escape", "Space",
  "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown",
] as const;

const coord = z.number().finite().min(0).max(10_000);

export const liveSolveInputSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("mouse"), action: z.enum(["down", "up", "move"]), x: coord, y: coord }),
  z.object({ type: z.literal("wheel"), x: coord, y: coord, deltaX: z.number().finite().min(-2000).max(2000), deltaY: z.number().finite().min(-2000).max(2000) }),
  z.object({ type: z.literal("text"), text: z.string().min(1).max(500) }),
  z.object({ type: z.literal("key"), key: z.enum(LIVE_SOLVE_KEYS), shift: z.boolean().optional() }),
]);
export type LiveSolveInput = z.infer<typeof liveSolveInputSchema>;

export interface LiveSolveInputMessage {
  applicationId: string;
  userId: string;
  input: LiveSolveInput;
}

/** Parse an input message from Redis; anything malformed is dropped. */
export function parseLiveSolveInputMessage(raw: string): LiveSolveInputMessage | null {
  try {
    const value = JSON.parse(raw) as Partial<LiveSolveInputMessage>;
    if (typeof value.applicationId !== "string" || typeof value.userId !== "string") return null;
    const input = liveSolveInputSchema.safeParse(value.input);
    return input.success ? { applicationId: value.applicationId, userId: value.userId, input: input.data } : null;
  } catch {
    return null;
  }
}
