import { describe, expect, it, vi } from "vitest";
import { applyYourselfMessage, browserPageSource, fetchPosting, followToCompany, guessBoardNames, urlListSource, type HttpFetcher } from "../src";

function fakeHttp(routes: Record<string, unknown>) {
  return vi.fn<HttpFetcher>(async (url) => {
    if (!(url in routes)) throw new Error("The posting was not found (it may have closed)");
    return { url, status: 200, contentType: "application/json", text: JSON.stringify(routes[url]) };
  });
}

const linkedIn = { url: "https://www.linkedin.com/jobs/view/3987654321", title: "Account Executive", company: "Acme, Inc.", location: "New York, NY" };

describe("followToCompany", () => {
  it("guesses a company's board names", () => {
    expect(guessBoardNames("Acme, Inc.")).toEqual(["acme"]);
    expect(guessBoardNames("Pied Piper Corp")).toEqual(["piedpiper", "pied-piper", "pied"]);
  });

  it("finds the same job on the company's own board, never touching LinkedIn", async () => {
    const http = fakeHttp({
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs": {
        jobs: [
          { id: 1, title: "Account Executive", company_name: "Acme", location: { name: "Austin, TX" } },
          { id: 2, title: "Account Executive", company_name: "Acme", location: { name: "New York, NY" } },
          { id: 3, title: "Senior Account Executive", company_name: "Acme", location: { name: "New York, NY" } },
        ],
      },
    });
    const found = await followToCompany(linkedIn, { http });
    expect(found).toEqual({ url: "https://boards.greenhouse.io/acme/jobs/2", via: "company_board", foundOn: "Greenhouse" });
    expect(http.mock.calls.some((c) => /linkedin|joinhandshake|indeed/.test(c[0]))).toBe(false);
  });

  it("falls back to JSearch's direct company link when the board can't be guessed", async () => {
    const http = fakeHttp({
      [`https://jsearch.p.rapidapi.com/search-v2?${new URLSearchParams({ query: "Account Executive Acme, Inc. in New York, NY", page: "1", num_pages: "1", date_posted: "month" })}`]: {
        data: [
          { employer_name: "Other Co", job_title: "Account Executive", job_apply_link: "https://other.example.com/jobs/1" },
          {
            employer_name: "Acme",
            job_title: "Account Executive",
            job_location: "New York, NY",
            job_apply_link: "https://www.linkedin.com/jobs/view/3987654321",
            apply_options: [
              { publisher: "LinkedIn", apply_link: "https://www.linkedin.com/jobs/view/3987654321" },
              { publisher: "Acme Careers", apply_link: "https://acme.wd5.myworkdayjobs.com/External/job/New-York/AE_R1", is_direct: true },
            ],
          },
        ],
      },
    });
    expect(await followToCompany(linkedIn, { http })).toBeNull();
    expect(await followToCompany(linkedIn, { http, aggregatorKey: "key" })).toEqual({ url: "https://acme.wd5.myworkdayjobs.com/External/job/New-York/AE_R1", via: "jsearch", foundOn: "JSearch" });
  });

  it("uses a company link the job already has, and can't look up a bare link", async () => {
    const http = fakeHttp({});
    expect(await followToCompany({ ...linkedIn, applicationUrl: "https://careers.acme.com/apply/9" }, { http })).toMatchObject({ url: "https://careers.acme.com/apply/9", via: "job" });
    expect(await followToCompany({ url: "https://app.joinhandshake.com/stu/jobs/9876543", title: "Handshake job 9876543", company: "Unknown company" }, { http, aggregatorKey: "key" })).toBeNull();
    expect(http).not.toHaveBeenCalled();
  });

  it("explains how to apply yourself", () => {
    expect(applyYourselfMessage("handshake", "https://app.joinhandshake.com/stu/jobs/1", { title: "Analyst", company: "Acme" })).toContain("apply on Handshake yourself: https://app.joinhandshake.com/stu/jobs/1");
    expect(applyYourselfMessage("linkedin", "https://www.linkedin.com/jobs/view/1", { title: "LinkedIn job 1", company: "Unknown company" })).toContain("Add the job's title and company");
  });
});

describe("Handshake links", () => {
  it("are kept as links to fill in, never fetched", async () => {
    const fetch = vi.fn(async () => null);
    const pasted = await urlListSource.parse({ text: "https://app.joinhandshake.com/stu/jobs/9876543?ref=x" }, { maxJobs: 10, fetchPosting: fetch });
    expect(pasted.jobs).toEqual([expect.objectContaining({ title: "Handshake job 9876543", externalId: "9876543", needsDetails: true })]);
    const saved = await browserPageSource.parse({ url: "https://app.joinhandshake.com/stu/jobs/9876543", text: "page text", heading: "Analyst" }, { maxJobs: 10, fetchPosting: fetch });
    expect(saved.jobs).toEqual([expect.objectContaining({ title: "Handshake job 9876543", needsDetails: true })]);
    expect(fetch).not.toHaveBeenCalled();
    const http = vi.fn<HttpFetcher>();
    expect(await fetchPosting("https://www.indeed.com/viewjob?jk=1", http)).toBeNull();
    expect(await fetchPosting("https://app.joinhandshake.com/stu/jobs/1", http)).toBeNull();
    expect(http).not.toHaveBeenCalled();
  });
});
