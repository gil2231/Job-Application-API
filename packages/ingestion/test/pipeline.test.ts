import { strToU8 } from "fflate";
import { beforeEach, describe, expect, it } from "vitest";
import { deleteJobs, prisma, skipJobs, updateProfessional } from "@autoapply/database";
import { DEFAULT_MATCH_WEIGHTS, type QualificationResult } from "@autoapply/shared";
import { analyzeJobs, fileImportSource, jobFingerprint, prepareJob, rescoreJobs, runImport, urlListSource } from "../src";
import { BDR_DESCRIPTION, makeUser, resetDatabase } from "./helpers";

beforeEach(resetDatabase);

const csv = (...rows: string[]) => ({ fileName: "jobs.csv", bytes: strToU8(["url,title,company,location,description", ...rows].join("\n")) });
const quote = (s: string) => `"${s.replace(/"/g, '""')}"`;
const noFetch = { context: { fetchPosting: async () => null } };

async function setUpProfile(userId: string) {
  await prisma.masterProfile.upsert({ where: { userId }, update: { city: "New York", state: "NY" }, create: { userId, city: "New York", state: "NY" } });
  await updateProfessional(userId, {
    currentTitle: "Sales Development Representative",
    targetTitles: ["Business Development Representative"],
    summary: null,
    industries: ["SaaS"],
    yearsExperience: 2,
    skills: ["Salesforce", "Cold Calling"],
    software: [],
    technicalSkills: [],
    languages: [],
  } as never);
  await prisma.automationRule.upsert({
    where: { userId },
    update: { minMatchScore: 60, minSalary: 60000 },
    create: { userId, minMatchScore: 60, minSalary: 60000, matchWeights: DEFAULT_MATCH_WEIGHTS },
  });
}

describe("jobFingerprint and prepareJob", () => {
  it("matches the same role across sites", () => {
    expect(jobFingerprint("Acme, Inc.", "Sr. Account Executive")).toBe(jobFingerprint("acme", "Senior Account Executive"));
    expect(jobFingerprint("Acme", "Account Executive")).not.toBe(jobFingerprint("Acme", "Senior Account Executive"));
    expect(jobFingerprint("Acme", "BDR")).not.toBe(jobFingerprint("Acme", "SDR"));
  });

  it("keeps only LinkedIn ids and leaves placeholders unfingerprinted", () => {
    expect(prepareJob({ url: "https://jobs.lever.co/acme/1", title: "AE", company: "Acme", externalId: "lever-1" })?.externalId).toBeNull();
    const li = prepareJob({ url: "https://www.linkedin.com/jobs/view/3901234567/", title: "LinkedIn job 3901234567", company: "Unknown company", needsDetails: true });
    expect(li).toMatchObject({ externalId: "3901234567", fingerprint: null, platform: "LINKEDIN_EASY_APPLY" });
    expect(prepareJob({ url: "https://example.com/1", title: "", company: "Acme" })).toBeNull();
  });
});

describe("runImport", () => {
  it("stores new jobs, deduplicates and tracks the import", async () => {
    const user = await makeUser();
    const first = await runImport(
      user.id,
      fileImportSource,
      csv(
        "https://boards.greenhouse.io/acme/jobs/1?utm_source=linkedin,BDR,Acme,New York NY,",
        "https://boards.greenhouse.io/acme/jobs/1,BDR,Acme,New York NY,",
        "https://jobs.lever.co/globex/2,Account Executive,Globex,,",
        "not-a-url,Broken,Initech,,",
      ),
      { fileName: "jobs.csv" },
    );
    expect(first).toMatchObject({ total: 3, created: 2, duplicates: 1, failed: 1 });
    expect(first.issues.map((i) => i.kind).sort()).toEqual(["duplicate", "invalid"]);

    // Same role at the same company, posted on another site: caught by fingerprint.
    const second = await runImport(user.id, fileImportSource, csv("https://careers.globex.com/jobs/77,Account Executive,Globex Inc,,"));
    expect(second).toMatchObject({ created: 0, duplicates: 1 });
    expect(second.issues[0]!.message).toMatch(/Looks like "Account Executive"/);

    const imports = await prisma.jobImport.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    expect(imports.map((i) => [i.status, i.createdCount, i.duplicateCount, i.failedCount])).toEqual([
      ["COMPLETED", 2, 1, 1],
      ["COMPLETED", 0, 1, 0],
    ]);
    const jobs = await prisma.job.findMany({ where: { userId: user.id } });
    expect(jobs.every((j) => j.status === "IMPORTED" && j.importId === imports[0]!.id)).toBe(true);
  });

  it("doesn't re-add deleted or already processed jobs", async () => {
    const user = await makeUser();
    const rows = ["https://jobs.lever.co/acme/1,BDR,Acme,,", "https://jobs.lever.co/acme/2,SDR,Acme,,"];
    const { createdJobIds } = await runImport(user.id, fileImportSource, csv(...rows));
    await deleteJobs(user.id, [createdJobIds[0]!]);
    await skipJobs(user.id, [createdJobIds[1]!]);
    const again = await runImport(user.id, fileImportSource, csv(...rows));
    expect(again).toMatchObject({ created: 0, skipped: 2 });
    expect(again.issues.map((i) => i.kind)).toEqual(["previously_removed", "already_processed"]);
  });

  it("fills in missing details on an existing job and queues it for re-analysis", async () => {
    const user = await makeUser();
    const { createdJobIds } = await runImport(user.id, fileImportSource, csv("https://jobs.lever.co/acme/1,BDR,Acme,,"));
    await prisma.job.update({ where: { id: createdJobIds[0] }, data: { status: "NEEDS_DETAILS" } });
    const again = await runImport(user.id, fileImportSource, csv(`https://jobs.lever.co/acme/1,BDR,Acme,New York NY,${quote(BDR_DESCRIPTION)}`));
    expect(again.enrichedJobIds).toEqual(createdJobIds);
    const job = await prisma.job.findUniqueOrThrow({ where: { id: createdJobIds[0] } });
    expect(job).toMatchObject({ status: "IMPORTED", location: "New York NY" });
    expect(job.description).toContain("Business Development Representative");
  });

  it("adds pasted LinkedIn links as placeholders that need details", async () => {
    const user = await makeUser();
    const summary = await runImport(user.id, urlListSource, { text: "https://www.linkedin.com/jobs/view/3901234567/\nhttps://www.linkedin.com/jobs/view/3901234567" }, noFetch);
    expect(summary).toMatchObject({ created: 1, duplicates: 0, needsDetails: 1 });
    const job = await prisma.job.findFirstOrThrow({ where: { userId: user.id } });
    expect(job).toMatchObject({ externalId: "3901234567", sourceType: "MANUAL", fingerprint: null });
  });
});

describe("analyzeJobs and rescoreJobs", () => {
  it("analyzes, scores and qualifies imported jobs", async () => {
    const user = await makeUser();
    await setUpProfile(user.id);
    await runImport(
      user.id,
      fileImportSource,
      csv(
        `https://boards.greenhouse.io/acme/jobs/1,Business Development Representative,Acme,"New York, NY",${quote(BDR_DESCRIPTION)}`,
        `https://jobs.lever.co/acme/2,Senior Software Engineer,Acme,"New York, NY",${quote(BDR_DESCRIPTION.replace(/1\+ years/, "8+ years").replace(/\$65,000 - \$75,000/, "$40,000 - $45,000"))}`,
        "https://www.linkedin.com/jobs/view/3901234567/,Account Executive,Globex,,",
      ),
    );

    const summary = await analyzeJobs(user.id);
    expect(summary).toMatchObject({ analyzed: 3, qualified: 1, notQualified: 1, needsDetails: 1, failed: 0, method: "heuristic" });

    const jobs = await prisma.job.findMany({ where: { userId: user.id }, orderBy: { title: "asc" } });
    const [ae, bdr, swe] = jobs;
    expect(ae).toMatchObject({ status: "NEEDS_DETAILS" });
    expect(bdr).toMatchObject({ status: "QUALIFIED", salaryMin: 65000, salaryMax: 75000, experienceYearsMin: 1, workArrangement: "HYBRID", employmentType: "FULL_TIME" });
    expect(bdr!.matchScore).toBeGreaterThanOrEqual(60);
    expect(bdr!.skills).toEqual(expect.arrayContaining(["Salesforce", "Cold calling"]));
    expect(bdr!.analysis).toMatchObject({ version: 1, method: "heuristic", hasDescription: true });
    expect(swe!.status).toBe("NOT_QUALIFIED");
    const checks = (swe!.qualification as unknown as QualificationResult).checks;
    expect(checks.find((c) => c.rule === "minSalary")).toMatchObject({ outcome: "fail" });

    // Nothing left to analyze.
    expect((await analyzeJobs(user.id)).analyzed).toBe(0);
  });

  it("re-qualifies stored analysis when the rules change", async () => {
    const user = await makeUser();
    await setUpProfile(user.id);
    await runImport(user.id, fileImportSource, csv(`https://boards.greenhouse.io/acme/jobs/1,Business Development Representative,Acme,"New York, NY",${quote(BDR_DESCRIPTION)}`));
    await analyzeJobs(user.id);
    expect((await prisma.job.findFirstOrThrow({ where: { userId: user.id } })).status).toBe("QUALIFIED");

    await prisma.automationRule.update({ where: { userId: user.id }, data: { excludedCompanies: ["Acme"] } });
    expect(await rescoreJobs(user.id)).toEqual({ rescored: 1, qualified: 0 });
    const job = await prisma.job.findFirstOrThrow({ where: { userId: user.id } });
    expect(job.status).toBe("NOT_QUALIFIED");
    expect((job.qualification as unknown as QualificationResult).checks.find((c) => c.outcome === "fail")).toMatchObject({ rule: "excludedCompanies" });
  });

  it("falls back to NEEDS_DETAILS when the analyzer throws", async () => {
    const user = await makeUser();
    await runImport(user.id, fileImportSource, csv("https://jobs.lever.co/acme/1,BDR,Acme,,"));
    const summary = await analyzeJobs(user.id, {
      analyzer: {
        analyze: async () => {
          throw new Error("boom");
        },
      },
    });
    expect(summary).toMatchObject({ analyzed: 0, failed: 1 });
    expect((await prisma.job.findFirstOrThrow({ where: { userId: user.id } })).status).toBe("NEEDS_DETAILS");
  });
});
