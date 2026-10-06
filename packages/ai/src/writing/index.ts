import { NO_PROVIDER, resolveProvider, type AIConfig } from "../provider";
import { generateCoverLetter } from "./cover-letter";
import { generateResume } from "./resume";
import type { WritingJob, WritingProfile } from "./profile";

export * from "./profile";
export * from "./truthfulness";
export { generateResume, headerFor, templateSummary, MAX_BULLETS_PER_ROLE, MAX_SKILLS, RESUME_TAILORING_JSON_SCHEMA } from "./resume";
export { generateCoverLetter, templateCoverLetter, COVER_LETTER_JSON_SCHEMA } from "./cover-letter";

/** Why AI was asked for but couldn't be used; nothing when AI is simply off. */
function unavailable(provider: unknown, reason: string | null): string | null {
  return provider || !reason || reason === NO_PROVIDER ? null : `AI isn't available (${reason}), so this was built from your profile`;
}

/** Generate a job-specific resume with the user's AI settings, falling back to the template. */
export function writeResumeForJob(profile: WritingProfile, job: WritingJob, config: AIConfig = {}) {
  const { provider, reason } = resolveProvider(config);
  return generateResume({ profile, job, provider, unavailableReason: unavailable(provider, reason) });
}

/** Generate a job-specific cover letter with the user's AI settings, falling back to the template. */
export function writeCoverLetterForJob(profile: WritingProfile, job: WritingJob, config: AIConfig = {}) {
  const { provider, reason } = resolveProvider(config);
  return generateCoverLetter({ profile, job, provider, unavailableReason: unavailable(provider, reason) });
}
