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
