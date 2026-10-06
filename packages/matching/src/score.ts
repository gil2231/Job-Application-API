import {
  canonicalSkillKey,
  computeYearsOfExperience,
  formatSalaryRange,
  MATCH_DIMENSIONS,
  SENIORITY_LABELS,
  EDUCATION_LEVEL_LABELS,
  type EducationLevel,
  type JobAnalysis,
  type MatchBreakdownItem,
  type MatchDimension,
  type MatchResult,
  type MatchWeights,
  type SeniorityLevel,
  type WorkArrangement,
} from "@autoapply/shared";
import { degreeLevel, EDUCATION_ORDER, industryMatches, isRemotePreference, locationMatches, titleSimilarity } from "./normalize";

/** The parts of a Master Profile that matching reads. */
export interface MatchProfile {
  currentTitle: string | null;
  targetTitles: string[];
  industries: string[];
  yearsExperience: number | null;
  city: string | null;
  state: string | null;
  /** Every skill in the profile: skills, software, technical, languages. */
  skills: string[];
  education: Array<{ degree: string | null; major: string | null }>;
  employment: Array<{ title: string; startDate: Date | string; endDate: Date | string | null; isCurrent: boolean; skills: string[] }>;
}

/** The parts of the user's rules that affect scoring (not just qualification). */
export interface MatchPreferences {
  preferredLocations: string[];
  workArrangements: WorkArrangement[];
  minSalary: number | null;
}

export interface MatchInput {
  title: string;
  location: string | null;
  analysis: JobAnalysis;
}

type Dimension = Omit<MatchBreakdownItem, "dimension" | "weight">;

const NEUTRAL = 0.5;
const unknown = (reason: string): Dimension => ({ score: NEUTRAL, known: false, reason });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const listPreview = (items: string[], max = 8) => (items.length > max ? `${items.slice(0, max).join(", ")} and ${items.length - max} more` : items.join(", "));

/** Years a seniority level usually expects, used when the posting gives no number. */
const SENIORITY_YEARS: Record<SeniorityLevel, number> = { INTERN: 0, ENTRY: 0, MID: 2, SENIOR: 5, LEAD: 7, MANAGER: 5, DIRECTOR: 8, EXECUTIVE: 10 };

export function profileYears(profile: MatchProfile, now: Date = new Date()): number | null {
  if (profile.yearsExperience != null) return profile.yearsExperience;
  if (profile.employment.length) return computeYearsOfExperience(profile.employment, now);
  return null;
}

function scoreSkills(job: MatchInput, profile: MatchProfile): Dimension {
  const jobSkills = job.analysis.skills;
  if (!jobSkills.length) return unknown(job.analysis.hasDescription ? "The posting doesn't name specific skills." : "Add the job description to compare skills.");
  const owned = new Set([...profile.skills, ...profile.employment.flatMap((e) => e.skills)].map(canonicalSkillKey));
  if (!owned.size) return { score: 0, known: true, reason: "Your Master Profile has no skills yet, so none could be matched.", details: [`Asks for: ${listPreview(jobSkills)}`] };
  const matched = jobSkills.filter((s) => owned.has(canonicalSkillKey(s)));
  const missing = jobSkills.filter((s) => !owned.has(canonicalSkillKey(s)));
  // Postings list many nice-to-have tools; matching 8 of them counts as a full match.
  const score = Math.min(1, matched.length / Math.min(jobSkills.length, 8));
  const details = [matched.length ? `You have: ${listPreview(matched)}` : null, missing.length ? `Not in your profile: ${listPreview(missing)}` : null].filter(
    (d): d is string => d !== null,
  );
  return { score, known: true, reason: `You have ${matched.length} of the ${plural(jobSkills.length, "skill")} it mentions.`, details };
}

function scoreExperience(job: MatchInput, profile: MatchProfile, now: Date): Dimension {
  const years = profileYears(profile, now);
  const stated = job.analysis.experienceYearsMin;
  const seniority = job.analysis.seniority;
  const required = stated ?? (seniority ? SENIORITY_YEARS[seniority] : null);
  if (required == null) return unknown("The posting doesn't state an experience requirement.");
  const source = stated != null ? `${plural(stated, "year")} required` : `${SENIORITY_LABELS[seniority!]} role (about ${plural(required, "year")} expected)`;
  if (years == null) return unknown(`${source}. Add your employment history or years of experience to compare.`);
  const yours = `you have ${Math.round(years * 10) / 10}`;
  if (years >= required) {
    if (required <= 1 && years >= 8) return { score: 0.7, known: true, reason: `${source}; ${yours}, so this may be junior for you.` };
    return { score: 1, known: true, reason: `${source}; ${yours}.` };
  }
  return { score: Math.max(0, years / required), known: true, reason: `${source}; ${yours}.` };
}

function highestDegree(profile: MatchProfile): EducationLevel | null {
  let best: EducationLevel | null = null;
  for (const e of profile.education) {
    const level = degreeLevel(e.degree);
    if (level && (!best || EDUCATION_ORDER.indexOf(level) > EDUCATION_ORDER.indexOf(best))) best = level;
  }
  return best;
}

function scoreEducation(job: MatchInput, profile: MatchProfile): Dimension {
  const req = job.analysis.education;
  if (!req) {
    return job.analysis.hasDescription ? { score: 1, known: true, reason: "No degree requirement is listed." } : unknown("Add the job description to check education requirements.");
  }
  if (req.level === "NONE") return { score: 1, known: true, reason: "The posting says no degree is required." };
  const needed = EDUCATION_LEVEL_LABELS[req.level];
  const yours = highestDegree(profile);
  if (!yours) {
    if (!profile.education.length) {
      return req.equivalentExperienceAccepted
        ? { score: 0.6, known: true, reason: `Asks for a ${needed.toLowerCase()} or equivalent experience; your profile lists no degree.` }
        : { score: 0, known: true, reason: `Asks for a ${needed.toLowerCase()}; your profile lists no degree.` };
    }
    return unknown(`Asks for a ${needed.toLowerCase()}; add the degree name to your education so it can be compared.`);
  }
  const gap = EDUCATION_ORDER.indexOf(req.level) - EDUCATION_ORDER.indexOf(yours);
  const yoursLabel = EDUCATION_LEVEL_LABELS[yours].toLowerCase();
  if (gap <= 0) return { score: 1, known: true, reason: `Asks for a ${needed.toLowerCase()}; you have a ${yoursLabel}.` };
  if (req.equivalentExperienceAccepted) return { score: 0.7, known: true, reason: `Asks for a ${needed.toLowerCase()} or equivalent experience; you have a ${yoursLabel}.` };
  return { score: gap === 1 ? 0.3 : 0, known: true, reason: `Asks for a ${needed.toLowerCase()}; you have a ${yoursLabel}.` };
}

function scoreLocation(job: MatchInput, profile: MatchProfile, prefs: MatchPreferences): Dimension {
  const arrangement = job.analysis.workArrangement;
  const location = job.location ?? job.analysis.location;
  const acceptsArrangement = (a: WorkArrangement) => !prefs.workArrangements.length || prefs.workArrangements.includes(a);
  const wantsRemote = prefs.workArrangements.includes("REMOTE") || prefs.preferredLocations.some(isRemotePreference);

  if (arrangement === "REMOTE") {
    if (acceptsArrangement("REMOTE") || wantsRemote) return { score: 1, known: true, reason: "Remote, which fits your preferences." };
    return { score: 0.4, known: true, reason: "Remote, but your rules don't include remote work." };
  }
  if (!location) {
    return arrangement === "UNKNOWN" ? unknown("The posting doesn't give a location.") : unknown(`${arrangement === "HYBRID" ? "Hybrid" : "On-site"}, but no location is listed.`);
  }
  const cities = prefs.preferredLocations.filter((l) => !isRemotePreference(l));
  const preferred = cities.find((p) => locationMatches(location, p));
  const home = [profile.city, profile.state].filter((x): x is string => !!x).find((p) => locationMatches(location, p));
  const where = arrangement === "UNKNOWN" ? location : `${arrangement === "HYBRID" ? "Hybrid" : "On-site"} in ${location}`;
  if (arrangement !== "UNKNOWN" && !acceptsArrangement(arrangement)) {
    return { score: preferred || home ? 0.3 : 0, known: true, reason: `${where}, but your rules exclude ${arrangement === "HYBRID" ? "hybrid" : "on-site"} roles.` };
  }
  if (preferred) return { score: 1, known: true, reason: `${where}, one of your preferred locations (${preferred}).` };
  if (home) return { score: 0.9, known: true, reason: `${where}, near you (${home}).` };
  if (!cities.length && !profile.city && !profile.state) return unknown(`${where}. Add preferred locations on the Rules page to score this.`);
  return { score: 0, known: true, reason: `${where}, which isn't one of your preferred locations.` };
}

function scoreIndustry(job: MatchInput, profile: MatchProfile): Dimension {
  const industry = job.analysis.industry;
  if (!industry) return unknown("The industry isn't clear from the posting.");
  if (!profile.industries.length) return unknown(`${industry}. Add industries to your Master Profile to score this.`);
  const match = profile.industries.find((i) => industryMatches(industry, i));
  return match
    ? { score: 1, known: true, reason: `${industry}, which matches your industry experience (${match}).` }
    : { score: 0.3, known: true, reason: `${industry}; your profile lists ${listPreview(profile.industries, 4)}.` };
}

function scoreRole(job: MatchInput, profile: MatchProfile): Dimension {
  const candidates: Array<{ title: string; weight: number; label: string }> = [
    ...profile.targetTitles.map((t) => ({ title: t, weight: 1, label: "your target title" })),
    ...(profile.currentTitle ? [{ title: profile.currentTitle, weight: 0.9, label: "your current title" }] : []),
    ...profile.employment.map((e) => ({ title: e.title, weight: 0.8, label: "a past title" })),
  ];
  if (!candidates.length) return unknown("Add target titles to your Master Profile to score role alignment.");
  let best = { score: 0, title: "", label: "" };
  for (const c of candidates) {
    const score = titleSimilarity(job.title, c.title) * c.weight;
    if (score > best.score) best = { score, title: c.title, label: c.label };
  }
  if (best.score >= 0.75) return { score: Math.min(1, best.score), known: true, reason: `Closely matches ${best.label} "${best.title}".` };
  if (best.score > 0.2) return { score: best.score, known: true, reason: `Partly matches ${best.label} "${best.title}".` };
  const targets = profile.targetTitles.length ? profile.targetTitles : [profile.currentTitle ?? candidates[0]!.title];
  return { score: best.score, known: true, reason: `Doesn't match your titles (${listPreview(targets, 3)}).` };
}

function scoreCompensation(job: MatchInput, prefs: MatchPreferences): Dimension {
  const salary = job.analysis.salary;
  if (job.analysis.commissionOnly) return { score: 0, known: true, reason: "Pay is commission-only." };
  const listed = salary ? formatSalaryRange(salary.min, salary.max, salary.currency, salary.period) : null;
  if (prefs.minSalary == null) {
    return listed ? { score: 1, known: true, reason: `Lists ${listed}; you haven't set a minimum salary.` } : { score: 1, known: true, reason: "You haven't set a minimum salary." };
  }
  const minimum = formatSalaryRange(prefs.minSalary, prefs.minSalary, "USD", "YEAR");
  if (!salary) return unknown(`No salary listed; your minimum is ${minimum}.`);
  const annual = salary.period === "YEAR" ? "" : ` (about ${formatSalaryRange(salary.annualMin, salary.annualMax, salary.currency, "YEAR")} a year)`;
  if (salary.annualMin >= prefs.minSalary) return { score: 1, known: true, reason: `Lists ${listed}${annual}, at or above your ${minimum} minimum.` };
  if (salary.annualMax >= prefs.minSalary) return { score: 0.8, known: true, reason: `Lists ${listed}${annual}; the top of the range meets your ${minimum} minimum.` };
  if (salary.annualMax >= prefs.minSalary * 0.9) return { score: 0.4, known: true, reason: `Lists ${listed}${annual}, slightly below your ${minimum} minimum.` };
  return { score: 0, known: true, reason: `Lists ${listed}${annual}, below your ${minimum} minimum.` };
}

/**
 * Score a job 0-100 against the profile with the user's weights. Each
 * dimension is scored 0..1 with a plain-language reason; dimensions the
 * posting doesn't cover get neutral partial credit and are marked unknown.
 */
export function scoreMatch(job: MatchInput, profile: MatchProfile, prefs: MatchPreferences, weights: MatchWeights, now: Date = new Date()): MatchResult {
  const scorers: Record<MatchDimension, () => Dimension> = {
    skills: () => scoreSkills(job, profile),
    experience: () => scoreExperience(job, profile, now),
    education: () => scoreEducation(job, profile),
    location: () => scoreLocation(job, profile, prefs),
    industry: () => scoreIndustry(job, profile),
    roleAlignment: () => scoreRole(job, profile),
    compensation: () => scoreCompensation(job, prefs),
  };
  const breakdown: MatchBreakdownItem[] = MATCH_DIMENSIONS.map((dimension) => {
    const result = scorers[dimension]();
    return { dimension, weight: weights[dimension], ...result, score: Math.round(Math.max(0, Math.min(1, result.score)) * 100) / 100 };
  });
  const total = breakdown.reduce((sum, b) => sum + b.weight * b.score, 0);
  return { score: Math.max(0, Math.min(100, Math.round(total))), breakdown };
}
