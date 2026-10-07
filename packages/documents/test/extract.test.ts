import { Document, Packer, Paragraph, TextRun } from "docx";
import { zipSync, strToU8 } from "fflate";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";
import { extractResumeText, normalizeText } from "../src";

async function pdfOf(lines: Array<string | [string, string]>): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  let y = 740;
  for (const line of lines) {
    const [left, right] = Array.isArray(line) ? line : [line, null];
    page.drawText(left, { x: 50, y, size: 11, font });
    if (right) page.drawText(right, { x: 450, y, size: 11, font });
    y -= 16;
  }
  return Buffer.from(await pdf.save());
}

describe("extractResumeText", () => {
  it("reads a PDF line by line and keeps right-aligned dates on their line", async () => {
    const body = await pdfOf([
      "Jane Doe",
      "jane.doe@example.com | (512) 555-0147",
      "EXPERIENCE",
      ["Senior Account Executive, Northwind Software Inc.", "Jan 2022 - Present"],
      "- Closed $1.2M in new ARR in 2023",
    ]);
    const result = await extractResumeText("resume.pdf", body);
    expect(result).toEqual({
      ok: true,
      text: [
        "Jane Doe",
        "jane.doe@example.com | (512) 555-0147",
        "EXPERIENCE",
        "Senior Account Executive, Northwind Software Inc. | Jan 2022 - Present",
        "- Closed $1.2M in new ARR in 2023",
      ].join("\n"),
    });
  });

  it("reads a Word document, with list paragraphs as bullets", async () => {
    const doc = new Document({
      sections: [
        {
          children: [
            new Paragraph({ children: [new TextRun("Alex Kim")] }),
            new Paragraph({ children: [new TextRun("Experience")] }),
            new Paragraph({ children: [new TextRun("Software Engineer & Lead"), new TextRun({ text: "2021 – Present" })] }),
            new Paragraph({ text: "Built a telemetry pipeline", bullet: { level: 0 } }),
          ],
        },
      ],
    });
    const body = await Packer.toBuffer(doc);
    const result = await extractResumeText("resume.docx", Buffer.from(body));
    expect(result.ok && result.text).toBe("Alex Kim\nExperience\nSoftware Engineer & Lead2021 – Present\n• Built a telemetry pipeline");
  });

  it("reads plain text", async () => {
    const result = await extractResumeText("resume.txt", Buffer.from("Pat Morgan\r\npat@example.com\r\n\r\n\r\n\r\nSkills: Excel, SQL\n"));
    expect(result).toEqual({ ok: true, text: "Pat Morgan\npat@example.com\n\nSkills: Excel, SQL" });
  });

  it("explains files it can't read", async () => {
    expect(await extractResumeText("resume.doc", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]))).toEqual({
      ok: false,
      error: "Older .doc files can't be read. Save it as a PDF or .docx and try again.",
    });
    expect(await extractResumeText("photo.png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 1]))).toMatchObject({ ok: false, error: expect.stringMatching(/PDF, Word/) });
    expect(await extractResumeText("resume.pdf", Buffer.from("not a pdf"))).toMatchObject({ ok: false, error: "This file is not a valid .pdf file" });
    // A PDF with no text layer (a scan) has nothing to read.
    expect(await extractResumeText("scan.pdf", await pdfOf([]))).toMatchObject({ ok: false, error: expect.stringMatching(/scanned image/) });
    // A zip that isn't a Word document.
    const zip = Buffer.from(zipSync({ "other.txt": strToU8("hello") }));
    expect(await extractResumeText("resume.docx", zip)).toMatchObject({ ok: false, error: expect.stringMatching(/couldn't be read/) });
  });

  it("normalizes whitespace and ligatures", () => {
    expect(normalizeText("Proﬁcient   in\tExcel \n\n\n\nNext")).toBe("Proficient in Excel\n\nNext");
  });
});
