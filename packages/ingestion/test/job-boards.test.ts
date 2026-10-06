import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@autoapply/database";
import { analyzeJobs, BoardSearchError, jobBoardSearchSource, parseBoardList, parseBoardRef, runImport, searchJobBoards, type HttpFetcher } from "../src";
import { BDR_DESCRIPTION, makeUser, resetDatabase } from "./helpers";

function fakeHttp(routes: Record<string, unknown>) {
  return vi.fn<HttpFetcher>(async (url) => {
    if (!(url in routes)) throw new Error("The posting was not found (it may have closed)");
    return { url, status: 200, contentType: "application/json", text: JSON.stringify(routes[url]) };
  });
}

const GREENHOUSE = "https://boards-api.greenhouse.io/v1/boards/acme/jobs?content=true";
const LEVER = "https://api.lever.co/v0/postings/globex?mode=json";
const ASHBY = "https://api.ashbyhq.com/posting-api/job-board/initech?includeCompensation=true";

const routes = {
  [GREENHOUSE]: {
    jobs: [
      {
        id: 101,
        title: "Business Development Representative",
        company_name: "Acme Inc",
        location: { name: "New York, NY" },
        content: BDR_DESCRIPTION.replace(/\n/g, "&lt;br&gt;"),
        absolute_url: "https://careers.acme.com/jobs?gh_jid=101",
        first_published: "2026-09-20T00:00:00Z",
      },
      { id: 102, title: "Senior Software Engineer", company_name: "Acme Inc", location: { name: "Remote" }, content: "&lt;p&gt;Work with our sales team.&lt;/p&gt;", first_published: "2026-09-25T00:00:00Z" },
      { id: 103, title: "Account Executive", company_name: "Acme Inc", location: { name: "Austin, TX" }, content: "&lt;p&gt;Commission only.&lt;/p&gt;" },
    ],
  },
  [LEVER]: [
    {
      id: "0a1b2c3d-1111-2222-3333-444455556666",
      text: "Sales Development Rep",
      categories: { location: "Remote - US" },
      descriptionPlain: "Book meetings for our business development team.",
      hostedUrl: "https://jobs.lever.co/globex/0a1b2c3d-1111-2222-3333-444455556666",
      applyUrl: "https://jobs.lever.co/globex/0a1b2c3d-1111-2222-3333-444455556666/apply",
      createdAt: Date.parse("2026-09-28T00:00:00Z"),
      workplaceType: "remote",
      salaryRange: { min: 60000, max: 70000, currency: "USD", interval: "per-year-salary" },
    },
  ],
  [ASHBY]: {
    jobs: [
      { id: "aaaaaaaa-1111-2222-3333-444455556666", title: "Business Development Manager", location: "New York", jobUrl: "https://jobs.ashbyhq.com/initech/aaaaaaaa-1111-2222-3333-444455556666", descriptionPlain: "Grow partnerships." },
      { id: "bbbbbbbb-1111-2222-3333-444455556666", title: "Business Development Lead", isListed: false, jobUrl: "https://jobs.ashbyhq.com/initech/bbbbbbbb" },
    ],
  },
};

const boards = parseBoardList("boards.greenhouse.io/acme\nhttps://jobs.lever.co/globex\nashby:initech").boards;

describe("parseBoardRef", () => {
  it("reads board links and shorthands", () => {
    expect(parseBoardRef("https://boards.greenhouse.io/acme/jobs/123?gh_src=x")).toEqual({ provider: "greenhouse", slug: "acme" });
    expect(parseBoardRef("job-boards.greenhouse.io/acme")).toEqual({ provider: "greenhouse", slug: "acme" });
    expect(parseBoardRef("https://boards.greenhouse.io/embed/job_board?for=acme")).toEqual({ provider: "greenhouse", slug: "acme" });
    expect(parseBoardRef("https://jobs.eu.lever.co/globex/abc")).toEqual({ provider: "lever", slug: "globex", region: "eu" });
    expect(parseBoardRef("https://jobs.ashbyhq.com/Initech%20Labs")).toEqual({ provider: "ashby", slug: "Initech Labs" });
    expect(parseBoardRef("Lever: globex")).toEqual({ provider: "lever", slug: "globex" });
    // A posting link points back to its board, which is how picked results find their board again.
    expect(parseBoardRef("https://jobs.lever.co/globex/0a1b2c3d-1111-2222-3333-444455556666")).toEqual({ provider: "lever", slug: "globex" });
    expect(parseBoardRef("https://jobs.ashbyhq.com/initech/aaaaaaaa-1111-2222-3333-444455556666")).toEqual({ provider: "ashby", slug: "initech" });
  });
  it("rejects other sites, LinkedIn included, and odd names", () => {
    expect(parseBoardRef("https://www.linkedin.com/jobs/search?keywords=sales")).toBeNull();
    expect(parseBoardRef("https://careers.acme.com")).toBeNull();
    expect(parseBoardRef("greenhouse:../../admin")).toBeNull();
    expect(parseBoardRef("https://boards.greenhouse.io/")).toBeNull();
  });
  it("lists boards one per line, dropping repeats and reporting bad lines", () => {
    const { boards: list, invalid } = parseBoardList("greenhouse:acme\nhttps://boards.greenhouse.io/ACME\nlinkedin.com/jobs, lever:globex");
    expect(list.map((b) => b.slug)).toEqual(["acme", "globex"]);
    expect(invalid).toEqual(["linkedin.com/jobs"]);
  });
});

describe("searchJobBoards", () => {
  it("matches keywords in titles across Greenhouse, Lever and Ashby", async () => {
    const http = fakeHttp(routes);
    const result = await searchJobBoards({ boards, query: '"business development"' }, http);
    expect(result.jobs.map((j) => j.title)).toEqual(["Business Development Representative", "Business Development Manager"]);
    expect(result.jobs[0]).toMatchObject({ company: "Acme Inc", provider: "greenhouse", url: "https://boards.greenhouse.io/acme/jobs/101", applicationUrl: null, matchedIn: "title" });
    expect(result.boards.map((b) => [b.slug, b.postings, b.matches])).toEqual([["acme", 3, 1], ["globex", 1, 0], ["initech", 1, 1]]);
    // Only the documented public APIs are called.
    expect(http.mock.calls.map((c) => c[0]).sort()).toEqual([ASHBY, GREENHOUSE, LEVER].sort());
  });

  it("searches descriptions when asked, listing title matches first", async () => {
    const result = await searchJobBoards({ boards, query: '"business development"', searchDescriptions: true }, fakeHttp(routes));
    expect(result.jobs.map((j) => [j.title, j.matchedIn])).toEqual([
      ["Business Development Representative", "title"],
      ["Business Development Manager", "title"],
      ["Sales Development Rep", "description"],
    ]);
  });

  it("applies exclusions to the whole posting and filters by location", async () => {
    const http = fakeHttp(routes);
    const titles = async (query: string, location?: string) => (await searchJobBoards({ boards, query, location }, http)).jobs.map((j) => j.title);
    expect(await titles("account executive")).toEqual(["Account Executive"]);
    expect(await titles("account executive -commission")).toEqual([]);
    expect(await titles("", "Remote")).toEqual(["Sales Development Rep", "Senior Software Engineer"]);
    expect(await titles("development", "new york")).toEqual(["Business Development Representative", "Business Development Manager"]);
  });

  it("reports a board that fails without losing the others", async () => {
    const result = await searchJobBoards({ boards: [...boards, { provider: "lever", slug: "nosuchco" }], query: "development" }, fakeHttp(routes));
    expect(result.jobs.length).toBe(3);
    expect(result.boards.at(-1)).toMatchObject({ slug: "nosuchco", error: "No public board found with this name." });
    expect(result.issues).toEqual([expect.objectContaining({ kind: "fetch_failed" })]);
  });

  it("needs boards and keywords", async () => {
    await expect(searchJobBoards({ boards: [], query: "sales" }, fakeHttp(routes))).rejects.toBeInstanceOf(BoardSearchError);
    await expect(searchJobBoards({ boards, query: "  " }, fakeHttp(routes))).rejects.toThrow("Enter keywords");
  });
});

describe("job board import", () => {
  beforeEach(resetDatabase);

  it("imports the picked postings through dedup, analysis and scoring", async () => {
    const user = await makeUser();
    const http = fakeHttp(routes);
    const picked = ["https://boards.greenhouse.io/acme/jobs/101", "https://jobs.lever.co/globex/0a1b2c3d-1111-2222-3333-444455556666"];
    const summary = await runImport(user.id, jobBoardSearchSource, { boards, query: "development", onlyUrls: picked, http });
    expect(summary).toMatchObject({ total: 2, created: 2, duplicates: 0 });

    const again = await runImport(user.id, jobBoardSearchSource, { boards, query: "development", http });
    expect(again).toMatchObject({ total: 3, created: 1, duplicates: 2 });

    const source = await prisma.jobSource.findFirstOrThrow({ where: { userId: user.id, type: "JOB_BOARD" } });
    expect(source.name).toBe("Job board search");
    const jobs = await prisma.job.findMany({ where: { userId: user.id }, orderBy: { title: "asc" } });
    expect(jobs.map((j) => [j.title, j.platform, j.sourceType])).toEqual([
      ["Business Development Manager", "ASHBY", "JOB_BOARD"],
      ["Business Development Representative", "GREENHOUSE", "JOB_BOARD"],
      ["Sales Development Rep", "LEVER", "JOB_BOARD"],
    ]);

    const analyzed = await analyzeJobs(user.id);
    expect(analyzed.analyzed).toBe(3);
    const bdr = await prisma.job.findFirstOrThrow({ where: { userId: user.id, title: "Business Development Representative" } });
    expect(bdr.description).toContain("Business Development Representative to generate pipeline");
    expect(bdr.salaryAnnualMax).toBe(75000);
    expect(bdr.matchScore).not.toBeNull();
  });
});
