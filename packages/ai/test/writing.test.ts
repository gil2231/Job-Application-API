import { describe, expect, it } from "vitest";
import { checkClaims, factSheet, generateCoverLetter, generateResume, profileRoles, RESUME_TAILORING_JSON_SCHEMA, COVER_LETTER_JSON_SCHEMA } from "../src";
import { fakeProvider, JOB, NOW, PROFILE } from "./writing-fixtures";

const sheet = factSheet(PROFILE, NOW);
const check = (text: string) => checkClaims(text, { profile: PROFILE, job: JOB, factSheet: sheet });

describe("checkClaims", () => {
  it("accepts text built from profile facts", () => {
    expect(check("Account Executive at Brightwave who closed $1.2M in new ARR, 130% of quota, using Salesforce and HubSpot.").ok).toBe(true);
    expect(check("I hold a bachelor's degree in Communication from Rutgers University.").ok).toBe(true);
    expect(check("I'd like to bring my experience to Acme Payments.").ok).toBe(true);
  });

  it("rejects numbers, skills, credentials and employers the profile doesn't show", () => {
    expect(check("Closed $3M in new business.").problems).toEqual(['the figure "$3M"']);
    expect(check("Experienced with Kubernetes and Salesforce.").problems).toEqual(['the skill "Kubernetes"']);
    expect(check("An MBA-trained seller.").problems).toEqual(['"MBA"']);
    expect(check("Previously a top seller at Oracle.").problems).toEqual(['"Oracle"']);
    expect(check("Certified Salesforce administrator.").ok).toBe(false);
  });
});

describe("generateResume (no AI)", () => {
  it("builds the resume from the profile, with the job's skills and most relevant bullets first", async () => {
    const { content } = await generateResume({ profile: PROFILE, job: JOB, unavailableReason: "No AI provider is configured", now: NOW });
    expect(content.generation).toMatchObject({ method: "template", model: null, fallbackReason: "No AI provider is configured" });
    expect(content.header).toEqual({ name: "Jordan Rivera", headline: "Account Executive", contact: ["jordan@example.com", "212-555-0100", "New York, NY", "https://www.linkedin.com/in/jordan-rivera"] });
    expect(content.summary).toBe("Account Executive with 6 years of professional experience, skilled in Salesforce, Negotiation and HubSpot.");
    // Skills the job asks for come first, and only skills the profile has appear.
    expect(content.skills.slice(0, 3)).toEqual(["Salesforce", "HubSpot", "Negotiation"]);
    expect(content.skills).not.toContain("Kubernetes");
    expect(content.experience[0]).toMatchObject({ company: "Brightwave", title: "Account Executive", dates: "Mar 2022 – Present" });
    expect(content.experience[0]!.bullets[0]).toBe("Built a Salesforce dashboard the team uses for pipeline reviews");
    expect(content.experience[1]!.dates).toBe("Jan 2020 – Feb 2022");
    // Every bullet is one of the person's own, unchanged.
    const own = new Set(profileRoles(PROFILE).flatMap((r) => r.bullets.map((b) => b.text)));
    expect(content.experience.flatMap((e) => e.bullets).every((b) => own.has(b))).toBe(true);
    expect(content.education[0]).toEqual({ school: "Rutgers University", credential: "Bachelor of Arts in Communication", dates: "May 2019", details: ["GPA 3.6"] });
    expect(content.generation.matchedSkills).toEqual(["Salesforce", "Negotiation", "HubSpot"]);
  });

  it("keeps the person's own summary when they wrote one", async () => {
    const { content } = await generateResume({ profile: { ...PROFILE, summary: "Seller who loves finance teams." }, job: JOB, now: NOW });
    expect(content.summary).toBe("Seller who loves finance teams.");
  });
});

describe("generateResume (AI)", () => {
  it("uses the model's bullet and skill choices, dropping anything not in the profile", async () => {
    const provider = fakeProvider(() => ({
      summary: "Account Executive at Brightwave with 6 years in sales, closing $1.2M in new ARR in 2024.",
      roles: [
        { roleId: "r1", bulletIds: ["r1.b1", "r1.b3", "r9.b1", "r2.b1"] },
        { roleId: "r2", bulletIds: [] },
      ],
      skills: ["negotiation", "Salesforce", "Kubernetes"],
    }));
    const { content } = await generateResume({ profile: PROFILE, job: JOB, provider, now: NOW });
    expect(provider.calls[0]!.jsonSchema).toBe(RESUME_TAILORING_JSON_SCHEMA);
    expect(provider.calls[0]!.messages[1]!.content).toContain("[r1.b1] Closed $1.2M in new ARR in 2024, 130% of quota");
    expect(content.generation).toMatchObject({ method: "ai", model: "fake-model-1" });
    expect(content.generation.fallbackReason).toBe("dropped skills that aren't in your profile");
    expect(content.summary).toBe("Account Executive at Brightwave with 6 years in sales, closing $1.2M in new ARR in 2024.");
    // Unknown ids and another role's bullets are ignored.
    expect(content.experience[0]!.bullets).toEqual(["Closed $1.2M in new ARR in 2024, 130% of quota", "Run discovery calls and demos for mid-market finance teams"]);
    // A role the model left empty keeps its deterministic choice.
    expect(content.experience[1]!.bullets.length).toBeGreaterThan(0);
    expect(content.skills).toEqual(["Negotiation", "Salesforce"]);
  });

  it("replaces a summary that invents facts with the template summary", async () => {
    const provider = fakeProvider(() => ({ summary: "MBA-holding seller who closed $5M at Oracle.", roles: [], skills: [] }));
    const { content } = await generateResume({ profile: PROFILE, job: JOB, provider, now: NOW });
    expect(content.summary).toBe("Account Executive with 6 years of professional experience, skilled in Salesforce, Negotiation and HubSpot.");
    expect(content.generation.method).toBe("ai");
    expect(content.generation.fallbackReason).toMatch(/AI text mentioned .*\$5M.*MBA.*Oracle|AI text mentioned/);
    expect(content.generation.fallbackReason).toContain("written from your profile instead");
  });

  it("falls back to the template when the provider fails", async () => {
    const provider = fakeProvider(() => new Error("rate limited"));
    const { content } = await generateResume({ profile: PROFILE, job: JOB, provider, now: NOW });
    expect(content.generation.method).toBe("template");
    expect(content.generation.fallbackReason).toContain("rate limited");
    expect(content.experience[0]!.bullets.length).toBeGreaterThan(0);
  });
});

describe("generateCoverLetter", () => {
  it("writes a template letter from profile facts and the person's own bullets", async () => {
    const { content } = await generateCoverLetter({ profile: PROFILE, job: JOB, now: NOW });
    expect(content.generation.method).toBe("template");
    const [greeting, opening] = content.paragraphs;
    expect(greeting).toBe("Dear Acme Payments hiring team,");
    expect(opening).toBe("I'm writing to apply for the Senior Account Executive position at Acme Payments. I'm currently an Account Executive at Brightwave, with 6 years of professional experience.");
    expect(content.paragraphs.filter((p) => p.startsWith("• "))).toHaveLength(3);
    expect(content.paragraphs).toContain("The role calls for experience with Salesforce, Negotiation and HubSpot, which are part of my background.");
    expect(content.paragraphs.slice(-2)).toEqual(["Sincerely,", "Jordan Rivera"]);
    // The template passes its own truthfulness check.
    expect(check(content.paragraphs.join("\n")).ok).toBe(true);
  });

  it("uses the model's body when every claim checks out", async () => {
    const provider = fakeProvider(() => ({ paragraphs: ["I'd like to bring my sales experience to Acme Payments.", "At Brightwave I closed $1.2M in new ARR in 2024 and built a Salesforce dashboard for pipeline reviews."] }));
    const { content } = await generateCoverLetter({ profile: PROFILE, job: JOB, provider, now: NOW });
    expect(provider.calls[0]!.jsonSchema).toBe(COVER_LETTER_JSON_SCHEMA);
    expect(content.generation).toMatchObject({ method: "ai", model: "fake-model-1", fallbackReason: null });
    expect(content.paragraphs).toEqual(["Dear Acme Payments hiring team,", "I'd like to bring my sales experience to Acme Payments.", "At Brightwave I closed $1.2M in new ARR in 2024 and built a Salesforce dashboard for pipeline reviews.", "Sincerely,", "Jordan Rivera"]);
  });

  it("rejects a body that claims skills the person doesn't have", async () => {
    const provider = fakeProvider(() => ({ paragraphs: ["I've deployed Kubernetes clusters for 10 years."] }));
    const { content } = await generateCoverLetter({ profile: PROFILE, job: JOB, provider, now: NOW });
    expect(content.generation.method).toBe("template");
    expect(content.generation.fallbackReason).toContain("Kubernetes");
    expect(content.paragraphs.join(" ")).not.toContain("Kubernetes");
  });
});
