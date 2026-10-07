import { FIELD_LABEL_SYNONYMS, normalizeQuestionKey, type ProfileFieldKey } from "@autoapply/shared";
import type { DetectedField } from "./fields";

/**
 * Deterministic field classification: maps a form field onto the controlled
 * Master Profile schema (or onto a standard Answer Library question) using
 * labels, autocomplete tokens and attribute names. No guessing: anything that
 * doesn't clearly match is "unknown" and goes to a person. The AI classifier in
 * @autoapply/ai layers on top of this one through the FieldClassifier interface.
 */

export interface Classification {
  mappedField: ProfileFieldKey;
  /** 0..100 */
  confidence: number;
  /** Set when mappedField is "answer.library": the standard question key it matched. */
  questionKey?: string;
  evidence: string;
  /** Which classifier decided; absent means the heuristic one. */
  method?: "heuristic" | "ai";
}

export interface FieldClassifier {
  classify(field: DetectedField): Classification | Promise<Classification>;
}

/** Lowercase, drop required markers, punctuation and filler so labels compare cleanly. */
export function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/\((required|optional)\)/g, " ")
    .replace(/[*:?]/g, " ")
    .replace(/[^a-z0-9/+&' -]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const AUTOCOMPLETE: Record<string, ProfileFieldKey> = {
  "given-name": "masterProfile.firstName",
  "family-name": "masterProfile.lastName",
  name: "masterProfile.fullName",
  nickname: "masterProfile.preferredName",
  email: "masterProfile.email",
  tel: "masterProfile.phone",
  "tel-national": "masterProfile.phone",
  "address-line1": "masterProfile.addressLine1",
  "street-address": "masterProfile.addressLine1",
  "address-line2": "masterProfile.addressLine2",
  "address-level2": "masterProfile.city",
  "address-level1": "masterProfile.state",
  "postal-code": "masterProfile.postalCode",
  country: "masterProfile.country",
  "country-name": "masterProfile.country",
  "organization-title": "masterProfile.currentTitle",
  organization: "masterProfile.currentCompany",
};

const ATTRIBUTE_TOKENS: Array<[RegExp, ProfileFieldKey]> = [
  [/^(first_?name|fname|given_?name)$/, "masterProfile.firstName"],
  [/^(last_?name|lname|surname|family_?name)$/, "masterProfile.lastName"],
  [/^(full_?name|name)$/, "masterProfile.fullName"],
  [/^e?_?mail(_?address)?$/, "masterProfile.email"],
  [/^(phone|phone_?number|mobile|telephone|tel|cell)$/, "masterProfile.phone"],
  [/^(city|town)$/, "masterProfile.city"],
  [/^(state|province|region)$/, "masterProfile.state"],
  [/^(zip|zip_?code|postal_?code|postcode)$/, "masterProfile.postalCode"],
  [/^country$/, "masterProfile.country"],
  [/^(linkedin|linkedin_?url|linkedin_?profile)$/, "masterProfile.linkedinUrl"],
  [/^(portfolio|portfolio_?url)$/, "masterProfile.portfolioUrl"],
  [/^(website|website_?url|personal_?website)$/, "masterProfile.websiteUrl"],
  [/^(github|github_?url)$/, "masterProfile.githubUrl"],
  [/^(resume|cv|resume_?file)$/, "documents.resume"],
  [/^(cover_?letter|coverletter)$/, "documents.coverLetter"],
];

/** Labels with these words describe someone or something other than the applicant. */
const NEGATIVE = /\b(reference|referee|referr|emergency|manager|supervisor|previous|former|recruiter|company name|employer name|school name|hiring|spouse|parent|guardian)\b/;

/** Single words too generic to match inside a longer label. */
const NO_PARTIAL = new Set(["name", "cell", "street", "state", "region", "apt", "suite", "employer", "website", "address", "town", "mobile", "phone", "email", "city", "country", "portfolio", "zip"]);

/** Standard questions recognized by wording, keyed like STANDARD_QUESTIONS. */
const QUESTION_PATTERNS: Array<[RegExp, string]> = [
  [/(legally )?(authori[sz]ed|eligible) to work|work authori[sz]ation|right to work/, "work_authorization"],
  [/(require|need)s? (visa |immigration |employment )?sponsor|sponsorship/, "sponsorship"],
  [/(willing|open|able|prepared) to relocat|consider relocat|relocation (is )?(possible|an option)|^relocat\w*\??$/, "relocation"],
  [/willing(ness)? to travel|travel requirement|\btravel\b.*%|percentage of travel/, "travel"],
  [/salary|compensation|pay expectation|desired pay|expected pay/, "salary_expectations"],
  [/why (do )?you want to (work|join)|why (are you interested in|this) (company|us)|why .*\b(work here|join us)\b/, "why_company"],
  [/why (are you interested in|do you want) (this|the) (role|position|job)|interest(ed)? in (this|the) (role|position)/, "why_role"],
  [/good fit|why should we hire|what makes you (a )?(great|good|strong)/, "why_fit"],
  [/years of sales|sales experience/, "sales_experience"],
  [/(people )?manage(ment|rial)? experience|years (of )?(managing|management)|direct reports/, "management_experience"],
  [/(how many )?years of (professional |relevant |work )?experience|total experience/, "years_experience"],
  [/start date|when can you start|available to start|earliest start|notice period/, "start_date"],
  [/\bgender\b|\bsex\b/, "demographic_gender"],
  [/\brace\b|ethnicity|hispanic|latino/, "demographic_race"],
  [/veteran/, "demographic_veteran"],
  [/\b(active|current(ly)?|serv(e|ed|ing)|member of|in) (the )?(us |u s )?(military|armed forces|national guard|reserves?)\b|\bactive duty\b|\bactive-duty\b|\bmilitary (service|status|member|experience)\b/, "military_status"],
  [/disabilit/, "demographic_disability"],
];

export function matchStandardQuestion(label: string): string | null {
  const text = normalizeLabel(label);
  for (const [pattern, key] of QUESTION_PATTERNS) {
    // A question about a spouse's or family member's service isn't about the applicant.
    if (key === "military_status" && /spouse|partner|dependent|family|parent|child/.test(text)) continue;
    if (pattern.test(text)) return key;
  }
  return null;
}

export class HeuristicFieldClassifier implements FieldClassifier {
  classify(field: DetectedField): Classification {
    const label = normalizeLabel(field.label);
    const hints = field.hints ?? {};

    if (field.kind === "file") {
      // Some sites label the input only "Attach" and name it by its id instead (Greenhouse: #resume, #cover_letter).
      const handle = `${hints.name ?? ""} ${hints.id ?? ""}`.toLowerCase();
      if (/cover/.test(label) || /cover/.test(handle)) return { mappedField: "documents.coverLetter", confidence: 95, evidence: "Cover letter upload" };
      if (/resume|résumé|\bcv\b|curriculum/.test(label) || /resume|cv/.test(handle)) return { mappedField: "documents.resume", confidence: 95, evidence: "Resume upload" };
      return { mappedField: "unknown", confidence: 0, evidence: `Unrecognized upload "${field.label}"` };
    }

    const negative = NEGATIVE.test(label);
    // Questions about authorization, sponsorship, salary, etc. come from the Answer Library, never the profile.
    const question = matchStandardQuestion(field.label);
    if (question && !negative) {
      return { mappedField: "answer.library", confidence: 90, questionKey: question, evidence: `Recognized as the standard "${question}" question` };
    }

    const auto = hints.autocomplete?.toLowerCase().split(/\s+/).pop();
    if (auto && AUTOCOMPLETE[auto] && !negative) return { mappedField: AUTOCOMPLETE[auto]!, confidence: 95, evidence: `autocomplete="${auto}"` };

    for (const [key, synonyms] of Object.entries(FIELD_LABEL_SYNONYMS) as Array<[ProfileFieldKey, string[]]>) {
      if (key.startsWith("documents.")) continue;
      if (synonyms.includes(label)) return { mappedField: key, confidence: 95, evidence: `Label "${field.label}"` };
    }
    if (!negative) {
      let best: { key: ProfileFieldKey; length: number } | null = null;
      for (const [key, synonyms] of Object.entries(FIELD_LABEL_SYNONYMS) as Array<[ProfileFieldKey, string[]]>) {
        if (key.startsWith("documents.")) continue;
        for (const synonym of synonyms) {
          if (NO_PARTIAL.has(synonym)) continue;
          if (new RegExp(`(^|\\s)${synonym.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(\\s|$)`).test(label) && (!best || synonym.length > best.length)) {
            best = { key, length: synonym.length };
          }
        }
      }
      if (best) return { mappedField: best.key, confidence: 85, evidence: `Label "${field.label}" contains a known phrase` };
    }

    for (const attr of [hints.name, hints.id]) {
      const token = attr?.toLowerCase().replace(/[-\s]/g, "_").replace(/^(applicant|candidate|user|input|field)_/, "");
      if (!token || negative) continue;
      for (const [pattern, key] of ATTRIBUTE_TOKENS) if (pattern.test(token)) return { mappedField: key, confidence: 80, evidence: `Field name "${attr}"` };
    }

    if (!negative && field.kind === "email") return { mappedField: "masterProfile.email", confidence: 80, evidence: "Email input" };
    if (!negative && field.kind === "phone") return { mappedField: "masterProfile.phone", confidence: 75, evidence: "Telephone input" };

    return { mappedField: "unknown", confidence: 0, evidence: `No profile field matches "${field.label}"` };
  }
}

/** Stable keys for the fields on one page: the normalized label, de-duplicated with a suffix. */
export function assignFieldKeys(fields: DetectedField[]): DetectedField[] {
  const seen = new Map<string, number>();
  return fields.map((f) => {
    const base = normalizeQuestionKey(f.label) || f.hints?.name || f.hints?.id || "field";
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...f, key: n === 1 ? base : `${base}_${n}` };
  });
}

/** A field label for people to read: without the trailing required marker ("Email *", "Phone (required)"). */
export function displayLabel(label: string): string {
  return label.replace(/\s*(?:[*✱]+|\(required\))\s*$/i, "").trim() || label;
}
