import Redis from "ioredis";
import { getChangeFingerprint, prisma } from "@autoapply/database";
import { progressChannel, progressKey } from "@autoapply/shared";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const POLL_MS = 3000;
const MAX_LIFETIME_MS = 5 * 60_000;

/**
 * Server-sent events for the signed-in user:
 * - "change": a fingerprint of their pipeline state, polled every few seconds;
 *   the client refreshes server components when it changes.
 * - "progress": live step-by-step progress from the worker ("✓ Profile
 *   loaded … ● Validating"), relayed from Redis pub/sub as it happens.
 * The stream closes after a few minutes and the browser reconnects,
 * re-checking the session each time.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const userId = session.user.id;
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;
  let subscriber: Redis | null = null;
  let closed = false;

  const cleanup = () => {
    closed = true;
    clearInterval(timer);
    subscriber?.disconnect();
    subscriber = null;
  };

  const stream = new ReadableStream({
    async start(controller) {
      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const close = () => {
        cleanup();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const started = Date.now();
      let last = "";
      const tick = async () => {
        try {
          if (request.signal.aborted || Date.now() - started > MAX_LIFETIME_MS) return close();
          const fingerprint = await getChangeFingerprint(userId);
          if (fingerprint !== last) {
            last = fingerprint;
            send(`event: change\ndata: ${fingerprint}\n\n`);
          } else {
            send(`: keep-alive\n\n`);
          }
        } catch {
          close();
        }
      };
      send("retry: 5000\n\n");
      request.signal.addEventListener("abort", close, { once: true });
      await tick();
      timer = setInterval(tick, POLL_MS);
      await relayProgress(userId, send).then((s) => {
        if (closed) s?.disconnect();
        else subscriber = s;
      });
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}

/** Send the latest progress of applications a worker holds, then forward new progress as it's published. */
async function relayProgress(userId: string, send: (chunk: string) => void): Promise<Redis | null> {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  const subscriber = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1500, enableOfflineQueue: false, retryStrategy: () => null });
  subscriber.on("error", () => undefined);
  try {
    await subscriber.connect();
    await subscriber.subscribe(progressChannel(userId));
    subscriber.on("message", (_channel, message) => send(`event: progress\ndata: ${message.replace(/\n/g, " ")}\n\n`));
    const held = await prisma.application.findMany({ where: { userId, lockedBy: { not: null } }, select: { id: true }, take: 20 });
    if (held.length) {
      const reader = subscriber.duplicate({ lazyConnect: true, enableOfflineQueue: false });
      reader.on("error", () => undefined);
      try {
        await reader.connect();
        const snapshots = await reader.mget(held.map((a) => progressKey(a.id)));
        for (const s of snapshots) if (s) send(`event: progress\ndata: ${s.replace(/\n/g, " ")}\n\n`);
      } finally {
        reader.disconnect();
      }
    }
    return subscriber;
  } catch {
    subscriber.disconnect();
    return null;
  }
}
