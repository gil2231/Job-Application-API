import type { EducationLevel } from "@autoapply/shared";

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Whole-phrase, case-insensitive containment ("commission only" matches "Commission-only"). */
export function containsPhrase(text: string, phrase: string): boolean {
  const words = phrase
    .trim()
    .split(/[\s-]+/)
    .filter(Boolean)
    .map(escapeRegExp);
  if (!words.length) return false;
  return new RegExp(`(?<![A-Za-z0-9])${words.join("[\\s-]+")}(?![A-Za-z0-9])`, "i").test(text);
}

// ── Companies ───────────────────────────────────────────────────────────────

const COMPANY_SUFFIXES = /\b(inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|gmbh|sa|ag|bv|pty|holdings|group|technologies|technology|labs)\b\.?/g;

export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,]/g, " ")
    .replace(COMPANY_SUFFIXES, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function companyMatches(company: string, excluded: string): boolean {
  const a = normalizeCompany(company);
  const b = normalizeCompany(excluded);
  return a.length > 0 && b.length > 0 && a === b;
}

// ── Locations ───────────────────────────────────────────────────────────────

const STATES: Record<string, string> = {
  alabama: "al", alaska: "ak", arizona: "az", arkansas: "ar", california: "ca", colorado: "co", connecticut: "ct", delaware: "de",
  florida: "fl", georgia: "ga", hawaii: "hi", idaho: "id", illinois: "il", indiana: "in", iowa: "ia", kansas: "ks", kentucky: "ky",
  louisiana: "la", maine: "me", maryland: "md", massachusetts: "ma", michigan: "mi", minnesota: "mn", mississippi: "ms", missouri: "mo",
  montana: "mt", nebraska: "ne", nevada: "nv", "new hampshire": "nh", "new jersey": "nj", "new mexico": "nm", "new york": "ny",
  "north carolina": "nc", "north dakota": "nd", ohio: "oh", oklahoma: "ok", oregon: "or", pennsylvania: "pa", "rhode island": "ri",
  "south carolina": "sc", "south dakota": "sd", tennessee: "tn", texas: "tx", utah: "ut", vermont: "vt", virginia: "va", washington: "wa",
  "west virginia": "wv", wisconsin: "wi", wyoming: "wy", "district of columbia": "dc",
};

const CITY_ALIASES: Record<string, string> = {
  nyc: "new york",
  "new york city": "new york",
  manhattan: "new york",
  brooklyn: "new york",
  sf: "san francisco",
  "sf bay area": "san francisco",
  "bay area": "san francisco",
  "san francisco bay area": "san francisco",
  la: "los angeles",
  dc: "washington",
  "washington dc": "washington",
  "washington d c": "washington",
  philly: "philadelphia",
  atx: "austin",
  chi: "chicago",
};

/** Lowercased place phrases a location string refers to: city, state name and state code. */
function placeTokens(location: string): Set<string> {
  const out = new Set<string>();
  const cleaned = location.toLowerCase().replace(/\(.*?\)/g, " ").replace(/[.]/g, "");
  for (const rawPart of cleaned.split(/[,/|;]| - | or /)) {
    const part = rawPart.replace(/\b(metropolitan area|metro area|area|greater|hq|office)\b/g, "").replace(/\s+/g, " ").trim();
    if (!part) continue;
    const alias = CITY_ALIASES[part];
    out.add(alias ?? part);
    if (alias) continue;
    if (STATES[part]) out.add(STATES[part]);
    const stateName = Object.entries(STATES).find(([, code]) => code === part)?.[0];
    if (stateName) out.add(stateName);
  }
  return out;
}

/** True when a job location refers to the preferred place ("New York, NY" ~ "NYC", "Austin, TX" ~ "Texas"). */
export function locationMatches(jobLocation: string, preferred: string): boolean {
  const pref = preferred.trim().toLowerCase();
  if (!pref || pref === "remote" || pref === "anywhere") return false;
  const jobTokens = placeTokens(jobLocation);
  for (const token of placeTokens(preferred)) {
    if (jobTokens.has(token)) return true;
    if (token.length > 3 && containsPhrase(jobLocation, token)) return true;
  }
  return false;
}

export function isRemotePreference(value: string): boolean {
  return /^(remote|anywhere|work from home|wfh)$/i.test(value.trim());
}

// ── Titles ──────────────────────────────────────────────────────────────────

const TITLE_ABBREVIATIONS: Array<[RegExp, string]> = [
  [/\bsr\b\.?/g, "senior"],
  [/\bjr\b\.?/g, "junior"],
  [/\bmgr\b\.?/g, "manager"],
  [/\bengr?\b\.?/g, "engineer"],
  [/\bswe\b/g, "software engineer"],
  [/\bsde\b/g, "software engineer"],
  [/\bdev\b/g, "developer"],
  [/\b(bdr|sdr|business development representative|business development rep|sales development rep)\b/g, "sales development representative"],
  [/\bae\b/g, "account executive"],
  [/\bcsm\b/g, "customer success manager"],
  [/\bpm\b/g, "product manager"],
  [/\bvp\b/g, "vice president"],
  [/\bux\b/g, "user experience"],
  [/\bui\b/g, "user interface"],
  [/\bml\b/g, "machine learning"],
  [/\bqa\b/g, "quality assurance"],
  [/\bhr\b/g, "human resources"],
  [/\brep\b/g, "representative"],
  [/\bfront[- ]end\b/g, "frontend"],
  [/\bback[- ]end\b/g, "backend"],
  [/\bfull[- ]stack\b/g, "fullstack"],
];

/** Words that describe level or employment terms, not the job itself. */
const TITLE_NOISE = new Set([
  "senior", "junior", "lead", "staff", "principal", "associate", "entry", "level", "intern", "i", "ii", "iii", "iv", "v",
  "remote", "hybrid", "onsite", "contract", "temporary", "full", "time", "part", "the", "of", "and", "a", "an", "for", "to", "in", "with",
  "us", "usa", "new", "grad", "graduate",
]);

export function titleTokens(title: string): string[] {
  let t = title.toLowerCase().replace(/\(.*?\)/g, " ").replace(/&/g, " and ");
  for (const [pattern, replacement] of TITLE_ABBREVIATIONS) t = t.replace(pattern, replacement);
  // Drop location/team suffixes like "Account Executive - NYC" or "Engineer, Payments".
  t = t.split(/\s[-–—|]\s|,/)[0] ?? t;
  return t
    .replace(/[^a-z0-9+#]+/g, " ")
    .split(" ")
    .filter((w) => w && !TITLE_NOISE.has(w));
}

/** 0..1 similarity between two job titles, ignoring seniority words and abbreviations. */
export function titleSimilarity(a: string, b: string): number {
  const ta = titleTokens(a);
  const tb = titleTokens(b);
  if (!ta.length || !tb.length) return 0;
  const joinedA = ta.join(" ");
  const joinedB = tb.join(" ");
  if (joinedA === joinedB) return 1;
  // "Account Executive" vs "Enterprise Account Executive": one title contained in the other.
  if (` ${joinedA} `.includes(` ${joinedB} `) || ` ${joinedB} `.includes(` ${joinedA} `)) return 0.85;
  const setA = new Set(ta);
  const setB = new Set(tb);
  const intersection = [...setA].filter((w) => setB.has(w)).length;
  const union = new Set([...setA, ...setB]).size;
  return intersection / union;
}

// ── Education ───────────────────────────────────────────────────────────────

export const EDUCATION_ORDER: EducationLevel[] = ["NONE", "HIGH_SCHOOL", "ASSOCIATE", "BACHELOR", "MASTER", "DOCTORATE"];

/** Degree level from free text like "B.S.", "Bachelor of Arts", "MBA". Null when it can't tell. */
export function degreeLevel(degree: string | null | undefined): EducationLevel | null {
  if (!degree) return null;
  const d = degree.toLowerCase();
  if (/\b(ph\.?\s?d|doctor|doctorate|d\.?phil|ed\.?d|j\.?d|m\.?d)\b/.test(d)) return "DOCTORATE";
  if (/\b(master|mba|m\.?s|m\.?a|m\.?eng|mfa|mph|msc|m\.?sc)\b/.test(d)) return "MASTER";
  if (/\b(bachelor|b\.?s|b\.?a|b\.?sc|b\.?eng|bba|bfa|undergraduate)\b/.test(d)) return "BACHELOR";
  if (/\b(associate|a\.?a|a\.?s)\b/.test(d)) return "ASSOCIATE";
  if (/\b(high school|ged|diploma)\b/.test(d)) return "HIGH_SCHOOL";
  return null;
}

export function industryMatches(a: string, b: string): boolean {
  const x = a.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const y = b.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!x || !y) return false;
  return x === y || containsPhrase(x, y) || containsPhrase(y, x);
}
