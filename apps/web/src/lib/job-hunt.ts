import "server-only";
import { after } from "next/server";
import { detectPlatformFromUrl } from "@autoapply/ats-adapters";
import { audit, findKnownJobUrls, prisma, queueApplications } from "@autoapply/database";
import { analyzeJobs, foundJobsSource, runImport, type FoundJob } from "@autoapply/ingestion";
import { canonicalizeJobUrl, createLogger, isCompanyApplicationUrl } from "@autoapply/shared";
import { searchOpenings, usingFakeJobSources } from "./job-search";
import { notifyWorker } from "./worker-queue";

const log = createLogger("job-hunt");

/**
 * What the Start button's job search is doing, for the Tasks page. Start looks
 * for new openings that fit the saved preferences, adds them to the jobs list,
 * checks each against the profile and rules, and puts the ones that qualify in
 * line, all in the background while the queue runs.
 */
export interface JobHunt {
  state: "searching" | "adding" | "checking" | "done" | "failed";
  message: string;
  startedAt: number;
  finishedAt: number | null;
  found: number;
  queued: number;
}

/** New jobs added per Start; each one is read and checked, which can use the AI. */
const MAX_NEW_JOBS = 20;
/** Pressing Start again soon after a search doesn't search again. */
const SEARCH_AGAIN_AFTER_MS = 10 * 60_000;
/** How long the result stays on the Tasks page. */
const SHOW_RESULT_MS = 30 * 60_000;

// One web process serves the app; keep the state on globalThis so every module copy shares it.
const store = globalThis as typeof globalThis & { __applyanceJobHunts?: Map<string, JobHunt> };
const hunts = (store.__applyanceJobHunts ??= new Map<string, JobHunt>());

const plural = (n: number, word: string) => `${n.toLocaleString("en-US")} ${word}${n === 1 ? "" : "s"}`;
const active = (hunt: JobHunt | undefined) => !!hunt && (hunt.state === "searching" || hunt.state === "adding" || hunt.state === "checking");

export function jobHuntStatus(userId: string, now = Date.now()): JobHunt | null {
  const hunt = hunts.get(userId);
  if (!hunt) return null;
  if (!active(hunt) && hunt.finishedAt != null && now - hunt.finishedAt > SHOW_RESULT_MS) return null;
  return hunt;
}

/**
 * Start a search for this user unless one is running or just finished.
 * Returns "started", "running" or "recent".
 */
export function startJobHunt(userId: string, now = Date.now()): "started" | "running" | "recent" {
  const last = hunts.get(userId);
  if (active(last)) return "running";
  if (last?.finishedAt != null && last.state === "done" && now - last.finishedAt < SEARCH_AGAIN_AFTER_MS) return "recent";
  hunts.set(userId, { state: "searching", message: "Searching job boards for openings that fit your preferences", startedAt: now, finishedAt: null, found: 0, queued: 0 });
  const task = hunt(userId).catch((error) => {
    log.error("Job search from Start failed", { error });
    finish(userId, "failed", "Couldn't search for new jobs this time. The jobs already in line keep going.");
  });
  after(() => task);
  return "started";
}

function update(userId: string, patch: Partial<JobHunt>) {
  const hunt = hunts.get(userId);
  if (hunt) hunts.set(userId, { ...hunt, ...patch });
}

function finish(userId: string, state: "done" | "failed", message: string, patch: Partial<JobHunt> = {}) {
  update(userId, { ...patch, state, message, finishedAt: Date.now() });
}

/** Jobs Applyance can apply to by itself (not on a listing site or job aggregator), the ones on hiring software it knows first. */
function applicable<T extends { url: string }>(jobs: T[]): T[] {
  const own = jobs.filter((j) => isCompanyApplicationUrl(j.url));
  const known = (j: T) => {
    const platform = detectPlatformFromUrl(j.url).platform;
    // Workday usually needs an account, so its jobs go after the ones that don't.
    return platform !== "GENERIC" && platform !== "UNKNOWN" && platform !== "WORKDAY";
  };
  return [...own.filter(known), ...own.filter((j) => !known(j))];
}

async function hunt(userId: string) {
  const result = await searchOpenings(userId);
  if (!result) {
    finish(userId, "done", "Add the kinds of jobs you want under Preferences on the Jobs page, then press Start.");
    return;
  }
  const canonical = (url: string) => {
    try {
      return canonicalizeJobUrl(url);
    } catch {
      return url;
    }
  };
  const known = await findKnownJobUrls(userId, result.jobs.map((j) => canonical(j.url)));
  const fresh = applicable(result.jobs.filter((j) => !known.has(canonical(j.url)))).slice(0, MAX_NEW_JOBS);
  if (!fresh.length) {
    finish(userId, "done", "No new openings fit your preferences right now. Press Start again later, or widen your preferences on the Jobs page.");
    return;
  }

  update(userId, { state: "adding", found: fresh.length, message: `Found ${plural(fresh.length, "new opening")}. Reading their job pages` });
  const jobs: FoundJob[] = fresh.map((j) => ({
    url: j.url,
    title: j.title ?? "Untitled job",
    company: j.company ?? "Unknown company",
    location: j.location ?? null,
    postedAt: j.postedAt ?? null,
    salaryText: j.salaryText ?? null,
    workArrangement: j.workArrangement ?? null,
    description: j.description ?? null,
  }));
  const summary = await runImport(userId, foundJobsSource, { jobs }, usingFakeJobSources ? { context: { fetchPosting: async () => null } } : {});
  await audit(userId, "jobs.imported", { entityType: "JobImport", entityId: summary.importId, metadata: { source: "start_button", created: summary.created, duplicates: summary.duplicates } });
  const added = summary.createdJobIds;
  if (!added.length) {
    finish(userId, "done", "No new openings fit your preferences right now. Press Start again later, or widen your preferences on the Jobs page.");
    return;
  }

  update(userId, { state: "checking", found: added.length, message: `Checking which of ${plural(added.length, "new job")} fit your profile and rules` });
  const checked = await analyzeJobs(userId, { jobIds: added });
  const qualified = await prisma.job.findMany({
    where: { id: { in: added }, userId, status: "QUALIFIED", application: null },
    select: { id: true },
    orderBy: { matchScore: { sort: "desc", nulls: "last" } },
  });
  const queued = qualified.length ? (await queueApplications(userId, qualified.map((j) => j.id))).queued : 0;
  if (queued) await notifyWorker(userId);
  await audit(userId, "queue.hunt", { metadata: { found: added.length, queued } });
  const why = [checked.notQualified ? `${checked.notQualified} didn't pass your rules` : null, checked.needsDetails ? `${checked.needsDetails} need more details` : null].filter(Boolean).join(" and ");
  const message = queued
    ? `Found ${plural(added.length, "new job")}. ${queued} ${queued === 1 ? "fits and was" : "fit and were"} added to the line.`
    : `Found ${plural(added.length, "new job")}, but none qualified yet${why ? ` (${why})` : ""}. They're on the Jobs page.`;
  finish(userId, "done", message, { found: added.length, queued });
}
