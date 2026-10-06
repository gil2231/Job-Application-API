import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import type { CoverLetterContent, ResumeContent } from "@autoapply/shared";

/**
 * PDF rendering for generated resumes and cover letters: a plain, single-column
 * layout that applicant tracking systems parse reliably (real text, standard
 * fonts, no tables or images).
 */

const PAGE = { width: 612, height: 792, margin: 54 };
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.36, 0.36, 0.4);

interface Fonts {
  regular: PDFFont;
  bold: PDFFont;
  italic: PDFFont;
}

/** Characters the standard fonts can't draw are swapped for close equivalents or dropped. */
function sanitizer(font: PDFFont) {
  const supported = new Set(font.getCharacterSet());
  const swaps: Record<string, string> = { "✱": "*", "★": "*", "→": "->", "←": "<-", "≥": ">=", "≤": "<=", " ": " ", " ": " ", "​": "" };
  return (text: string) =>
    [...text.normalize("NFC")]
      .map((ch) => (supported.has(ch.codePointAt(0)!) ? ch : (swaps[ch] ?? (supported.has(ch.normalize("NFD").codePointAt(0)!) ? ch.normalize("NFD")[0]! : ""))))
      .join("");
}

class Writer {
  private page: PDFPage;
  private y: number;
  private readonly clean: (s: string) => string;
  readonly width = PAGE.width - PAGE.margin * 2;

  constructor(
    private readonly doc: PDFDocument,
    readonly fonts: Fonts,
  ) {
    this.page = doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - PAGE.margin;
    this.clean = sanitizer(fonts.regular);
  }

  private ensure(height: number) {
    if (this.y - height < PAGE.margin) {
      this.page = this.doc.addPage([PAGE.width, PAGE.height]);
      this.y = PAGE.height - PAGE.margin;
    }
  }

  wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const lines: string[] = [];
    for (const para of this.clean(text).split("\n")) {
      let line = "";
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(next, size) <= width) {
          line = next;
          continue;
        }
        if (line) lines.push(line);
        // A single word wider than the line (a long URL) is broken by characters.
        let rest = word;
        while (font.widthOfTextAtSize(rest, size) > width) {
          let cut = rest.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(rest.slice(0, cut), size) > width) cut--;
          lines.push(rest.slice(0, cut));
          rest = rest.slice(cut);
        }
        line = rest;
      }
      lines.push(line);
    }
    return lines;
  }

  text(text: string, options: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; indent?: number; gapAfter?: number; lineHeight?: number } = {}) {
    const font = options.font ?? this.fonts.regular;
    const size = options.size ?? 10.5;
    const indent = options.indent ?? 0;
    const lineHeight = options.lineHeight ?? size * 1.35;
    for (const line of this.wrap(text, font, size, this.width - indent)) {
      this.ensure(lineHeight);
      this.y -= lineHeight;
      this.page.drawText(line, { x: PAGE.margin + indent, y: this.y + (lineHeight - size) / 2, size, font, color: options.color ?? INK });
    }
    this.y -= options.gapAfter ?? 0;
  }

  /** Bold text on the left with smaller text flush right on the same line (role and dates). */
  split(left: string, right: string, size = 10.5) {
    const lineHeight = size * 1.4;
    const rightText = this.clean(right);
    const rightWidth = this.fonts.regular.widthOfTextAtSize(rightText, size - 1);
    const leftLines = this.wrap(left, this.fonts.bold, size, this.width - rightWidth - 12);
    leftLines.forEach((line, i) => {
      this.ensure(lineHeight);
      this.y -= lineHeight;
      const baseline = this.y + (lineHeight - size) / 2;
      this.page.drawText(line, { x: PAGE.margin, y: baseline, size, font: this.fonts.bold, color: INK });
      if (i === 0 && rightText) this.page.drawText(rightText, { x: PAGE.margin + this.width - rightWidth, y: baseline, size: size - 1, font: this.fonts.regular, color: MUTED });
    });
  }

  bullet(text: string, size = 10.5) {
    const indent = 14;
    const lineHeight = size * 1.35;
    const lines = this.wrap(text, this.fonts.regular, size, this.width - indent);
    lines.forEach((line, i) => {
      this.ensure(lineHeight);
      this.y -= lineHeight;
      const baseline = this.y + (lineHeight - size) / 2;
      if (i === 0) this.page.drawText("•", { x: PAGE.margin + 3, y: baseline, size, font: this.fonts.regular, color: INK });
      this.page.drawText(line, { x: PAGE.margin + indent, y: baseline, size, font: this.fonts.regular, color: INK });
    });
    this.y -= 1.5;
  }

  heading(text: string) {
    this.ensure(30);
    this.y -= 10;
    this.text(text.toUpperCase(), { font: this.fonts.bold, size: 10, color: INK, lineHeight: 14 });
    this.page.drawLine({ start: { x: PAGE.margin, y: this.y - 2 }, end: { x: PAGE.margin + this.width, y: this.y - 2 }, thickness: 0.6, color: MUTED });
    this.y -= 7;
  }

  gap(points: number) {
    this.y -= points;
  }
}

async function open(title: string, author: string) {
  const doc = await PDFDocument.create();
  doc.setTitle(title);
  doc.setAuthor(author);
  doc.setCreator("Applyance");
  doc.setProducer("Applyance");
  const fonts = {
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };
  return { doc, writer: new Writer(doc, fonts) };
}

function header(w: Writer, h: ResumeContent["header"]) {
  w.text(h.name, { font: w.fonts.bold, size: 20, lineHeight: 26 });
  if (h.headline) w.text(h.headline, { size: 11.5, color: MUTED, lineHeight: 16 });
  if (h.contact.length) w.text(h.contact.join("  ·  "), { size: 9.5, color: MUTED, lineHeight: 13 });
}

export async function renderResumePdf(content: ResumeContent): Promise<Uint8Array> {
  const { doc, writer: w } = await open(`${content.header.name} – Resume – ${content.job.company}`, content.header.name);
  header(w, content.header);
  if (content.summary) {
    w.heading("Summary");
    w.text(content.summary);
  }
  if (content.skills.length) {
    w.heading("Skills");
    w.text(content.skills.join(", "));
  }
  if (content.experience.length) {
    w.heading("Experience");
    content.experience.forEach((role, i) => {
      if (i > 0) w.gap(6);
      w.split(`${role.title}, ${role.company}`, role.dates);
      if (role.location) w.text(role.location, { font: w.fonts.italic, size: 9.5, color: MUTED, lineHeight: 13 });
      for (const b of role.bullets) w.bullet(b);
    });
  }
  if (content.education.length) {
    w.heading("Education");
    content.education.forEach((ed, i) => {
      if (i > 0) w.gap(4);
      w.split(ed.school, ed.dates ?? "");
      if (ed.credential) w.text(ed.credential);
      for (const d of ed.details) w.text(d, { size: 9.5, color: MUTED, lineHeight: 13 });
    });
  }
  return doc.save();
}

export async function renderCoverLetterPdf(content: CoverLetterContent, date = new Date()): Promise<Uint8Array> {
  const { doc, writer: w } = await open(`${content.header.name} – Cover letter – ${content.job.company}`, content.header.name);
  header(w, content.header);
  w.gap(18);
  w.text(date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }), { gapAfter: 12 });
  content.paragraphs.forEach((p, i) => {
    const isBullet = p.startsWith("• ");
    if (!isBullet && content.paragraphs[i - 1]?.startsWith("• ")) w.gap(6);
    if (isBullet) w.bullet(p.slice(2), 11);
    else w.text(p, { size: 11, lineHeight: 15.5, gapAfter: 8 });
  });
  return doc.save();
}
