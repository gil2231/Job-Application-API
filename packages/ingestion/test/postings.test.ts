import { describe, expect, it, vi } from "vitest";
import { assertFetchableUrl, fetchPosting, isPublicAddress, parseJobPostingJsonLd, UnsafeUrlError, type HttpFetcher } from "../src/postings";

/** A fake network: maps requested URLs to bodies and records every request. */
function fakeHttp(routes: Record<string, unknown>, contentType = "application/json") {
  const http = vi.fn<HttpFetcher>(async (url) => {
    if (!(url in routes)) throw new Error(`unexpected request ${url}`);
    const body = routes[url];
    return { url, status: 200, contentType, text: typeof body === "string" ? body : JSON.stringify(body) };
  });
  return http;
}

describe("fetchPosting", () => {
  it("reads Greenhouse's public board API", async () => {
    const http = fakeHttp({
      "https://boards-api.greenhouse.io/v1/boards/acme/jobs/4012345?pay_transparency=true": {
        title: "Account Executive",
        company_name: "Acme Inc",
        location: { name: "New York, NY" },
        content: "&lt;p&gt;Sell software&lt;/p&gt;",
        absolute_url: "https://boards.greenhouse.io/acme/jobs/4012345",
        first_published: "2026-09-01T00:00:00Z",
        pay_input_ranges: [{ min_cents: 9000000, max_cents: 11000000, currency_type: "USD" }],
      },
    });
    const job = await fetchPosting("https://boards.greenhouse.io/acme/jobs/4012345?gh_src=x", http);
    expect(job).toMatchObject({ title: "Account Executive", company: "Acme Inc", location: "New York, NY", salaryText: "USD 90,000 - 110,000 per year" });
    expect(job!.url).toBe("https://boards.greenhouse.io/acme/jobs/4012345?gh_src=x");
  });

  it("reads Lever postings, including lists and workplace type", async () => {
    const id = "0a1b2c3d-1111-2222-3333-444455556666";
    const http = fakeHttp({
      [`https://api.lever.co/v0/postings/acme-corp/${id}`]: {
        text: "SDR",
        categories: { location: "Remote - US" },
        description: "<p>Intro</p>",
        lists: [{ text: "Requirements", content: "<li>1+ years in sales</li>" }],
        workplaceType: "remote",
        salaryRange: { min: 60000, max: 70000, currency: "USD", interval: "per-year-salary" },
      },
    });
    const job = await fetchPosting(`https://jobs.lever.co/acme-corp/${id}/apply`, http);
    expect(job).toMatchObject({ title: "SDR", company: "Acme Corp", workArrangement: "REMOTE", salaryText: "USD 60,000 - 70,000 per year" });
    expect(job!.description).toContain("<h3>Requirements</h3><ul><li>1+ years in sales</li></ul>");
  });

  it("finds the posting on an Ashby board and reports closed ones", async () => {
    const id = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const http = fakeHttp({
      "https://api.ashbyhq.com/posting-api/job-board/acme?includeCompensation=true": {
        jobs: [{ id, title: "Solutions Engineer", location: "Boston", descriptionHtml: "<p>Demo</p>", workplaceType: "Hybrid", compensation: { scrapeableCompensationSalarySummary: "$120K – $150K" } }],
      },
    });
    expect(await fetchPosting(`https://jobs.ashbyhq.com/acme/${id}`, http)).toMatchObject({ title: "Solutions Engineer", workArrangement: "HYBRID", salaryText: "$120K – $150K" });
    await expect(fetchPosting("https://jobs.ashbyhq.com/acme/ffffffff-bbbb-cccc-dddd-eeeeeeeeeeee", http)).rejects.toThrow(/not found/);
  });

  it("reads SmartRecruiters and Workday postings", async () => {
    const http = fakeHttp({
      "https://api.smartrecruiters.com/v1/companies/Globex/postings/744000012345": {
        name: "Inside Sales Rep",
        company: { name: "Globex" },
        location: { city: "Chicago", region: "IL", remote: false },
        jobAd: { sections: { jobDescription: { title: "Job Description", text: "<p>Call customers</p>" } } },
      },
      "https://initech.wd5.myworkdayjobs.com/wday/cxs/initech/External/job/Austin-TX/Account-Manager_R123": {
        jobPostingInfo: { title: "Account Manager", location: "Austin, TX", jobDescription: "<p>Grow accounts</p>", remoteType: "Hybrid", jobReqId: "R123" },
        hiringOrganization: { name: "Initech" },
      },
    });
    expect(await fetchPosting("https://jobs.smartrecruiters.com/Globex/744000012345-inside-sales-rep", http)).toMatchObject({ title: "Inside Sales Rep", location: "Chicago, IL" });
    expect(await fetchPosting("https://initech.wd5.myworkdayjobs.com/en-US/External/job/Austin-TX/Account-Manager_R123", http)).toMatchObject({
      title: "Account Manager",
      company: "Initech",
      workArrangement: "HYBRID",
    });
  });

  it("reads schema.org JobPosting data from any careers page", async () => {
    const html = `<html><head><script type="application/ld+json">${JSON.stringify({
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "Organization", name: "Ignored" },
        {
          "@type": "JobPosting",
          title: "Customer Success Manager",
          hiringOrganization: { "@type": "Organization", name: "Umbrella" },
          jobLocation: { "@type": "Place", address: { addressLocality: "Denver", addressRegion: "CO", addressCountry: "US" } },
          baseSalary: { currency: "USD", value: { minValue: 80000, maxValue: 95000, unitText: "YEAR" } },
          employmentType: "FULL_TIME",
          description: "<p>Help customers</p>",
        },
      ],
    })}</script></head></html>`;
    const http = fakeHttp({ "https://careers.umbrella.com/jobs/42": html }, "text/html; charset=utf-8");
    expect(await fetchPosting("https://careers.umbrella.com/jobs/42", http)).toMatchObject({
      title: "Customer Success Manager",
      company: "Umbrella",
      location: "Denver, CO, US",
      salaryText: "USD 80,000 - 95,000 per year",
    });
    expect(parseJobPostingJsonLd("<html><body>No data</body></html>", "https://x.com")).toBeNull();
  });

  it("never requests LinkedIn", async () => {
    const http = fakeHttp({});
    expect(await fetchPosting("https://www.linkedin.com/jobs/view/3901234567/", http)).toBeNull();
    expect(await fetchPosting("https://linkedin.com/company/acme/jobs", http)).toBeNull();
    expect(http).not.toHaveBeenCalled();
  });
});

describe("SSRF protection", () => {
  it("classifies private and public addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) {
      expect(isPublicAddress(ip), ip).toBe(false);
    }
    for (const ip of ["8.8.8.8", "172.32.0.1", "151.101.1.1", "2606:4700::1111"]) expect(isPublicAddress(ip), ip).toBe(true);
    expect(isPublicAddress("not-an-ip")).toBe(false);
  });

  it("refuses unsafe URLs before any request", () => {
    for (const url of [
      "ftp://example.com/x",
      "http://127.0.0.1/admin",
      "http://[::1]/",
      "http://169.254.169.254/latest/meta-data",
      "https://example.com:8443/",
      "https://user:pass@example.com/",
      "http://localhost/",
      "http://db.internal/",
    ]) {
      expect(() => assertFetchableUrl(url), url).toThrow(UnsafeUrlError);
    }
    expect(assertFetchableUrl("https://boards.greenhouse.io/acme/jobs/1").hostname).toBe("boards.greenhouse.io");
  });
});
