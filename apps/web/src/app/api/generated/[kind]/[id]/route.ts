import { getGenerated, NotFoundError, type GeneratedKind } from "@autoapply/database";
import { EXPORT_FORMATS, EXPORT_MIME, generatedFileName, renderCoverLetter, renderResume, type ExportFormat } from "@autoapply/documents";
import { getSession } from "@/lib/auth";
import { createLogger } from "@autoapply/shared";

const log = createLogger("generated");

export const dynamic = "force-dynamic";

const KINDS: Record<string, GeneratedKind> = { resume: "resume", "cover-letter": "coverLetter" };

/** Render a generated resume or cover letter as PDF or DOCX for its owner, draft or approved. */
export async function GET(request: Request, { params }: { params: Promise<{ kind: string; id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });
  const { kind: slug, id } = await params;
  const kind = KINDS[slug];
  const url = new URL(request.url);
  const format = (url.searchParams.get("format") ?? "pdf") as ExportFormat;
  if (!kind || !/^[a-z0-9]{20,40}$/i.test(id) || !EXPORT_FORMATS.includes(format)) return new Response("Not found", { status: 404 });
  try {
    const doc = await getGenerated(session.user.id, kind, id);
    const body = doc.kind === "resume" ? await renderResume(doc.content, format) : await renderCoverLetter(doc.content, format);
    const inline = url.searchParams.get("inline") === "1" && format === "pdf";
    const fileName = generatedFileName(slug === "resume" ? "resume" : "cover-letter", doc.content, format);
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": EXPORT_MIME[format],
        "Content-Length": String(body.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof NotFoundError) return new Response("Not found", { status: 404 });
    log.error("Rendering a generated document failed", { error });
    return new Response("Could not render the document", { status: 500 });
  }
}
