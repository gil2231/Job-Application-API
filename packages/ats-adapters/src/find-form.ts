import { parseHttpUrl, type Platform } from "@autoapply/shared";
import { detectPlatformFromUrl, HTML_MARKERS } from "./detect";

/**
 * Finding the application form behind the page a job links to. Employer
 * careers pages (Betterment's, reached from its Greenhouse link) show the ATS
 * form inside an iframe, and listing sites (Built In) link out to it with an
 * Apply button. Filling the page itself finds nothing, so the worker opens
 * the form directly instead.
 */

export interface PageSnapshot {
  url: string;
  html: string;
  /** Every child frame on the page, with its document when it could be read. */
  frames: Array<{ url: string; html: string }>;
  links: Array<{ text: string; href: string }>;
  /** Visible fields a person could fill on the page itself. */
  fieldCount: number;
}

export interface FormLocation {
  url: string;
  via: "iframe" | "greenhouse_job_id" | "link";
  platform: Platform;
}

/** URLs that open one job's application on an ATS Applyance fills, not a list of jobs. */
const APPLICATION_PATHS: Partial<Record<Platform, RegExp>> = {
  GREENHOUSE: /^\/embed\/job_app\b|^\/[^/]+\/jobs\/\d+/,
  LEVER: /^\/[^/]+\/[0-9a-f]{8}-[0-9a-f-]{27}/i,
  ASHBY: /^\/[^/]+\/[0-9a-f]{8}-[0-9a-f-]{27}/i,
  WORKDAY: /\/job\//,
  SMARTRECRUITERS: /^\/[^/]+\/\d{6,}/,
};

const APPLY_TEXT = /\bapply\b/i;
/** A page with this many fields of its own is the form, whatever else it links to. */
const OWN_FORM_FIELDS = 3;

/** Does this link open one job's application on a supported ATS? */
export function isAtsApplicationUrl(input: string): boolean {
  const url = parseHttpUrl(input);
  if (!url || url.protocol !== "https:") return false;
  const path = APPLICATION_PATHS[detectPlatformFromUrl(url.toString()).platform];
  return !!path && path.test(url.pathname);
}

/** Greenhouse's own copy of a job's form, which it serves for embedding and never forwards elsewhere. */
export const greenhouseEmbedUrl = (board: string, jobId: string) => `https://boards.greenhouse.io/embed/job_app?for=${encodeURIComponent(board)}&token=${jobId}`;

/**
 * A Greenhouse job link that forwarded to the employer's own careers page
 * (Betterment, Stripe): the embed link to the same job's form, or null.
 */
export function greenhouseEmbedForRedirect(requested: string, landed: string): string | null {
  const from = parseHttpUrl(requested);
  const to = parseHttpUrl(landed);
  if (!from || !to || !/^(boards|job-boards)\.greenhouse\.io$/i.test(from.hostname) || /(^|\.)greenhouse\.io$/i.test(to.hostname)) return null;
  const job = /^\/([a-z0-9_-]+)\/jobs\/(\d+)/i.exec(from.pathname);
  return job ? greenhouseEmbedUrl(job[1]!, job[2]!) : null;
}

const hasFormMarkup = (html: string) => Object.values(HTML_MARKERS).some((m) => m.form.test(html));

/** Greenhouse board name from its embed script, e.g. boards.greenhouse.io/embed/job_board/js?for=betterment. */
function greenhouseBoard(html: string): string | null {
  const match = /greenhouse\.io\/embed\/job_(?:board|app)(?:\/js)?\?(?:[^"'\s<>]*&(?:amp;)?)?for=([a-z0-9_-]+)/i.exec(html);
  return match ? match[1]! : null;
}

/**
 * Where the application form for this page really is, or null when the page
 * is the form itself or nothing better can be found.
 */
export function findApplicationForm(page: PageSnapshot): FormLocation | null {
  const here = parseHttpUrl(page.url);
  if (!here || page.fieldCount >= OWN_FORM_FIELDS || hasFormMarkup(page.html)) return null;
  const same = (u: string) => u.split("#")[0] === page.url.split("#")[0];

  // 1. The form in an iframe: an ATS application page, or any frame holding ATS form markup.
  for (const frame of page.frames) {
    if (!/^https?:\/\//i.test(frame.url) || same(frame.url)) continue;
    if (isAtsApplicationUrl(frame.url) || hasFormMarkup(frame.html)) {
      return { url: frame.url, via: "iframe", platform: detectPlatformFromUrl(frame.url).platform };
    }
  }

  // 2. Greenhouse's embed script hasn't drawn its iframe yet: build the embed link from the job id in the address.
  const jobId = here.searchParams.get("gh_jid");
  const board = jobId && /^\d+$/.test(jobId) ? greenhouseBoard(page.html) : null;
  if (board) {
    return { url: greenhouseEmbedUrl(board, jobId!), via: "greenhouse_job_id", platform: "GREENHOUSE" };
  }

  // 3. An Apply link out to the ATS (listing sites, careers pages). Only on pages that aren't an ATS themselves.
  if (detectPlatformFromUrl(page.url).platform !== "GENERIC") return null;
  const candidates = page.links.filter((l) => isAtsApplicationUrl(l.href));
  const apply = [...new Set(candidates.filter((l) => APPLY_TEXT.test(l.text)).map((l) => l.href))];
  const all = [...new Set(candidates.map((l) => l.href))];
  const href = apply.length === 1 ? apply[0] : apply.length === 0 && all.length === 1 ? all[0] : undefined;
  return href ? { url: href, via: "link", platform: detectPlatformFromUrl(href).platform } : null;
}
