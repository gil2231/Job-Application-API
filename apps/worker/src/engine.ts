import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Redis from "ioredis";
import type { BrowserContext, Page } from "playwright-core";
import {
  classifyFailure,
  decideRetry,
  decideSubmission,
  displayLabel,
  failureForHttpStatus,
  FieldResolver,
  findContradictions,
  isPlaceholderOption,
  retryAfterOf,
  toProfileFacts,
  type FieldMapping,
  type FieldKind,
  type ProfileFactsForForms,
} from "@autoapply/automation";
import { createApplicationAI, type ApplicationAI } from "@autoapply/ai";
import { detectPlatformFromUrl, findApplicationForm, greenhouseEmbedForRedirect, type AdapterContext, type PageSnapshot, type AdapterRegistry, type AdapterStatus, type ApplicationAdapter, type DocumentsToUpload, type HumanStep, type ValidationResult } from "@autoapply/ats-adapters";
import {
  addApplicationEvent,
  addAttemptScreenshot,
  cancelAttempt,
  finishAttempt,
  getHeldState,
  holdForManualSubmit,
  linkAttemptBrowserSession,
  loadBrowserSession,
  loadProcessingContext,
  markStillWaiting,
  recordSubmittedInBrowser,
  releaseHeldApplication,
  renewLease,
  requeueAfterShutdown,
  resumeHeldApplication,
  saveApplicationQuestions,
  saveBrowserSession,
  setApplicationPlatform,
  setJobApplicationUrl,
  setProfileSnapshot,
  type AttemptOutcome,
  type ProcessingContext,
  type QuestionRecord,
} from "@autoapply/database";
import type { StorageDriver } from "@autoapply/documents";
import { applyYourselfMessage, followToCompany, type FollowJob, type FollowResult } from "@autoapply/ingestion";
import { APPLICATION_EVENT_TYPES, enumLabel, FAILURE_INFO, LISTING_SITE_LABELS, listingSite, type ApplicationEventType, type AttentionReason, type EventLevel, type Platform } from "@autoapply/shared";
import type { BrowserPool } from "./browser";
import type { WorkerConfig } from "./config";
import type { LiveSolveHub, LiveWindow } from "./live-solve";
import { ProgressReporter } from "./progress";
import { SiteHealth } from "./site-health";
import { checkSite } from "./site-policy";

export interface EngineDeps {
  config: WorkerConfig;
  browsers: BrowserPool;
  registry: AdapterRegistry<Page>;
  storage: StorageDriver;
  redis: Redis | null;
  workerId: string;
  /** Per-site circuit breaker; built from `redis` when not given. */
  siteHealth?: SiteHealth;
  /** Set when CAPTCHAs can be solved live from the app's CAPTCHA screen. */
  liveSolve?: LiveSolveHub | null;
  /** Finds the company's own application for a job saved from a listing site; followToCompany when not given. */
  follow?: (job: FollowJob) => Promise<FollowResult | null>;
}

export interface RunInput {
  applicationId: string;
  attemptId: string;
  attemptNumber: number;
  userId: string;
  signal: AbortSignal;
}

export interface RunResult {
  result: "finished" | "cancelled" | "released";
  /** Set when the attempt failed transiently and should run again after this delay. */
  retryInMs?: number;
}

/** Why the worker aborted a run itself. */
export const ABORT_REASONS = { stop: "stop", shutdown: "shutdown", leaseLost: "lease-lost" } as const;

/** The application was stopped, skipped or taken over while this run held it. */
class StoppedError extends Error {
  constructor() {
    super("The application was stopped");
    this.name = "StoppedError";
  }
}

const MAX_PAGES = 15;
const MAX_CONDITIONAL_ROUNDS = 5;
const POLL_MS = 2000;
/** How long a page with no form may show after a sign-in or CAPTCHA before the run carries on anyway. */
const BLANK_PAGE_GRACE_MS = 15_000;

const FIELD_TYPE: Record<FieldKind, QuestionRecord["fieldType"]> = {
  text: "TEXT", textarea: "TEXTAREA", email: "EMAIL", phone: "PHONE", url: "URL", number: "NUMBER", date: "DATE",
  select: "SELECT", radio: "RADIO", checkbox: "CHECKBOX", file: "FILE", unknown: "UNKNOWN",
};
const SOURCE: Record<FieldMapping["source"], NonNullable<QuestionRecord["answer"]>["source"]> = {
  profile: "PROFILE", library: "USER", user: "USER", ai: "AI_GENERATED", none: "USER",
};
const HUMAN_LABEL: Record<HumanStep, string> = { CAPTCHA: "CAPTCHA detected", MFA: "Verification code required", AUTH_REQUIRED: "Sign-in required" };
/** Blockers only the person can clear in a browser; everything else is a review. */
const WAITING_REASONS: ReadonlySet<AttentionReason> = new Set(["CAPTCHA", "MFA", "AUTH_REQUIRED", "UNSUPPORTED_SITE"]);

const isEventType = (t: string): t is ApplicationEventType => (APPLICATION_EVENT_TYPES as readonly string[]).includes(t);

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}

/** Skills from a stored job analysis, if it has run. */
function jobAnalysisSkills(analysis: unknown): string[] | undefined {
  const skills = (analysis as { skills?: unknown } | null)?.skills;
  return Array.isArray(skills) ? skills.filter((s): s is string => typeof s === "string") : undefined;
}

const safeFileName = (name: string) => name.replace(/[^\w.\- ()]+/g, "_").slice(0, 120) || "document";

/** Profile values worth keeping with the application for the record (no sensitive answers). */
function snapshotOf(p: ProcessingContext["profile"]) {
  const current = p.employment.find((e) => e.isCurrent);
  return {
    name: [p.firstName, p.lastName].filter(Boolean).join(" ") || null,
    email: p.email,
    phone: p.phone,
    location: [p.city, p.state].filter(Boolean).join(", ") || null,
    linkedin: p.linkedinUrl,
    portfolio: p.portfolioUrl ?? p.websiteUrl,
    currentTitle: p.currentTitle ?? current?.title ?? null,
    currentCompany: current?.company ?? null,
    yearsExperience: p.yearsExperience,
    school: p.education[0]?.school ?? null,
    capturedAt: new Date().toISOString(),
  };
}

function toRecord(m: FieldMapping): QuestionRecord {
  const value = m.value == null ? null : Array.isArray(m.value) ? m.value.join(", ") : m.value;
  return {
    label: displayLabel(m.detectedLabel),
    normalizedKey: m.field.key ?? m.detectedLabel,
    fieldType: FIELD_TYPE[m.field.kind],
    required: m.field.required,
    options: m.field.options?.filter((o) => !isPlaceholderOption(o)),
    pageIndex: m.field.pageIndex,
    locator: m.field.locators[0],
    mappedField: m.mappedField === "unknown" ? null : m.mappedField,
    confidence: m.confidence,
    status: m.status,
    reviewReason: m.reviewReason,
    answer: value != null && value !== "" ? { value, source: SOURCE[m.source], confidence: m.confidence, libraryAnswerId: m.libraryAnswerId, sensitive: m.sensitive } : null,
  };
}

/**
 * Runs one attempt of one application, following the worker flow:
 * load profile → open the application → detect platform → pick adapter →
 * map → fill → upload → answer → validate → human checkpoint if needed →
 * submit if permitted → record the result.
 */
export class ApplicationEngine {
  private readonly deps: EngineDeps & { siteHealth: SiteHealth };

  constructor(deps: EngineDeps) {
    this.deps = { ...deps, siteHealth: deps.siteHealth ?? new SiteHealth(deps.redis) };
  }

  async run(input: RunInput): Promise<RunResult> {
    const data = await loadProcessingContext(input.applicationId);
    if (!data) return { result: "cancelled" };
    return new AttemptRun(this.deps, input, data).execute();
  }
}

class AttemptRun {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private tmpDir: string | null = null;
  private domain = "";
  private platform: Platform = "UNKNOWN";
  private readonly progress: ProgressReporter;
  private readonly facts: ProfileFactsForForms;
  private ai: ApplicationAI | null = null;
  private aiFailureLogged = false;

  constructor(
    private readonly deps: EngineDeps & { siteHealth: SiteHealth },
    private readonly input: RunInput,
    private readonly data: ProcessingContext,
  ) {
    this.progress = new ProgressReporter(deps.redis, { applicationId: input.applicationId, userId: input.userId, company: data.job.company, title: data.job.title });
    this.facts = toProfileFacts(data.profile);
  }

  private log(type: ApplicationEventType, message: string, options: { level?: EventLevel; data?: unknown } = {}) {
    return addApplicationEvent(this.input.applicationId, this.input.userId, type, message, options);
  }

  private async finish(outcome: AttemptOutcome): Promise<RunResult> {
    const applied = await finishAttempt({ applicationId: this.input.applicationId, attemptId: this.input.attemptId, userId: this.input.userId, workerId: this.deps.workerId, outcome });
    if (!applied) {
      await this.progress.finish("failed");
      return { result: "cancelled" };
    }
    await this.progress.finish(outcome.kind === "submitted" ? "done" : outcome.kind === "attention" ? "waiting" : "failed");
    return { result: "finished", retryInMs: outcome.kind === "retry" ? outcome.delayMs : undefined };
  }

  /**
   * A careers page with the form in an iframe (Betterment's Greenhouse board)
   * or a listing with an Apply link out to the ATS (Built In): open the form
   * itself, up to two steps away, and remember its link on the job. Returns
   * why it can't be opened, or null to carry on with the current page.
   */
  private async openFormBehindPage(jobId: string): Promise<string | null> {
    const page = this.page!;
    for (let step = 0; step < 2; step++) {
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => undefined);
      const form = findApplicationForm(await snapshotPage(page));
      if (!form || listingSite(form.url)) return null;
      const from = new URL(page.url()).hostname;
      const site = await checkSite(form.url, this.deps.config);
      if (!site.allowed) return `The application form is on ${new URL(form.url).hostname}. ${site.reason}`;
      const how = form.via === "link" ? "linked from" : "embedded in";
      await this.log("NOTE", `Opened the ${form.platform === "GENERIC" ? "" : `${enumLabel(form.platform)} `}application form ${how} ${from}: ${form.url}`);
      const response = await page.goto(form.url, { waitUntil: "domcontentloaded" });
      const blocked = response ? failureForHttpStatus(response.status(), response.headers()["retry-after"]) : null;
      if (blocked) throw blocked;
      const landed = await checkSite(page.url(), this.deps.config);
      if (!landed.allowed) return `The application form redirected to ${new URL(page.url()).hostname}. ${landed.reason}`;
      this.domain = new URL(page.url()).hostname;
      await setJobApplicationUrl(jobId, form.url, detectPlatformFromUrl(form.url).platform);
    }
    return null;
  }

  private attention(status: "WAITING_FOR_USER" | "REVIEW_REQUIRED" | "READY", reason: AttentionReason, detail: string) {
    return this.finish({ kind: "attention", status, reason, detail });
  }

  async execute(): Promise<RunResult> {
    const { input, data, deps } = this;
    const { signal } = input;
    const closeOnAbort = () => void this.context?.close().catch(() => undefined);
    signal.addEventListener("abort", closeOnAbort, { once: true });
    try {
      signal.throwIfAborted();
      await this.progress.running("profile", "Loading profile");
      await setProfileSnapshot(input.applicationId, snapshotOf(data.profile), { resumeId: data.resume?.id, coverLetterId: data.coverLetter?.id });
      await this.log("PROFILE_LOADED", "Master Profile loaded");
      await this.progress.done("profile", "Profile loaded");

      let url = data.job.applicationUrl ?? data.job.url;
      // Saved from LinkedIn, Handshake or another listing site: apply on the company's own site instead, never on the listing site.
      const listing = listingSite(url);
      if (listing) {
        await this.progress.running("detected", `Finding ${data.job.company}'s own application`);
        const follow = deps.follow ?? ((job: FollowJob) => followToCompany(job, { aggregatorKey: deps.config.jsearchApiKey }));
        const found = await follow({ url: data.job.url, applicationUrl: data.job.applicationUrl, title: data.job.title, company: data.job.company, location: data.job.location }).catch(() => null);
        if (!found) return this.attention("WAITING_FOR_USER", "UNSUPPORTED_SITE", applyYourselfMessage(listing, url, data.job));
        url = found.url;
        await setJobApplicationUrl(data.job.id, url, detectPlatformFromUrl(url).platform);
        await this.log("NOTE", `Followed the ${LISTING_SITE_LABELS[listing]} job to ${data.job.company}'s own application (found on ${found.foundOn}): ${url}`);
      }
      if (detectPlatformFromUrl(url).platform === "LINKEDIN_EASY_APPLY") {
        return this.attention("WAITING_FOR_USER", "UNSUPPORTED_SITE", "LinkedIn Easy Apply needs your LinkedIn sign-in, and Applyance never signs in to LinkedIn. Add the employer's own application link to this job, or apply on LinkedIn yourself and mark it submitted.");
      }
      const site = await checkSite(url, deps.config);
      if (!site.allowed) return this.attention("WAITING_FOR_USER", "UNSUPPORTED_SITE", site.reason);

      this.tmpDir = await mkdtemp(join(tmpdir(), "autoapply-"));
      const documents = await this.downloadDocuments();

      await this.progress.running("browser", "Launching browser");
      this.domain = new URL(url).hostname;
      const saved = await loadBrowserSession(input.userId, this.domain);
      this.context = await deps.browsers.newContext(saved?.storageState);
      if (saved) await linkAttemptBrowserSession(input.attemptId, saved.id);
      this.page = await this.context.newPage();
      await this.log("BROWSER_LAUNCHED", saved ? `Browser launched with your saved session for ${this.domain}` : "Browser launched");
      await this.progress.done("browser", "Browser launched");

      let response = await this.page.goto(url, { waitUntil: "commit" });
      // A Greenhouse job that forwards to the employer's own careers page (Betterment, Stripe): open Greenhouse's copy of the form instead.
      const embed = greenhouseEmbedForRedirect(url, this.page.url());
      if (embed) {
        await this.log("NOTE", `The Greenhouse link forwards to ${new URL(this.page.url()).hostname}; opened the same job's form on Greenhouse instead: ${embed}`);
        url = embed;
        response = await this.page.goto(url, { waitUntil: "domcontentloaded" });
        this.domain = new URL(url).hostname;
        await setJobApplicationUrl(data.job.id, url, "GREENHOUSE");
      } else {
        await this.page.waitForLoadState("domcontentloaded");
      }
      // An outage, a rate limit or a closed posting: don't try to fill an error page.
      const blocked = response ? failureForHttpStatus(response.status(), response.headers()["retry-after"]) : null;
      if (blocked) throw blocked;
      await deps.siteHealth.recordSuccess(this.domain);
      const landed = await checkSite(this.page.url(), deps.config);
      if (!landed.allowed) return this.attention("WAITING_FOR_USER", "UNSUPPORTED_SITE", `The link redirected to ${new URL(this.page.url()).hostname}. ${landed.reason}`);
      const blockedForm = await this.openFormBehindPage(data.job.id);
      if (blockedForm) return this.attention("WAITING_FOR_USER", "UNSUPPORTED_SITE", blockedForm);

      const { adapter, detection } = await deps.registry.resolve(this.page.url(), await this.page.content());
      if (!adapter) return this.attention("WAITING_FOR_USER", "UNSUPPORTED_SITE", `No adapter can fill ${enumLabel(detection.platform)} applications yet.`);
      this.platform = detection.platform;
      await setApplicationPlatform(input.applicationId, detection.platform);
      const usingFallback = adapter.platform !== detection.platform && detection.platform !== "GENERIC";
      await this.log("PLATFORM_DETECTED", `${enumLabel(detection.platform)} detected (${detection.evidence})${usingFallback ? `; filling it with the ${adapter.displayName.toLowerCase()} adapter` : ""}`);
      await this.progress.done("detected", `Application detected: ${enumLabel(detection.platform)}`);

      this.ai = createApplicationAI(
        { provider: data.settings.aiProvider, model: data.settings.aiModel },
        { profile: data.profile, job: { id: data.job.id, title: data.job.title, company: data.job.company, description: data.job.description, skills: jobAnalysisSkills(data.job.analysis) }, library: data.library },
      );
      if (this.ai.info.method === "ai") await this.log("NOTE", `AI field mapping and answer drafts are on (${this.ai.info.model}). AI drafts always wait for your approval.`);
      const resolver = new FieldResolver({
        classifier: this.ai.classifier,
        drafter: this.ai.drafter ?? undefined,
        profile: this.facts,
        library: data.library,
        stored: data.questions,
        documents: { resume: documents.resume ? { fileName: documents.resume.fileName } : null, coverLetter: documents.coverLetter ? { fileName: documents.coverLetter.fileName } : null },
        fieldConfidenceThreshold: data.settings.fieldConfidenceThreshold,
        answerConfidenceThreshold: data.settings.answerConfidenceThreshold,
      });
      const ctx: AdapterContext<Page> = {
        page: this.page,
        applicationId: input.applicationId,
        mode: data.application.mode,
        confidenceThreshold: data.settings.fieldConfidenceThreshold,
        pageIndex: 0,
        signal,
        resolveField: (field) => resolver.resolve(field),
        log: async (e) => {
          await this.log(isEventType(e.type) ? e.type : "NOTE", e.message, { level: e.level, data: e.data });
          if (e.type === "RESUME_UPLOADED") await this.progress.done("resume", "Resume uploaded");
          if (e.type === "COVER_LETTER_UPLOADED") await this.progress.done("cover", "Cover letter uploaded");
        },
        screenshot: (caption) => this.screenshot(caption),
      };

      await adapter.initialize(ctx);
      await ctx.screenshot("Application opened");
      return await this.fillPages(adapter, ctx, documents, detection.platform);
    } catch (error) {
      if (signal.aborted || error instanceof StoppedError) return this.aborted();
      return this.failed(error);
    } finally {
      signal.removeEventListener("abort", closeOnAbort);
      await this.context?.close().catch(() => undefined);
      if (this.tmpDir) await rm(this.tmpDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  private async fillPages(adapter: ApplicationAdapter<Page>, ctx: AdapterContext<Page>, documents: DocumentsToUpload, detected: Platform): Promise<RunResult> {
    const all: FieldMapping[] = [];
    let pageIndex = 0;
    while (pageIndex < MAX_PAGES) {
      ctx.pageIndex = pageIndex;
      await this.assertHeld();
      const status = await adapter.getStatus(ctx);
      if (status.state === "needs_human") {
        const outcome = await this.humanCheckpoint(adapter, ctx, status);
        if (outcome !== "resumed") return outcome;
        continue;
      }
      if (status.state === "submitted") {
        await ctx.screenshot("Confirmation");
        await this.saveSession();
        return this.finish({ kind: "submitted", confirmation: status.confirmation ?? null, message: `The site accepted the application when leaving page ${pageIndex}${status.confirmation ? ` (confirmation ${status.confirmation})` : ""}` });
      }
      if (status.state === "failed") return this.failed(new Error(status.message));
      if (!status.hasForm) {
        return this.attention("WAITING_FOR_USER", "UNSUPPORTED_SITE", pageIndex === 0 ? "Applyance couldn't find an application form at this link. Add the direct application link to the job, or apply yourself." : `Page ${pageIndex + 1} of the application has no form Applyance can fill.`);
      }

      const pageNo = pageIndex + 1;
      await this.progress.running(`page-${pageIndex}`, `Filling page ${pageNo}`);
      const mappings = await this.fillPage(adapter, ctx, documents);
      all.push(...mappings);
      await saveApplicationQuestions(this.input.applicationId, mappings.map(toRecord));
      await ctx.screenshot(`Page ${pageNo} filled`);

      const review = mappings.filter((m) => m.status === "NEEDS_REVIEW");
      if (review.length) {
        await this.saveSession();
        const names = review.slice(0, 3).map((m) => `"${displayLabel(m.detectedLabel)}"`).join(", ");
        return this.attention("REVIEW_REQUIRED", "QUESTION_REVIEW", `${review.length} question${review.length === 1 ? "" : "s"} on page ${pageNo} need${review.length === 1 ? "s" : ""} your answer: ${names}${review.length > 3 ? ", …" : ""}. Nothing has been sent yet.`);
      }

      await this.progress.running("validating", "Validating…");
      const validation = await adapter.validate(ctx);
      if (!validation.ok) return this.validationFailed(validation, mappings);
      await this.log("VALIDATION_COMPLETED", `Page ${pageNo} passed validation`);

      if (!status.isFinalPage) {
        const advance = await adapter.nextPage(ctx);
        if (!advance.moved) return this.validationFailed(advance.validation, mappings);
        await this.log("PAGE_COMPLETED", `Page ${pageNo} completed`);
        await this.progress.done(`page-${pageIndex}`, `Page ${pageNo} completed`);
        pageIndex++;
        continue;
      }
      await this.progress.done("validating", "Validation completed");
      await this.progress.done(`page-${pageIndex}`, pageIndex > 0 ? `Page ${pageNo} completed` : "Form filled");

      // A security check that shows up only at the end still stops everything.
      const final = await adapter.getStatus(ctx);
      if (final.state === "needs_human") {
        const outcome = await this.humanCheckpoint(adapter, ctx, final);
        if (outcome !== "resumed") return outcome;
      }
      const humanSubmitOnly = (final.state === "in_progress" ? final : status).humanSubmitOnly === true;
      return this.decideAndSubmit(adapter, ctx, all, detected, humanSubmitOnly);
    }
    return this.failed(new Error(`The application has more than ${MAX_PAGES} pages`));
  }

  /** Fill one page, re-scanning for questions that appear after earlier answers (conditional fields). */
  private async fillPage(adapter: ApplicationAdapter<Page>, ctx: AdapterContext<Page>, documents: DocumentsToUpload): Promise<FieldMapping[]> {
    const seen = new Map<string, FieldMapping>();
    let { mappings } = await adapter.mapFields(ctx);
    for (let round = 0; round < MAX_CONDITIONAL_ROUNDS; round++) {
      const fresh = mappings.filter((m) => !seen.has(m.field.key ?? m.detectedLabel));
      if (!fresh.length) break;
      for (const m of fresh) seen.set(m.field.key ?? m.detectedLabel, m);
      if (round > 0) await this.log("NOTE", `${fresh.length} more question${fresh.length === 1 ? "" : "s"} appeared after earlier answers`);
      await adapter.fillFields(ctx, fresh);
      await adapter.uploadDocuments(ctx, documents, fresh);
      await adapter.answerQuestions(ctx, fresh);
      ({ mappings } = await adapter.mapFields(ctx));
    }
    // A field hidden again by a later answer is no longer part of the form.
    const visible = new Set(mappings.map((m) => m.field.key ?? m.detectedLabel));
    const final = [...seen.values()].filter((m) => visible.has(m.field.key ?? m.detectedLabel));

    const fromProfile = final.filter((m) => m.source === "profile" && m.status === "ANSWERED").length;
    const questions = final.filter((m) => (m.mappedField === "answer.library" || m.mappedField === "unknown") && m.status === "ANSWERED");
    const flagged = final.filter((m) => m.status === "NEEDS_REVIEW").length;
    const aiMapped = final.filter((m) => m.mappedBy === "ai").length;
    const drafts = final.filter((m) => m.source === "ai").length;
    const extras = [aiMapped ? `${aiMapped} mapped with AI help` : null, flagged ? `${flagged} need${flagged === 1 ? "s" : ""} review${drafts ? ` (${drafts} with an AI draft to check)` : ""}` : null].filter(Boolean);
    await this.log("FIELDS_MAPPED", `Mapped ${final.length} field${final.length === 1 ? "" : "s"} on page ${ctx.pageIndex + 1}: ${fromProfile} from your profile, ${questions.length} from your answers${extras.length ? `, ${extras.join(", ")}` : ""}`, {
      data: final.map((m) => ({ label: displayLabel(m.detectedLabel), mappedField: m.mappedField, confidence: m.confidence, status: m.status, source: m.source, mappedBy: m.mappedBy ?? "heuristic" })),
    });
    await this.noteAIFailures();
    await this.progress.done(`fields-${ctx.pageIndex}`, `${final.length} fields mapped${ctx.pageIndex ? ` on page ${ctx.pageIndex + 1}` : ""}`);
    if (questions.length) {
      await this.log("QUESTIONS_ANSWERED", `${questions.length} question${questions.length === 1 ? "" : "s"} answered from your Answer Library and approvals`);
      await this.progress.done(`questions-${ctx.pageIndex}`, `${questions.length} question${questions.length === 1 ? "" : "s"} answered`);
    }
    return final;
  }

  /** Say once when AI calls failed and the built-in mapper or a blank answer was used instead. */
  private async noteAIFailures() {
    const error = this.ai?.lastFailure();
    if (!error || this.aiFailureLogged) return;
    this.aiFailureLogged = true;
    await this.log("NOTE", `AI was unavailable for some fields (${error}). The built-in mapper was used, and anything it couldn't answer is waiting for you.`, { level: "WARNING" });
  }

  private async decideAndSubmit(adapter: ApplicationAdapter<Page>, ctx: AdapterContext<Page>, mappings: FieldMapping[], detected: Platform, humanSubmitOnly = false): Promise<RunResult> {
    const { data } = this;
    // A page where nothing could be filled isn't a finished application (a job page mistaken for the form, say), so it's never offered for submission.
    if (!mappings.some((m) => m.status === "ANSWERED")) {
      await ctx.screenshot("Nothing filled");
      return this.attention("WAITING_FOR_USER", "UNSUPPORTED_SITE", "Applyance found nothing it could fill at this link, so it hasn't treated it as an application. Add the direct application link to the job, or apply yourself.");
    }
    const contradictions = findContradictions({ mappings, profile: this.facts, library: data.library, job: data.job, rule: data.rule });
    const decision = decideSubmission({
      mode: data.application.mode,
      submitApproved: !!data.application.submitApprovedAt,
      autoSubmitEnabled: data.rule.autoSubmitEnabled,
      platformSupported: adapter.supportsAutoSubmit && (adapter.platform === detected || detected === "GENERIC"),
      platformLabel: enumLabel(detected),
      mappings,
      contradictions,
      securityChallenge: false,
      confidenceThreshold: data.settings.fieldConfidenceThreshold,
    });

    if (decision.action === "review") {
      await this.saveSession();
      await ctx.screenshot("Ready for review");
      return this.attention(WAITING_REASONS.has(decision.reason) ? "WAITING_FOR_USER" : "REVIEW_REQUIRED", decision.reason, decision.detail);
    }
    // Sites that score submissions with invisible reCAPTCHA: Applyance fills the form, but the final Submit is always the person's own click.
    if (humanSubmitOnly) {
      await this.saveSession();
      await ctx.screenshot("Ready to submit");
      await this.log("NOTE", "This site checks submissions with reCAPTCHA in the background, so the final Submit is left to you");
      if (this.deps.browsers.interactive) return this.waitForManualSubmit(adapter, ctx);
      return this.attention("READY", "FINAL_REVIEW", "Everything is filled and checked. This site checks submissions with reCAPTCHA in the background, so open the application and click Submit yourself, then mark it submitted here.");
    }
    if (decision.action === "hand_off") {
      await this.saveSession();
      await ctx.screenshot("Ready to submit");
      if (this.deps.browsers.interactive) return this.waitForManualSubmit(adapter, ctx);
      return this.attention("READY", "FINAL_REVIEW", decision.detail);
    }

    await this.progress.running("submit", "Submitting");
    const result = await adapter.submit(ctx);
    if ("validation" in result) return this.validationFailed(result.validation, mappings);
    await ctx.screenshot("Confirmation");
    await this.saveSession();
    await this.progress.done("submit", "Submitted");
    const how = data.application.submitApprovedAt ? "after your approval" : "automatically";
    return this.finish({ kind: "submitted", confirmation: result.confirmation ?? null, message: `Submitted ${how}${result.confirmation ? ` (confirmation ${result.confirmation})` : ""}` });
  }

  /** The site rejected values: flag the fields it complained about so the person can correct them. */
  private async validationFailed(validation: ValidationResult, mappings: FieldMapping[]): Promise<RunResult> {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const flagged: FieldMapping[] = [];
    const unmatched: string[] = [];
    for (const err of validation.errors) {
      const target = mappings.find((m) => norm(m.detectedLabel) === norm(err.label)) ?? mappings.find((m) => norm(err.label).includes(norm(m.detectedLabel)) || norm(m.detectedLabel).includes(norm(err.label)));
      if (target && target.field.kind !== "file") flagged.push({ ...target, status: "NEEDS_REVIEW", reviewReason: `The site rejected this answer: ${err.message}` });
      else unmatched.push(`${err.label}: ${err.message}`);
    }
    if (flagged.length) await saveApplicationQuestions(this.input.applicationId, flagged.map(toRecord));
    await this.screenshot("Validation errors").catch(() => undefined);
    await this.saveSession();
    const list = validation.errors.slice(0, 4).map((e) => `${e.label}: ${e.message}`).join("; ");
    const detail = flagged.length
      ? `The site rejected ${flagged.length === 1 ? "an answer" : `${flagged.length} answers`} (${list}). Correct ${flagged.length === 1 ? "it" : "them"} below and Applyance will try again.`
      : `The site reported a problem it didn't tie to a field (${unmatched.slice(0, 3).join("; ") || list}). Check the application, then press Try again.`;
    return this.attention("REVIEW_REQUIRED", "VALIDATION_ERROR", detail);
  }

  /**
   * A CAPTCHA, sign-in or verification code. Applyance never completes these.
   * With a visible browser the page stays open for the person to finish it
   * there, and the run continues as soon as the page moves on; otherwise the
   * application waits in Needs Attention.
   */
  private async humanCheckpoint(adapter: ApplicationAdapter<Page>, ctx: AdapterContext<Page>, status: Extract<AdapterStatus, { state: "needs_human" }>): Promise<RunResult | "resumed"> {
    const { deps, input } = this;
    const label = HUMAN_LABEL[status.reason];
    await ctx.screenshot(label);
    await this.progress.waiting("human", `Waiting for you: ${label}`);
    await this.saveSession();
    // A CAPTCHA can be solved live from the app; sign-ins and codes still need the visible browser.
    const live = status.reason === "CAPTCHA" && this.page ? (deps.liveSolve ?? null) : null;
    if (!deps.browsers.interactive && !live) {
      const action = status.reason === "CAPTCHA" ? "complete the CAPTCHA" : "sign in";
      return this.attention("WAITING_FOR_USER", status.reason, `${status.detail} Open the application to ${action} and finish it yourself, then mark it submitted. If the check was a one-off, press I've completed it and Applyance will look again.`);
    }

    const detail = live
      ? `${status.detail} Solve it on the CAPTCHA screen in Applyance. The application carries on by itself as soon as it's solved.`
      : `${status.detail} Finish it in the Applyance browser window, then press ${status.reason === "CAPTCHA" ? "I've completed it" : "Continue"}. Applyance carries on from there.`;
    const kept = await finishAttempt({ applicationId: input.applicationId, attemptId: input.attemptId, userId: input.userId, workerId: deps.workerId, outcome: { kind: "attention", status: "WAITING_FOR_USER", reason: status.reason, detail, keepLease: { leaseMs: deps.config.leaseMs } } });
    if (!kept) return { result: "cancelled" };

    const waitMs = live ? deps.config.liveSolveWaitMs : deps.config.interactiveWaitMs;
    const deadline = Date.now() + waitMs;
    let window: LiveWindow | null = null;
    let ended: "solved" | "timed_out" | "stopped" = "stopped";
    let blankSince: number | null = null;
    try {
      if (live) {
        window = await live.open(this.page!, { applicationId: input.applicationId, userId: input.userId, company: this.data.job.company, title: this.data.job.title, expiresAt: new Date(deadline) });
        await this.log("NOTE", "Live CAPTCHA window opened on the CAPTCHA screen");
      }
      while (Date.now() < deadline) {
        await sleep(POLL_MS, input.signal);
        await renewLease(input.applicationId, deps.workerId, deps.config.leaseMs);
        const held = await getHeldState(input.applicationId);
        if (!held || held.lockedBy !== deps.workerId || (held.status !== "WAITING_FOR_USER" && held.status !== "QUEUED")) {
          await cancelAttempt(input.applicationId, input.attemptId, deps.workerId, "The application was changed while waiting");
          return { result: "cancelled" };
        }
        const now = await adapter.getStatus(ctx).catch(() => null);
        // Between the sign-in page and the form there is a moment with neither on screen; that isn't the person finishing.
        // A page that stays without a form is what the site shows next, so carry on and let the run report it.
        const blank = now?.state === "in_progress" && !now.hasForm;
        blankSince = blank ? (blankSince ?? Date.now()) : null;
        const settled = now && now.state !== "needs_human" && (!blank || Date.now() - blankSince! >= BLANK_PAGE_GRACE_MS);
        if (settled) {
          ended = "solved";
          const where = live && !deps.browsers.interactive ? "on the CAPTCHA screen" : "in the browser";
          await resumeHeldApplication(input.applicationId, input.attemptId, input.userId, deps.workerId, `${label.replace(" detected", "").replace(" required", "")} completed ${where}; continuing`, deps.config.leaseMs);
          await this.saveSession();
          await this.progress.resume();
          return "resumed";
        }
        if (held.status === "QUEUED") {
          await markStillWaiting(input.applicationId, input.userId, deps.workerId, `The page still shows the ${status.reason === "CAPTCHA" ? "CAPTCHA" : "sign-in"}. ${live ? "Solve it on the CAPTCHA screen" : "Finish it in the Applyance browser window"} first.`);
        }
      }
      ended = "timed_out";
      await this.saveSession();
      await releaseHeldApplication(input.applicationId, input.attemptId, deps.workerId);
      if (live) await this.log("NOTE", "Nobody solved the CAPTCHA in time, so its live window closed. Open it again from the CAPTCHA screen.");
      await this.progress.finish("waiting");
      return { result: "released" };
    } finally {
      await window?.close(ended);
    }
  }

  /** Manual mode with a visible browser: leave the filled form open and record it when the person submits. */
  private async waitForManualSubmit(adapter: ApplicationAdapter<Page>, ctx: AdapterContext<Page>): Promise<RunResult> {
    const { deps, input } = this;
    const kept = await finishAttempt({
      applicationId: input.applicationId, attemptId: input.attemptId, userId: input.userId, workerId: deps.workerId,
      outcome: { kind: "attention", status: "READY", reason: "FINAL_REVIEW", detail: "Everything is filled in the Applyance browser window. Review it there and click Submit; Applyance records it automatically.", keepLease: { leaseMs: deps.config.leaseMs } },
    });
    if (!kept) return { result: "cancelled" };
    await this.progress.waiting("submit", "Waiting for you to click Submit");
    const deadline = Date.now() + deps.config.interactiveWaitMs;
    while (Date.now() < deadline) {
      await sleep(POLL_MS, input.signal);
      await holdForManualSubmit(input.applicationId, deps.workerId, deps.config.leaseMs);
      const held = await getHeldState(input.applicationId);
      if (!held || held.lockedBy !== deps.workerId || held.status !== "READY") {
        await cancelAttempt(input.applicationId, input.attemptId, deps.workerId, "Finished outside the browser window");
        return { result: "cancelled" };
      }
      const now = await adapter.getStatus(ctx).catch(() => null);
      if (now?.state === "submitted") {
        await ctx.screenshot("Confirmation");
        await this.saveSession();
        await recordSubmittedInBrowser(input.applicationId, input.attemptId, input.userId, deps.workerId, now.confirmation ?? null);
        await this.progress.done("submit", "Submitted by you");
        await this.progress.finish("done");
        return { result: "finished" };
      }
    }
    await releaseHeldApplication(input.applicationId, input.attemptId, deps.workerId);
    await this.progress.finish("waiting");
    return { result: "released" };
  }

  private async failed(error: unknown): Promise<RunResult> {
    const failure = classifyFailure(error);
    const message = error instanceof Error ? error.message.split("\n")[0]!.slice(0, 500) : String(error);
    await this.screenshot("Error").catch(() => undefined);
    const label = FAILURE_INFO[failure].label;
    // A site that keeps failing is held off for every application, not just this one.
    const cooldown = this.domain ? await this.deps.siteHealth.recordFailure(this.domain, failure, retryAfterOf(error)) : null;
    if (cooldown) await this.log("NOTE", `Holding off ${cooldown.host} for a while: ${cooldown.reason}. Other applications to it wait too.`, { level: "WARNING" }).catch(() => undefined);
    const decision = decideRetry(failure, this.input.attemptNumber, { retryAfterMs: retryAfterOf(error) });
    if (decision.action === "retry") {
      const delayMs = Math.max(decision.delayMs, cooldown ? Date.parse(cooldown.until) - Date.now() : 0);
      return this.finish({ kind: "retry", failure, message: `${label}: ${message}`, delayMs });
    }
    if (decision.action === "needs_attention") {
      const detail = decision.reason === "REPEATED_FAILURE" ? `This application failed ${this.input.attemptNumber} times (${label}: ${message}). Check it, then press Try again or skip it.` : `${label}: ${message}`;
      return this.attention(WAITING_REASONS.has(decision.reason) ? "WAITING_FOR_USER" : "REVIEW_REQUIRED", decision.reason, detail);
    }
    return this.finish({ kind: "failed", failure, message });
  }

  private async aborted(): Promise<RunResult> {
    const { input, deps } = this;
    if (input.signal.reason === ABORT_REASONS.shutdown) await requeueAfterShutdown(input.applicationId, input.attemptId, input.userId, deps.workerId);
    else await cancelAttempt(input.applicationId, input.attemptId, deps.workerId, input.signal.reason === ABORT_REASONS.stop ? "Stopped by user" : "Stopped");
    await this.progress.finish("failed");
    return { result: "cancelled" };
  }

  /** Backstop for a missed stop message: give up if the application is no longer ours. */
  private async assertHeld() {
    const held = await getHeldState(this.input.applicationId);
    if (!held || held.status !== "PROCESSING" || held.lockedBy !== this.deps.workerId) {
      throw new StoppedError();
    }
  }

  private async downloadDocuments(): Promise<DocumentsToUpload> {
    const out: DocumentsToUpload = {};
    for (const kind of ["resume", "coverLetter"] as const) {
      const doc = this.data[kind];
      if (!doc) continue;
      const body = await this.deps.storage.get(doc.storageKey);
      const dir = join(this.tmpDir!, kind);
      await mkdir(dir, { recursive: true });
      const path = join(dir, safeFileName(doc.fileName));
      await writeFile(path, body, { mode: 0o600 });
      out[kind] = { path, fileName: doc.fileName };
    }
    return out;
  }

  private async screenshot(caption: string): Promise<string> {
    if (!this.page || this.page.isClosed()) return "";
    const key = `users/${this.input.userId}/screenshots/${this.input.applicationId}/${randomUUID()}.png`;
    const body = await this.page.screenshot({ fullPage: true, type: "png", timeout: 10_000 });
    await this.deps.storage.put(key, body, "image/png");
    await addAttemptScreenshot(this.input.attemptId, { key, caption, takenAt: new Date().toISOString() });
    return key;
  }

  /** Keep the site's cookies so a sign-in done once is reused next time. */
  private async saveSession() {
    if (!this.context || !this.domain) return;
    try {
      const state = await this.context.storageState();
      if (!state.cookies.length && !state.origins.length) return;
      const session = await saveBrowserSession(this.input.userId, this.domain, this.platform, state);
      await linkAttemptBrowserSession(this.input.attemptId, session.id);
    } catch {
      /* the context may already be closed */
    }
  }
}

/** What findApplicationForm needs from a loaded page: its HTML, frames, links and how many fields it has itself. */
async function snapshotPage(page: Page): Promise<PageSnapshot> {
  const main = page.mainFrame();
  // Only web pages can hold a form; an about:blank frame (reCAPTCHA's badge) never finishes loading, so it isn't read.
  const readable = page.frames().filter((f) => f !== main && /^https?:\/\//i.test(f.url())).slice(0, 12);
  const frames = await Promise.all(readable.map(async (f) => ({ url: f.url(), html: await withTimeout(f.content(), 3000).catch(() => "") })));
  const { links, fieldCount } = (await page.evaluate(SNAPSHOT_SCRIPT)) as Pick<PageSnapshot, "links" | "fieldCount">;
  return { url: page.url(), html: await page.content(), frames, links, fieldCount };
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms).unref())]);
}

const SNAPSHOT_SCRIPT = `(() => {
  const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  const links = Array.from(document.querySelectorAll("a[href]")).slice(0, 1500).map((a) => ({ text: (a.innerText || a.getAttribute("aria-label") || "").trim().slice(0, 80), href: a.href }));
  const fieldCount = Array.from(document.querySelectorAll("input, select, textarea")).filter((el) => visible(el) && !/^(hidden|submit|button|search|image|reset)$/i.test(el.type || "")).length;
  return { links, fieldCount };
})()`;
