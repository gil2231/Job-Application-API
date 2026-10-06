import { registerProvider } from "./provider";
import { createAnthropicProvider } from "./providers/anthropic";

registerProvider("anthropic", (config) => createAnthropicProvider(config));

export * from "./provider";
export { ANTHROPIC_DEFAULT_MODEL, createAnthropicProvider } from "./providers/anthropic";
export * from "./job-analysis";
