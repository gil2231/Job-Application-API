import { getChangeFingerprint } from "@autoapply/database";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const POLL_MS = 3000;
const MAX_LIFETIME_MS = 5 * 60_000;

/**
 * Server-sent events: emits a fingerprint of the user's pipeline state every
 * few seconds. The client refreshes when it changes. The stream closes after a
 * few minutes and the browser reconnects, re-checking the session each time.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const userId = session.user.id;
  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | undefined;

  const stream = new ReadableStream({
    async start(controller) {
      const started = Date.now();
      let last = "";
      const tick = async () => {
        try {
          if (request.signal.aborted || Date.now() - started > MAX_LIFETIME_MS) {
            clearInterval(timer);
            controller.close();
            return;
          }
          const fingerprint = await getChangeFingerprint(userId);
          if (fingerprint !== last) {
            last = fingerprint;
            controller.enqueue(encoder.encode(`event: change\ndata: ${fingerprint}\n\n`));
          } else {
            controller.enqueue(encoder.encode(`: keep-alive\n\n`));
          }
        } catch {
          clearInterval(timer);
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      };
      controller.enqueue(encoder.encode("retry: 5000\n\n"));
      await tick();
      timer = setInterval(tick, POLL_MS);
    },
    cancel() {
      clearInterval(timer);
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" },
  });
}
