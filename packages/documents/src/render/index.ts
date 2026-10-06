import type { CoverLetterContent, ResumeContent } from "@autoapply/shared";
import { renderCoverLetterDocx, renderResumeDocx } from "./docx";
import { renderCoverLetterPdf, renderResumePdf } from "./pdf";

export { renderCoverLetterDocx, renderResumeDocx } from "./docx";
export { renderCoverLetterPdf, renderResumePdf } from "./pdf";

export const EXPORT_FORMATS = ["pdf", "docx"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export const EXPORT_MIME: Record<ExportFormat, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const slug = (s: string) => s.normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/[\s_]+/g, "-").toLowerCase().slice(0, 60) || "document";

/** "jordan-rivera-resume-acme.pdf" */
export function generatedFileName(kind: "resume" | "cover-letter", content: { header: { name: string }; job: { company: string } }, format: ExportFormat): string {
  return `${slug(content.header.name)}-${kind}-${slug(content.job.company)}.${format}`;
}

export async function renderResume(content: ResumeContent, format: ExportFormat): Promise<Uint8Array> {
  return format === "pdf" ? renderResumePdf(content) : new Uint8Array(await renderResumeDocx(content));
}

export async function renderCoverLetter(content: CoverLetterContent, format: ExportFormat, date?: Date): Promise<Uint8Array> {
  return format === "pdf" ? renderCoverLetterPdf(content, date) : new Uint8Array(await renderCoverLetterDocx(content, date));
}
