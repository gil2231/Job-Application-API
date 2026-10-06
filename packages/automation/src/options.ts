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

const PLACEHOLDER = /^(select|choose|please select|please choose|--|—|-|none selected|pick one)\b/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+%]+/g, " ").trim();

/** Options a person would never mean to pick (the "Select…" prompt). */
export function isPlaceholderOption(option: string): boolean {
  return option.trim() === "" || PLACEHOLDER.test(option.trim());
}

const YES = /^(yes|y|true|i am|i do|i will|i have|authorized|i agree|agree)\b/;
const NO = /^(no|n|false|i am not|i do not|i don t|i will not|i won t|not)\b/;

function polarity(text: string): "yes" | "no" | null {
  const t = norm(text);
  if (NO.test(t)) return "no";
  if (YES.test(t)) return "yes";
  return null;
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
  return null;
}

/** Whether a free-text answer means yes, for single checkboxes ("I agree…"). */
export function answerMeansYes(value: string): boolean | null {
  const p = polarity(value);
  return p === "yes" ? true : p === "no" ? false : null;
}
