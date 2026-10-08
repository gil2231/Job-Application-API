import { extractHandshakeJobId, extractLinkedInJobId, parseHttpUrl } from "@autoapply/shared";
import { parseJobPostingJsonLd } from "../postings";
import type { JobSourceAdapter, RawJob, SourceParseResult } from "../types";
import { companyFromUrl } from "./url-list";

/**
 * What the browser extension sends when the person clicks Save on a page. On
 * LinkedIn it sends only `url`; elsewhere it adds what the page shows.
 */
export interface CapturedPage {
  url: string;
  /** document.title or og:title. */
  title?: string | null;
  /** og:site_name, often the employer. */
  siteName?: string | null;
  /** The page's main heading, usually the job title. */
  heading?: string | null;
  /** Text the person selected before saving: taken as the description when long enough. */
  selection?: string | null;
  /** Visible text of the page's main content. */
  text?: string | null;
  /** The page's schema.org JobPosting blocks (application/ld+json), unparsed. */
  jsonLd?: string[] | null;
}

/** Shorter than this, page text is probably not a job description. */
const MIN_DESCRIPTION_CHARS = 200;

export const isLinkedInUrl = (url: string) => {
  const parsed = parseHttpUrl(url);
  return !!parsed && /(^|\.)linkedin\.com$/i.test(parsed.hostname);
};

const clip = (s: string | null | undefined, max: number) => {
  const t = s?.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, max) : null;
};

/** "Senior AE - Acme Careers" → "Senior AE" when the heading is missing. */
function titleFromDocumentTitle(title: string, company: string | null): string {
  const parts = title.split(/\s+[|·–—-]\s+/);
  if (parts.length > 1 && company && parts.slice(1).some((p) => p.toLowerCase().includes(company.toLowerCase()))) return parts[0]!;
  return parts.length > 1 && parts[0]!.length >= 3 ? parts[0]! : title;
}

/**
 * The job page the person is looking at, saved from the browser extension.
 *
 * LinkedIn and Handshake pages are never read: only the job link is kept,
 * exactly as if it were pasted, even if the extension sent more. Everywhere else the page's own
 * JobPosting data is used first, then the public posting data a pasted link
 * would get, then what the page shows (its heading and the selected or main
 * text).
 */
export const browserPageSource: JobSourceAdapter<CapturedPage> = {
  id: "extension",
  type: "BROWSER_EXTENSION",
  name: "Browser extension",
  async parse(input, context): Promise<SourceParseResult> {
    const result = (jobs: RawJob[], issues: SourceParseResult["issues"] = []): SourceParseResult => ({ sourceType: "BROWSER_EXTENSION", sourceName: "Browser extension", jobs, issues });
    const url = parseHttpUrl(input.url)?.toString();
    if (!url) return result([], [{ url: input.url, kind: "invalid", message: "This page doesn't have a web address Applyance can save." }]);

    if (isLinkedInUrl(url)) {
      const id = extractLinkedInJobId(url);
      if (!id) return result([], [{ url, kind: "invalid", message: "Open the LinkedIn job's own page (its link has /jobs/view/), then save it." }]);
      return result([{ url, externalId: id, title: `LinkedIn job ${id}`, company: "Unknown company", needsDetails: true }]);
    }

    // Handshake is treated like LinkedIn: its pages are behind a school sign-in and aren't read.
    if (/(^|\.)joinhandshake\.com$/i.test(new URL(url).hostname)) {
      const id = extractHandshakeJobId(url);
      if (!id) return result([], [{ url, kind: "invalid", message: "Open the Handshake job's own page, then save it." }]);
      return result([{ url, externalId: id, title: `Handshake job ${id}`, company: "Unknown company", needsDetails: true }]);
    }

    const ld = (input.jsonLd ?? []).slice(0, 5).map((block) => `<script type="application/ld+json">${block.slice(0, 200_000)}</script>`).join("");
    const fromPage = ld ? parseJobPostingJsonLd(ld, url) : null;
    if (fromPage?.title) {
      const company = fromPage.company ?? clip(input.siteName, 200) ?? companyFromUrl(url);
      return result([{ ...fromPage, url, company }]);
    }

    const issues: SourceParseResult["issues"] = [];
    if (context.fetchPosting) {
      try {
        const posting = await context.fetchPosting(url);
        if (posting?.title && posting.company) return result([{ ...posting, url }]);
      } catch {
        // The page itself is still worth saving; its text is used below.
      }
    }

    const company = clip(input.siteName, 200) ?? companyFromUrl(url);
    const heading = clip(input.heading, 200);
    const title = heading ?? (input.title ? titleFromDocumentTitle(clip(input.title, 300)!, company) : null) ?? "Untitled job";
    const selection = input.selection?.trim() ?? "";
    const description = (selection.length >= MIN_DESCRIPTION_CHARS ? selection : input.text?.trim() ?? "").slice(0, 50_000);
    const needsDetails = description.length < MIN_DESCRIPTION_CHARS;
    if (needsDetails) issues.push({ url, kind: "fetch_failed", message: "Couldn't find the job description on this page. Paste it on the job's page in Applyance." });
    return result([{ url, title, company, description: needsDetails ? null : description, needsDetails }], issues);
  },
};
