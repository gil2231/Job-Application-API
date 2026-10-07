import { liveSolveInputSchema } from "@autoapply/shared";
import { getSession } from "@/lib/auth";
import { sendLiveInput } from "@/lib/live-solve";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** A click, scroll or keystroke on a live CAPTCHA window, passed to the real page. */
export async function POST(request: Request, { params }: { params: Promise<{ applicationId: string }> }) {
  const session = await getSession();
  if (!session) return new Response(null, { status: 401 });
  // Only this app's own pages may drive a live window.
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin && origin !== process.env.APP_URL?.replace(/\/$/, "")) return new Response(null, { status: 403 });
  const userId = session.user.id;
  if (!(await rateLimit(`live-solve:${userId}`, 600, 60_000)).allowed) return new Response(null, { status: 429 });
  const { applicationId } = await params;
  if (!/^[a-z0-9]{10,40}$/i.test(applicationId)) return new Response(null, { status: 404 });
  const parsed = liveSolveInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new Response(null, { status: 400 });
  const result = await sendLiveInput(userId, applicationId, parsed.data);
  if (result === "not_found") return new Response(null, { status: 404 });
  if (result === "unavailable") return new Response(null, { status: 503 });
  return new Response(null, { status: 204 });
}
