import { computeYearsOfExperience, deriveAnswerFromProfile, type ProfileFieldKey } from "@autoapply/shared";
import { HeuristicFieldClassifier, type Classification, type FieldClassifier } from "./classify";
import type { DetectedField, FieldMapping } from "./fields";
import { requiresReview } from "./fields";
import { answerMeansYes, chooseOption, isPlaceholderOption } from "./options";

/**
 * Turns detected form fields into values, using only what the user has told
 * AutoApply: the Master Profile, the Answer Library, and answers they approved
 * for this application. Nothing is invented; a field with no source is left
 * blank (optional) or sent to the user (required).
 */

export interface ProfileFactsForForms {
  firstName?: string | null;
  lastName?: string | null;
  preferredName?: string | null;
  email?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
  country?: string | null;
  linkedinUrl?: string | null;
  portfolioUrl?: string | null;
  websiteUrl?: string | null;
  githubUrl?: string | null;
  currentTitle?: string | null;
  summary?: string | null;
  yearsExperience?: number | null;
  employment: Array<{ company: string; title: string; startDate: Date | string; endDate?: Date | string | null; isCurrent?: boolean }>;
  education: Array<{ school: string; degree?: string | null; major?: string | null; gpa?: number | null; graduationDate?: Date | string | null }>;
}

export interface LibraryAnswerForForms {
  id: string;
  questionKey: string;
  question: string;
  answer: string;
  confidence: number;
  autoSubmitAllowed: boolean;
  requiresHumanReview: boolean;
  isSensitive: boolean;
}

/** A question already recorded for this application on an earlier run. */
export interface StoredQuestionForForms {
  pageIndex: number;
  normalizedKey: string;
  status: "PENDING" | "ANSWERED" | "NEEDS_REVIEW" | "APPROVED" | "SKIPPED";
  answer: { value: string; approvedByUser: boolean } | null;
}

export interface ResolverInput {
  profile: ProfileFactsForForms;
  library: LibraryAnswerForForms[];
  stored: StoredQuestionForForms[];
  documents: { resume?: { fileName: string } | null; coverLetter?: { fileName: string } | null };
  /** 0..100 */
  fieldConfidenceThreshold: number;
  /** 0..100 */
  answerConfidenceThreshold: number;
  classifier?: FieldClassifier;
}

const LABELS: Partial<Record<ProfileFieldKey, string>> = {
  "masterProfile.firstName": "first name",
  "masterProfile.lastName": "last name",
  "masterProfile.fullName": "name",
  "masterProfile.email": "email",
  "masterProfile.phone": "phone number",
  "masterProfile.addressLine1": "street address",
  "masterProfile.city": "city",
  "masterProfile.state": "state",
  "masterProfile.postalCode": "ZIP code",
  "masterProfile.country": "country",
  "masterProfile.linkedinUrl": "LinkedIn URL",
  "masterProfile.portfolioUrl": "portfolio URL",
  "masterProfile.websiteUrl": "website",
  "masterProfile.githubUrl": "GitHub URL",
  "masterProfile.currentTitle": "current title",
  "masterProfile.currentCompany": "current company",
  "masterProfile.yearsExperience": "years of experience",
  "education.school": "school",
  "education.degree": "degree",
  "education.major": "major",
  "education.gpa": "GPA",
  "education.graduationDate": "graduation date",
};

const looksLikeYesNoQuestion = (label: string) => /^\s*(are|do|does|did|will|would|have|has|can|could|is|were|should|may)\b/i.test(label);

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);

/** Read one controlled-schema field from the profile. */
export function profileValue(key: ProfileFieldKey, p: ProfileFactsForForms): string | null {
  const current = p.employment.find((e) => e.isCurrent) ?? p.employment[0];
  const school = p.education[0];
  const v = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
  switch (key) {
    case "masterProfile.firstName": return v(p.firstName);
    case "masterProfile.lastName": return v(p.lastName);
    case "masterProfile.fullName": return p.firstName && p.lastName ? `${p.firstName.trim()} ${p.lastName.trim()}` : null;
    case "masterProfile.preferredName": return v(p.preferredName);
    case "masterProfile.email": return v(p.email);
    case "masterProfile.phone": return v(p.phone);
    case "masterProfile.addressLine1": return v(p.addressLine1);
    case "masterProfile.addressLine2": return v(p.addressLine2);
    case "masterProfile.city": return v(p.city);
    case "masterProfile.state": return v(p.state);
    case "masterProfile.postalCode": return v(p.postalCode);
    case "masterProfile.country": return v(p.country);
    case "masterProfile.linkedinUrl": return v(p.linkedinUrl);
    case "masterProfile.portfolioUrl": return v(p.portfolioUrl);
    case "masterProfile.websiteUrl": return v(p.websiteUrl);
    case "masterProfile.githubUrl": return v(p.githubUrl);
    case "masterProfile.currentTitle": return v(p.currentTitle) ?? (current?.isCurrent ? current.title : null);
    case "masterProfile.currentCompany": return current?.isCurrent ? current.company : null;
    case "masterProfile.yearsExperience":
      if (p.yearsExperience != null) return String(p.yearsExperience);
      return p.employment.length ? String(Math.floor(computeYearsOfExperience(p.employment))) : null;
    case "masterProfile.summary": return v(p.summary);
    case "education.school": return v(school?.school);
    case "education.degree": return v(school?.degree);
    case "education.major": return v(school?.major);
    case "education.gpa": return school?.gpa != null ? String(school.gpa) : null;
    case "education.graduationDate": return iso(school?.graduationDate);
    default: return null;
  }
}

export class FieldResolver {
  private readonly classifier: FieldClassifier;
  constructor(private readonly input: ResolverInput) {
    this.classifier = input.classifier ?? new HeuristicFieldClassifier();
  }

  async resolve(field: DetectedField): Promise<FieldMapping> {
    const key = field.key ?? field.label;
    const base = { field, detectedLabel: field.label };
    const stored = this.input.stored.find((q) => q.pageIndex === field.pageIndex && q.normalizedKey === key);

    // A decision the user made for this application always wins.
    if (stored?.status === "SKIPPED") {
      return { ...base, mappedField: "unknown", value: null, confidence: 100, source: "user", status: "SKIPPED", autoSubmitAllowed: true };
    }
    const classification = await this.classifier.classify(field);
    if (stored?.status === "APPROVED" && stored.answer) {
      return this.withOption({ ...base, mappedField: classification.mappedField, questionKey: classification.questionKey, value: stored.answer.value, confidence: 100, source: "user", status: "ANSWERED", autoSubmitAllowed: true });
    }

    switch (classification.mappedField) {
      case "documents.resume":
      case "documents.coverLetter":
        return this.resolveDocument(field, classification);
      case "answer.library":
        return this.resolveLibrary(field, classification);
      case "unknown":
        return this.resolveUnknown(field);
      default:
        return this.resolveProfile(field, classification);
    }
  }

  private resolveDocument(field: DetectedField, c: Classification): FieldMapping {
    const doc = c.mappedField === "documents.resume" ? this.input.documents.resume : this.input.documents.coverLetter;
    const what = c.mappedField === "documents.resume" ? "resume" : "cover letter";
    const base = { field, detectedLabel: field.label, mappedField: c.mappedField, autoSubmitAllowed: true };
    if (doc) return { ...base, value: doc.fileName, confidence: c.confidence, source: "profile", status: "ANSWERED" };
    if (field.required) return { ...base, value: null, confidence: 0, source: "none", status: "NEEDS_REVIEW", reviewReason: `This application requires a ${what}. Upload one in Documents, then approve to continue.` };
    return { ...base, value: null, confidence: c.confidence, source: "none", status: "SKIPPED" };
  }

  private resolveProfile(field: DetectedField, c: Classification): FieldMapping {
    const value = profileValue(c.mappedField, this.input.profile);
    const base = { field, detectedLabel: field.label, mappedField: c.mappedField, autoSubmitAllowed: true } as const;
    if (value == null) {
      if (!field.required) return { ...base, value: null, confidence: c.confidence, source: "none", status: "SKIPPED" };
      return { ...base, value: null, confidence: 0, source: "none", status: "NEEDS_REVIEW", reviewReason: `Your Master Profile has no ${LABELS[c.mappedField] ?? "value for this field"}.` };
    }
    return this.withOption(this.gate({ ...base, value, confidence: c.confidence, source: "profile", status: "ANSWERED" }, this.input.fieldConfidenceThreshold));
  }

  private resolveLibrary(field: DetectedField, c: Classification): FieldMapping {
    const key = field.key ?? "";
    const answer = this.input.library.find((a) => a.questionKey === c.questionKey) ?? this.input.library.find((a) => a.questionKey === key);
    const base = { field, detectedLabel: field.label, mappedField: "answer.library" as const, questionKey: c.questionKey };
    if (answer && answer.answer.trim()) {
      const mapping: FieldMapping = {
        ...base,
        value: answer.answer,
        confidence: Math.min(c.confidence, answer.confidence),
        source: "library",
        status: "ANSWERED",
        libraryAnswerId: answer.id,
        sensitive: answer.isSensitive,
        autoSubmitAllowed: answer.autoSubmitAllowed && !answer.requiresHumanReview,
      };
      // A yes/no answer typed into a box that asks for more than yes or no is a mismatch, not an answer.
      if ((field.kind === "text" || field.kind === "textarea") && answerMeansYes(answer.answer) !== null && !looksLikeYesNoQuestion(field.label)) {
        return { ...mapping, status: "NEEDS_REVIEW", reviewReason: `Your saved answer "${answer.answer}" doesn't fit this question.` };
      }
      const gated = this.withOption(this.gate(mapping, this.input.answerConfidenceThreshold));
      if (answer.requiresHumanReview && gated.status === "ANSWERED") {
        return { ...gated, status: "NEEDS_REVIEW", reviewReason: "Your Answer Library marks this answer for review before it's sent." };
      }
      return gated;
    }
    const derived = c.questionKey ? deriveAnswerFromProfile(c.questionKey, this.input.profile) : null;
    if (derived) {
      return this.withOption(
        this.gate({ ...base, value: derived.answer, confidence: Math.round(Math.min(c.confidence, derived.confidence * 100)), source: "profile", status: "ANSWERED", autoSubmitAllowed: true }, this.input.answerConfidenceThreshold),
      );
    }
    if (!field.required) return { ...base, value: null, confidence: c.confidence, source: "none", status: "SKIPPED", autoSubmitAllowed: true };
    return { ...base, value: null, confidence: 0, source: "none", status: "NEEDS_REVIEW", reviewReason: "No saved answer for this question. Answer it once and AutoApply can reuse it.", autoSubmitAllowed: false };
  }

  private resolveUnknown(field: DetectedField): FieldMapping {
    const key = field.key ?? "";
    const saved = this.input.library.find((a) => a.questionKey === key);
    if (saved) return this.resolveLibrary(field, { mappedField: "answer.library", confidence: 95, questionKey: saved.questionKey, evidence: "Saved answer" });
    const base = { field, detectedLabel: field.label, mappedField: "unknown" as const, value: null, source: "none" as const, autoSubmitAllowed: false };
    if (!field.required) return { ...base, confidence: 0, status: "SKIPPED", autoSubmitAllowed: true };
    return { ...base, confidence: 0, status: "NEEDS_REVIEW", reviewReason: "AutoApply doesn't recognize this question and won't guess. Answer it to continue." };
  }

  /** Apply the review threshold for this kind of value. */
  private gate(mapping: FieldMapping, threshold: number): FieldMapping {
    if (requiresReview(mapping, threshold)) {
      return { ...mapping, status: "NEEDS_REVIEW", reviewReason: mapping.reviewReason ?? `Confidence ${mapping.confidence}% is below your ${threshold}% review threshold.` };
    }
    return mapping;
  }

  /** For dropdowns, radios and checkboxes, translate the value into one of the field's options. */
  private withOption(mapping: FieldMapping): FieldMapping {
    const { field } = mapping;
    if (mapping.value == null || Array.isArray(mapping.value)) return mapping;
    if (field.kind === "checkbox" && !field.multiple) {
      const yes = answerMeansYes(mapping.value);
      if (yes == null) return { ...mapping, status: "NEEDS_REVIEW", reviewReason: `"${mapping.value}" isn't a clear yes or no for this checkbox.` };
      return { ...mapping, value: yes ? "Yes" : "No" };
    }
    if (field.kind === "checkbox" && field.multiple) {
      const wanted = mapping.value.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
      const picked = wanted.map((w) => chooseOption(w, field.options ?? [])).filter((m): m is NonNullable<typeof m> => !!m);
      if (!picked.length || picked.length < wanted.length) {
        return { ...mapping, status: "NEEDS_REVIEW", reviewReason: "The saved answer doesn't match the choices on this form." };
      }
      return { ...mapping, value: picked.map((p) => p.option), confidence: Math.min(mapping.confidence, ...picked.map((p) => p.confidence)) };
    }
    if (field.kind !== "select" && field.kind !== "radio") return mapping;
    const options = (field.options ?? []).filter((o) => !isPlaceholderOption(o));
    const match = chooseOption(mapping.value, options);
    if (!match) {
      return { ...mapping, status: "NEEDS_REVIEW", reviewReason: `"${mapping.value}" doesn't match any of the choices: ${options.slice(0, 8).join(", ")}.` };
    }
    const confidence = Math.min(mapping.confidence, match.confidence);
    const threshold = mapping.source === "library" ? this.input.answerConfidenceThreshold : this.input.fieldConfidenceThreshold;
    const next: FieldMapping = { ...mapping, value: match.option, confidence };
    if (mapping.source !== "user" && confidence < threshold && next.status === "ANSWERED") {
      return { ...next, status: "NEEDS_REVIEW", reviewReason: `Picked "${match.option}" for "${mapping.value}" with ${confidence}% confidence.` };
    }
    return next;
  }
}

/** Facts from a FullProfile-shaped object, ready for the resolver. */
export function toProfileFacts(p: {
  firstName?: string | null; lastName?: string | null; preferredName?: string | null; email?: string | null; phone?: string | null;
  addressLine1?: string | null; addressLine2?: string | null; city?: string | null; state?: string | null; postalCode?: string | null; country?: string | null;
  linkedinUrl?: string | null; portfolioUrl?: string | null; websiteUrl?: string | null; githubUrl?: string | null; currentTitle?: string | null; summary?: string | null;
  yearsExperience?: number | null;
  employment: ProfileFactsForForms["employment"];
  education: ProfileFactsForForms["education"];
}): ProfileFactsForForms {
  return { ...p, employment: p.employment, education: p.education };
}
