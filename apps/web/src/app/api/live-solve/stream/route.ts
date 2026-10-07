import Redis from "ioredis";
import { liveSolveChannel, type LiveSolveEvent } from "@autoapply/shared";
import { getSession } from "@/lib/auth";
import { getLiveFrames } from "@/lib/live-solve";

export const dynamic = "force-dynamic";

const MAX_LIFETIME_MS = 5 * 60_000;
const KEEP_ALIVE_MS = 15_000;

/**
 * Server-sent events for the CAPTCHA screen: the current frame of each live
 * window first, then new frames and "window closed" notices as the worker
 * publishes them. Closes after a few minutes; the browser reconnects and the
 * session is checked again.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const userId = session.user.id;
  const url = process.env.REDIS_URL;
  if (!url) return new Response("Live windows need Redis", { status: 503 });

  const encoder = new TextEncoder();
  let subscriber: Redis | null = null;
  let timers: ReturnType<typeof setTimeout>[] = [];
  let closed = false;
  const cleanup = () => {
    closed = true;
    for (const t of timers) clearTimeout(t);
    timers = [];
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
      const event = (e: LiveSolveEvent) => send(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
      request.signal.addEventListener("abort", close, { once: true });
      send("retry: 3000\n\n");

      const sub = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 1500, enableOfflineQueue: false, retryStrategy: () => null });
      sub.on("error", () => undefined);
      try {
        await sub.connect();
        await sub.subscribe(liveSolveChannel(userId));
      } catch {
        sub.disconnect();
        return close();
      }
      if (closed) return sub.disconnect();
      subscriber = sub;
      sub.on("message", (_channel, message) => send(`event: ${(JSON.parse(message) as LiveSolveEvent).type}\ndata: ${message}\n\n`));
      for (const frame of await getLiveFrames(userId)) event({ type: "frame", frame });
      send("event: ready\ndata: {}\n\n");

      const keepAlive = () => {
        send(": keep-alive\n\n");
        timers.push(setTimeout(keepAlive, KEEP_ALIVE_MS));
      };
      timers.push(setTimeout(keepAlive, KEEP_ALIVE_MS));
      timers.push(setTimeout(close, MAX_LIFETIME_MS));
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
