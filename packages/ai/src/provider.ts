/**
 * AI provider abstraction. Job analysis, field classification, answer drafting
 * and document generation call these interfaces, never a vendor SDK directly, so
 * the model can be swapped by configuration. Every AI feature has a
 * deterministic fallback for when no provider is configured.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CompletionRequest {
  messages: ChatMessage[];
  maxTokens?: number;
  temperature?: number;
  /** When set, the provider must return JSON matching this JSON Schema. */
  jsonSchema?: Record<string, unknown>;
}

export interface CompletionResult {
  text: string;
  model: string;
  usage?: { inputTokens: number; outputTokens: number };
}

export interface AIProvider {
  readonly id: string;
  readonly model: string;
  complete(request: CompletionRequest): Promise<CompletionResult>;
}

export type ProviderFactory = (config: { model?: string; apiKey?: string }) => AIProvider;

const factories = new Map<string, ProviderFactory>();

export function registerProvider(id: string, factory: ProviderFactory): void {
  factories.set(id, factory);
}

export function availableProviders(): string[] {
  return [...factories.keys()];
}

export class AIUnavailableError extends Error {
  constructor(message = "No AI provider is configured") {
    super(message);
    this.name = "AIUnavailableError";
  }
}

export function createProvider(id: string | null | undefined, config: { model?: string; apiKey?: string } = {}): AIProvider {
  if (!id) throw new AIUnavailableError();
  const factory = factories.get(id);
  if (!factory) throw new AIUnavailableError(`AI provider "${id}" is not installed`);
  return factory(config);
}

/** The reason given when AI is simply turned off. */
export const NO_PROVIDER = "No AI provider is configured";

export interface AIConfig {
  /** Provider id (e.g. "anthropic"), or "none". Defaults to the AI_PROVIDER environment variable. */
  provider?: string | null;
  model?: string | null;
}

/**
 * The provider a user's settings ask for, or null with the reason AI isn't in
 * use. Never throws for missing configuration, so every caller can fall back to
 * its deterministic path.
 */
export function resolveProvider(config: AIConfig = {}): { provider: AIProvider | null; reason: string | null } {
  const configured = config.provider || process.env.AI_PROVIDER || null;
  const providerId = configured === "none" ? null : configured;
  if (!providerId) return { provider: null, reason: NO_PROVIDER };
  try {
    return { provider: createProvider(providerId, { model: config.model || process.env.AI_MODEL || undefined }), reason: null };
  } catch (error) {
    if (!(error instanceof AIUnavailableError)) throw error;
    return { provider: null, reason: error.message };
  }
}
