import { getDocument, NotFoundError } from "@autoapply/database";
import { getStorage } from "@autoapply/documents";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Stream a document to its owner. Other users get a 404, never a 403, so ids don't leak. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  try {
    const doc = await getDocument(session.user.id, id);
    const body = await getStorage().get(doc.storageKey);
    const inline = new URL(request.url).searchParams.get("inline") === "1" && doc.mimeType === "application/pdf";
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Length": String(body.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return new Response("Not found", { status: 404 });
    console.error("[documents] download failed", error);
    return new Response("Could not read the file", { status: 500 });
  }
}
