import Anthropic from "@anthropic-ai/sdk";
import { AIUnavailableError, type AIProvider, type CompletionRequest, type CompletionResult } from "../provider";

export const ANTHROPIC_DEFAULT_MODEL = "claude-opus-5-5";

/**
 * Anthropic provider. JSON requests use structured outputs, so the response is
 * guaranteed to match the schema. Server-side refusal fallbacks are enabled so
 * a declined request is retried on the default fallback model.
 */
export function createAnthropicProvider(
  config: { model?: string; apiKey?: string } = {},
  clientOptions: { fetch?: typeof globalThis.fetch } = {},
): AIProvider {
  const apiKey = config.apiKey || process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new AIUnavailableError("ANTHROPIC_API_KEY is not set");
  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2, ...clientOptions });
  const model = config.model || ANTHROPIC_DEFAULT_MODEL;

  return {
    id: "anthropic",
    model,
    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const system = request.messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
      const messages = request.messages
        .filter((m): m is typeof m & { role: "user" | "assistant" } => m.role !== "system")
        .map((m) => ({ role: m.role, content: m.content }));
      const response = await client.beta.messages.create({
        model,
        max_tokens: request.maxTokens ?? 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        ...(system ? { system } : {}),
        messages,
        output_config: {
          effort: "low",
          ...(request.jsonSchema ? { format: { type: "json_schema" as const, schema: request.jsonSchema } } : {}),
        },
      });
      if (response.stop_reason === "refusal") throw new Error("The AI provider declined the request");
      if (response.stop_reason === "max_tokens") throw new Error("The AI response was cut off");
      const text = response.content.map((block) => (block.type === "text" ? block.text : "")).join("");
      return {
        text,
        model: response.model,
        usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens },
      };
    },
  };
}
