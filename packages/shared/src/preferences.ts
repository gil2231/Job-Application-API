import { mentionsKeyword } from "./keywords";

/**
 * Job search preferences: one free-text box of comma-separated roles,
 * industries, keywords and places, e.g. "Account Executive, SaaS, FinTech, NYC".
 * The string drives recommended jobs; the user edits it whenever their
 * preferences change.
 */

/** What a new user starts with until they write their own. */
export const DEFAULT_SEARCH_PREFERENCES =
  "Marketing, Sales, Business Development, Sales Development Representative, Account Executive, Business Development Representative, Growth, Client Success, Customer Success, Product Marketing, Product Strategy, Solutions, Solutions Consultant, Strategy, Management Consulting, Consulting, Research, Markets, Sales & Trading, Wealth Management, Financial Services, Investment Banking, Commercial Real Estate, Investment Sales, Operations, Business Operations, Revenue Operations, Partnerships, Account Management, Relationship Management, Analyst, Rotational Program, Graduate Analyst, New Graduate, Entry Level, 2027 Full-Time, SaaS, Technology Sales, FinTech, AI, Web3, Crypto, Blockchain, Digital Marketing, E-commerce, Market Research, Competitive Intelligence, Go-to-Market, GTM, Revenue Growth, Client-Facing, NYC, New York City";

export const MAX_PREFERENCE_TERMS = 100;
export const MAX_PREFERENCES_LENGTH = 5_000;

/** Split the box into terms: commas, semicolons or new lines; repeats dropped. */
export function parsePreferences(text: string | null | undefined): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];
  for (const raw of (text ?? "").split(/[,;\n]+/)) {
    const term = raw.replace(/["\s]+/g, " ").trim().slice(0, 100);
    if (!term || seen.has(term.toLowerCase())) continue;
    seen.add(term.toLowerCase());
    terms.push(term);
    if (terms.length >= MAX_PREFERENCE_TERMS) break;
  }
  return terms;
}

/** Places that mean the same city. Keys and values are lowercase. */
const PLACE_ALIASES: Record<string, string[]> = {
  nyc: ["new york", "nyc", "manhattan", "brooklyn"],
  "new york city": ["new york", "nyc", "manhattan", "brooklyn"],
  "new york": ["new york", "nyc", "manhattan", "brooklyn"],
  sf: ["san francisco"],
  "bay area": ["san francisco", "oakland", "san jose", "palo alto", "mountain view", "menlo park"],
  la: ["los angeles"],
  dc: ["washington"],
  "washington dc": ["washington"],
};

const PLACES = new Set([
  ...Object.keys(PLACE_ALIASES),
  "remote", "hybrid", "on-site", "onsite", "united states", "usa", "us", "uk", "london", "canada", "toronto",
  "san francisco", "los angeles", "boston", "chicago", "austin", "seattle", "denver", "miami", "atlanta", "dallas", "houston",
  "philadelphia", "washington", "new jersey", "jersey city", "hoboken", "stamford", "charlotte", "nashville", "phoenix", "san diego",
  "salt lake city", "minneapolis", "detroit", "pittsburgh", "raleigh", "portland", "brooklyn", "manhattan",
]);

/** Whether a preference term names a place rather than a role or keyword. */
export function isPlaceTerm(term: string): boolean {
  return PLACES.has(term.trim().toLowerCase());
}

/** Whether a job's location is in the place a term names (NYC matches "New York, NY"). */
export function locationMatchesPlace(location: string | null | undefined, term: string): boolean {
  if (!location) return false;
  const key = term.trim().toLowerCase();
  if (key === "remote") return mentionsKeyword(location, "remote");
  const names = PLACE_ALIASES[key] ?? [key];
  return names.some((name) => mentionsKeyword(location, name));
}

/** Preference terms split into roles and keywords versus places. */
export function splitPreferences(terms: string[]): { keywords: string[]; places: string[] } {
  return { keywords: terms.filter((t) => !isPlaceTerm(t)), places: terms.filter(isPlaceTerm) };
}

/** The keyword query for a list of terms: each one quoted, so phrases stay together. */
export function termsToQuery(terms: string[]): string {
  return terms.map((t) => (/[\s-]/.test(t) ? `"${t.replace(/"/g, "")}"` : t)).join(" ");
}

export interface PreferenceFit {
  /** Higher fits better; 0 means nothing in the preferences matched. */
  score: number;
  /** Preference terms the job matched, title matches first. */
  matched: string[];
  /** Preferred places the job is in. */
  places: string[];
}

/** A preference in the title counts most; one only in the company or description counts a little. */
const TITLE_WEIGHT = 3;
const OTHER_WEIGHT = 1;
const PLACE_WEIGHT = 4;

/**
 * How well a job fits the preference terms, for ranking search results and
 * new openings: each term in the title, company or description, and whether
 * the job is in one of the preferred places.
 */
export function preferenceFit(
  job: { title?: string | null; company?: string | null; location?: string | null; description?: string | null; remote?: boolean },
  preferences: { keywords: string[]; places: string[] },
): PreferenceFit {
  const title = job.title ?? "";
  const other = `${job.company ?? ""}\n${job.description ?? ""}`;
  const inTitle = preferences.keywords.filter((t) => mentionsKeyword(title, t));
  const elsewhere = preferences.keywords.filter((t) => !inTitle.includes(t) && mentionsKeyword(other, t));
  const places = preferences.places.filter((p) => locationMatchesPlace(job.location, p) || (job.remote === true && p.trim().toLowerCase() === "remote"));
  return {
    score: inTitle.length * TITLE_WEIGHT + elsewhere.length * OTHER_WEIGHT + (places.length ? PLACE_WEIGHT : 0),
    matched: [...inTitle, ...elsewhere],
    places,
  };
}
