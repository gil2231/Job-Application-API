import { getStorage } from "@autoapply/documents";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/**
 * Serve worker artifacts (screenshots) by storage key. Keys are namespaced by
 * user id, so a user can only ever read keys under their own prefix.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const key = new URL(request.url).searchParams.get("key") ?? "";
  const prefix = `users/${session.user.id}/screenshots/`;
  if (!key.startsWith(prefix) || key.includes("..")) return new Response("Not found", { status: 404 });
  const type = TYPES[key.split(".").pop()?.toLowerCase() ?? ""];
  if (!type) return new Response("Not found", { status: 404 });
  try {
    const body = await getStorage().get(key);
    return new Response(new Uint8Array(body), { headers: { "Content-Type": type, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
