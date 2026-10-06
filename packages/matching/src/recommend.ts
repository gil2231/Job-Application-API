import { mentionsKeyword } from "@autoapply/shared";

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
}

/** A keyword in the title counts fully; one that only appears in the description counts half. */
const DESCRIPTION_WEIGHT = 0.5;
/** Jobs not scored yet (no description) are ranked as if they scored this. */
const UNSCORED = 50;

function brokeARule(qualification: unknown): boolean {
  const checks = (qualification as { checks?: Array<{ rule: string; outcome: string }> } | null)?.checks;
  // Without the stored checks there's no telling why it failed, so leave it out.
  if (!Array.isArray(checks)) return true;
  return checks.some((c) => c.outcome === "fail" && c.rule !== "minMatchScore");
}

/**
 * Rank jobs for the Recommended list. With keywords, a job needs at least one
 * of them, and relevance is half keyword coverage, half match score. Without
 * keywords, only scored jobs are recommended, by match score. Jobs that broke
 * one of the user's rules (excluded company, salary, location…) are never
 * recommended; a job that only scored below the minimum still can be, ranked
 * lower by its score.
 */
export function rankRecommendations<T extends RecommendationCandidate>(jobs: T[], keywords: string[], limit = 50): Array<Recommendation<T>> {
  const terms = [...new Set(keywords.map((k) => k.trim()).filter(Boolean))];
  const out: Array<Recommendation<T>> = [];
  for (const job of jobs) {
    if (job.status === "SKIPPED" || (job.status === "NOT_QUALIFIED" && brokeARule(job.qualification))) continue;
    if (!terms.length) {
      if (job.matchScore == null) continue;
      out.push({ job, relevance: job.matchScore, titleKeywords: [], descriptionKeywords: [] });
      continue;
    }
    const heading = `${job.title}\n${job.company}`;
    const titleKeywords = terms.filter((t) => mentionsKeyword(heading, t));
    const descriptionKeywords = job.description ? terms.filter((t) => !titleKeywords.includes(t) && mentionsKeyword(job.description!, t)) : [];
    if (!titleKeywords.length && !descriptionKeywords.length) continue;
    const coverage = Math.min(1, (titleKeywords.length + descriptionKeywords.length * DESCRIPTION_WEIGHT) / Math.min(terms.length, 3));
    const relevance = Math.round(coverage * 50 + (job.matchScore ?? UNSCORED) * 0.5);
    out.push({ job, relevance, titleKeywords, descriptionKeywords });
  }
  return out.sort((a, b) => b.relevance - a.relevance || b.job.savedAt.getTime() - a.job.savedAt.getTime()).slice(0, limit);
}
