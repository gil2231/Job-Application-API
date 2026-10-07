import OpenAI from "openai";
import { AIUnavailableError, type AIProvider, type CompletionRequest, type CompletionResult } from "../provider";

export const OPENAI_DEFAULT_MODEL = "gpt-5.5";

/**
 * True when a JSON Schema meets OpenAI's strict structured-output rules: every
 * object lists all of its properties as required and allows no others. Strict
 * schemas are guaranteed to be followed; any other schema is still sent, just
 * without the guarantee, and the caller's own validation catches a bad reply.
 */
export function isStrictSchema(schema: unknown): boolean {
  if (Array.isArray(schema)) return schema.every(isStrictSchema);
  if (!schema || typeof schema !== "object") return true;
  const node = schema as Record<string, unknown>;
  if (node.type === "object" || node.properties) {
    const keys = Object.keys((node.properties as Record<string, unknown>) ?? {});
    const required = new Set((node.required as string[]) ?? []);
    if (node.additionalProperties !== false || keys.some((k) => !required.has(k))) return false;
  }
  return Object.entries(node).every(([key, value]) => key === "enum" || key === "const" || isStrictSchema(value));
}

/**
 * OpenAI provider (Chat Completions). JSON requests use structured outputs.
 * A refusal or a cut-off reply throws, so the caller falls back to its
 * deterministic path exactly as it does with any other provider.
 */
export function createOpenAIProvider(
  config: { model?: string; apiKey?: string } = {},
  clientOptions: { fetch?: typeof globalThis.fetch } = {},
): AIProvider {
  const apiKey = config.apiKey || process.env.OPENAI_API_KEY;
  if (!apiKey) throw new AIUnavailableError("OPENAI_API_KEY is not set");
  const client = new OpenAI({ apiKey, timeout: 60_000, maxRetries: 2, ...clientOptions });
  const model = config.model || OPENAI_DEFAULT_MODEL;

  return {
    id: "openai",
    model,
    async complete(request: CompletionRequest): Promise<CompletionResult> {
      const response = await client.chat.completions.create({
        model,
        max_completion_tokens: request.maxTokens ?? 16000,
        reasoning_effort: "low",
        messages: request.messages.map((m) => (m.role === "system" ? { role: "developer" as const, content: m.content } : { role: m.role, content: m.content })),
        ...(request.jsonSchema
          ? { response_format: { type: "json_schema" as const, json_schema: { name: "response", schema: request.jsonSchema, strict: isStrictSchema(request.jsonSchema) } } }
          : {}),
      });
      const choice = response.choices[0];
      if (!choice) throw new Error("The AI provider returned no answer");
      if (choice.message.refusal || choice.finish_reason === "content_filter") throw new Error("The AI provider declined the request");
      if (choice.finish_reason === "length") throw new Error("The AI response was cut off");
      return {
        text: choice.message.content ?? "",
        model: response.model,
        ...(response.usage ? { usage: { inputTokens: response.usage.prompt_tokens, outputTokens: response.usage.completion_tokens } } : {}),
      };
    },
  };
}
