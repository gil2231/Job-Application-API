import { afterEach, describe, expect, it, vi } from "vitest";
import type { DetectedField } from "@autoapply/automation";
import {
  AIAnswerDrafter,
  ANSWER_DRAFT_JSON_SCHEMA,
  COVER_LETTER_JSON_SCHEMA,
  createJobAnalyzer,
  createOpenAIProvider,
  FIELD_MAPPING_JSON_SCHEMA,
  generateCoverLetter,
  isStrictSchema,
  JOB_ANALYSIS_JSON_SCHEMA,
  resolveProvider,
  RESUME_TAILORING_JSON_SCHEMA,
} from "../src";
import { JOB, NOW, PROFILE } from "./writing-fixtures";

type Capture = { calls: Array<{ url: string; body: Record<string, unknown> }> };

/** A fetch that answers like the Chat Completions API and records each request. */
function mockFetch(reply: (body: Record<string, unknown>) => Record<string, unknown>, capture: Capture = { calls: [] }) {
  return (async (url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body)) as Record<string, unknown>;
    capture.calls.push({ url: String(url), body });
    return new Response(JSON.stringify(reply(body)), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const completion = (message: Record<string, unknown>, finish_reason = "stop") => ({
  id: "chatcmpl_1",
  object: "chat.completion",
  created: 1,
  model: "gpt-5.5-2026-04-23",
  choices: [{ index: 0, finish_reason, message: { role: "assistant", refusal: null, ...message } }],
  usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
});

const json = (value: unknown) => () => completion({ content: JSON.stringify(value) });

describe("OpenAI provider", () => {
  it("requests strict structured JSON with the system prompt as developer instructions", async () => {
    const capture: Capture = { calls: [] };
    const provider = createOpenAIProvider({ apiKey: "sk-test" }, { fetch: mockFetch(json({ ok: true }), capture) });
    const schema = { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false };
    const result = await provider.complete({
      messages: [
        { role: "system", content: "Extract facts." },
        { role: "user", content: "Posting" },
      ],
      jsonSchema: schema,
      maxTokens: 500,
    });
    expect(result).toEqual({ text: '{"ok":true}', model: "gpt-5.5-2026-04-23", usage: { inputTokens: 12, outputTokens: 6 } });
    const { url, body } = capture.calls[0]!;
    expect(url).toMatch(/\/chat\/completions$/);
    expect(body).toMatchObject({
      model: "gpt-5.5",
      max_completion_tokens: 500,
      reasoning_effort: "low",
      messages: [
        { role: "developer", content: "Extract facts." },
        { role: "user", content: "Posting" },
      ],
      response_format: { type: "json_schema", json_schema: { name: "response", strict: true, schema } },
    });
  });

  it("uses the configured model", () => {
    expect(createOpenAIProvider({ apiKey: "sk-test", model: "gpt-5.4-mini" }).model).toBe("gpt-5.4-mini");
  });

  it("treats a refusal or a cut-off reply as a failure so the caller falls back", async () => {
    const refused = createOpenAIProvider({ apiKey: "sk-test" }, { fetch: mockFetch(() => completion({ content: null, refusal: "I can't help with that." })) });
    await expect(refused.complete({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow("declined");
    const cut = createOpenAIProvider({ apiKey: "sk-test" }, { fetch: mockFetch(() => completion({ content: '{"ok":' }, "length")) });
    await expect(cut.complete({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow("cut off");
  });

  it("needs OPENAI_API_KEY", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(() => createOpenAIProvider()).toThrow("OPENAI_API_KEY is not set");
    vi.unstubAllEnvs();
  });
});

describe("isStrictSchema", () => {
  it("accepts every schema Applyance sends, so OpenAI must follow them exactly", () => {
    for (const schema of [JOB_ANALYSIS_JSON_SCHEMA, FIELD_MAPPING_JSON_SCHEMA, ANSWER_DRAFT_JSON_SCHEMA, RESUME_TAILORING_JSON_SCHEMA, COVER_LETTER_JSON_SCHEMA]) {
      expect(isStrictSchema(schema)).toBe(true);
    }
  });

  it("rejects optional properties and open objects", () => {
    expect(isStrictSchema({ type: "object", properties: { a: { type: "string" } }, required: [], additionalProperties: false })).toBe(false);
    expect(isStrictSchema({ type: "object", properties: { a: { type: "string" } }, required: ["a"] })).toBe(false);
    expect(isStrictSchema({ type: "array", items: { type: "object", properties: {}, additionalProperties: true } })).toBe(false);
  });
});

describe("choosing OpenAI", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("is picked by AI_PROVIDER=openai", () => {
    vi.stubEnv("AI_PROVIDER", "openai");
    vi.stubEnv("AI_MODEL", "");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    const { provider, reason } = resolveProvider();
    expect(reason).toBeNull();
    expect(provider).toMatchObject({ id: "openai", model: "gpt-5.5" });
  });

  it("reports a missing key and keeps the built-in analyzer", () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    expect(createJobAnalyzer({ provider: "openai" }).info).toMatchObject({ method: "heuristic", reason: "OPENAI_API_KEY is not set" });
  });

  it("doesn't apply a server AI_MODEL meant for another provider", () => {
    vi.stubEnv("AI_PROVIDER", "anthropic");
    vi.stubEnv("AI_MODEL", "claude-opus-5-5");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    expect(resolveProvider({ provider: "openai" }).provider?.model).toBe("gpt-5.5");
    expect(resolveProvider({ provider: "openai", model: "gpt-5.4" }).provider?.model).toBe("gpt-5.4");
  });
});

describe("truthfulness rules with OpenAI", () => {
  const field = (label: string, extra: Partial<DetectedField> = {}): DetectedField => ({ label, kind: "text", required: true, pageIndex: 0, locators: [{ strategy: "label", value: label }], ...extra });
  const context = { profile: PROFILE, job: JOB, library: [] };

  it("replaces a cover letter that invents skills with the template", async () => {
    const provider = createOpenAIProvider({ apiKey: "sk-test" }, { fetch: mockFetch(json({ paragraphs: ["I've deployed Kubernetes clusters for 10 years."] })) });
    const { content } = await generateCoverLetter({ profile: PROFILE, job: JOB, provider, now: NOW });
    expect(content.generation.method).toBe("template");
    expect(content.paragraphs.join(" ")).not.toContain("Kubernetes");
  });

  it("drops an answer draft with claims the profile doesn't back", async () => {
    const provider = createOpenAIProvider({ apiKey: "sk-test" }, { fetch: mockFetch(json({ answerable: true, answer: "I led a Kubernetes migration at Google.", basedOn: "x", confidence: 90 })) });
    expect(await new AIAnswerDrafter(provider, context).draft(field("Describe a project you led"))).toBeNull();
  });

  it("never sends legal, demographic, pay or availability questions to OpenAI", async () => {
    const capture: Capture = { calls: [] };
    const provider = createOpenAIProvider({ apiKey: "sk-test" }, { fetch: mockFetch(json({ answerable: true, answer: "Yes", basedOn: "x", confidence: 99 }), capture) });
    const drafter = new AIAnswerDrafter(provider, context);
    for (const label of ["Are you authorized to work in the US?", "What is your gender?", "Desired salary", "When are you available to start?"]) {
      expect(await drafter.draft(field(label))).toBeNull();
    }
    expect(capture.calls).toHaveLength(0);
  });
});
