"use server";

import { revalidatePath } from "next/cache";
import {
  audit,
  createSavedSearch,
  deleteSavedSearch,
  getSavedSearch,
  markSearchMatchesAdded,
  saveNotificationSettings,
  SavedSearchLimitError,
  SavedSearchNameTakenError,
  setSavedSearchAlerts,
  updateSavedSearch,
  type SavedSearchInput,
} from "@autoapply/database";
import { BOARD_PROVIDER_LIST, BoardSearchError, boardKey, boardUrl, jobBoardSearchSource, MAX_BOARDS_PER_SEARCH, parseBoardList, parseBoardRef, runImport } from "@autoapply/ingestion";
import { createEmailSender, runSavedSearch, sendTestEmail } from "@autoapply/notifications";
import { canonicalizeJobUrl, notificationSettingsSchema, savedSearchSchema, type SavedSearchFormInput } from "@autoapply/shared";
import { authedAction, formToObject, parseIds, validationFailed, type ActionResult } from "@/lib/action";
import { analyzeInBackground } from "@/lib/pipeline";
import { LIMITS, rateLimit } from "@/lib/rate-limit";

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function refresh() {
  revalidatePath("/job-alerts");
  revalidatePath("/settings");
}

/** Validate the form and turn its board list into board links. */
function readSearch(input: SavedSearchFormInput): { search: SavedSearchInput } | { error: ActionResult<never> } {
  const parsed = savedSearchSchema.safeParse(input);
  if (!parsed.success) return { error: validationFailed(parsed.error) };
  const { boards, invalid } = parseBoardList(parsed.data.boards);
  const fail = (field: string, message: string) => ({ error: { ok: false, message, errors: { [field]: message } } as ActionResult<never> });
  if (invalid.length) return fail("boards", `Not a ${BOARD_PROVIDER_LIST} board: ${invalid.slice(0, 3).join(", ")}${invalid.length > 3 ? "…" : ""}`);
  if (!boards.length) return fail("boards", "Add at least one job board");
  if (boards.length > MAX_BOARDS_PER_SEARCH) return fail("boards", `Search up to ${MAX_BOARDS_PER_SEARCH} boards at a time`);
  if (!parsed.data.query && !parsed.data.location) return fail("query", "Enter keywords to search for");
  const d = parsed.data;
  return { search: { name: d.name, boards: boards.map(boardUrl), query: d.query, location: d.location ?? null, searchDescriptions: d.searchDescriptions, matchAny: d.matchAny, alertsEnabled: d.alertsEnabled } };
}

function searchError(error: unknown): ActionResult<never> | null {
  if (error instanceof SavedSearchNameTakenError) return { ok: false, message: error.message, errors: { name: error.message } };
  if (error instanceof SavedSearchLimitError) return { ok: false, message: error.message };
  return null;
}

/**
 * Save a board search for daily job alerts. It runs once right away so what's
 * open today becomes the baseline; the morning emails then carry only postings
 * that appear after this.
 */
export async function createSavedSearchAction(input: SavedSearchFormInput): Promise<ActionResult<{ id: string }>> {
  return authedAction<{ id: string }>(async (user) => {
    const read = readSearch(input);
    if ("error" in read) return read.error;
    let saved;
    try {
      saved = await createSavedSearch(user.id, read.search);
    } catch (error) {
      const handled = searchError(error);
      if (handled) return handled;
      throw error;
    }
    await audit(user.id, "job_alerts.search_saved", { entityType: "SavedSearch", entityId: saved.id });
    let message = `Saved "${saved.name}".`;
    const limit = await rateLimit(`board-search:${user.id}`, LIMITS.boardSearch.limit, LIMITS.boardSearch.windowMs);
    if (limit.allowed) {
      const run = await runSavedSearch(saved);
      message += run.error && run.totalMatches === 0 ? " The boards couldn't be read just now; they'll be tried again tomorrow morning." : ` ${plural(run.totalMatches, "job")} match today.`;
    }
    if (read.search.alertsEnabled) message += " You'll get an email when new ones are posted.";
    refresh();
    return { ok: true, message, data: { id: saved.id } };
  });
}

export async function updateSavedSearchAction(id: string, input: SavedSearchFormInput): Promise<ActionResult> {
  return authedAction(async (user) => {
    const [searchId] = parseIds([id]);
    if (!searchId) return { ok: false, message: "Invalid id" };
    const read = readSearch(input);
    if ("error" in read) return read.error;
    let updated;
    try {
      updated = await updateSavedSearch(user.id, searchId, read.search);
    } catch (error) {
      const handled = searchError(error);
      if (handled) return handled;
      throw error;
    }
    if (!updated) return { ok: false, message: "Saved search not found" };
    // A changed search starts over: record today's matches as its new baseline.
    if (!updated.lastRunAt && (await rateLimit(`board-search:${user.id}`, LIMITS.boardSearch.limit, LIMITS.boardSearch.windowMs)).allowed) await runSavedSearch(updated);
    await audit(user.id, "job_alerts.search_updated", { entityType: "SavedSearch", entityId: searchId });
    refresh();
    return { ok: true, message: "Saved search updated" };
  });
}

export async function setSavedSearchAlertsAction(id: string, enabled: boolean): Promise<ActionResult> {
  return authedAction(async (user) => {
    const [searchId] = parseIds([id]);
    if (!searchId || typeof enabled !== "boolean") return { ok: false, message: "Invalid request" };
    if (!(await setSavedSearchAlerts(user.id, searchId, enabled))) return { ok: false, message: "Saved search not found" };
    refresh();
    return { ok: true, message: enabled ? "Daily emails on for this search" : "Daily emails paused for this search" };
  });
}

export async function deleteSavedSearchAction(id: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    const [searchId] = parseIds([id]);
    if (!searchId || !(await deleteSavedSearch(user.id, searchId))) return { ok: false, message: "Saved search not found" };
    await audit(user.id, "job_alerts.search_deleted", { entityType: "SavedSearch", entityId: searchId });
    refresh();
    return { ok: true, message: "Saved search deleted" };
  });
}

/** Run a saved search now. New postings show on the page; no email is sent. */
export async function checkSavedSearchNowAction(id: string): Promise<ActionResult> {
  return authedAction(async (user) => {
    const [searchId] = parseIds([id]);
    const search = searchId ? await getSavedSearch(user.id, searchId) : null;
    if (!search) return { ok: false, message: "Saved search not found" };
    const limit = await rateLimit(`board-search:${user.id}`, LIMITS.boardSearch.limit, LIMITS.boardSearch.windowMs);
    if (!limit.allowed) return { ok: false, message: `Search limit reached. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.` };
    const run = await runSavedSearch(search);
    refresh();
    if (run.error && run.totalMatches === 0) return { ok: false, message: `Couldn't check the boards: ${run.error}` };
    if (run.baseline) return { ok: true, message: `${plural(run.totalMatches, "job")} match today. New ones will show up here and in your morning email.` };
    return { ok: true, message: run.newMatches.length ? `Found ${plural(run.newMatches.length, "new job")}` : "Nothing new since the last check" };
  });
}

/** Add postings a saved search found to the user's jobs. The boards are read again so only open postings are added. */
export async function addAlertMatchesAction(id: string, urls: string[]): Promise<ActionResult> {
  return authedAction(async (user) => {
    const [searchId] = parseIds([id]);
    const search = searchId ? await getSavedSearch(user.id, searchId) : null;
    if (!search) return { ok: false, message: "Saved search not found" };
    const picked = Array.isArray(urls) ? urls.filter((u): u is string => typeof u === "string" && u.length <= 2048).slice(0, 200) : [];
    if (!picked.length) return { ok: false, message: "Choose at least one job to add" };
    const limit = await rateLimit(`import:${user.id}`, LIMITS.jobImport.limit, LIMITS.jobImport.windowMs);
    if (!limit.allowed) return { ok: false, message: `Import limit reached. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.` };
    const pickedBoards = new Set(picked.map((u) => parseBoardRef(u)).filter((b) => b !== null).map(boardKey));
    const boards = parseBoardList(search.boards.join("\n")).boards.filter((b) => pickedBoards.has(boardKey(b)));
    if (!boards.length) return { ok: false, message: "Those jobs aren't on this search's boards" };
    let summary;
    try {
      summary = await runImport(user.id, jobBoardSearchSource, {
        boards,
        query: search.query,
        location: search.location,
        searchDescriptions: search.searchDescriptions,
        matchAny: search.matchAny,
        onlyUrls: picked,
      });
    } catch (error) {
      if (error instanceof BoardSearchError) return { ok: false, message: error.message };
      throw error;
    }
    if (summary.total === 0) return { ok: false, message: "Those jobs are no longer on the boards." };
    await markSearchMatchesAdded(user.id, search.id, picked.flatMap((u) => { try { return [canonicalizeJobUrl(u)]; } catch { return []; } }));
    await audit(user.id, "jobs.imported", { entityType: "JobImport", entityId: summary.importId, metadata: { source: "job_alert", created: summary.created, duplicates: summary.duplicates } });
    if (summary.created || summary.enrichedJobIds.length) analyzeInBackground(user.id);
    refresh();
    revalidatePath("/jobs");
    revalidatePath("/dashboard");
    const closed = picked.length - summary.total;
    return {
      ok: true,
      message: `Added ${plural(summary.created, "job")} to your jobs${summary.duplicates ? `, ${summary.duplicates} already there` : ""}${closed > 0 ? `, ${closed} no longer open` : ""}.`,
    };
  });
}

export async function saveNotificationSettingsAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  return authedAction(async (user) => {
    const parsed = notificationSettingsSchema.safeParse(formToObject(formData));
    if (!parsed.success) return validationFailed(parsed.error);
    await saveNotificationSettings(user.id, parsed.data);
    await audit(user.id, "settings.notifications_updated", { entityType: "UserSetting", metadata: parsed.data });
    refresh();
    return { ok: true, message: "Notification settings saved" };
  });
}

export async function sendTestEmailAction(): Promise<ActionResult> {
  return authedAction(async (user) => {
    const limit = await rateLimit(`test-email:${user.id}`, 5, 60 * 60_000);
    if (!limit.allowed) return { ok: false, message: "You've sent several test emails. Try again later." };
    const result = await sendTestEmail(user.id, createEmailSender());
    refresh();
    return result;
  });
}
