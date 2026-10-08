import { locationMatchesPlace, mentionsKeyword, splitPreferences } from "@autoapply/shared";

export interface RecommendationCandidate {
  id: string;
  title: string;
  company: string;
  location: string | null;
  description: string | null;
  matchScore: number | null;
  status: string;
  savedAt: Date;
  /** The stored QualificationResult, used to tell a low score apart from a broken rule. */
  qualification?: unknown;
}

export interface Recommendation<T extends RecommendationCandidate> {
  job: T;
  /** 0–100: how well the job fits, from keyword hits and the match score. */
  relevance: number;
  /** Keywords found in the title or company. */
  titleKeywords: string[];
  /** Keywords found only in the description. */
  descriptionKeywords: string[];
  /** Preferred places the job is in (e.g. NYC). */
  places: string[];
}

/** A keyword in the title counts fully; one that only appears in the description counts half. */
const DESCRIPTION_WEIGHT = 0.5;
/** Jobs not scored yet (no description) are ranked as if they scored this. */
const UNSCORED = 50;
/** Extra relevance for a job in one of the preferred places. */
const PLACE_BONUS = 15;

function brokeARule(qualification: unknown): boolean {
  const checks = (qualification as { checks?: Array<{ rule: string; outcome: string }> } | null)?.checks;
  // Without the stored checks there's no telling why it failed, so leave it out.
  if (!Array.isArray(checks)) return true;
  return checks.some((c) => c.outcome === "fail" && c.rule !== "minMatchScore");
}

/**
 * Rank jobs for the Recommended list. With keywords, a job needs at least one
 * of them, and relevance is half keyword coverage, half match score. Places
 * among the terms (NYC, Remote…) don't count as keywords; a job in one of them
 * ranks higher. Without
 * keywords, only scored jobs are recommended, by match score. Jobs that broke
 * one of the user's rules (excluded company, salary, location…) are never
 * recommended; a job that only scored below the minimum still can be, ranked
 * lower by its score.
 */
export function rankRecommendations<T extends RecommendationCandidate>(jobs: T[], keywords: string[], limit = 50): Array<Recommendation<T>> {
  const { keywords: terms, places } = splitPreferences([...new Set(keywords.map((k) => k.trim()).filter(Boolean))]);
  const out: Array<Recommendation<T>> = [];
  for (const job of jobs) {
    if (job.status === "SKIPPED" || (job.status === "NOT_QUALIFIED" && brokeARule(job.qualification))) continue;
    const inPlaces = places.filter((p) => locationMatchesPlace(job.location, p));
    const bonus = inPlaces.length ? PLACE_BONUS : 0;
    if (!terms.length) {
      if (job.matchScore == null) continue;
      out.push({ job, relevance: Math.min(100, job.matchScore + bonus), titleKeywords: [], descriptionKeywords: [], places: inPlaces });
      continue;
    }
    const heading = `${job.title}\n${job.company}`;
    const titleKeywords = terms.filter((t) => mentionsKeyword(heading, t));
    const descriptionKeywords = job.description ? terms.filter((t) => !titleKeywords.includes(t) && mentionsKeyword(job.description!, t)) : [];
    if (!titleKeywords.length && !descriptionKeywords.length) continue;
    const coverage = Math.min(1, (titleKeywords.length + descriptionKeywords.length * DESCRIPTION_WEIGHT) / Math.min(terms.length, 3));
    const relevance = Math.min(100, Math.round(coverage * 50 + (job.matchScore ?? UNSCORED) * 0.5) + bonus);
    out.push({ job, relevance, titleKeywords, descriptionKeywords, places: inPlaces });
  }
  return out.sort((a, b) => b.relevance - a.relevance || b.job.savedAt.getTime() - a.job.savedAt.getTime()).slice(0, limit);
}
