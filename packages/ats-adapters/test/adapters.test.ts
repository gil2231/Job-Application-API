import { describe, expect, it } from "vitest";
import { AUTOMATED_PLATFORMS, createDefaultRegistry, detectPlatformFromHtml, platformScore } from "../src";

/** Trimmed-down markup in the shape each ATS really serves. */
const PAGES = {
  GREENHOUSE: '<form id="application_form" action="/acme/jobs/1"><input name="job_application[first_name]"></form>',
  LEVER: '<a class="postings-btn template-btn-submit" href="/acme/1/apply">Apply for this job</a>',
  ASHBY: '<input id="_systemfield_name" name="_systemfield_name">',
  WORKDAY: '<a role="button" data-automation-id="adventureButton">Apply</a>',
  SMARTRECRUITERS: '<oc-application-form><spl-input name="firstName" label="First name"></spl-input></oc-application-form>',
} as const;

describe("bundled adapters", () => {
  it("registers an adapter for every automated platform, and none for LinkedIn Easy Apply", () => {
    const registry = createDefaultRegistry();
    expect(registry.list().map((a) => a.platform).sort()).toEqual([...AUTOMATED_PLATFORMS].sort());
    expect(registry.has("LINKEDIN_EASY_APPLY")).toBe(false);
    for (const adapter of registry.list()) expect(adapter.supportsAutoSubmit).toBe(true);
  });

  it.each(Object.entries(PAGES))("recognizes %s from its form structure on an employer's own domain", async (platform, html) => {
    expect(detectPlatformFromHtml("https://careers.example.com/jobs/1", html)).toMatchObject({ platform, confidence: 85 });
    const { adapter, detection } = await createDefaultRegistry().resolve("https://careers.example.com/jobs/1", html);
    expect(adapter?.platform).toBe(platform);
    expect(detection.platform).toBe(platform);
  });

  it.each([
    ["https://boards.greenhouse.io/acme/jobs/1", "GREENHOUSE"],
    ["https://jobs.lever.co/acme/1b2c", "LEVER"],
    ["https://jobs.ashbyhq.com/acme/1b2c", "ASHBY"],
    ["https://acme.wd1.myworkdayjobs.com/External/job/NYC/BDR_R1", "WORKDAY"],
    ["https://jobs.smartrecruiters.com/Acme/7434", "SMARTRECRUITERS"],
  ] as const)("each adapter claims its own hosts: %s", async (url, platform) => {
    const registry = createDefaultRegistry();
    expect((await registry.resolve(url)).adapter?.platform).toBe(platform);
    for (const adapter of registry.list()) {
      const score = await adapter.detect(url);
      if (adapter.platform === platform) expect(score).toBe(95);
      else expect(score).toBeLessThan(70);
    }
  });

  it("falls back to the generic adapter for an ordinary careers form", async () => {
    const { adapter } = await createDefaultRegistry().resolve("https://careers.example.com/apply", '<form><label for="n">Name</label><input id="n"></form>');
    expect(adapter?.platform).toBe("GENERIC");
  });

  it("scores platforms from URL first, then form structure, then embeds", () => {
    expect(platformScore("LEVER", "https://jobs.lever.co/acme/1")).toBe(95);
    expect(platformScore("LEVER", "https://careers.acme.com", PAGES.LEVER)).toBe(85);
    expect(platformScore("LEVER", "https://careers.acme.com", '<script src="https://jobs.lever.co/embed.js"></script>')).toBe(80);
    expect(platformScore("LEVER", "https://careers.acme.com", PAGES.GREENHOUSE)).toBe(0);
  });

  it("doesn't mistake a job description that mentions an ATS for its form", () => {
    expect(detectPlatformFromHtml("https://careers.acme.com/1", "<p>Experience with Workday HCM and Greenhouse reporting is a plus.</p>").platform).toBe("GENERIC");
  });
});
