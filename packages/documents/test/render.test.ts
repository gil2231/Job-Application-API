import { unzipSync, strFromU8 } from "fflate";
import { decodePDFRawStream, PDFArray, PDFDocument, PDFRawStream } from "pdf-lib";
import { describe, expect, it } from "vitest";
import type { CoverLetterContent, ResumeContent } from "@autoapply/shared";
import { generatedFileName, renderCoverLetter, renderResume } from "../src";

const generation = { method: "template" as const, model: null, fallbackReason: null, generatedAt: "2026-06-01T00:00:00.000Z", matchedSkills: ["Salesforce"], edited: false };
const header = { name: "Jordan Rivera", headline: "Account Executive", contact: ["jordan@example.com", "212-555-0100", "New York, NY"] };

const resume: ResumeContent = {
  version: 1,
  header,
  summary: "Account Executive with 6 years of experience ✱ skilled in Salesforce → HubSpot.",
  skills: ["Salesforce", "HubSpot", "Negotiation"],
  experience: [
    { company: "Brightwave", title: "Account Executive", location: "New York, NY", dates: "Mar 2022 – Present", bullets: ["Closed $1.2M in new ARR in 2024, 130% of quota", "x".repeat(400)] },
    ...Array.from({ length: 6 }, (_, i) => ({ company: `Company ${i}`, title: "Representative", location: null, dates: "Jan 2015 – Feb 2016", bullets: Array.from({ length: 5 }, (_, j) => `Did meaningful work item ${j} with a reasonably long description that wraps onto another line of the page`) })),
  ],
  education: [{ school: "Rutgers University", credential: "Bachelor of Arts in Communication", dates: "May 2019", details: ["GPA 3.6"] }],
  job: { id: "job_1", title: "Senior Account Executive", company: "Acme Payments" },
  generation,
};

const letter: CoverLetterContent = {
  version: 1,
  header,
  paragraphs: ["Dear Acme Payments hiring team,", "I'm writing to apply for the Senior Account Executive position.", "• Closed $1.2M in new ARR in 2024.", "Sincerely,", "Jordan Rivera"],
  job: resume.job,
  generation,
};

/** WinAnsi bytes that differ from Latin-1. */
const WIN_ANSI: Record<number, string> = { 0x91: "‘", 0x92: "’", 0x93: "“", 0x94: "”", 0x95: "•", 0x96: "–", 0x97: "—" };

/** The text drawn on each page, from pdf-lib's hex-encoded show-text operators. */
async function pdfText(bytes: Uint8Array): Promise<string> {
  const pdf = await PDFDocument.load(bytes);
  const out: string[] = [];
  for (const page of pdf.getPages()) {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((ref) => pdf.context.lookup(ref)) : [contents];
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) continue;
      const content = Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
      for (const t of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out.push([...Buffer.from(t[1]!, "hex")].map((b) => WIN_ANSI[b] ?? String.fromCharCode(b)).join(""));
    }
  }
  return out.join("\n");
}

describe("PDF export", () => {
  it("renders a multi-page resume as real, searchable text", async () => {
    const bytes = await renderResume(resume, "pdf");
    const pdf = await PDFDocument.load(bytes);
    expect(pdf.getPageCount()).toBeGreaterThan(1);
    expect(pdf.getTitle()).toBe("Jordan Rivera – Resume – Acme Payments");
    expect(pdf.getCreator()).toBe("Applyance");
    const text = await pdfText(bytes);
    for (const s of ["Jordan Rivera", "SUMMARY", "EXPERIENCE", "Account Executive, Brightwave", "Mar 2022 – Present", "Closed $1.2M in new ARR in 2024, 130% of quota", "Rutgers University", "GPA 3.6"]) expect(text).toContain(s);
    // Characters the standard font can't draw are replaced, not fatal.
    expect(text).toContain("experience * skilled in Salesforce -> HubSpot.");
  });

  it("renders a cover letter with its bullet points", async () => {
    const bytes = await renderCoverLetter(letter, "pdf", new Date("2026-06-01T12:00:00Z"));
    const text = await pdfText(bytes);
    expect(text).toContain("June 1, 2026");
    expect(text).toContain("Dear Acme Payments hiring team,");
    expect(text).toContain("•");
    expect(text).toContain("Closed $1.2M in new ARR in 2024.");
  });
});

describe("Word export", () => {
  it("writes a .docx with the same content", async () => {
    const files = unzipSync(await renderResume(resume, "docx"));
    const xml = strFromU8(files["word/document.xml"]!);
    for (const s of ["Jordan Rivera", "SUMMARY", "Closed $1.2M in new ARR in 2024, 130% of quota", "Rutgers University"]) expect(xml).toContain(s);
    expect(strFromU8(files["docProps/core.xml"]!)).toContain("Jordan Rivera – Resume – Acme Payments");
    const letterXml = strFromU8(unzipSync(await renderCoverLetter(letter, "docx"))["word/document.xml"]!);
    expect(letterXml).toContain("Dear Acme Payments hiring team,");
  });
});

it("names files after the person and the company", () => {
  expect(generatedFileName("resume", resume, "pdf")).toBe("jordan-rivera-resume-acme-payments.pdf");
  expect(generatedFileName("cover-letter", { header: { name: "Zoë O'Brien" }, job: { company: "Café & Co." } }, "docx")).toBe("zoe-obrien-cover-letter-cafe-co.docx");
});
