import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { createApplicationAI } from "@autoapply/ai";
import { displayLabel, FieldResolver, toProfileFacts } from "@autoapply/automation";
import { createDefaultRegistry, FormAdapter, toDetectedFields, type ScannedField, type ScanOptions } from "@autoapply/ats-adapters";
import {
  addApplicationEvent,
  audit,
  ConflictError,
  connectExtension,
  continueAfterBrowserSignIn,
  getApplicationForHandoff,
  listApplicationsWaitingForUser,
  loadProcessingContext,
  markSubmittedInBrowser,
  NotFoundError,
  prisma,
  revokeExtensionConnection,
  validateExtensionToken,
  validateSessionToken,
} from "@autoapply/database";
import { getStorage } from "@autoapply/documents";
import { analyzeJobs, browserPageSource, isLinkedInUrl, runImport } from "@autoapply/ingestion";
import { enumLabel, type Platform } from "@autoapply/shared";

declare module "fastify" {
  interface FastifyRequest {
    extensionConnectionId?: string;
  }
}

const appUrl = () => (process.env.APP_URL ?? "http://localhost:3000").replace(/\/+$/, "");

/**
 * The extension authenticates with its own token (from a pairing code), sent
 * as a Bearer header. Cookies are deliberately not accepted here, so another
 * site can't make the browser call these routes on the person's behalf.
 * A web session token works too, for scripts and tests.
 */
async function authenticateExtension(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : undefined;
  const extension = await validateExtensionToken(token);
  if (extension) {
    request.user = extension.user;
    request.extensionConnectionId = extension.connectionId;
    return;
  }
  const session = token ? await validateSessionToken(token) : null;
  if (!session) return reply.code(401).send({ error: "Connect the extension to your Applyance account again." });
  request.user = session.user;
}

const idParam = z.object({ id: z.string().regex(/^[a-z0-9]{20,40}$/i) });
const text = (max: number) => z.string().max(max);

const capturedPageSchema = z.object({
  url: z.string().url().max(4000),
  title: text(1000).nullish(),
  siteName: text(500).nullish(),
  heading: text(1000).nullish(),
  selection: text(100_000).nullish(),
  text: text(100_000).nullish(),
  jsonLd: z.array(text(200_000)).max(10).nullish(),
});

const scannedFieldSchema = z.object({
  kind: text(20),
  widget: z.enum(["native", "combobox", "listbox", "buttons", "autocomplete"]),
  label: text(2000),
  labelVia: z.enum(["label", "aria", "dom", "none"]),
  required: z.boolean(),
  options: z.array(text(1000)).max(500).optional(),
  optionValues: z.array(text(1000)).max(500).optional(),
  multiple: z.boolean(),
  name: text(1000),
  id: text(1000),
  placeholder: text(1000),
  autocomplete: text(200),
  inputType: text(50),
  accept: text(500),
  ariaLabel: text(1000),
  domPath: text(4000),
});

const cookieSchema = z.object({
  name: text(4096),
  value: text(8192),
  domain: text(255).min(1),
  path: text(1024),
  expires: z.number(),
  httpOnly: z.boolean(),
  secure: z.boolean(),
  sameSite: z.enum(["Strict", "Lax", "None"]),
});

/** Hosts an ATS serves its forms from, so the extension can ask for them when the employer's page embeds the form. */
const PLATFORM_HOSTS: Partial<Record<Platform, string[]>> = {
  GREENHOUSE: ["https://*.greenhouse.io/*"],
  LEVER: ["https://*.lever.co/*"],
  ASHBY: ["https://*.ashbyhq.com/*"],
  SMARTRECRUITERS: ["https://*.smartrecruiters.com/*"],
  WORKDAY: ["https://*.myworkdayjobs.com/*", "https://*.myworkday.com/*"],
};

/** Match patterns for the sites the extension needs to open and fill this application (the person grants them). */
function originsFor(url: string, platform: Platform): string[] {
  const u = new URL(url);
  return [...new Set([`${u.protocol}//${u.hostname}/*`, ...(PLATFORM_HOSTS[platform] ?? [])])];
}

const registry = createDefaultRegistry();
function scanOptionsFor(platform: Platform): ScanOptions {
  const adapter = registry.list().find((a) => a.platform === platform);
  return adapter instanceof FormAdapter ? adapter.scanOptions : {};
}

const HOW_TO_FINISH: Partial<Record<string, string>> = {
  CAPTCHA: "Solve the check on the page yourself, then press the site's Submit button.",
  AUTH_REQUIRED: "Sign in on the page yourself, then choose Continue in Applyance.",
  MFA: "Enter the verification code on the page yourself, then choose Continue in Applyance.",
};

type HandoffApplication = Awaited<ReturnType<typeof getApplicationForHandoff>>;

function describe(app: HandoffApplication) {
  const url = app.job.applicationUrl ?? app.job.url;
  const linkedIn = isLinkedInUrl(url);
  return {
    id: app.id,
    title: app.job.title,
    company: app.job.company,
    status: app.status,
    statusLabel: enumLabel(app.status),
    reason: app.attentionReason,
    reasonLabel: app.attentionReason ? enumLabel(app.attentionReason) : null,
    detail: app.attentionDetail,
    url,
    /** Applyance never opens or fills LinkedIn pages. */
    canFinishInBrowser: !linkedIn,
    canContinueAfterSignIn: app.status === "WAITING_FOR_USER" && (app.attentionReason === "AUTH_REQUIRED" || app.attentionReason === "MFA"),
    howToFinish: (app.attentionReason && HOW_TO_FINISH[app.attentionReason]) ?? "Check the answers Applyance filled in, finish the rest, then press the site's Submit button.",
    origins: linkedIn ? [] : originsFor(url, app.platform),
    link: `${appUrl()}/applications/${app.id}`,
  };
}

async function handoffApplication(userId: string, applicationId: string) {
  const app = await getApplicationForHandoff(userId, applicationId);
  if (isLinkedInUrl(app.job.applicationUrl ?? app.job.url)) throw new ConflictError("Applyance never opens or fills LinkedIn pages. Apply on LinkedIn yourself, then mark it submitted in Applyance.");
  return app;
}

const SAVE_RESULT = {
  created: "saved",
  duplicate: "already_saved",
  previously_removed: "removed_before",
  already_processed: "already_applied",
} as const;

/**
 * Routes for the Applyance browser extension: connecting with a pairing code,
 * saving the job on the current page, and finishing applications in the
 * person's own browser (filling approved answers, saving a sign-in they did
 * themselves, recording a submission they made). Applyance never solves a
 * CAPTCHA, enters a password or presses Submit here.
 */
export async function extensionRoutes(app: FastifyInstance) {
  app.post("/connect", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (request, reply) => {
    const body = z.object({ code: text(40).min(4), browser: text(200).nullish() }).parse(request.body);
    const connected = await connectExtension(body.code, { browser: body.browser });
    if (!connected) return reply.code(400).send({ error: "That code didn't work. Codes last 10 minutes and work once. Create a new one in Applyance under Settings, Browser extension." });
    await audit(connected.user.id, "extension.connected", { entityType: "ExtensionConnection", entityId: connected.connectionId, metadata: { browser: body.browser ?? null }, context: { ipAddress: request.ip, userAgent: request.headers["user-agent"] ?? null } });
    return { token: connected.token, user: { email: connected.user.email, name: connected.user.name }, appUrl: appUrl() };
  });

  await app.register(async (authed) => {
    authed.addHook("preHandler", authenticateExtension);

    authed.get("/me", async (request) => ({ user: { email: request.user!.email, name: request.user!.name }, appUrl: appUrl() }));

    authed.delete("/connection", async (request, reply) => {
      if (request.extensionConnectionId) {
        await revokeExtensionConnection(request.user!.id, request.extensionConnectionId);
        await audit(request.user!.id, "extension.disconnected", { entityType: "ExtensionConnection", entityId: request.extensionConnectionId });
      }
      return reply.code(204).send();
    });

    authed.post("/jobs", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async (request) => {
      const userId = request.user!.id;
      const page = capturedPageSchema.parse(request.body);
      // Belt and braces: even if an extension sent LinkedIn page content, only the link is used.
      const input = isLinkedInUrl(page.url) ? { url: page.url } : page;
      const summary = await runImport(userId, browserPageSource, input);
      const outcome = summary.outcomes[0];
      if (!outcome) return { result: "not_saved", message: summary.issues[0]?.message ?? "Applyance couldn't save this page." };
      if (outcome.kind === "created" || (outcome.kind === "duplicate" && outcome.enriched)) {
        analyzeJobs(userId, { jobIds: [outcome.jobId] }).catch((error) => request.log.error(error, "analysis after extension save failed"));
      }
      await audit(userId, "jobs.imported", { entityType: "JobImport", entityId: summary.importId, metadata: { source: "extension", created: summary.created, duplicates: summary.duplicates } });
      const job = await prisma.job.findFirst({ where: { id: outcome.jobId, userId }, select: { id: true, title: true, company: true, status: true } });
      const needsDetails = job?.status === "NEEDS_DETAILS" || summary.needsDetails > 0;
      const linkedIn = isLinkedInUrl(page.url);
      const message =
        outcome.kind === "created"
          ? linkedIn
            ? "Saved the link. Applyance doesn't read LinkedIn pages, so paste the job description on the job's page in Applyance to score it."
            : needsDetails
              ? "Saved. Applyance couldn't find the description on this page, so paste it on the job's page in Applyance."
              : "Saved. Applyance is scoring it against your profile now."
          : outcome.kind === "duplicate"
            ? outcome.enriched
              ? "Already saved. Added the details it was missing."
              : "Already in your jobs."
            : outcome.kind === "previously_removed"
              ? "You deleted this job earlier, so it wasn't added again."
              : "You've already applied to or skipped this job.";
      return {
        result: SAVE_RESULT[outcome.kind],
        message,
        job: job ? { id: job.id, title: job.title, company: job.company, needsDetails, link: `${appUrl()}/jobs/${job.id}` } : null,
      };
    });

    authed.get("/applications", async (request) => {
      const { rows, total } = await listApplicationsWaitingForUser(request.user!.id);
      return { total, applications: rows.map(describe), link: `${appUrl()}/needs-attention` };
    });

    authed.post("/applications/:id/open", async (request) => {
      const { id } = idParam.parse(request.params);
      const app = await handoffApplication(request.user!.id, id);
      await addApplicationEvent(id, request.user!.id, "HUMAN_INPUT_RECEIVED", "Opened in your own browser with the Applyance extension");
      return { application: describe(app), scanOptions: scanOptionsFor(app.platform) };
    });

    /**
     * The extension scanned a page of the form in the person's browser. Each
     * field is resolved exactly as the worker would: from the Master Profile,
     * the Answer Library and answers approved for this application. Only
     * confident answers are filled; everything else is left to the person.
     */
    authed.post("/applications/:id/fill", async (request) => {
      const { id } = idParam.parse(request.params);
      const userId = request.user!.id;
      const body = z.object({ url: z.string().url().max(4000), pageIndex: z.number().int().min(0).max(50).default(0), fields: z.array(scannedFieldSchema).max(300) }).parse(request.body);
      await handoffApplication(userId, id);
      if (isLinkedInUrl(body.url)) throw new ConflictError("Applyance never fills LinkedIn pages.");
      const data = await loadProcessingContext(id);
      if (!data) throw new NotFoundError("Application");
      const ai = createApplicationAI(
        { provider: data.settings.aiProvider, model: data.settings.aiModel },
        { profile: data.profile, job: { id: data.job.id, title: data.job.title, company: data.job.company, description: data.job.description }, library: data.library },
      );
      const resolver = new FieldResolver({
        classifier: ai.classifier,
        profile: toProfileFacts(data.profile),
        library: data.library,
        stored: data.questions,
        documents: { resume: data.resume ? { fileName: data.resume.fileName } : null, coverLetter: data.coverLetter ? { fileName: data.coverLetter.fileName } : null },
        fieldConfidenceThreshold: data.settings.fieldConfidenceThreshold,
        answerConfidenceThreshold: data.settings.answerConfidenceThreshold,
      });
      const fields = toDetectedFields(body.fields as ScannedField[], body.pageIndex);
      const plan = [];
      for (const [index, field] of fields.entries()) {
        const m = await resolver.resolve(field);
        const label = displayLabel(m.detectedLabel);
        if (field.kind === "file") {
          const document = m.mappedField === "documents.resume" && data.resume ? "resume" : m.mappedField === "documents.coverLetter" && data.coverLetter ? "coverLetter" : null;
          if (document && m.status !== "SKIPPED") plan.push({ index, label, action: "upload" as const, document, fileName: document === "resume" ? data.resume!.fileName : data.coverLetter!.fileName });
          else plan.push({ index, label, action: field.required ? ("yours" as const) : ("skip" as const), reason: field.required ? "Attach this file yourself." : null });
          continue;
        }
        const empty = m.value == null || m.value === "" || (Array.isArray(m.value) && !m.value.length);
        if (m.status === "ANSWERED" && !empty) plan.push({ index, label, action: "fill" as const, value: m.value });
        else if (m.status === "NEEDS_REVIEW" || (field.required && empty)) plan.push({ index, label, action: "yours" as const, reason: m.reviewReason ?? "Applyance doesn't have an answer for this." });
        else plan.push({ index, label, action: "skip" as const, reason: null });
      }
      const filled = plan.filter((p) => p.action === "fill" || p.action === "upload").length;
      const yours = plan.filter((p) => p.action === "yours").length;
      if (fields.length) {
        await addApplicationEvent(id, userId, "FIELDS_MAPPED", `Filled ${filled} of ${fields.length} field${fields.length === 1 ? "" : "s"} in your browser on ${new URL(body.url).hostname}${yours ? `; ${yours} left for you` : ""}`);
      }
      return { plan, filled, yours };
    });

    authed.get("/applications/:id/documents/:kind", async (request, reply) => {
      const { id } = idParam.parse(request.params);
      const { kind } = z.object({ kind: z.enum(["resume", "coverLetter"]) }).parse(request.params);
      await handoffApplication(request.user!.id, id);
      const data = await loadProcessingContext(id);
      const doc = data?.[kind];
      if (!doc) throw new NotFoundError(kind === "resume" ? "Resume" : "Cover letter");
      const body = await getStorage().get(doc.storageKey);
      return reply
        .header("content-type", doc.mimeType)
        .header("content-disposition", `attachment; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`)
        .header("cache-control", "no-store")
        .send(body);
    });

    authed.post("/applications/:id/signed-in", async (request) => {
      const { id } = idParam.parse(request.params);
      const { cookies } = z.object({ cookies: z.array(cookieSchema).max(300) }).parse(request.body);
      const result = await continueAfterBrowserSignIn(request.user!.id, id, cookies);
      await audit(request.user!.id, "browser_session.saved_from_extension", { entityType: "Application", entityId: id, metadata: { host: result.host, cookies: result.cookies } });
      return { ok: true, message: `Saved your sign-in for ${result.host}. Applyance is carrying on with the application.` };
    });

    authed.post("/applications/:id/submitted", async (request) => {
      const { id } = idParam.parse(request.params);
      const body = z.object({ confirmation: text(100).nullish(), detected: z.boolean().default(false) }).parse(request.body ?? {});
      await markSubmittedInBrowser(request.user!.id, id, { confirmation: body.confirmation, detected: body.detected });
      return { ok: true, message: "Recorded as submitted. Flightpath now shows it as Submitted." };
    });
  });
}
