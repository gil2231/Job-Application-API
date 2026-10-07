import { RESUME_PERSONAL_FIELDS, RESUME_SKILL_LISTS, type ResumeDraft, type ResumeReading } from "@autoapply/shared";
import { resolveProvider, type AIConfig, type AIProvider } from "../provider";
import { readResumeWithAI } from "./ai";
import { groundDraft } from "./ground";
import { parseResumeText } from "./parse";

export { parseResumeText, parseLocation } from "./parse";
export { groundDraft } from "./ground";
export { readResumeWithAI, RESUME_JSON_SCHEMA } from "./ai";
export { parseDate, findDateRange } from "./dates";

/**
 * Contact details found by pattern are exact; a model that left one out is
 * filled in from the parser. Everything else comes from one reader only, so
 * entries are never merged from two different readings.
 */
function fillContactGaps(ai: ResumeDraft, parsed: ResumeDraft): ResumeDraft {
  const personal = { ...ai.personal };
  for (const key of RESUME_PERSONAL_FIELDS) personal[key] ??= parsed.personal[key];
  const skills = { ...ai.skills };
  if (RESUME_SKILL_LISTS.every((l) => ai.skills[l].length === 0)) Object.assign(skills, parsed.skills);
  return { ...ai, personal, skills };
}

/**
 * Turn resume text into a draft of profile fields for the person to review.
 * Uses the configured AI provider when there is one and falls back to the
 * built-in parser otherwise or when the model fails. Either way, every value is
 * checked against the resume text and anything not found there is dropped.
 */
export async function readResume(
  resumeText: string,
  options: { ai?: AIConfig; provider?: AIProvider | null } = {},
): Promise<ResumeReading> {
  const parsed = parseResumeText(resumeText);
  const { provider, reason } = options.provider !== undefined ? { provider: options.provider, reason: null } : resolveProvider(options.ai);
  if (provider) {
    try {
      const fromAI = await readResumeWithAI(provider, resumeText);
      const grounded = groundDraft(fillContactGaps(fromAI, parsed), resumeText);
      return { draft: grounded.draft, method: "ai", model: provider.model, removed: grounded.removed };
    } catch (error) {
      console.warn("[resume-import] AI reading failed, using the built-in parser", error instanceof Error ? error.message : error);
      const grounded = groundDraft(parsed, resumeText);
      return { draft: grounded.draft, method: "builtin", fallbackReason: "The AI provider couldn't read this resume", removed: grounded.removed };
    }
  }
  const grounded = groundDraft(parsed, resumeText);
  return { draft: grounded.draft, method: "builtin", ...(reason && options.ai?.provider ? { fallbackReason: reason } : {}), removed: grounded.removed };
}
