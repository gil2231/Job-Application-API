import { extractLinkedInJobId, parseHttpUrl, type WorkArrangement } from "@autoapply/shared";
import type { RawJob } from "../types";
import { safeFetch, type HttpFetcher } from "./safe-fetch";

/**
 * Readers for public job postings. Each reads the posting data an ATS
 * publishes for anyone to see (the same data its public job board renders).
 * LinkedIn is deliberately absent: its postings are never fetched.
 */
interface PostingReader {
  name: string;
  matches(url: URL): boolean;
  read(url: URL, http: HttpFetcher): Promise<RawJob | null>;
}

const titleize = (slug: string) =>
  slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

async function getJson<T>(http: HttpFetcher, url: string): Promise<T> {
  const response = await http(url, { accept: "application/json" });
  try {
    return JSON.parse(response.text) as T;
  } catch {
    throw new Error("The posting data wasn't valid JSON");
  }
}

const formatRange = (min: number | null | undefined, max: number | null | undefined, currency: string | null | undefined, period: string) => {
  if (min == null && max == null) return null;
  const fmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const cur = currency ?? "USD";
  const range = min != null && max != null && min !== max ? `${fmt(min)} - ${fmt(max)}` : fmt((min ?? max)!);
  return `${cur} ${range} ${period}`;
};

// ── Greenhouse ──────────────────────────────────────────────────────────────

interface GreenhouseJob {
  title: string;
  company_name?: string;
  location?: { name?: string };
  content?: string;
  absolute_url?: string;
  first_published?: string;
  updated_at?: string;
  pay_input_ranges?: Array<{ min_cents: number; max_cents: number; currency_type: string }>;
}

const greenhouse: PostingReader = {
  name: "Greenhouse",
  matches: (url) => /(^|\.)greenhouse\.io$/i.test(url.hostname),
  async read(url, http) {
    let board: string | undefined;
    let id: string | undefined;
    const path = /^\/([^/]+)\/jobs\/(\d+)/.exec(url.pathname);
    if (path) [, board, id] = path;
    else if (url.pathname.startsWith("/embed/job_app")) {
      board = url.searchParams.get("for") ?? undefined;
      id = url.searchParams.get("token") ?? undefined;
    }
    if (!board || !id || !/^\d+$/.test(id)) return null;
    const job = await getJson<GreenhouseJob>(http, `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs/${id}?pay_transparency=true`);
    const pay = job.pay_input_ranges?.[0];
    return {
      url: url.toString(),
      externalId: id,
      title: job.title,
      company: job.company_name || titleize(board),
      location: job.location?.name ?? null,
      description: job.content ?? null,
      applicationUrl: job.absolute_url ?? url.toString(),
      postedAt: job.first_published ? new Date(job.first_published) : null,
      salaryText: pay ? formatRange(pay.min_cents / 100, pay.max_cents / 100, pay.currency_type, "per year") : null,
    };
  },
};

// ── Lever ───────────────────────────────────────────────────────────────────

interface LeverJob {
  text: string;
  categories?: { location?: string; commitment?: string; team?: string };
  description?: string;
  descriptionPlain?: string;
  lists?: Array<{ text: string; content: string }>;
  additional?: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  workplaceType?: string;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
}

const lever: PostingReader = {
  name: "Lever",
  matches: (url) => /^jobs\.(eu\.)?lever\.co$/i.test(url.hostname),
  async read(url, http) {
    const m = /^\/([^/]+)\/([0-9a-f-]{36})/i.exec(url.pathname);
    if (!m) return null;
    const [, site, id] = m;
    const api = url.hostname.startsWith("jobs.eu.") ? "api.eu.lever.co" : "api.lever.co";
    const job = await getJson<LeverJob>(http, `https://${api}/v0/postings/${encodeURIComponent(site!)}/${id}`);
    const lists = (job.lists ?? []).map((l) => `<h3>${l.text}</h3><ul>${l.content}</ul>`).join("");
    const arrangement: Record<string, WorkArrangement> = { remote: "REMOTE", hybrid: "HYBRID", "on-site": "ONSITE", onsite: "ONSITE" };
    const interval = job.salaryRange?.interval?.replace(/-/g, " ").replace(/ salary$/, "") ?? "per year";
    return {
      url: url.toString(),
      externalId: id,
      title: job.text,
      company: titleize(site!),
      location: job.categories?.location ?? null,
      description: [job.description ?? job.descriptionPlain ?? "", lists, job.additional ?? ""].join("\n"),
      applicationUrl: job.applyUrl ?? job.hostedUrl ?? url.toString(),
      postedAt: job.createdAt ? new Date(job.createdAt) : null,
      workArrangement: (job.workplaceType && arrangement[job.workplaceType.toLowerCase()]) || null,
      salaryText: job.salaryRange ? formatRange(job.salaryRange.min, job.salaryRange.max, job.salaryRange.currency, interval) : null,
    };
  },
};

// ── Ashby ───────────────────────────────────────────────────────────────────

interface AshbyBoard {
  jobs?: Array<{
    id: string;
    title: string;
    location?: string;
    descriptionHtml?: string;
    descriptionPlain?: string;
    publishedAt?: string;
    isRemote?: boolean;
    workplaceType?: string;
    jobUrl?: string;
    applyUrl?: string;
    compensation?: { compensationTierSummary?: string; scrapeableCompensationSalarySummary?: string };
  }>;
}

const ashby: PostingReader = {
  name: "Ashby",
  matches: (url) => /^jobs\.ashbyhq\.com$/i.test(url.hostname),
  async read(url, http) {
    const m = /^\/([^/]+)\/([0-9a-f-]{36})/i.exec(url.pathname);
    if (!m) return null;
    const [, org, id] = m;
    const board = await getJson<AshbyBoard>(http, `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(org!)}?includeCompensation=true`);
    const job = board.jobs?.find((j) => j.id === id);
    if (!job) throw new Error("The posting was not found (it may have closed)");
    const workplace = job.workplaceType?.toUpperCase();
    return {
      url: url.toString(),
      externalId: id,
      title: job.title,
      company: titleize(decodeURIComponent(org!)),
      location: job.location ?? null,
      description: job.descriptionHtml ?? job.descriptionPlain ?? null,
      applicationUrl: job.applyUrl ?? job.jobUrl ?? url.toString(),
      postedAt: job.publishedAt ? new Date(job.publishedAt) : null,
      workArrangement: job.isRemote || workplace === "REMOTE" ? "REMOTE" : workplace === "HYBRID" ? "HYBRID" : workplace === "ONSITE" ? "ONSITE" : null,
      salaryText: job.compensation?.scrapeableCompensationSalarySummary ?? job.compensation?.compensationTierSummary ?? null,
    };
  },
};

// ── SmartRecruiters ─────────────────────────────────────────────────────────

interface SmartRecruitersJob {
  name: string;
  company?: { name?: string };
  location?: { city?: string; region?: string; country?: string; remote?: boolean; hybrid?: boolean; fullLocation?: string };
  releasedDate?: string;
  typeOfEmployment?: { label?: string };
  jobAd?: { sections?: Record<string, { title?: string; text?: string }> };
  applyUrl?: string;
}

const smartRecruiters: PostingReader = {
  name: "SmartRecruiters",
  matches: (url) => /^(jobs|careers)\.smartrecruiters\.com$/i.test(url.hostname),
  async read(url, http) {
    const m = /^\/([^/]+)\/(\d+)/.exec(url.pathname);
    if (!m) return null;
    const [, company, id] = m;
    const job = await getJson<SmartRecruitersJob>(http, `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company!)}/postings/${id}`);
    const sections = Object.values(job.jobAd?.sections ?? {})
      .map((s) => `${s.title ? `<h3>${s.title}</h3>` : ""}${s.text ?? ""}`)
      .join("\n");
    const loc = job.location;
    return {
      url: url.toString(),
      externalId: id,
      title: job.name,
      company: job.company?.name ?? titleize(company!),
      location: loc?.fullLocation ?? ([loc?.city, loc?.region].filter(Boolean).join(", ") || null),
      description: [job.typeOfEmployment?.label ? `<p>${job.typeOfEmployment.label}</p>` : "", sections].join("\n"),
      applicationUrl: job.applyUrl ?? url.toString(),
      postedAt: job.releasedDate ? new Date(job.releasedDate) : null,
      workArrangement: loc?.remote ? "REMOTE" : loc?.hybrid ? "HYBRID" : null,
    };
  },
};

// ── Workday ─────────────────────────────────────────────────────────────────

interface WorkdayJob {
  jobPostingInfo?: {
    title?: string;
    jobDescription?: string;
    location?: string;
    startDate?: string;
    timeType?: string;
    externalUrl?: string;
    remoteType?: string;
    jobReqId?: string;
  };
  hiringOrganization?: { name?: string };
}

const workday: PostingReader = {
  name: "Workday",
  matches: (url) => /\.myworkdayjobs\.com$/i.test(url.hostname),
  async read(url, http) {
    // https://acme.wd5.myworkdayjobs.com/en-US/External/job/New-York-NY/Account-Executive_R123
    const tenant = url.hostname.split(".")[0]!;
    const m = /^\/(?:[a-z]{2}-[A-Z]{2}\/)?([^/]+)\/job\/(.+)$/.exec(url.pathname);
    if (!m) return null;
    const [, site, rest] = m;
    const data = await getJson<WorkdayJob>(http, `https://${url.hostname}/wday/cxs/${tenant}/${site}/job/${rest}`);
    const info = data.jobPostingInfo;
    if (!info?.title) return null;
    const remote = info.remoteType?.toLowerCase() ?? "";
    return {
      url: url.toString(),
      externalId: info.jobReqId ?? null,
      title: info.title,
      company: data.hiringOrganization?.name ?? titleize(tenant),
      location: info.location ?? null,
      description: [info.timeType ? `<p>${info.timeType}</p>` : "", info.jobDescription ?? ""].join("\n"),
      applicationUrl: info.externalUrl ?? url.toString(),
      postedAt: info.startDate ? new Date(info.startDate) : null,
      workArrangement: remote.includes("hybrid") ? "HYBRID" : remote.includes("remote") ? "REMOTE" : remote.includes("site") ? "ONSITE" : null,
    };
  },
};

// ── schema.org JobPosting (any careers site) ────────────────────────────────

type JsonLd = Record<string, unknown>;

function findJobPosting(node: unknown): JsonLd | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }
  const obj = node as JsonLd;
  const type = obj["@type"];
  if (type === "JobPosting" || (Array.isArray(type) && type.includes("JobPosting"))) return obj;
  return findJobPosting(obj["@graph"]);
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function jsonLdLocation(value: unknown): string | null {
  const first = Array.isArray(value) ? value[0] : value;
  if (!first || typeof first !== "object") return null;
  const address = (first as JsonLd).address;
  if (typeof address === "string") return address;
  if (!address || typeof address !== "object") return null;
  const a = address as JsonLd;
  const country = a.addressCountry && typeof a.addressCountry === "object" ? str((a.addressCountry as JsonLd).name) : str(a.addressCountry);
  return [str(a.addressLocality), str(a.addressRegion), country].filter(Boolean).join(", ") || null;
}

function jsonLdSalary(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const salary = value as JsonLd;
  const v = salary.value as JsonLd | number | undefined;
  const currency = str(salary.currency) ?? "USD";
  if (typeof v === "number") return formatRange(v, v, currency, "per year");
  if (!v || typeof v !== "object") return null;
  const unit = (str(v.unitText) ?? "YEAR").toLowerCase();
  const period = unit.startsWith("hour") ? "per hour" : unit.startsWith("month") ? "per month" : unit.startsWith("week") ? "per week" : unit.startsWith("day") ? "per day" : "per year";
  const min = typeof v.minValue === "number" ? v.minValue : typeof v.value === "number" ? v.value : null;
  const max = typeof v.maxValue === "number" ? v.maxValue : min;
  return formatRange(min, max, currency, period);
}

export function parseJobPostingJsonLd(html: string, pageUrl: string): RawJob | null {
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown;
    try {
      data = JSON.parse(m[1]!.trim());
    } catch {
      continue;
    }
    const job = findJobPosting(data);
    if (!job) continue;
    const org = job.hiringOrganization;
    const company = typeof org === "string" ? org : org && typeof org === "object" ? str((org as JsonLd).name) : null;
    const title = str(job.title);
    if (!title) continue;
    const employment = Array.isArray(job.employmentType) ? job.employmentType.join(", ") : str(job.employmentType);
    const description = [employment ? `<p>Employment type: ${employment}</p>` : "", str(job.description) ?? ""].join("\n");
    return {
      url: pageUrl,
      title,
      company,
      location: jsonLdLocation(job.jobLocation),
      description,
      applicationUrl: str(job.url) ?? pageUrl,
      postedAt: str(job.datePosted) ? new Date(str(job.datePosted)!) : null,
      workArrangement: str(job.jobLocationType)?.toUpperCase() === "TELECOMMUTE" ? "REMOTE" : null,
      salaryText: jsonLdSalary(job.baseSalary),
      externalId: job.identifier && typeof job.identifier === "object" ? str((job.identifier as JsonLd).value) : null,
    };
  }
  return null;
}

const jsonLd: PostingReader = {
  name: "Careers page",
  matches: () => true,
  async read(url, http) {
    const response = await http(url.toString(), { accept: "text/html,application/xhtml+xml" });
    if (!/html/i.test(response.contentType)) return null;
    return parseJobPostingJsonLd(response.text, response.url);
  },
};

const READERS: PostingReader[] = [greenhouse, lever, ashby, smartRecruiters, workday, jsonLd];

/**
 * Read a public posting's details. Returns null when the page has no
 * machine-readable posting data. Never fetches LinkedIn.
 */
export async function fetchPosting(input: string, http: HttpFetcher = safeFetch): Promise<RawJob | null> {
  const url = parseHttpUrl(input);
  if (!url || extractLinkedInJobId(input) || /(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
  const reader = READERS.find((r) => r.matches(url))!;
  const job = await reader.read(url, http);
  if (!job) return null;
  return {
    ...job,
    url: input,
    title: job.title?.slice(0, 200) ?? null,
    company: job.company?.slice(0, 200) ?? null,
    location: job.location?.slice(0, 200) ?? null,
    description: job.description?.slice(0, 100_000) ?? null,
    postedAt: job.postedAt && !Number.isNaN(job.postedAt.getTime()) ? job.postedAt : null,
  };
}

export { safeFetch, UnsafeUrlError, isPublicAddress, assertFetchableUrl } from "./safe-fetch";
export type { HttpFetcher, FetchedResponse } from "./safe-fetch";
