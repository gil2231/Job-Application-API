import type { AttentionReason, AutomationMode } from "@autoapply/shared";
import type { FieldMapping } from "./fields";
import type { LibraryAnswerForForms, ProfileFactsForForms } from "./resolve";
import { answerMeansYes } from "./options";

/**
 * The checks that decide whether an application may be submitted without a
 * person, and what happens instead when it may not.
 */

export interface Contradiction {
  message: string;
}

const firstNumber = (s: string) => {
  const m = s.match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const sameUrl = (a: string, b: string) => a.trim().replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "").toLowerCase() === b.trim().replace(/^https?:\/\/(www\.)?/i, "").replace(/\/+$/, "").toLowerCase();

/** Facts that disagree with each other: Applyance won't submit until a person resolves them. */
export function findContradictions(input: {
  mappings: FieldMapping[];
  profile: ProfileFactsForForms;
  library: LibraryAnswerForForms[];
  job: { sponsorshipAvailable?: boolean | null };
  rule: { requiresSponsorship: boolean };
}): Contradiction[] {
  const out: Contradiction[] = [];
  const lib = (key: string) => input.library.find((a) => a.questionKey === key && a.answer.trim());

  const sponsorship = lib("sponsorship");
  if (sponsorship) {
    const needs = answerMeansYes(sponsorship.answer);
    if (needs === true && !input.rule.requiresSponsorship) out.push({ message: "Your Answer Library says you need visa sponsorship, but your rules say you don't." });
    if (needs === false && input.rule.requiresSponsorship) out.push({ message: "Your rules say you need visa sponsorship, but your Answer Library says you don't." });
  }
  if (input.rule.requiresSponsorship && input.job.sponsorshipAvailable === false) {
    out.push({ message: "This job says it can't sponsor visas, and your rules say you need sponsorship." });
  }

  const years = lib("years_experience");
  if (years && input.profile.yearsExperience != null) {
    const n = firstNumber(years.answer);
    if (n != null && Math.abs(n - input.profile.yearsExperience) > 1) {
      out.push({ message: `Your Answer Library says ${n} years of experience; your Master Profile says ${input.profile.yearsExperience}.` });
    }
  }
  const linkedin = lib("linkedin_url");
  if (linkedin && input.profile.linkedinUrl && !sameUrl(linkedin.answer, input.profile.linkedinUrl)) {
    out.push({ message: "Your Answer Library and Master Profile list different LinkedIn URLs." });
  }

  // The same profile field filled with two different values on this form.
  const byField = new Map<string, Set<string>>();
  for (const m of input.mappings) {
    if (m.status === "SKIPPED" || m.value == null || Array.isArray(m.value) || m.mappedField === "unknown" || m.mappedField === "answer.library" || m.mappedField.startsWith("documents.")) continue;
    const set = byField.get(m.mappedField) ?? new Set<string>();
    set.add(m.value.trim().toLowerCase());
    byField.set(m.mappedField, set);
  }
  for (const [field, values] of byField) if (values.size > 1) out.push({ message: `The form asks for ${field.split(".").pop()} twice and the answers differ.` });
  return out;
}

export interface SubmissionCheck {
  mode: AutomationMode;
  /** The user approved this application for submission (Review mode, or "Let Applyance submit"). */
  submitApproved: boolean;
  autoSubmitEnabled: boolean;
  /** The adapter that filled the form is built for the detected platform and allows unattended submission. */
  platformSupported: boolean;
  platformLabel: string;
  mappings: FieldMapping[];
  contradictions: Contradiction[];
  /** A CAPTCHA or other security check is on the page. */
  securityChallenge: boolean;
  /** The user's field-mapping confidence threshold (0-100). */
  confidenceThreshold: number;
}

export type SubmissionDecision =
  | { action: "submit" }
  /** Stop before submitting and wait for the user in Needs Attention. */
  | { action: "review"; reason: AttentionReason; detail: string; reasons: string[] }
  /** Manual mode: the form is filled; the user clicks Submit. */
  | { action: "hand_off"; detail: string };

/**
 * Auto mode submits only when the platform is supported, every required field
 * is confidently mapped, nothing is unresolved, there's no CAPTCHA or security
 * check, nothing contradicts, and the user's rules allow it. Anything else
 * downgrades to review.
 */
export function decideSubmission(check: SubmissionCheck): SubmissionDecision {
  const unresolved = check.mappings.filter((m) => m.status === "NEEDS_REVIEW");
  if (unresolved.length) {
    return { action: "review", reason: "QUESTION_REVIEW", detail: `${unresolved.length} question${unresolved.length === 1 ? "" : "s"} need${unresolved.length === 1 ? "s" : ""} your answer before this application can continue.`, reasons: unresolved.map((m) => m.detectedLabel) };
  }
  if (check.securityChallenge) {
    return { action: "review", reason: "CAPTCHA", detail: "A security check appeared before submission. Applyance never completes these for you.", reasons: ["Security check on the page"] };
  }
  if (check.submitApproved) return { action: "submit" };

  if (check.mode === "MANUAL") {
    return { action: "hand_off", detail: "Everything is filled and checked. Open the application and click Submit yourself, then mark it submitted here." };
  }
  if (check.mode === "REVIEW") {
    return { action: "review", reason: "FINAL_REVIEW", detail: "Everything is filled and checked. Review the answers, then approve to submit.", reasons: ["Review mode stops before submitting"] };
  }

  const reasons: string[] = [];
  if (!check.autoSubmitEnabled) reasons.push("auto-submit is turned off in your rules");
  if (!check.platformSupported) reasons.push(`${check.platformLabel} isn't supported for unattended submission yet`);
  const lowConfidenceRequired = check.mappings.filter((m) => m.field.required && m.status === "ANSWERED" && m.source !== "user" && m.confidence < check.confidenceThreshold);
  if (lowConfidenceRequired.length) reasons.push(`${lowConfidenceRequired.length} required field${lowConfidenceRequired.length === 1 ? " wasn't" : "s weren't"} mapped confidently`);
  const notAllowed = check.mappings.filter((m) => m.status === "ANSWERED" && !m.autoSubmitAllowed);
  if (notAllowed.length) reasons.push(`${notAllowed.length} answer${notAllowed.length === 1 ? " isn't" : "s aren't"} allowed to be sent without your review`);
  if (check.contradictions.length) reasons.push(...check.contradictions.map((c) => c.message));

  if (!reasons.length) return { action: "submit" };
  const reason: AttentionReason = check.contradictions.length ? "CONTRADICTION" : "FINAL_REVIEW";
  return { action: "review", reason, detail: `Auto mode stopped before submitting: ${reasons.join("; ")}. Review and approve to submit.`, reasons };
}
