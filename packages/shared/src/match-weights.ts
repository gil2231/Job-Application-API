export const MATCH_DIMENSIONS = [
  "skills",
  "experience",
  "education",
  "location",
  "industry",
  "roleAlignment",
  "compensation",
] as const;
export type MatchDimension = (typeof MATCH_DIMENSIONS)[number];

export type MatchWeights = Record<MatchDimension, number>;

/** Default weighting, in percent. Users can change it on the Rules page. */
export const DEFAULT_MATCH_WEIGHTS: MatchWeights = {
  skills: 25,
  experience: 20,
  education: 10,
  location: 10,
  industry: 10,
  roleAlignment: 15,
  compensation: 10,
};

export const MATCH_DIMENSION_LABELS: Record<MatchDimension, string> = {
  skills: "Skills",
  experience: "Experience",
  education: "Education",
  location: "Location",
  industry: "Industry",
  roleAlignment: "Role alignment",
  compensation: "Compensation",
};

export function sumWeights(weights: MatchWeights): number {
  return MATCH_DIMENSIONS.reduce((total, key) => total + weights[key], 0);
}

/** One scored dimension of a job's match, stored with the job so the UI can explain it. */
export interface MatchBreakdownItem {
  dimension: MatchDimension;
  weight: number;
  /** 0..1 */
  score: number;
  reason: string;
  /** False when the job didn't say enough to judge this dimension; it then gets neutral partial credit. */
  known: boolean;
  /** Supporting evidence, e.g. matched and missing skills. */
  details?: string[];
}
