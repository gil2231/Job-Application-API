import { isPlaceholderOption } from "@autoapply/shared";

/**
 * Picking the right option in a dropdown or radio group for a value from the
 * profile or Answer Library. Returns null rather than a near miss, so an
 * option that doesn't clearly match goes to a person.
 */

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey", NM: "New Mexico",
  NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island",
  SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont", VA: "Virginia", WA: "Washington",
  WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

const COUNTRY_ALIASES: string[][] = [
  ["united states", "united states of america", "usa", "us", "u s", "u s a", "america"],
  ["united kingdom", "uk", "u k", "great britain", "england"],
  ["canada", "ca"],
];

/** "I don't wish to answer", "Decline to self-identify": a choice not to say, never a yes or a no. */
const DECLINE = /\b(wish to (answer|disclose|self identify|identify)|want to (answer|disclose|self identify|identify)|decline|prefer not|choose not|rather not|not to (answer|disclose|say|self identify|identify))\b/;

/** Degree levels, so "Bachelor of Science" finds "Bachelor's Degree". Abbreviations count only at the start ("BS in Finance"). */
const DEGREE_LEVELS: Array<[string, RegExp]> = [
  ["doctorate", /\b(doctor\w*|ph ?d)\b|^(d ?phil|ed ?d)\b/],
  ["master", /\bmaster\w*|^(m ?s|m ?sc|m ?a|m ?b ?a|m ?eng|mfa|mph|m ?ed)\b/],
  ["bachelor", /\bbachelor\w*|\bundergraduate degree\b|^(b ?s|b ?sc|b ?a|b ?b ?a|b ?eng|bfa)\b/],
  ["associate", /\bassociate\w*( s)? (degree|of)\b|^associate\w*$|^aas\b/],
  ["high school", /\b(high school|ged|secondary school)\b/],
];

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+%]+/g, " ").trim();

export { isPlaceholderOption };

const YES = /^(yes|y|true|i am|i do|i will|i have|authorized|i agree|agree|i acknowledge|acknowledged?|i accept|i certify|i confirm|i understand|i consent)\b/;
const NO = /^(no|n|false|i am not|i do not|i don t|i will not|i won t|not)\b/;

function polarity(text: string): "yes" | "no" | "decline" | null {
  const t = norm(text);
  if (DECLINE.test(t)) return "decline";
  if (NO.test(t)) return "no";
  if (YES.test(t)) return "yes";
  return null;
}

const degreeLevel = (text: string) => DEGREE_LEVELS.find(([, pattern]) => pattern.test(norm(text)))?.[0] ?? null;

/** A US state, by its two-letter code or its name. */
export function isUsState(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  return !!US_STATES[value.trim().toUpperCase()] || Object.values(US_STATES).some((name) => norm(name) === norm(value));
}

export interface OptionMatch {
  option: string;
  /** 0..100 */
  confidence: number;
}

export function chooseOption(value: string, options: string[]): OptionMatch | null {
  const candidates = options.filter((o) => !isPlaceholderOption(o));
  if (!candidates.length || !value.trim()) return null;
  const v = norm(value);

  const exact = candidates.find((o) => norm(o) === v);
  if (exact) return { option: exact, confidence: 100 };

  // US states: "NY" ↔ "New York".
  const stateName = US_STATES[value.trim().toUpperCase()];
  const stateCode = Object.entries(US_STATES).find(([, name]) => norm(name) === v)?.[0];
  for (const o of candidates) {
    if (stateName && norm(o) === norm(stateName)) return { option: o, confidence: 100 };
    if (stateCode && norm(o) === stateCode.toLowerCase()) return { option: o, confidence: 100 };
  }

  // Countries with common aliases.
  const aliasGroup = COUNTRY_ALIASES.find((g) => g.includes(v));
  if (aliasGroup) {
    const o = candidates.find((c) => aliasGroup.includes(norm(c)));
    if (o) return { option: o, confidence: 95 };
  }

  // Yes / No answers against longer option wording ("Yes, I am authorized").
  const want = polarity(value);
  if (want) {
    const matching = candidates.filter((o) => polarity(o) === want);
    if (matching.length === 1) return { option: matching[0]!, confidence: 90 };
  }

  // Numbers against ranges ("4" → "3-5 years", "10" → "10+ years").
  const num = Number.parseFloat(value.replace(/[^0-9.]/g, ""));
  if (Number.isFinite(num) && /^[\s$]*[0-9.,]+\s*(years?|yrs?)?\s*$/i.test(value)) {
    for (const o of candidates) {
      const range = o.match(/(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)/);
      if (range && num >= Number(range[1]) && num <= Number(range[2])) return { option: o, confidence: 90 };
      const plus = o.match(/(\d+(?:\.\d+)?)\s*\+/);
      if (plus && num >= Number(plus[1])) return { option: o, confidence: 85 };
      const less = o.match(/(?:less than|under|<)\s*(\d+(?:\.\d+)?)/i);
      if (less && num < Number(less[1])) return { option: o, confidence: 85 };
    }
  }

  // One option clearly containing the value (or the reverse), e.g. "Bachelor's" ↔ "Bachelor's Degree".
  if (v.length >= 3) {
    const containing = candidates.filter((o) => {
      const n = norm(o);
      return n.includes(v) || (n.length >= 3 && v.includes(n));
    });
    if (containing.length === 1) return { option: containing[0]!, confidence: 80 };
  }

  // The same degree level in other words: "Bachelor of Science" ↔ "Bachelor's Degree".
  const level = degreeLevel(value);
  if (level) {
    const same = candidates.filter((o) => degreeLevel(o) === level);
    if (same.length === 1) return { option: same[0]!, confidence: 90 };
    // "MS" is a master's degree but not an MBA, and the other way round.
    const mba = (text: string) => /\b(m ?b ?a|business administration)\b/.test(norm(text));
    const kind = same.filter((o) => mba(o) === mba(value));
    if (kind.length === 1) return { option: kind[0]!, confidence: 90 };
  }
  return null;
}

const US_COUNTRY = COUNTRY_ALIASES[0]!;

/** The state a place option names, as a two-letter code ("Bronx, Idaho, United States" → "ID"). */
function statesIn(parts: string[]): string[] {
  return parts.flatMap((p) => Object.entries(US_STATES).filter(([code, name]) => p === norm(name) || p === code.toLowerCase()).map(([code]) => code));
}

const stateCode = (state: string | null | undefined) => {
  if (!state?.trim()) return null;
  const code = state.trim().toUpperCase();
  if (US_STATES[code]) return code;
  return Object.entries(US_STATES).find(([, name]) => norm(name) === norm(state))?.[0] ?? null;
};

/**
 * Pick a search box's suggestion for a typed value: the one that names it
 * ("Bronx, United States" for "Bronx"), never one that merely starts the same
 * way ("Bronxville"). For places, suggestions in another US state than the
 * profile's are left out and one in the profile's state is preferred. Returns
 * null when it isn't clear which is meant.
 */
export function chooseSuggestion(value: string, options: string[], place?: { state?: string | null; country?: string | null }): OptionMatch | null {
  const candidates = options.filter((o) => !isPlaceholderOption(o));
  if (!candidates.length || !value.trim()) return null;
  const exact = candidates.find((o) => norm(o) === norm(value));
  if (exact) return { option: exact, confidence: 100 };

  // "Fordham University, Gabelli School of Business" names the same place as "Fordham University".
  const head = norm(value.split(",")[0]!);
  const parts = (o: string) => o.split(",").map(norm).filter(Boolean);
  const home = stateCode(place?.state);
  const abroad = !!place?.country && !US_COUNTRY.includes(norm(place.country));
  const named = candidates.filter((o) => {
    const [first, ...rest] = parts(o);
    if (first !== head) return false;
    const states = statesIn(rest);
    // A suggestion in another US state (or in the US at all, for someone abroad) is a different place.
    return !(home && states.some((s) => s !== home)) && !(abroad && (states.length || rest.some((r) => US_COUNTRY.includes(r))));
  });
  const inHomeState = home ? named.filter((o) => statesIn(parts(o).slice(1)).includes(home)) : [];
  if (inHomeState.length === 1) return { option: inHomeState[0]!, confidence: 95 };
  if (named.length === 1) return { option: named[0]!, confidence: 90 };
  if (named.length > 1) return null;

  // Aliases, states, yes/no and degree levels; a value merely contained in a suggestion isn't enough here.
  const match = chooseOption(value, candidates);
  return match && match.confidence > 80 ? match : null;
}

/** A choice that is itself a consent ("By clicking this box…, you consent to our Applicant Privacy Statement."). */
export function isConsentStatement(option: string): boolean {
  return /\b(consent|acknowledge|agree|certify|accept|authori[sz]e)\b/i.test(option) && !/\b(do not|don't|not)\b/i.test(option);
}

/** Whether a free-text answer means yes, for single checkboxes ("I agree…"). */
export function answerMeansYes(value: string): boolean | null {
  const p = polarity(value);
  return p === "yes" ? true : p === "no" ? false : null;
}
