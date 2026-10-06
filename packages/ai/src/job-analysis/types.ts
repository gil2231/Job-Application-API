import type { JobAnalysis, Platform, WorkArrangement } from "@autoapply/shared";

export interface JobAnalysisInput {
  title: string;
  company: string;
  location?: string | null;
  description?: string | null;
  salaryText?: string | null;
  /** Arrangement the user entered, if any. Overrides detection. */
  workArrangement?: WorkArrangement | null;
  platform: Platform;
  /** The user's own profile skills, searched for in the posting alongside the shared vocabulary. */
  knownSkills?: string[];
}

export interface JobAnalyzer {
  analyze(input: JobAnalysisInput): Promise<JobAnalysis>;
}
