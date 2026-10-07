/** Dates as resumes write them: "Jan 2020", "January 2020", "01/2020", "2020", "Present". */

const MONTHS: Array<[RegExp, number]> = [
  [/^jan/i, 1],
  [/^feb/i, 2],
  [/^mar/i, 3],
  [/^apr/i, 4],
  [/^may/i, 5],
  [/^jun/i, 6],
  [/^jul/i, 7],
  [/^aug/i, 8],
  [/^sep/i, 9],
  [/^oct/i, 10],
  [/^nov/i, 11],
  [/^dec/i, 12],
];

const MONTH_NAME = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const SEASON = "(?:spring|summer|fall|autumn|winter)";
const YEAR = "(?:19[5-9]\\d|20[0-4]\\d)";
/** One date: "Jan. 2020", "01/2020", "2020". */
export const DATE_SOURCE = `(?:${MONTH_NAME}\\.?,?\\s+${YEAR}|${SEASON}\\s+${YEAR}|(?:0?[1-9]|1[0-2])\\s*[/.-]\\s*${YEAR}|${YEAR})`;
const END_WORD = "(?:present|current|now|today|ongoing)";
const DASH = "\\s*(?:-|–|—|to|until)\\s*";

export const DATE_RANGE = new RegExp(`(${DATE_SOURCE})${DASH}(${DATE_SOURCE}|${END_WORD})`, "i");
export const SINGLE_DATE = new RegExp(`(?:expected\\s+|anticipated\\s+|class of\\s+|graduat(?:ed|ion|ing)\\s*:?\\s*)?(${DATE_SOURCE})`, "i");
export const CURRENT_WORD = new RegExp(`^${END_WORD}$`, "i");

export interface ParsedDate {
  /** "YYYY-MM". */
  value: string;
  monthKnown: boolean;
}

const SEASON_MONTH: Record<string, number> = { spring: 5, summer: 8, fall: 12, autumn: 12, winter: 12 };

export function parseDate(raw: string): ParsedDate | null {
  const s = raw.trim().replace(/\s+/g, " ");
  const year = /(19[5-9]\d|20[0-4]\d)/.exec(s)?.[1];
  if (!year) return null;
  const numeric = /^(0?[1-9]|1[0-2])\s*[/.-]\s*\d{4}$/.exec(s);
  if (numeric) return { value: `${year}-${numeric[1]!.padStart(2, "0")}`, monthKnown: true };
  const word = s.split(/[\s.,]+/)[0] ?? "";
  const month = MONTHS.find(([re]) => re.test(word))?.[1];
  if (month) return { value: `${year}-${String(month).padStart(2, "0")}`, monthKnown: true };
  // A season names roughly when a term ended, not a month; the person checks it.
  const season = SEASON_MONTH[word.toLowerCase()];
  if (season) return { value: `${year}-${String(season).padStart(2, "0")}`, monthKnown: false };
  return { value: `${year}-01`, monthKnown: false };
}

export interface ParsedRange {
  start: ParsedDate | null;
  end: ParsedDate | null;
  isCurrent: boolean;
  /** The matched text, so callers can remove it from the line. */
  match: string;
}

export function findDateRange(line: string): ParsedRange | null {
  const m = DATE_RANGE.exec(line);
  if (!m) return null;
  const isCurrent = CURRENT_WORD.test(m[2]!.trim());
  return { start: parseDate(m[1]!), end: isCurrent ? null : parseDate(m[2]!), isCurrent, match: m[0] };
}

/** Does `text` contain a written form of this month? Used to check a model's dates. */
export function textMentionsMonth(text: string, ym: string): boolean {
  const [year, month] = ym.split("-");
  if (!year || !month || !text.includes(year)) return false;
  const m = Number(month);
  const name = new RegExp(`\\b${MONTH_NAME}\\.?,?\\s+${year}`, "gi");
  for (const hit of text.matchAll(name)) {
    if (MONTHS.find(([re]) => re.test(hit[0]))?.[1] === m) return true;
  }
  return new RegExp(`\\b0?${m}\\s*[/.-]\\s*${year}\\b`).test(text);
}
