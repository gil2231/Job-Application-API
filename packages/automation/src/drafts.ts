import { normalizeLabel } from "./classify";
import type { DetectedField } from "./fields";

/**
 * AI answer drafts for questions the Answer Library doesn't cover. A draft is
 * only ever a suggestion: it always goes to the person for review and is never
 * submitted unattended.
 */

export interface AnswerDraft {
  value: string;
  /** 0..100, the drafter's own estimate; drafts are reviewed whatever it says. */
  confidence: number;
  /** The profile facts or saved answers the draft is built from, for the reviewer. */
  basis: string;
}

export interface AnswerDrafter {
  draft(field: DetectedField): Promise<AnswerDraft | null>;
}

/**
 * Questions about legal status, identity, money, availability or personal
 * preference. Only the person can answer these; no draft is ever offered.
 */
const NEVER_DRAFT = new RegExp(
  [
    // Word stems: "authorized", "sponsorship", "relocating", "disability".
    String.raw`\b(authori[sz]|eligib|sponsor|citizen|immigra|clearance|ethnic|hispanic|latin|veteran|militar|disabil|criminal|convict|felon|arrest|salar|compensat|wage|relocat|travel|willing|consent|acknowledg|signatur|certif|attest|referr|pronoun)\w*`,
    // Whole words and phrases.
    String.raw`\b(visa|green card|work permit|gender|sex|race|age|date of birth|birth ?date|ssn|social security|pay|pay rate|hourly rate|start date|notice period|available|availability|agree|drug|background check|how did you hear|who referred)\b`,
  ].join("|"),
);

export function mayDraft(field: DetectedField): boolean {
  if (field.kind === "file" || field.kind === "checkbox" || field.kind === "date" || field.kind === "unknown") return false;
  return !NEVER_DRAFT.test(normalizeLabel(field.label));
}
