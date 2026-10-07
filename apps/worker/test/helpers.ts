import { createDefaultRegistry } from "@autoapply/ats-adapters";
import { claimApplication, createAnswer, createDocument, createManualJob, getUserSettings, prisma, queueApplications, updatePersonal, updateProfessional } from "@autoapply/database";
import { buildStorageKey, getStorage, sha256Hex } from "@autoapply/documents";
import type { AnswerCategory, AutomationMode } from "@autoapply/shared";
import { resetDatabase, makeUser } from "../../../packages/database/test/helpers";
import { BrowserPool } from "../src/browser";
import { loadConfig, type WorkerConfig } from "../src/config";
import { ApplicationEngine, type RunResult } from "../src/engine";
import type { SiteHealth } from "../src/site-health";

export { resetDatabase, makeUser };

export const PDF = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");

export function testConfig(overrides: Partial<WorkerConfig> = {}): WorkerConfig {
  return { ...loadConfig({}), leaseMs: 30_000, interactiveWaitMs: 20_000, navigationTimeoutMs: 15_000, ...overrides };
}

/** A pool that runs headless but behaves as if a person can see the window (for the interactive checkpoint). */
export class VisibleBrowserPool extends BrowserPool {
  override get interactive() {
    return true;
  }
}

export function makeEngine(options: { config?: WorkerConfig; browsers?: BrowserPool; workerId?: string; siteHealth?: SiteHealth } = {}) {
  const config = options.config ?? testConfig();
  const browsers = options.browsers ?? new BrowserPool({ ...config, headless: true });
  const registry = createDefaultRegistry();
  const workerId = options.workerId ?? "test-worker";
  const engine = new ApplicationEngine({ config, browsers, registry, storage: getStorage(), redis: null, workerId, siteHealth: options.siteHealth });
  return { engine, browsers, config, workerId };
}

export interface ApplicantOptions {
  mode?: AutomationMode;
  autoSubmit?: boolean;
  requiresSponsorship?: boolean;
  resume?: boolean;
  coverLetter?: boolean;
  profile?: Partial<Parameters<typeof updatePersonal>[1]>;
  library?: Array<{ key: string; question: string; answer: string; category: AnswerCategory; review?: boolean; auto?: boolean; confidence?: number }>;
}

/** A user with a filled-in profile, a resume, and Answer Library entries for the usual questions. */
export async function makeApplicant(options: ApplicantOptions = {}) {
  const user = await makeUser("Jordan Rivera");
  await updatePersonal(user.id, {
    firstName: "Jordan",
    lastName: "Rivera",
    email: "jordan@example.com",
    phone: "212-555-0100",
    city: "New York",
    state: "NY",
    country: "United States",
    linkedinUrl: "https://www.linkedin.com/in/jordan-rivera",
    ...options.profile,
  } as Parameters<typeof updatePersonal>[1]);
  await updateProfessional(user.id, { currentTitle: "Sales Development Representative", targetTitles: ["BDR"], summary: "SDR with 4 years in SaaS.", industries: ["Software"], yearsExperience: 4, skills: ["Salesforce"], software: [], technicalSkills: [], languages: [] } as unknown as Parameters<typeof updateProfessional>[1]);
  await getUserSettings(user.id);
  await prisma.automationRule.upsert({
    where: { userId: user.id },
    update: { autoSubmitEnabled: options.autoSubmit ?? true, requiresSponsorship: options.requiresSponsorship ?? false, defaultMode: options.mode ?? "AUTO", maxApplicationsPerDay: 100, maxConcurrentApplications: 5 },
    create: { userId: user.id, autoSubmitEnabled: options.autoSubmit ?? true, requiresSponsorship: options.requiresSponsorship ?? false, defaultMode: options.mode ?? "AUTO", maxApplicationsPerDay: 100, maxConcurrentApplications: 5, matchWeights: {} },
  });
  const library = options.library ?? [
    { key: "work_authorization", question: "Are you legally authorized to work in this country?", answer: "Yes", category: "WORK_AUTHORIZATION" as const },
    { key: "sponsorship", question: "Will you now or in the future require visa sponsorship?", answer: "No", category: "SPONSORSHIP" as const },
  ];
  for (const a of library) {
    await createAnswer(user.id, { questionKey: a.key, question: a.question, answer: a.answer, category: a.category, confidence: a.confidence ?? 100, autoSubmitAllowed: a.auto ?? true, requiresHumanReview: a.review ?? false });
  }
  for (const [kind, enabled] of [["RESUME", options.resume ?? true], ["COVER_LETTER", options.coverLetter ?? false]] as const) {
    if (!enabled) continue;
    const key = buildStorageKey(user.id, kind, "pdf");
    await getStorage().put(key, PDF, "application/pdf");
    await createDocument(user.id, { type: kind, name: kind === "RESUME" ? "Main resume" : "Cover letter", isDefault: true }, { fileName: kind === "RESUME" ? "jordan-rivera-resume.pdf" : "jordan-cover-letter.pdf", mimeType: "application/pdf", sizeBytes: PDF.length, storageKey: key, sha256: sha256Hex(PDF) });
  }
  return user;
}

let jobCounter = 0;
/** Queue an application for a job whose application link is the given mock page. */
export async function queueFor(userId: string, url: string, options: { mode?: AutomationMode; sponsorshipAvailable?: boolean } = {}) {
  jobCounter += 1;
  const job = await createManualJob(userId, { url: `${url}${url.includes("?") ? "&" : "?"}job=${jobCounter}`, title: "Business Development Representative", company: "Example Corp", workArrangement: "UNKNOWN" } as Parameters<typeof createManualJob>[1], "UNKNOWN");
  await prisma.job.update({ where: { id: job.id }, data: { applicationUrl: url, status: "QUALIFIED", sponsorshipAvailable: options.sponsorshipAvailable ?? null } });
  await queueApplications(userId, [job.id], { mode: options.mode });
  return prisma.application.findUniqueOrThrow({ where: { jobId: job.id } });
}

/** Claim and run one attempt, as the BullMQ processor would. */
export async function runOnce(engine: ApplicationEngine, workerId: string, applicationId: string, signal: AbortSignal = new AbortController().signal): Promise<RunResult & { claimed: boolean }> {
  const claim = await claimApplication(applicationId, workerId, 30_000);
  if (!claim.claimed) return { claimed: false, result: "cancelled" };
  const outcome = await engine.run({ applicationId, attemptId: claim.attemptId, attemptNumber: claim.attemptNumber, userId: claim.userId, signal });
  return { claimed: true, ...outcome };
}

export function loadApplication(id: string) {
  return prisma.application.findUniqueOrThrow({
    where: { id },
    include: { questions: { include: { answer: true }, orderBy: [{ pageIndex: "asc" }, { createdAt: "asc" }] }, events: { orderBy: { createdAt: "asc" } }, attempts: true },
  });
}
