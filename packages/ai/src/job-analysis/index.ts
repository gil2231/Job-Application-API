import type { JobAnalysis } from "@autoapply/shared";
import { resolveProvider, type AIConfig } from "../provider";
import { analyzeJobWithAI } from "./ai";
import { analyzeJobHeuristically } from "./heuristic";
import type { JobAnalysisInput, JobAnalyzer } from "./types";

export type { JobAnalysisInput, JobAnalyzer } from "./types";
export { analyzeJobHeuristically, detectSkills } from "./heuristic";
export { analyzeJobWithAI, JOB_ANALYSIS_JSON_SCHEMA } from "./ai";
export { htmlToText } from "./text";

export type AnalyzerConfig = AIConfig;

export interface AnalyzerInfo {
  method: "ai" | "heuristic";
  provider: string | null;
  model: string | null;
  /** Why AI isn't in use, when it isn't. */
  reason: string | null;
}

/**
 * Build the job analyzer for a user: the configured AI provider when one is
 * available, otherwise the deterministic analyzer. Never throws for missing
 * configuration, so analysis always works.
 */
export function createJobAnalyzer(config: AnalyzerConfig = {}): JobAnalyzer & { info: AnalyzerInfo } {
  const { provider, reason } = resolveProvider(config);
  if (!provider) {
    return {
      info: { method: "heuristic", provider: null, model: null, reason },
      analyze: async (input: JobAnalysisInput): Promise<JobAnalysis> => analyzeJobHeuristically(input),
    };
  }
  const p = provider;
  return {
    info: { method: "ai", provider: p.id, model: p.model, reason: null },
    analyze: (input: JobAnalysisInput) => analyzeJobWithAI(p, input),
  };
}
