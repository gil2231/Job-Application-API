import { unzipSync, strFromU8 } from "fflate";
import { validateUpload } from "./validation";

/** Longest resume text kept. Real resumes are a few thousand characters. */
export const MAX_RESUME_TEXT_CHARS = 60_000;
const MAX_PDF_PAGES = 15;

export type TextExtraction = { ok: true; text: string } | { ok: false; error: string };

/**
 * Read the text of a resume file (PDF, Word .docx or plain text) so it can be
 * turned into profile fields. The file is validated by its signature first.
 * Line breaks are kept, since resume sections are found line by line.
 */
export async function extractResumeText(fileName: string, body: Buffer): Promise<TextExtraction> {
  const check = validateUpload(fileName, body);
  if (!check.ok) return check;
  let text: string;
  try {
    if (check.extension === "pdf") text = await pdfText(body);
    else if (check.extension === "docx") text = docxText(body);
    else if (check.extension === "txt") text = body.toString("utf8");
    else if (check.extension === "doc") return { ok: false, error: "Older .doc files can't be read. Save it as a PDF or .docx and try again." };
    else return { ok: false, error: "Upload your resume as a PDF, Word (.docx) or text file" };
  } catch {
    return { ok: false, error: "This file couldn't be read. If it's password-protected or damaged, save a new copy and try again." };
  }
  text = normalizeText(text);
  if (text.replace(/\s/g, "").length < 40) {
    return {
      ok: false,
      error: "No text was found in this file. It may be a scanned image; upload a PDF or Word file with selectable text.",
    };
  }
  return { ok: true, text: text.slice(0, MAX_RESUME_TEXT_CHARS) };
}

export function normalizeText(text: string): string {
  return (
    text
      .replace(/\r\n?/g, "\n")
      // Ligatures and non-breaking spaces that PDF exports often use.
      .replace(/\ufb01/g, "fi")
      .replace(/\ufb02/g, "fl")
      .replace(/[\u00a0\u2007\u202f]/g, " ")
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "")
      .split("\n")
      .map((line) => line.replace(/[ \t]+/g, " ").trim())
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  hasEOL?: boolean;
}

/** PDF text rebuilt into lines from each text item's position on the page. */
async function pdfText(body: Buffer): Promise<string> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(body));
  const pages: string[] = [];
  try {
    for (let n = 1; n <= Math.min(pdf.numPages, MAX_PDF_PAGES); n++) {
      const page = await pdf.getPage(n);
      const content = await page.getTextContent();
      const items = (content.items as unknown[]).filter((i): i is PdfTextItem => typeof (i as PdfTextItem).str === "string");
      const lines: Array<{ y: number; parts: Array<{ x: number; end: number; str: string }> }> = [];
      for (const item of items) {
        // pdf.js adds whitespace items over gaps; the gap itself decides the separator.
        if (!item.str.trim()) continue;
        const x = item.transform[4] ?? 0;
        const y = item.transform[5] ?? 0;
        const height = Math.abs(item.transform[3] ?? 10) || 10;
        let line = lines.find((l) => Math.abs(l.y - y) < height * 0.5);
        if (!line) {
          line = { y, parts: [] };
          lines.push(line);
        }
        line.parts.push({ x, end: x + item.width, str: item.str });
      }
      lines.sort((a, b) => b.y - a.y);
      pages.push(
        lines
          .map((l) => {
            const parts = l.parts.sort((a, b) => a.x - b.x);
            let out = "";
            let prevEnd: number | null = null;
            for (const p of parts) {
              // A visible gap between runs is a space; a wide one separates columns.
              const gap = prevEnd == null ? 0 : p.x - prevEnd;
              if (prevEnd != null && gap > 30) out += " | ";
              else if (prevEnd != null && gap > 1 && !out.endsWith(" ") && !p.str.startsWith(" ")) out += " ";
              out += p.str;
              prevEnd = p.end;
            }
            return out;
          })
          .join("\n"),
      );
    }
  } finally {
    await pdf.cleanup();
  }
  return pages.join("\n\n");
}

const XML_ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const decodeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : XML_ENTITIES[e.toLowerCase()]!,
  );

/** Paragraph text from word/document.xml. List paragraphs get a bullet so they read as bullets. */
function docxText(body: Buffer): string {
  const files = unzipSync(new Uint8Array(body), { filter: (f) => f.name === "word/document.xml" });
  const xml = files["word/document.xml"];
  if (!xml) throw new Error("Not a Word document");
  const doc = strFromU8(xml);
  const paragraphs: string[] = [];
  for (const m of doc.matchAll(/<w:p[ >][\s\S]*?<\/w:p>/g)) {
    const p = m[0];
    let text = "";
    for (const t of p.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>/g)) {
      if (t[0] === "<w:tab/>") text += "\t";
      else if (t[0] === "<w:br/>") text += "\n";
      else text += decodeXml(t[1] ?? "");
    }
    const bullet = /<w:numPr>/.test(p) && text.trim() ? "• " : "";
    paragraphs.push(bullet + text.replace(/\t/g, " | "));
  }
  return paragraphs.join("\n");
}
