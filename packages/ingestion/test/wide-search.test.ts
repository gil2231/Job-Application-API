import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@autoapply/database";
import { BoardSearchError, foundJobsSource, parseBoardList, runImport, searchEverywhere, type HttpFetcher } from "../src";
import { BDR_DESCRIPTION, makeUser, resetDatabase } from "./helpers";

type Route = unknown | ((init: { body?: string; headers?: Record<string, string> }) => unknown);

function fakeHttp(routes: Record<string, Route>) {
  return vi.fn<HttpFetcher>(async (url, init) => {
    if (!(url in routes)) throw new Error("The posting was not found (it may have closed)");
    const route = routes[url];
    const body = typeof route === "function" ? (route as (i: typeof init) => unknown)(init) : route;
    return { url, status: 200, contentType: "application/json", text: JSON.stringify(body) };
  });
}

const WORKDAY = "https://initech.wd5.myworkdayjobs.com/wday/cxs/initech/Careers/jobs";
const WORKABLE = "https://apply.workable.com/api/v1/widget/accounts/hooli";
const SMART = "https://api.smartrecruiters.com/v1/companies/Umbrella/postings?limit=100";
const RECRUITEE = "https://piedpiper.recruitee.com/api/offers/";
const GREENHOUSE = "https://boards-api.greenhouse.io/v1/boards/acme/jobs";
const JSEARCH = (q: string) => `https://jsearch.p.rapidapi.com/search?${new URLSearchParams({ query: q, page: "1", num_pages: "1", date_posted: "month" })}`;

const routes: Record<string, Route> = {
  [GREENHOUSE]: { jobs: [{ id: 1, title: "Account Executive", company_name: "Acme", location: { name: "New York, NY" } }] },
  [WORKDAY]: (init: { body?: string }) => {
    const { offset } = JSON.parse(init.body ?? "{}") as { offset: number };
    if (offset > 0) return { total: 21, jobPostings: [{ title: "Account Executive, Mid-Market", externalPath: "/job/Austin-TX/AE-MM_R2", locationsText: "Austin, TX", postedOn: "Posted 3 Days Ago" }] };
    return { total: 21, jobPostings: [{ title: "Account Executive", externalPath: "/job/New-York-NY/AE_R1", locationsText: "New York, NY", postedOn: "Posted Today", bulletFields: ["R1"] }] };
  },
  [WORKABLE]: { name: "Hooli", jobs: [{ title: "Enterprise Account Executive", shortcode: "AB12", url: "https://apply.workable.com/hooli/j/AB12/", city: "New York", country: "United States", published_on: "2026-09-30" }] },
  [SMART]: { content: [{ id: "744000", name: "Account Executive", company: { name: "Umbrella Corp" }, releasedDate: "2026-09-29T00:00:00Z", location: { city: "Remote", country: "us", remote: true } }] },
  [RECRUITEE]: { offers: [{ id: 9, title: "Account Executive", careers_url: "https://piedpiper.recruitee.com/o/account-executive", location: "Palo Alto", company_name: "Pied Piper", description: "<p>Sell compression.</p>" }] },
  [JSEARCH("account executive")]: {
    data: [
      // Also on Greenhouse: shown once, with LinkedIn added to where it was found.
      { job_id: "a", employer_name: "Acme", job_title: "Account Executive", job_city: "New York", job_state: "NY", job_publisher: "LinkedIn", job_apply_link: "https://www.linkedin.com/jobs/view/1", apply_options: [{ publisher: "LinkedIn", apply_link: "https://www.linkedin.com/jobs/view/1" }] },
      // Only on the aggregator: keeps the company's direct link over LinkedIn and Indeed.
      {
        job_id: "b",
        employer_name: "Globex",
        job_title: "Account Executive",
        job_location: "New York, NY",
        job_publisher: "Indeed",
        job_apply_link: "https://www.indeed.com/viewjob?jk=1",
        apply_options: [
          { publisher: "Indeed", apply_link: "https://www.indeed.com/viewjob?jk=1" },
          { publisher: "Globex Careers", apply_link: "https://careers.globex.com/jobs/77", is_direct: true },
        ],
        job_description: BDR_DESCRIPTION,
        job_min_salary: 70000,
        job_max_salary: 80000,
        job_salary_period: "YEAR",
      },
      { job_id: "c", employer_name: "Hooli", job_title: "Office Manager", job_location: "New York, NY", job_apply_link: "https://hooli.com/jobs/3" },
    ],
  },
};

routes[`${SMART}&q=account%20executive`] = routes[SMART];
routes[`${GREENHOUSE}?content=true`] = routes[GREENHOUSE];
routes[`${WORKABLE}?details=true`] = routes[WORKABLE];

const directory = ["greenhouse:acme", "workday:initech.wd5/Careers", "workable:hooli", "smartrecruiters:Umbrella", "recruitee:piedpiper", "lever:gone"];

describe("searchEverywhere", () => {
  it("searches every board and the aggregator at once, listing each job once", async () => {
    const http = fakeHttp(routes);
    const result = await searchEverywhere({ query: "account executive", directory, aggregatorKey: "key-123" }, http);
    const rows = result.jobs.map((j) => [j.company, j.title, j.sources.join("+")]);
    expect(rows).toEqual(
      expect.arrayContaining([
        ["Acme", "Account Executive", "Greenhouse+LinkedIn"],
        ["Initech", "Account Executive", "Workday"],
        ["Initech", "Account Executive, Mid-Market", "Workday"],
        ["Hooli", "Enterprise Account Executive", "Workable"],
        ["Umbrella Corp", "Account Executive", "SmartRecruiters"],
        ["Pied Piper", "Account Executive", "Recruitee"],
        ["Globex", "Account Executive", "Indeed+Globex Careers"],
      ]),
    );
    expect(result.jobs).toHaveLength(7);
    expect(result.jobs.find((j) => j.company === "Globex")).toMatchObject({ url: "https://careers.globex.com/jobs/77", salaryText: "USD 70,000 - 80,000 per year" });
    expect(result.jobs.find((j) => j.title === "Account Executive" && j.company === "Initech")!.url).toBe("https://initech.wd5.myworkdayjobs.com/Careers/job/New-York-NY/AE_R1");
    // A directory board that's gone is skipped quietly.
    expect(result).toMatchObject({ boardsSearched: 6, boardsAnswered: 5, userBoardErrors: [], aggregator: { status: "used", matches: 2 } });

    // Workday's own search narrows it, a page at a time; the key only goes to JSearch.
    const workday = http.mock.calls.filter((c) => c[0] === WORKDAY).map((c) => JSON.parse(c[1].body!));
    expect(workday).toEqual([expect.objectContaining({ searchText: "account executive", offset: 0, limit: 20 }), expect.objectContaining({ offset: 20 })]);
    expect(http.mock.calls.filter((c) => c[1].headers?.["x-rapidapi-key"]).map((c) => new URL(c[0]).host)).toEqual(["jsearch.p.rapidapi.com"]);
    expect(http.mock.calls.some((c) => /linkedin|indeed|joinhandshake/.test(new URL(c[0]).host))).toBe(false);
  });

  it("works without an aggregator key and reports the user's own boards that fail", async () => {
    const http = fakeHttp(routes);
    const result = await searchEverywhere({ query: "account executive", location: "New York", directory, boards: parseBoardList("lever:nosuchco").boards }, http);
    expect(result.aggregator.status).toBe("no_key");
    expect(result.jobs.map((j) => j.company).sort()).toEqual(["Acme", "Hooli", "Initech"]);
    expect(result.userBoardErrors).toEqual([{ url: "https://jobs.lever.co/nosuchco", label: "Lever · nosuchco", error: "No public board found with this name." }]);
    expect(http.mock.calls.some((c) => c[0].includes("rapidapi"))).toBe(false);
  });

  it("serves a repeat search from the cache", async () => {
    const http = fakeHttp(routes);
    await searchEverywhere({ query: "account executive", directory }, http);
    const calls = http.mock.calls.length;
    await searchEverywhere({ query: '"account executive" -mid', directory }, http);
    // Only Greenhouse and Workable again (now with descriptions, for the exclusion), plus the board that failed.
    expect(http.mock.calls.length).toBe(calls + 3);
  });

  it("matches any of many preference terms", async () => {
    const result = await searchEverywhere({ query: '"office manager" enterprise', matchAny: true, directory }, fakeHttp(routes));
    expect(result.jobs.map((j) => j.title)).toEqual(["Enterprise Account Executive"]);
  });

  it("needs something to search for", async () => {
    await expect(searchEverywhere({ query: " ", directory }, fakeHttp(routes))).rejects.toBeInstanceOf(BoardSearchError);
  });
});

describe("adding found jobs", () => {
  beforeEach(resetDatabase);

  it("adds the picked jobs with their full posting, and never fetches listing sites", async () => {
    const user = await makeUser();
    const fetchPosting = vi.fn(async (url: string) =>
      url.includes("greenhouse") ? { url, title: "Account Executive", company: "Acme Inc", location: "New York, NY", description: BDR_DESCRIPTION } : null,
    );
    const summary = await runImport(
      user.id,
      foundJobsSource,
      {
        jobs: [
          { url: "https://boards.greenhouse.io/acme/jobs/1", title: "Account Executive", company: "Acme", location: "New York, NY" },
          { url: "https://www.indeed.com/viewjob?jk=2", title: "Sales Rep", company: "Globex", location: "Austin, TX", salaryText: "USD 60,000 per year" },
        ],
      },
      { context: { fetchPosting } },
    );
    expect(summary).toMatchObject({ total: 2, created: 2 });
    expect(fetchPosting.mock.calls.map((c) => c[0])).toEqual(["https://boards.greenhouse.io/acme/jobs/1"]);
    const jobs = await prisma.job.findMany({ where: { userId: user.id }, orderBy: { company: "asc" } });
    expect(jobs.map((j) => [j.company, j.title, j.sourceType, !!j.description])).toEqual([
      ["Acme Inc", "Account Executive", "JOB_BOARD", true],
      ["Globex", "Sales Rep", "JOB_BOARD", false],
    ]);
  });
});
