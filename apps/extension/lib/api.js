// Talking to the Applyance server. Used by the popup and the background worker.

/** Where a local Applyance runs (`pnpm dev:api`). The person can change it when connecting. */
export const DEFAULT_API_URL = "http://localhost:4000";

export class ApiError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * @typedef {{ apiUrl?: string; token?: string; user?: { email: string; name: string }; appUrl?: string }} Connection
 * @returns {Promise<Connection>}
 */
export async function getConnection() {
  return /** @type {Connection} */ (await chrome.storage.local.get(["apiUrl", "token", "user", "appUrl"]));
}

/** "localhost:4000/" → "http://localhost:4000". Only http(s) origins. */
export function normalizeApiUrl(input) {
  const raw = String(input ?? "").trim();
  if (!raw) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !/^https?:\/\//i.test(raw)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `http://${raw}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** The match pattern that lets the extension call this server ("http://localhost/*" covers every port). */
export const originPattern = (apiUrl) => `${new URL(apiUrl).protocol}//${new URL(apiUrl).hostname}/*`;

async function request(apiUrl, path, { method = "GET", body, token } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  try {
    return await fetch(`${apiUrl}/v1/extension${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, `Can't reach Applyance at ${apiUrl}. Check that it's running, or connect again with the right address.`);
  }
}

async function errorFrom(response) {
  const data = await response.json().catch(() => ({}));
  return new ApiError(response.status, data.error ?? `Applyance couldn't do that (error ${response.status}).`);
}

/**
 * Call an extension route as the connected person. A rejected token means the
 * extension was disconnected (from Settings, or by signing out everywhere), so
 * it forgets the token and asks to connect again.
 * @param {string} path
 * @param {{ method?: string; body?: unknown; raw?: boolean }} [options]
 */
export async function api(path, options = {}) {
  const { apiUrl, token } = await getConnection();
  if (!apiUrl || !token) throw new ApiError(401, "Connect the extension to Applyance first.");
  const response = await request(apiUrl, path, { ...options, token });
  if (response.status === 401) {
    await chrome.storage.local.remove(["token", "user"]);
    throw new ApiError(401, "The extension was disconnected from Applyance. Connect it again.");
  }
  if (!response.ok) throw await errorFrom(response);
  if (options.raw) return response;
  return response.status === 204 ? null : response.json();
}

/** Trade a pairing code from Settings for this extension's own token. */
export async function connect(apiUrl, code) {
  const browser = describeBrowser(navigator.userAgent);
  const response = await request(apiUrl, "/connect", { method: "POST", body: { code, browser } });
  if (!response.ok) throw await errorFrom(response);
  const { token, user, appUrl } = await response.json();
  await chrome.storage.local.set({ apiUrl, token, user, appUrl });
  return { user, appUrl };
}

export async function disconnect() {
  await api("/connection", { method: "DELETE" }).catch(() => undefined);
  await chrome.storage.local.remove(["token", "user"]);
}

export function describeBrowser(ua) {
  const browser = /Edg\//.test(ua) ? "Edge" : /Brave/.test(ua) ? "Brave" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : "Browser";
  const os = /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "";
  return os ? `${browser} on ${os}` : browser;
}

/** Applyance never reads LinkedIn pages; on LinkedIn only the link is saved. */
export function isLinkedIn(url) {
  try {
    return /(^|\.)linkedin\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}
