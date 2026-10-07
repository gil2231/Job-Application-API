import { beforeEach, describe, expect, it } from "vitest";
import { answerSchema, employmentSchema, professionalSchema, resumeImportSchema } from "@autoapply/shared";
import { prisma } from "../src/client";
import {
  createEmployment,
  deleteEmployment,
  getFullProfile,
  importResumeIntoProfile,
  profileCompleteness,
  updatePersonal,
  updateProfessional,
} from "../src/repositories/profile";
import { createDocument, deleteDocument, listDocuments, setDefaultDocument } from "../src/repositories/documents";
import { createAnswer, getAnswerSuggestions, listAnswers } from "../src/repositories/answers";
import { NotFoundError } from "../src/repositories/errors";
import { makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

const file = (key: string) => ({ fileName: `${key}.pdf`, mimeType: "application/pdf", sizeBytes: 1000, storageKey: key, sha256: "x" });

describe("master profile", () => {
  it("replaces skills by category without duplicates", async () => {
    const user = await makeUser();
    await updateProfessional(user.id, professionalSchema.parse({ skills: "Sales, CRM, sales", software: "Salesforce", languages: "English, Spanish" }));
    await updateProfessional(user.id, professionalSchema.parse({ skills: "Prospecting", software: "HubSpot" }));
    const profile = await getFullProfile(user.id);
    expect(profile.skills.map((s) => `${s.category}:${s.name}`).sort()).toEqual(["SKILL:Prospecting", "SOFTWARE:HubSpot"]);
  });

  it("scopes employment edits to the owner", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const role = await createEmployment(a.id, employmentSchema.parse({ company: "Acme", title: "BDR", startDate: "2022-01-01", isCurrent: "on" }));
    await expect(deleteEmployment(b.id, role.id)).rejects.toBeInstanceOf(NotFoundError);
    const profile = await getFullProfile(a.id);
    expect(profile.employment).toHaveLength(1);
    expect(profileCompleteness(profile, { resumes: 0 }).missing).toContain("Resume");
  });
});

describe("resume import", () => {
  it("writes only the confirmed fields, adds skills without duplicates and appends records", async () => {
    const user = await makeUser();
    await updatePersonal(user.id, { firstName: "Janet", lastName: "Doe", phone: "212-555-0100" });
    await updateProfessional(user.id, professionalSchema.parse({ skills: "Negotiation", software: "Salesforce" }));
    await createEmployment(user.id, employmentSchema.parse({ company: "Old Co", title: "Rep", startDate: "2015-01-01", endDate: "2016-01-01" }));

    const input = resumeImportSchema.parse({
      personal: { firstName: "Jane", email: "Jane.Doe@Example.com", linkedinUrl: "https://linkedin.com/in/janedoe" },
      summary: "Quota-carrying seller.",
      skills: { skills: ["negotiation", "Prospecting"], software: ["Salesforce", "HubSpot"], languages: ["Spanish (professional)"] },
      employment: [{ company: "Northwind Software Inc.", title: "Senior Account Executive", startDate: "2022-01", isCurrent: true, achievements: ["Closed $1.2M in new ARR"] }],
      education: [{ school: "University of Texas at Austin", degree: "BBA", major: "Marketing", gpa: 3.6, gpaScale: 4, graduationDate: "2019-05" }],
    });
    const result = await importResumeIntoProfile(user.id, input);
    expect(result).toEqual({ fieldsUpdated: 4, skillsAdded: 3, employmentAdded: 1, educationAdded: 1 });

    const profile = await getFullProfile(user.id);
    // Unconfirmed fields keep their value.
    expect(profile).toMatchObject({ firstName: "Jane", lastName: "Doe", phone: "212-555-0100", email: "jane.doe@example.com", summary: "Quota-carrying seller." });
    expect(profile.skills.map((s) => `${s.category}:${s.name}`).sort()).toEqual([
      "LANGUAGE:Spanish (professional)",
      "SKILL:Negotiation",
      "SKILL:Prospecting",
      "SOFTWARE:HubSpot",
      "SOFTWARE:Salesforce",
    ]);
    expect(profile.employment.map((e) => e.company)).toEqual(["Northwind Software Inc.", "Old Co"]);
    expect(profile.employment[0]).toMatchObject({ isCurrent: true, endDate: null, startDate: new Date("2022-01-01T00:00:00Z") });
    expect(profile.education[0]).toMatchObject({ school: "University of Texas at Austin", gpa: 3.6, graduationDate: new Date("2019-05-01T00:00:00Z") });
  });

  it("rejects invalid records before writing anything", () => {
    expect(resumeImportSchema.safeParse({ employment: [{ company: "Acme", title: "Rep" }] }).success).toBe(false);
    expect(resumeImportSchema.safeParse({ personal: { email: "not-an-email" } }).success).toBe(false);
  });
});

describe("documents", () => {
  it("keeps exactly one default resume and promotes another on delete", async () => {
    const user = await makeUser();
    const first = await createDocument(user.id, { type: "RESUME", name: "General", isDefault: false }, file("k1"));
    const second = await createDocument(user.id, { type: "RESUME", name: "Sales", isDefault: true }, file("k2"));
    let docs = await listDocuments(user.id);
    expect(docs.filter((d) => d.isDefault).map((d) => d.id)).toEqual([second.id]);

    await setDefaultDocument(user.id, first.id);
    docs = await listDocuments(user.id);
    expect(docs.filter((d) => d.isDefault).map((d) => d.id)).toEqual([first.id]);

    await expect(prisma.resume.updateMany({ where: { userId: user.id }, data: { isDefault: true } })).rejects.toMatchObject({ code: "P2002" });

    await deleteDocument(user.id, first.id);
    docs = await listDocuments(user.id);
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ id: second.id, isDefault: true });
  });
});

describe("answer library", () => {
  it("encrypts demographic answers at rest", async () => {
    const user = await makeUser();
    await createAnswer(user.id, answerSchema.parse({ question: "Gender", answer: "Prefer not to say", category: "DEMOGRAPHIC", autoSubmitAllowed: "on" }));
    const raw = await prisma.applicationAnswer.findFirstOrThrow();
    expect(raw.answer.startsWith("enc:v1:")).toBe(true);
    expect((await listAnswers(user.id))[0]!.answer).toBe("Prefer not to say");
  });

  it("flags an empty answer for review and never auto-submits it", async () => {
    const user = await makeUser();
    const created = await createAnswer(user.id, answerSchema.parse({ question: "Why us?", answer: "", category: "MOTIVATION", autoSubmitAllowed: "on" }));
    expect(created).toMatchObject({ autoSubmitAllowed: false, requiresHumanReview: true });
  });

  it("suggests only what the profile states", async () => {
    const user = await makeUser();
    await prisma.masterProfile.update({ where: { userId: user.id }, data: { linkedinUrl: "https://linkedin.com/in/me" } });
    const suggestions = await getAnswerSuggestions(user.id);
    expect(suggestions.find((s) => s.key === "linkedin_url")?.derived).toMatchObject({ confidence: 1 });
    expect(suggestions.find((s) => s.key === "salary_expectations")?.derived).toBeNull();
  });
});
