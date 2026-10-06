// Applyance background worker: saving jobs, the "needs you" badge, and
// finishing applications in the person's own tabs.

import { api, ApiError, isLinkedIn } from "./lib/api.js";
import { capturePage, toStorageCookies } from "./lib/page.js";

const BADGE_ALARM = "refresh-badge";
const BADGE_MINUTES = 5;

// ─── Saving jobs ─────────────────────────────────────────────────────────────

/**
 * Save the job on a tab. On LinkedIn only the link is sent. Elsewhere the page
 * is read once, now, because the person asked (activeTab).
 * @param {{ id?: number; url?: string }} tab
 */
async function saveTab(tab) {
  if (!tab.url || !/^https?:/i.test(tab.url)) throw new ApiError(400, "Open a job's page first. Applyance can only save web pages.");
  if (isLinkedIn(tab.url)) return api("/jobs", { method: "POST", body: { url: tab.url } });
  let page = { url: tab.url };
  try {
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: capturePage });
    if (result?.result) page = result.result;
  } catch {
    // Pages the extension can't read (the Chrome Web Store, PDFs) are saved by their link.
  }
  return api("/jobs", { method: "POST", body: page });
}

/** A saved link: Applyance reads the public posting, the same as a pasted link. */
const saveLink = (url) => api("/jobs", { method: "POST", body: { url } });

/** Briefly show the result on the toolbar icon when saving from the right-click menu. */
async function flash(tabId, ok) {
  await chrome.action.setBadgeBackgroundColor({ color: ok ? "#16a34a" : "#dc2626", tabId });
  await chrome.action.setBadgeText({ text: ok ? "✓" : "!", tabId });
  setTimeout(() => chrome.action.setBadgeText({ text: "", tabId }).catch(() => undefined), 4000);
}

// ─── The badge: applications that need the person ────────────────────────────

async function refreshBadge() {
  try {
    const { total } = await api("/applications");
    await chrome.action.setBadgeBackgroundColor({ color: "#4f46e5" });
    await chrome.action.setBadgeText({ text: total ? String(Math.min(total, 99)) : "" });
    await chrome.action.setTitle({ title: total ? `Applyance: ${total} application${total === 1 ? "" : "s"} need${total === 1 ? "s" : ""} you` : "Applyance" });
  } catch {
    await chrome.action.setBadgeText({ text: "" });
  }
}

// ─── Finishing an application in the person's own tab ───────────────────────

/**
 * @typedef {{
 *   applicationId: string; title: string; company: string; url: string; link: string;
 *   reason: string | null; howToFinish: string; canContinueAfterSignIn: boolean;
 *   scanOptions: Record<string, unknown>; sawForm: boolean; pageIndex: number; done: null | "submitted" | "continued";
 *   status: { filled: number; yours: string[]; failed: string[] };
 * }} Handoff
 */

/** @returns {Promise<Record<string, Handoff>>} */
async function handoffs() {
  return (await chrome.storage.session.get("handoffs")).handoffs ?? {};
}

/** @param {number} tabId @param {(h: Handoff) => Handoff | null} change */
async function updateHandoff(tabId, change) {
  const all = await handoffs();
  const current = all[tabId];
  if (!current) return null;
  const next = change(current);
  if (next) all[tabId] = next;
  else delete all[tabId];
  await chrome.storage.session.set({ handoffs: all });
  return next;
}

/** Open the application in a new tab and help with it there. Host access was granted by the popup. */
async function startHandoff(applicationId) {
  const { application, scanOptions } = await api(`/applications/${applicationId}/open`, { method: "POST" });
  if (!application.canFinishInBrowser) throw new ApiError(409, "Applyance never opens LinkedIn pages.");
  const tab = await chrome.tabs.create({ url: application.url, active: true });
  const all = await handoffs();
  all[tab.id] = {
    applicationId,
    title: application.title,
    company: application.company,
    url: application.url,
    link: application.link,
    reason: application.reason,
    howToFinish: application.howToFinish,
    canContinueAfterSignIn: application.canContinueAfterSignIn,
    scanOptions,
    sawForm: false,
    pageIndex: 0,
    done: null,
    status: { filled: 0, yours: [], failed: [] },
  };
  await chrome.storage.session.set({ handoffs: all });
  return { tabId: tab.id };
}

/** Each page load in a handoff tab gets the helper (every frame, since forms are often embedded). */
async function injectHelper(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ["content/page-scripts.js", "content/handoff.js"] });
  } catch {
    // A page the person didn't grant access to (a sign-in on another site); the helper returns on the next page.
  }
}

const notifyPanel = (tabId, handoff) => chrome.tabs.sendMessage(tabId, { type: "handoff:update", handoff }, { frameId: 0 }).catch(() => undefined);

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Messages from the helper in a handoff tab. Each needs the tab to be one the person started from the popup. */
async function onHelperMessage(message, sender) {
  const tabId = sender.tab?.id;
  if (tabId == null) return null;
  const handoff = (await handoffs())[tabId];
  if (!handoff) return null;
  switch (message.type) {
    case "handoff:context":
      return { ...handoff, isTop: sender.frameId === 0 };
    case "handoff:fill": {
      const pageIndex = message.newPage ? handoff.pageIndex + (handoff.sawForm ? 1 : 0) : handoff.pageIndex;
      const result = await api(`/applications/${handoff.applicationId}/fill`, { method: "POST", body: { url: message.url, pageIndex, fields: message.fields } });
      await updateHandoff(tabId, (h) => ({ ...h, sawForm: h.sawForm || message.fields.length > 0, pageIndex }));
      return result;
    }
    case "handoff:document": {
      const response = await api(`/applications/${handoff.applicationId}/documents/${message.kind}`, { raw: true });
      const type = response.headers.get("content-type") ?? "application/octet-stream";
      return { base64: arrayBufferToBase64(await response.arrayBuffer()), type };
    }
    case "handoff:status": {
      const next = await updateHandoff(tabId, (h) => ({ ...h, status: message.status }));
      await notifyPanel(tabId, next);
      return { ok: true };
    }
    case "handoff:signed-in": {
      const cookies = await chrome.cookies.getAll({ url: handoff.url });
      const result = await api(`/applications/${handoff.applicationId}/signed-in`, { method: "POST", body: { cookies: toStorageCookies(cookies) } });
      const next = await updateHandoff(tabId, (h) => ({ ...h, done: "continued" }));
      await notifyPanel(tabId, next);
      void refreshBadge();
      return result;
    }
    case "handoff:submitted": {
      // A confirmation page counts only after Applyance saw this application's form in this tab.
      if (message.detected && !handoff.sawForm) return null;
      if (handoff.done) return { ok: true };
      const result = await api(`/applications/${handoff.applicationId}/submitted`, { method: "POST", body: { confirmation: message.confirmation ?? null, detected: !!message.detected } });
      const next = await updateHandoff(tabId, (h) => ({ ...h, done: "submitted" }));
      await notifyPanel(tabId, next);
      void refreshBadge();
      return result;
    }
    case "handoff:end":
      await updateHandoff(tabId, () => null);
      return { ok: true };
    default:
      return null;
  }
}

/** Messages from the popup. */
async function onPopupMessage(message) {
  switch (message.type) {
    case "save-tab":
      return saveTab(message.tab);
    case "start-handoff":
      return startHandoff(message.applicationId);
    case "refresh-badge":
      await refreshBadge();
      return { ok: true };
    default:
      return null;
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const fromHelper = typeof message?.type === "string" && message.type.startsWith("handoff:");
  (fromHelper ? onHelperMessage(message, sender) : onPopupMessage(message))
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error), status: error?.status ?? 500 }));
  return true;
});

chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== "complete") return;
  if ((await handoffs())[tabId]) await injectHelper(tabId);
});

chrome.tabs.onRemoved.addListener((tabId) => {
  void updateHandoff(tabId, () => null);
});

// ─── Right-click menu, install and the badge timer ──────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "save-page", title: "Save this job to Applyance", contexts: ["page"] });
    chrome.contextMenus.create({ id: "save-link", title: "Save linked job to Applyance", contexts: ["link"] });
  });
  void chrome.alarms.create(BADGE_ALARM, { periodInMinutes: BADGE_MINUTES });
  void refreshBadge();
});

chrome.runtime.onStartup.addListener(() => void refreshBadge());

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BADGE_ALARM) void refreshBadge();
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  try {
    if (info.menuItemId === "save-link" && info.linkUrl) await saveLink(info.linkUrl);
    else if (info.menuItemId === "save-page" && tab) await saveTab(tab);
    else return;
    if (tab?.id != null) await flash(tab.id, true);
  } catch {
    if (tab?.id != null) await flash(tab.id, false);
  }
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.token) void refreshBadge();
});

// For the end-to-end tests, which drive the worker directly.
globalThis.applyance = { saveTab, saveLink, startHandoff, refreshBadge, handoffs };
