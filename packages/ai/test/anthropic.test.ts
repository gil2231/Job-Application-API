import { describe, expect, it } from "vitest";
import { createAnthropicProvider } from "../src";

function mockFetch(body: unknown, capture: { url?: string; init?: RequestInit }) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    capture.url = String(url);
    capture.init = init;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const message = (overrides: Record<string, unknown> = {}) => ({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-opus-5-5",
  content: [{ type: "text", text: '{"ok":true}' }],
  stop_reason: "end_turn",
  usage: { input_tokens: 10, output_tokens: 5 },
  ...overrides,
});

describe("Anthropic provider", () => {
  it("requests structured JSON output with refusal fallbacks", async () => {
    const capture: { url?: string; init?: RequestInit } = {};
    const provider = createAnthropicProvider({ apiKey: "sk-test" }, { fetch: mockFetch(message(), capture) });
    const result = await provider.complete({
      messages: [
        { role: "system", content: "Extract facts." },
        { role: "user", content: "Posting" },
      ],
      jsonSchema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
    });
    expect(result).toMatchObject({ text: '{"ok":true}', model: "claude-opus-5-5", usage: { inputTokens: 10, outputTokens: 5 } });
    const body = JSON.parse(String(capture.init!.body));
    expect(body).toMatchObject({
      model: "claude-opus-5-5",
      system: "Extract facts.",
      messages: [{ role: "user", content: "Posting" }],
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema: { required: ["ok"] } } },
    });
    expect(new Headers(capture.init!.headers).get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
  });

  it("treats a refusal as a failure so the caller falls back", async () => {
    const provider = createAnthropicProvider({ apiKey: "sk-test" }, { fetch: mockFetch(message({ stop_reason: "refusal", content: [] }), {}) });
    await expect(provider.complete({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow("declined");
  });
});
