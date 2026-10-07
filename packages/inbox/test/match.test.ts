import { describe, expect, it } from "vitest";
import { matchApplication, mightBeAboutApplications, normalizeCompany, type MatchCandidate } from "../src";

const apps: MatchCandidate[] = [
  { id: "a1", company: "Acme, Inc.", title: "Account Executive", urls: [] },
  { id: "a2", company: "Acme, Inc.", title: "Sales Development Representative", urls: [] },
  { id: "b1", company: "Ramp", title: "Account Executive", urls: [] },
  { id: "c1", company: "Northwind Traders", title: "Customer Success Manager", urls: [] },
];
const mail = (fromName: string | null, fromAddress: string, subject: string, text = "") => ({ fromName, fromAddress, subject, text });

describe("normalizeCompany", () => {
  it("drops legal suffixes and punctuation", () => {
    expect(normalizeCompany("Acme, Inc.")).toBe("acme");
    expect(normalizeCompany("Johnson & Johnson LLC")).toBe("johnson and johnson");
  });
});

describe("matchApplication", () => {
  it("matches the company's own domain and picks the job by title", () => {
    expect(matchApplication(mail("Priya", "priya@acme.com", "Your Account Executive application"), apps)).toEqual({ result: "matched", applicationId: "a1", strength: "strong" });
  });

  it("matches an applicant tracking system email by the company in the sender name", () => {
    expect(matchApplication(mail("Northwind Traders Hiring Team", "no-reply@greenhouse.io", "Thank you"), apps)).toEqual({ result: "matched", applicationId: "c1", strength: "strong" });
  });

  it("calls two applications at one company with no title ambiguous", () => {
    expect(matchApplication(mail("Acme Recruiting", "jobs@acme.com", "Update on your application"), apps)).toEqual({ result: "ambiguous", candidates: ["a1", "a2"] });
  });

  it("uses an earlier match in the same thread", () => {
    expect(matchApplication(mail("Acme Recruiting", "jobs@acme.com", "Re: next steps"), apps, "a2")).toEqual({ result: "matched", applicationId: "a2", strength: "strong" });
  });

  it("needs a one-word company in the body to be written as a name", () => {
    expect(matchApplication(mail("Pat", "pat@gmail.com", "Hello", "We need to ramp up hiring"), apps)).toEqual({ result: "unmatched" });
    expect(matchApplication(mail("Pat", "pat@gmail.com", "Hello", "Thanks for interviewing with Ramp this week"), apps)).toEqual({ result: "matched", applicationId: "b1", strength: "body" });
  });

  it("doesn't take a free mailbox domain for a company", () => {
    expect(matchApplication(mail(null, "someone@outlook.com", "Hi"), [{ id: "o1", company: "Outlook", title: "x", urls: [] }])).toEqual({ result: "unmatched" });
  });
});

describe("mightBeAboutApplications", () => {
  it("lets through hiring systems and mentions of companies applied to", () => {
    const companies = apps.map((a) => a.company);
    expect(mightBeAboutApplications({ fromName: "Lever", fromAddress: "no-reply@hire.lever.co", subject: "x", snippet: "" }, companies)).toBe(true);
    expect(mightBeAboutApplications({ fromName: "Recruiting", fromAddress: "talent@acme.com", subject: "Hello", snippet: "" }, companies)).toBe(true);
    expect(mightBeAboutApplications({ fromName: "Mom", fromAddress: "mom@example.com", subject: "Dinner", snippet: "See you Sunday" }, companies)).toBe(false);
  });
});
