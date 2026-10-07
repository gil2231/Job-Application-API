import { z } from "zod";
import { captureException } from "@autoapply/ops";
import { getRequestContext } from "@/lib/request";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const reportSchema = z.object({
  name: z.string().max(100).optional(),
  message: z.string().max(1000),
  stack: z.string().max(8000).optional(),
  digest: z.string().max(100).optional(),
  /** Route pattern-ish path; ids are stripped below. */
  path: z.string().max(300).optional(),
});

/** Receives crashes from the browser (the error pages) and forwards them, scrubbed, to error reporting. */
export async function POST(request: Request) {
  const { ipAddress } = await getRequestContext();
  if (!rateLimit(`client-errors:${ipAddress}`, 10, 60_000).allowed) return new Response(null, { status: 429 });
  const parsed = reportSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  const { name, message, stack, digest, path } = parsed.data;
  const error = new Error(message);
  error.name = name || "ClientError";
  error.stack = stack ? `${error.name}: ${message}\n${stack.split("\n").slice(1).join("\n")}` : undefined;
  captureException(error, {
    tags: { source: "browser", path: path?.split("?")[0]?.replace(/\/[a-z0-9]{20,}(?=\/|$)/gi, "/:id") },
    extra: digest ? { digest } : undefined,
  });
  return new Response(null, { status: 204 });
}
