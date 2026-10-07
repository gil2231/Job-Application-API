import { unzipSync, strFromU8 } from "fflate";
import { extractLinkedInJobId, parseHttpUrl, WORK_ARRANGEMENTS, type WorkArrangement } from "@autoapply/shared";
import { normalizeHeader, parseCsv, parseLooseDate } from "../csv";
import type { ImportIssue, JobSourceAdapter, RawJob, SourceParseResult } from "../types";

export interface FileInput {
  fileName: string;
  bytes: Uint8Array;
}

const MAX_UNZIPPED_BYTES = 20 * 1024 * 1024;

/** Column names accepted for each field (normalized: lowercase, punctuation as spaces). */
const COLUMNS: Record<keyof Pick<RawJob, "url" | "title" | "company" | "location" | "description" | "salaryText" | "applicationUrl" | "postedAt" | "savedAt" | "workArrangement">, string[]> = {
  url: ["job url", "url", "job link", "link", "posting url", "job posting url"],
  title: ["job title", "title", "position", "role", "job name"],
  company: ["company name", "company", "employer", "organization", "organisation"],
  location: ["location", "job location", "city"],
  description: ["description", "job description", "details"],
  salaryText: ["salary", "compensation", "pay", "salary range", "pay range"],
  applicationUrl: ["application url", "apply url", "application link", "apply link"],
  postedAt: ["posted", "date posted", "posting date", "posted date", "posted at"],
  savedAt: ["saved date", "saved", "date saved", "saved at", "date added"],
  workArrangement: ["work arrangement", "remote", "workplace type", "work type"],
};

/** LinkedIn's data export ("Get a copy of your data" → Jobs) has exactly these columns in Saved Jobs.csv. */
const LINKEDIN_HEADERS = ["saved date", "job url", "job title", "company name"];

function isZip(bytes: Uint8Array): boolean {
  return bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

function readCsvText(input: FileInput): { text: string; fileName: string } {
  if (!isZip(input.bytes)) return { text: new TextDecoder("utf-8").decode(input.bytes), fileName: input.fileName };
  let total = 0;
  const files = unzipSync(input.bytes, {
    filter: (file) => {
      if (!/(^|\/)saved[ _-]?jobs\.csv$/i.test(file.name)) return false;
      total += file.originalSize;
      if (total > MAX_UNZIPPED_BYTES) throw new ImportFileError("The Saved Jobs file inside this archive is too large.");
      return true;
    },
  });
  const name = Object.keys(files)[0];
  if (!name) {
    throw new ImportFileError(
      'This archive has no "Saved Jobs.csv". In LinkedIn, request your data with "Jobs" selected, then upload the archive or the Saved Jobs.csv file inside it.',
    );
  }
  return { text: strFromU8(files[name]!), fileName: name };
}

export class ImportFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportFileError";
  }
}

function parseArrangement(value: string | undefined): WorkArrangement | null {
  if (!value) return null;
  const v = value.trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (v === "ONSITE" || v === "INOFFICE") return "ONSITE";
  if (v === "TRUE" || v === "YES") return "REMOTE";
  return (WORK_ARRANGEMENTS as readonly string[]).includes(v) ? (v as WorkArrangement) : null;
}

/**
 * CSV and LinkedIn-export import. The user downloads their own data from
 * LinkedIn and uploads it here; Applyance never signs in to or scrapes LinkedIn.
 * Any other spreadsheet with at least a URL column works too.
 */
export const fileImportSource: JobSourceAdapter<FileInput> = {
  id: "file",
  type: "CSV_IMPORT",
  name: "Spreadsheet import",
  async parse(input, context): Promise<SourceParseResult> {
    const { text } = readCsvText(input);
    const rows = parseCsv(text);
    if (rows.length < 2) throw new ImportFileError("This file has no job rows.");
    const headers = rows[0]!.map(normalizeHeader);
    const isLinkedIn = LINKEDIN_HEADERS.every((h) => headers.includes(h));
    const index = Object.fromEntries(
      Object.entries(COLUMNS).map(([field, names]) => [field, headers.findIndex((h) => names.includes(h))]),
    ) as Record<keyof typeof COLUMNS, number>;
    if (index.url < 0) throw new ImportFileError(`No URL column found. Expected one of: ${COLUMNS.url.map((c) => `"${c}"`).join(", ")}.`);

    const jobs: RawJob[] = [];
    const issues: ImportIssue[] = [];
    const cell = (row: string[], field: keyof typeof COLUMNS) => {
      const i = index[field];
      const value = i >= 0 ? row[i]?.trim() : undefined;
      return value ? value : undefined;
    };
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r]!;
      const rowNumber = r + 1;
      const url = cell(row, "url");
      if (!url || !parseHttpUrl(url)) {
        issues.push({ row: rowNumber, kind: "invalid", title: cell(row, "title"), message: url ? `"${url.slice(0, 80)}" isn't a valid URL.` : "Missing job URL." });
        continue;
      }
      if (jobs.length >= context.maxJobs) {
        issues.push({ row: rowNumber, kind: "limit", message: `Only the first ${context.maxJobs} jobs in a file are imported.` });
        break;
      }
      const applicationUrl = cell(row, "applicationUrl");
      jobs.push({
        row: rowNumber,
        url,
        title: cell(row, "title")?.slice(0, 200),
        company: cell(row, "company")?.slice(0, 200),
        location: cell(row, "location")?.slice(0, 200),
        description: cell(row, "description")?.slice(0, 50_000),
        salaryText: cell(row, "salaryText")?.slice(0, 200),
        applicationUrl: applicationUrl && parseHttpUrl(applicationUrl) ? applicationUrl : null,
        postedAt: parseLooseDate(cell(row, "postedAt")),
        savedAt: parseLooseDate(cell(row, "savedAt")),
        workArrangement: parseArrangement(cell(row, "workArrangement")),
        externalId: extractLinkedInJobId(url),
      });
    }
    return isLinkedIn
      ? { sourceType: "LINKEDIN_SAVED", sourceName: "LinkedIn saved jobs", jobs, issues }
      : { sourceType: "CSV_IMPORT", sourceName: "Spreadsheet import", jobs, issues };
  },
};
