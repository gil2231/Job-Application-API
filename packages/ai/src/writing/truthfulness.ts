import { canonicalSkillKey } from "@autoapply/shared";
import { detectSkills } from "../job-analysis/heuristic";
import { profileSkillNames, type WritingJob, type WritingProfile } from "./profile";

/**
 * Deterministic checks that generated text claims nothing the Master Profile
 * doesn't support. They are deliberately strict: text that fails is replaced
 * by the template version rather than shown to the person. The checks cover
 * numbers, skills and tools, credentials, and employers or schools.
 */

const CREDENTIALS =
  /\b(ph\.?\s?d|doctorate|doctoral|mba|m\.?b\.?a|master'?s|bachelor'?s|associate'?s degree|b\.?s\.?|b\.?a\.?|m\.?s\.?|j\.?d\.?|m\.?d\.?|certified|certification|certificate|licensed|license|cpa|pmp|cfa|cissp|series \d+|security clearance|clearance|fluent|bilingual|native speaker|award|awarded|patent|published|publication)\b/gi;

/** Degree names written different ways; the profile only has to show one of them. */
const DEGREE_FAMILIES: Array<{ pattern: RegExp; evidence: RegExp[] }> = [
  { pattern: /^(bachelor'?s|b\.?s\.?|b\.?a\.?)$/i, evidence: [/\bbachelor/, /\bb ?s\b/, /\bb ?a\b/, /\bbsc\b/, /\bbba\b/] },
  { pattern: /^(master'?s|m\.?s\.?)$/i, evidence: [/\bmaster/, /\bm ?s\b/, /\bm ?a\b/, /\bmsc\b/, /\bmba\b/] },
  { pattern: /^(mba|m\.?b\.?a)$/i, evidence: [/\bmba\b/, /\bm b a\b/, /\bmaster of business administration\b/] },
  { pattern: /^(ph\.?\s?d|doctorate|doctoral)$/i, evidence: [/\bph ?d\b/, /\bdoctor/] },
];

/** Words that introduce an organization: "at Stripe", "joined Acme Corp". */
const ORG_CONTEXT = /\b(?:at|for|with|from|joined|by|within)\s+((?:[A-Z][\w&.'-]*|&)(?:\s+(?:[A-Z][\w&.'-]*|&|of|and))*)/g;

/** Capitalized words that are normal at the start of a phrase, not organizations. */
const COMMON_CAPITALIZED = new Set(["I", "I'm", "I've", "My", "The", "This", "That", "A", "An", "Our", "Your", "Thank", "Dear", "Sincerely", "Best", "Regards", "In", "As", "It", "We", "You"]);

const NUMBER = /\$?\d[\d,]*(?:\.\d+)?\s*(?:%|\+|k\b|m\b|million|billion)?/gi;
const MULTIPLIER: Record<string, number> = { k: 1e3, m: 1e6, million: 1e6, billion: 1e9 };
/** "$1.2M" and "1,200,000" are the same figure; "3" and "$3M" are not. */
const normalizeNumber = (raw: string) => {
  const digits = raw.replace(/[^\d.]/g, "").replace(/\.$/, "");
  if (!digits) return null;
  const unit = /(k|m|million|billion)\s*$/i.exec(raw.trim())?.[1]?.toLowerCase();
  return String(Number(digits) * (unit ? MULTIPLIER[unit]! : 1));
};
const numbersIn = (text: string) => [...text.matchAll(NUMBER)].map((m) => normalizeNumber(m[0])).filter((n): n is string => !!n);

const lower = (s: string) => s.toLowerCase();
const squash = (s: string) => lower(s).replace(/[^a-z0-9%]+/g, " ").trim();

/** All text the person has given Applyance, used as the source of truth. */
function sourceText(profile: WritingProfile, factSheet: string): string {
  return squash([factSheet, ...profile.skills.map((s) => s.name)].join(" "));
}

export interface ClaimCheck {
  ok: boolean;
  /** What isn't supported, in words a person can read. */
  problems: string[];
}

export function checkClaims(text: string, ctx: { profile: WritingProfile; job: WritingJob; factSheet: string }): ClaimCheck {
  const problems: string[] = [];
  const source = sourceText(ctx.profile, ctx.factSheet);
  const jobText = squash(`${ctx.job.title} ${ctx.job.company}`);
  const supported = (phrase: string) => {
    const p = squash(phrase);
    return !p || ` ${source} `.includes(` ${p} `) || ` ${jobText} `.includes(` ${p} `);
  };

  // Numbers: every figure must come from the profile (dates, counts, percentages, GPA, years).
  // Bullet ids like [r1.b2] are labels, not facts.
  const known = new Set([...numbersIn(ctx.factSheet.replace(/\[r\d+(?:\.b\d+)?\]/g, " ")), ...numbersIn(`${ctx.job.title} ${ctx.job.company}`)]);
  for (const m of text.matchAll(NUMBER)) {
    const n = normalizeNumber(m[0]);
    if (n && !known.has(n)) problems.push(`the figure "${m[0].trim()}"`);
  }

  // Skills and tools: anything recognizable as a skill must be one the profile shows.
  const owned = new Set(profileSkillNames(ctx.profile).map(canonicalSkillKey));
  for (const skill of detectSkills(text)) {
    if (!owned.has(canonicalSkillKey(skill)) && !supported(skill)) problems.push(`the skill "${skill}"`);
  }

  // Credentials, honors and languages.
  for (const m of text.matchAll(CREDENTIALS)) {
    const family = DEGREE_FAMILIES.find((f) => f.pattern.test(m[0]));
    const ok = family ? family.evidence.some((e) => e.test(source)) : supported(m[0]);
    if (!ok) problems.push(`"${m[0]}"`);
  }

  // Organizations named after "at", "for", "with" and similar.
  for (const m of text.matchAll(ORG_CONTEXT)) {
    const words = m[1]!.split(/\s+/).filter((w) => !COMMON_CAPITALIZED.has(w));
    while (words.length && /^(of|and|&)$/.test(words[words.length - 1]!)) words.pop();
    // "with Salesforce and HubSpot" names two things; skills were checked above.
    for (const name of words.join(" ").replace(/[.,;:]+$/, "").split(/\s+and\s+/)) {
      if (!name || supported(name) || detectSkills(name).length) continue;
      problems.push(`"${name}"`);
    }
  }

  const unique = [...new Set(problems)];
  return { ok: unique.length === 0, problems: unique };
}

export function describeProblems(problems: string[]): string {
  const shown = problems.slice(0, 3).join(", ");
  return `AI text mentioned ${shown}${problems.length > 3 ? ` and ${problems.length - 3} more` : ""}, which your Master Profile doesn't support`;
}
