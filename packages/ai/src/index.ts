import { registerProvider } from "./provider";
import { createAnthropicProvider } from "./providers/anthropic";
import { createOpenAIProvider } from "./providers/openai";

registerProvider("anthropic", (config) => createAnthropicProvider(config));
registerProvider("openai", (config) => createOpenAIProvider(config));

export * from "./provider";
export { ANTHROPIC_DEFAULT_MODEL, createAnthropicProvider } from "./providers/anthropic";
export { OPENAI_DEFAULT_MODEL, createOpenAIProvider, isStrictSchema } from "./providers/openai";
export * from "./job-analysis";
export * from "./field-mapping";
export * from "./answers";
export * from "./application";
export * from "./writing";
