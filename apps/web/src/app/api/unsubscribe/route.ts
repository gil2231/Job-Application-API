import { audit, unsubscribeUser } from "@autoapply/database";
import { verifyUnsubscribeToken } from "@autoapply/notifications";

export const dynamic = "force-dynamic";

/**
 * One-click unsubscribe (RFC 8058): mail apps POST here when the person
 * presses their own Unsubscribe button. The signed token turns off one kind of
 * email for one account and does nothing else.
 */
export async function POST(request: Request) {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  const verified = verifyUnsubscribeToken(token);
  if (!verified) return Response.json({ error: "Invalid link" }, { status: 400 });
  await unsubscribeUser(verified.userId, verified.kind);
  await audit(verified.userId, "settings.unsubscribed", { metadata: { kind: verified.kind, via: "one_click" } });
  return Response.json({ ok: true });
}
