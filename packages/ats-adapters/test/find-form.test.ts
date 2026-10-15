import { describe, expect, it } from "vitest";
import { findApplicationForm, greenhouseEmbedForRedirect, isAtsApplicationUrl, type PageSnapshot } from "../src/find-form";

const page = (over: Partial<PageSnapshot>): PageSnapshot => ({ url: "https://careers.example.com/jobs/bdr", html: "<main><h1>BDR</h1></main>", frames: [], links: [], fieldCount: 0, ...over });

describe("isAtsApplicationUrl", () => {
  it.each([
    ["https://boards.greenhouse.io/embed/job_app?for=acme&token=123", true],
    ["https://job-boards.greenhouse.io/acme/jobs/4012345", true],
    ["https://boards.greenhouse.io/embed/job_board?for=acme", false],
    ["https://jobs.lever.co/acme/1b2c3d4e-0000-4000-8000-1234567890ab", true],
    ["https://jobs.lever.co/acme", false],
    ["https://jobs.ashbyhq.com/ramp/1b2c3d4e-0000-4000-8000-1234567890ab/application", true],
    ["https://acme.wd5.myworkdayjobs.com/en-US/External/job/NYC/BDR_R123", true],
    ["https://jobs.smartrecruiters.com/Acme/744000012345678-bdr", true],
    ["https://careers.acme.com/jobs/123", false],
    ["http://boards.greenhouse.io/acme/jobs/1", false],
  ])("%s → %s", (url, expected) => {
    expect(isAtsApplicationUrl(url)).toBe(expected);
  });
});

describe("findApplicationForm", () => {
  it("opens the ATS form a careers page shows in an iframe", () => {
    const frames = [
      { url: "https://www.googletagmanager.com/ns.html?id=GTM-1", html: "" },
      { url: "https://boards.greenhouse.io/embed/job_app?for=acme&token=123", html: "" },
    ];
    expect(findApplicationForm(page({ frames }))).toEqual({ url: "https://boards.greenhouse.io/embed/job_app?for=acme&token=123", via: "iframe", platform: "GREENHOUSE" });
  });

  it("recognizes a framed form by its markup when the address says nothing", () => {
    const frames = [{ url: "https://apply.acme-hiring.com/form/9", html: '<form id="application_form" data-source="greenhouse"></form>' }];
    expect(findApplicationForm(page({ frames }))?.url).toBe("https://apply.acme-hiring.com/form/9");
  });

  it("builds Greenhouse's embed link from gh_jid before the embed script draws the form (Betterment)", () => {
    const snapshot = page({
      url: "https://www.betterment.com/careers/current-openings/job?gh_jid=8195434&gh_jid=8195434",
      html: '<div id="grnhse_app"></div><script src="https://boards.greenhouse.io/embed/job_board/js?for=betterment"></script>',
    });
    expect(findApplicationForm(snapshot)).toEqual({ url: "https://boards.greenhouse.io/embed/job_app?for=betterment&token=8195434", via: "greenhouse_job_id", platform: "GREENHOUSE" });
  });

  it("follows an Apply link out to the company's ATS", () => {
    const links = [
      { text: "Benefits", href: "https://careers.example.com/benefits" },
      { text: "Apply now", href: "https://jobs.lever.co/acme/1b2c3d4e-0000-4000-8000-1234567890ab/apply" },
      { text: "Other job", href: "https://jobs.lever.co/acme/9b2c3d4e-0000-4000-8000-1234567890ab" },
    ];
    expect(findApplicationForm(page({ links }))).toMatchObject({ url: "https://jobs.lever.co/acme/1b2c3d4e-0000-4000-8000-1234567890ab/apply", via: "link", platform: "LEVER" });
  });

  it("doesn't pick between several jobs when none says Apply", () => {
    const links = [
      { text: "BDR", href: "https://jobs.lever.co/acme/1b2c3d4e-0000-4000-8000-1234567890ab" },
      { text: "AE", href: "https://jobs.lever.co/acme/9b2c3d4e-0000-4000-8000-1234567890ab" },
    ];
    expect(findApplicationForm(page({ links }))).toBeNull();
  });

  it("stays on a page that has its own form", () => {
    const frames = [{ url: "https://boards.greenhouse.io/embed/job_app?for=acme&token=123", html: "" }];
    expect(findApplicationForm(page({ frames, fieldCount: 6 }))).toBeNull();
    expect(findApplicationForm(page({ frames, html: '<form id="application_form"></form>' }))).toBeNull();
  });
});

describe("greenhouseEmbedForRedirect", () => {
  it("opens Greenhouse's own copy of a job that forwards to the employer's site", () => {
    expect(greenhouseEmbedForRedirect("https://boards.greenhouse.io/stripe/jobs/8246785", "https://stripe.com/jobs/search?gh_jid=8246785")).toBe("https://boards.greenhouse.io/embed/job_app?for=stripe&token=8246785");
    expect(greenhouseEmbedForRedirect("https://job-boards.greenhouse.io/scaleai/jobs/4012345", "https://job-boards.greenhouse.io/scaleai/jobs/4012345")).toBeNull();
    expect(greenhouseEmbedForRedirect("https://careers.acme.com/jobs/1", "https://www.acme.com/jobs/1")).toBeNull();
  });
});
