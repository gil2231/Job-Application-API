import type { JobAnalysis } from "@autoapply/shared";
import { AIUnavailableError, createProvider, type AIProvider } from "../provider";
import { analyzeJobWithAI } from "./ai";
import { analyzeJobHeuristically } from "./heuristic";
import type { JobAnalysisInput, JobAnalyzer } from "./types";

export type { JobAnalysisInput, JobAnalyzer } from "./types";
export { analyzeJobHeuristically, detectSkills } from "./heuristic";
export { analyzeJobWithAI, JOB_ANALYSIS_JSON_SCHEMA } from "./ai";
export { htmlToText } from "./text";

export interface AnalyzerConfig {
  /** Provider id (e.g. "anthropic"). Defaults to the AI_PROVIDER environment variable. */
  provider?: string | null;
  model?: string | null;
}

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
  const configured = config.provider || process.env.AI_PROVIDER || null;
  const providerId = configured === "none" ? null : configured;
  let provider: AIProvider | null = null;
  let reason: string | null = providerId ? null : "No AI provider is configured";
  if (providerId) {
    try {
      provider = createProvider(providerId, { model: config.model || process.env.AI_MODEL || undefined });
    } catch (error) {
      if (!(error instanceof AIUnavailableError)) throw error;
      reason = error.message;
    }
  }
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
