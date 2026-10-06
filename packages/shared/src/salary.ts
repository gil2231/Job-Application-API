export type SalaryPeriod = "HOUR" | "DAY" | "WEEK" | "MONTH" | "YEAR";

export interface ParsedSalary {
  min: number;
  max: number;
  currency: string;
  period: SalaryPeriod;
  /** Annualized values (40h week, 52 weeks) for comparison against rules. */
  annualMin: number;
  annualMax: number;
}

const CURRENCY_SYMBOLS: Record<string, string> = { $: "USD", "£": "GBP", "€": "EUR", "¥": "JPY", "₹": "INR" };
const CURRENCY_CODES = ["USD", "CAD", "AUD", "GBP", "EUR", "INR", "JPY", "CHF", "SGD", "NZD"];

const PERIOD_PATTERNS: Array<[RegExp, SalaryPeriod]> = [
  [/\b(per|an|\/|a)\s*(hour|hr)\b|\bhourly\b|\/\s*hr\b|\/\s*hour\b/i, "HOUR"],
  [/\b(per|a|\/)\s*day\b|\bdaily\b/i, "DAY"],
  [/\b(per|a|\/)\s*week\b|\bweekly\b/i, "WEEK"],
  [/\b(per|a|\/)\s*(month|mo)\b|\bmonthly\b/i, "MONTH"],
  [/\b(per|a|\/)\s*(year|yr|annum)\b|\bannual(ly)?\b|\byearly\b|\bp\.?a\.?\b/i, "YEAR"],
];

const ANNUAL_MULTIPLIER: Record<SalaryPeriod, number> = {
  HOUR: 40 * 52,
  DAY: 5 * 52,
  WEEK: 52,
  MONTH: 12,
  YEAR: 1,
};

// A number with optional thousands separators/decimals and an optional k/m suffix.
const AMOUNT = /(\d{1,3}(?:[,\s]\d{3})+|\d+(?:\.\d+)?)\s*([kKmM])?(?![\w])/g;

function toNumber(raw: string, suffix: string | undefined): number {
  const value = Number(raw.replace(/[,\s]/g, ""));
  if (!suffix) return value;
  return suffix.toLowerCase() === "k" ? value * 1_000 : value * 1_000_000;
}

/**
 * Parse free-text compensation ("$70,000 – $80,000 a year", "45-55/hr", "£60k")
 * into a normalized range. Returns null when no plausible salary is present,
 * rather than guessing.
 */
export function parseSalary(text: string | null | undefined): ParsedSalary | null {
  if (!text) return null;
  const input = text.trim();
  if (!input) return null;

  let currency = "USD";
  const code = CURRENCY_CODES.find((c) => new RegExp(`\\b${c}\\b`, "i").test(input));
  if (code) currency = code;
  else {
    const symbol = Object.keys(CURRENCY_SYMBOLS).find((s) => input.includes(s));
    if (symbol) currency = CURRENCY_SYMBOLS[symbol]!;
  }

  const amounts: number[] = [];
  for (const match of input.matchAll(AMOUNT)) {
    const n = toNumber(match[1]!, match[2]);
    if (Number.isFinite(n) && n > 0) amounts.push(n);
  }
  if (amounts.length === 0) return null;

  // "70-80k" means 70k-80k: apply a trailing suffix to a bare leading number.
  if (amounts.length >= 2 && /\d\s*[-–—to]+\s*\d+(?:\.\d+)?\s*[kK]\b/.test(input) && amounts[0]! < 1000 && amounts[1]! >= 1000) {
    amounts[0] = amounts[0]! * 1000;
  }

  const [first, second] = amounts;
  let min = first!;
  let max = second !== undefined && second >= first! ? second : first!;
  if (second !== undefined && second < first!) {
    min = second;
    max = first!;
  }

  let period: SalaryPeriod | undefined;
  for (const [pattern, p] of PERIOD_PATTERNS) {
    if (pattern.test(input)) {
      period = p;
      break;
    }
  }
  // Without an explicit period, infer from magnitude: small numbers are hourly.
  if (!period) period = max < 500 ? "HOUR" : "YEAR";

  // Reject values that cannot be a salary for the detected period (e.g. "2 years experience").
  if (period === "YEAR" && max < 1000) return null;

  const multiplier = ANNUAL_MULTIPLIER[period];
  return {
    min,
    max,
    currency,
    period,
    annualMin: Math.round(min * multiplier),
    annualMax: Math.round(max * multiplier),
  };
}

const compact = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1, notation: "compact" });

export function formatSalaryRange(
  min: number | null | undefined,
  max: number | null | undefined,
  currency = "USD",
  period: SalaryPeriod | null = "YEAR",
): string {
  if (min == null && max == null) return "—";
  const symbol = Object.entries(CURRENCY_SYMBOLS).find(([, c]) => c === currency)?.[0] ?? `${currency} `;
  const fmt = (n: number) => (period === "HOUR" ? n.toFixed(n % 1 === 0 ? 0 : 2) : compact.format(n));
  const suffix = period === "HOUR" ? "/hr" : "";
  if (min != null && max != null && min !== max) return `${symbol}${fmt(min)}–${symbol}${fmt(max)}${suffix}`;
  return `${symbol}${fmt((min ?? max)!)}${suffix}`;
}
