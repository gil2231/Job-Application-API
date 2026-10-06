import { HeuristicFieldClassifier, type AnswerDrafter, type FieldClassifier } from "@autoapply/automation";
import { AIAnswerDrafter, type DraftContext } from "./answers";
import { AIFieldClassifier } from "./field-mapping";
import { resolveProvider, type AIConfig } from "./provider";

export interface ApplicationAI {
  classifier: FieldClassifier;
  /** Null without a provider: unanswered questions simply go to the person. */
  drafter: AnswerDrafter | null;
  info: { method: "ai" | "heuristic"; provider: string | null; model: string | null; reason: string | null };
  /** The most recent AI error in this run, if any call failed. */
  lastFailure(): string | null;
}

/** Field mapping and answer drafting for one application run, per the user's AI settings. */
export function createApplicationAI(config: AIConfig, context: DraftContext): ApplicationAI {
  const { provider, reason } = resolveProvider(config);
  if (!provider) return { classifier: new HeuristicFieldClassifier(), drafter: null, info: { method: "heuristic", provider: null, model: null, reason }, lastFailure: () => null };
  const classifier = new AIFieldClassifier(provider);
  const drafter = new AIAnswerDrafter(provider, context);
  return {
    classifier,
    drafter,
    info: { method: "ai", provider: provider.id, model: provider.model, reason: null },
    lastFailure: () => drafter.lastError ?? classifier.stats.lastError,
  };
}
