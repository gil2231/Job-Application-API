import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";
import { companyFromUrl, extractUrls, fileImportSource, ImportFileError, urlListSource } from "../src/sources";
import type { RawJob, SourceContext } from "../src/types";

const ctx = (extra: Partial<SourceContext> = {}): SourceContext => ({ maxJobs: 1000, ...extra });
const file = (text: string, fileName = "jobs.csv") => ({ fileName, bytes: strToU8(text) });

const LINKEDIN_CSV = [
  "Saved Date,Job Url,Job Title,Company Name",
  "\"10/3/24, 2:15 PM\",https://www.linkedin.com/jobs/view/3901234567/,Business Development Representative,Acme",
  '"10/1/24, 9:00 AM",https://www.linkedin.com/jobs/view/sales-rep-at-globex-3907654321,"Sales Rep, East",Globex',
  "\"10/1/24, 9:00 AM\",not a url,Broken,Initech",
].join("\n");

describe("fileImportSource", () => {
  it("recognizes LinkedIn's Saved Jobs.csv", async () => {
    const result = await fileImportSource.parse(file(LINKEDIN_CSV, "Saved Jobs.csv"), ctx());
    expect(result).toMatchObject({ sourceType: "LINKEDIN_SAVED", sourceName: "LinkedIn saved jobs" });
    expect(result.jobs).toHaveLength(2);
    expect(result.jobs[0]).toMatchObject({ row: 2, title: "Business Development Representative", company: "Acme", externalId: "3901234567" });
    expect(result.jobs[0]!.savedAt?.toISOString()).toBe("2024-10-03T14:15:00.000Z");
    expect(result.jobs[1]).toMatchObject({ title: "Sales Rep, East", externalId: "3907654321" });
    expect(result.issues).toEqual([expect.objectContaining({ row: 4, kind: "invalid", title: "Broken" })]);
  });

  it("finds Saved Jobs.csv inside a LinkedIn data archive", async () => {
    const zip = zipSync({ "Connections.csv": strToU8("First Name\nAda"), "Jobs/Saved Jobs.csv": strToU8(LINKEDIN_CSV) });
    const result = await fileImportSource.parse({ fileName: "Basic_LinkedInDataExport.zip", bytes: zip }, ctx());
    expect(result.sourceType).toBe("LINKEDIN_SAVED");
    expect(result.jobs).toHaveLength(2);
  });

  it("explains an archive without saved jobs", async () => {
    const zip = zipSync({ "Connections.csv": strToU8("First Name\nAda") });
    await expect(fileImportSource.parse({ fileName: "export.zip", bytes: zip }, ctx())).rejects.toThrow(/Saved Jobs\.csv/);
  });

  it("imports any spreadsheet with a URL column and optional details", async () => {
    const csv = ["URL,Title,Employer,Location,Salary,Remote,Description", "https://jobs.lever.co/acme/1,AE,Acme,Austin TX,$90k,yes,Sell things"].join("\n");
    const result = await fileImportSource.parse(file(csv), ctx());
    expect(result.sourceType).toBe("CSV_IMPORT");
    expect(result.jobs[0]).toMatchObject({ company: "Acme", location: "Austin TX", salaryText: "$90k", workArrangement: "REMOTE", description: "Sell things", externalId: null });
  });

  it("rejects files without a URL column or rows", async () => {
    await expect(fileImportSource.parse(file("Title,Company\nAE,Acme"), ctx())).rejects.toBeInstanceOf(ImportFileError);
    await expect(fileImportSource.parse(file("Job URL"), ctx())).rejects.toThrow("no job rows");
  });

  it("stops at the row limit", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => `https://example.com/jobs/${i},Job ${i},Acme`);
    const result = await fileImportSource.parse(file(["url,title,company", ...rows].join("\n")), ctx({ maxJobs: 3 }));
    expect(result.jobs).toHaveLength(3);
    expect(result.issues).toEqual([expect.objectContaining({ kind: "limit" })]);
  });
});

describe("extractUrls", () => {
  it("pulls URLs out of mixed text and drops duplicates and trailing punctuation", () => {
    const text = "Check https://jobs.lever.co/acme/abc.\nAlso (https://boards.greenhouse.io/acme/jobs/1?utm_source=x), https://boards.greenhouse.io/acme/jobs/1";
    expect(extractUrls(text)).toEqual(["https://jobs.lever.co/acme/abc", "https://boards.greenhouse.io/acme/jobs/1?utm_source=x"]);
  });
});

describe("urlListSource", () => {
  it("adds LinkedIn links as placeholders without fetching them", async () => {
    const fetchPosting = vi.fn();
    const result = await urlListSource.parse({ text: "https://www.linkedin.com/jobs/view/3901234567/" }, ctx({ fetchPosting }));
    expect(fetchPosting).not.toHaveBeenCalled();
    expect(result.jobs[0]).toMatchObject({ externalId: "3901234567", title: "LinkedIn job 3901234567", needsDetails: true });
  });

  it("fills in public postings and records fetch failures", async () => {
    const fetchPosting = vi.fn(async (url: string): Promise<RawJob | null> => {
      if (url.includes("greenhouse")) return { url, title: "Account Executive", company: "Acme", description: "Sell" };
      if (url.includes("broken")) throw new Error("The site returned 500");
      return null;
    });
    const result = await urlListSource.parse(
      { text: "https://boards.greenhouse.io/acme/jobs/1\nhttps://careers.broken.com/1\nhttps://careers.initech.com/jobs/2" },
      ctx({ fetchPosting }),
    );
    expect(result.jobs.map((j) => [j.title, j.company, !!j.needsDetails])).toEqual([
      ["Account Executive", "Acme", false],
      ["Untitled job", "Broken", true],
      ["Untitled job", "Initech", true],
    ]);
    expect(result.issues).toEqual([expect.objectContaining({ kind: "fetch_failed", url: "https://careers.broken.com/1" })]);
  });
});

describe("companyFromUrl", () => {
  it("names the company from the board or host", () => {
    expect(companyFromUrl("https://boards.greenhouse.io/acme-corp/jobs/1")).toBe("Acme Corp");
    expect(companyFromUrl("https://jobs.lever.co/globex/0a1b")).toBe("Globex");
    expect(companyFromUrl("https://initech.wd5.myworkdayjobs.com/en-US/External/job/x")).toBe("Initech");
    expect(companyFromUrl("https://careers.umbrella.com/jobs/42")).toBe("Umbrella");
    expect(companyFromUrl("http://127.0.0.1/admin")).toBe("Unknown company");
  });
});
