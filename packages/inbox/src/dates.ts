/**
 * Finding an interview's date and time in an email's text, such as
 * "Tuesday, October 14 at 2:00 PM ET" or "Oct 14, 2026 at 14:30". Deliberately
 * strict: anything unclear yields nothing, and the user fills the time in.
 */
import { zonedToUtc } from "./text";

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const DAY = "(\\d{1,2})(?:st|nd|rd|th)?";
const TIME = "(\\d{1,2})(?::(\\d{2}))?\\s*(a\\.?m\\.?|p\\.?m\\.?)?";
const ZONE = "(?:\\s*\\(?\\s*(ET|EST|EDT|CT|CST|CDT|MT|MST|MDT|PT|PST|PDT|GMT|UTC|BST|CET|CEST|IST|AEST|AEDT|Eastern|Central|Mountain|Pacific)\\b\\)?)?";
const JOIN = "(?:,?\\s*(?:at|@|from|,|-|–)?\\s*)";

/** Abbreviations → IANA zones (the zone handles daylight time). */
const ZONES: Record<string, string> = {
  et: "America/New_York", est: "America/New_York", edt: "America/New_York", eastern: "America/New_York",
  ct: "America/Chicago", cst: "America/Chicago", cdt: "America/Chicago", central: "America/Chicago",
  mt: "America/Denver", mst: "America/Denver", mdt: "America/Denver", mountain: "America/Denver",
  pt: "America/Los_Angeles", pst: "America/Los_Angeles", pdt: "America/Los_Angeles", pacific: "America/Los_Angeles",
  gmt: "UTC", utc: "UTC", bst: "Europe/London", cet: "Europe/Paris", cest: "Europe/Paris", ist: "Asia/Kolkata", aest: "Australia/Sydney", aedt: "Australia/Sydney",
};

const PATTERNS: Array<{ re: RegExp; order: "md" | "dm" | "num" }> = [
  // October 14(, 2026)( at) 2:00 PM (ET)
  { re: new RegExp(`\\b${MONTH}\\s+${DAY}(?:,?\\s+(\\d{4}))?${JOIN}${TIME}${ZONE}`, "gi"), order: "md" },
  // 14 October( 2026)( at) 14:00
  { re: new RegExp(`\\b${DAY}\\s+${MONTH}(?:,?\\s+(\\d{4}))?${JOIN}${TIME}${ZONE}`, "gi"), order: "dm" },
  // 10/14(/2026)( at) 2:00 PM: US order
  { re: new RegExp(`\\b(\\d{1,2})/(\\d{1,2})(?:/(\\d{2,4}))?${JOIN}${TIME}${ZONE}`, "gi"), order: "num" },
];

function toHour(h: number, meridiem: string | undefined, minute: string | undefined): number | null {
  const m = meridiem?.replace(/\./g, "").toLowerCase();
  if (m) {
    if (h < 1 || h > 12) return null;
    return m === "pm" ? (h % 12) + 12 : h % 12;
  }
  // "at 2" with no minutes and no am/pm is too vague; "14:30" is fine.
  if (minute === undefined || h > 23) return null;
  return h;
}

/** Distinct date-times in the text, in UTC. */
export function findDateTimes(text: string, receivedAt: Date, defaultZone: string): Date[] {
  const found = new Map<number, Date>();
  for (const { re, order } of PATTERNS) {
    for (const m of text.matchAll(re)) {
      let month: number, day: number, year: number | undefined;
      const g = m.slice(1);
      if (order === "md") {
        month = MONTHS.indexOf(g[0]!.slice(0, 3).toLowerCase()) + 1;
        day = Number(g[1]);
        year = g[2] ? Number(g[2]) : undefined;
      } else if (order === "dm") {
        day = Number(g[0]);
        month = MONTHS.indexOf(g[1]!.slice(0, 3).toLowerCase()) + 1;
        year = g[2] ? Number(g[2]) : undefined;
      } else {
        month = Number(g[0]);
        day = Number(g[1]);
        year = g[2] ? Number(g[2].length === 2 ? `20${g[2]}` : g[2]) : undefined;
      }
      const [hh, mm, meridiem, zone] = g.slice(3);
      if (month < 1 || month > 12 || day < 1 || day > 31) continue;
      const hour = toHour(Number(hh), meridiem, mm);
      if (hour === null) continue;
      const minute = mm ? Number(mm) : 0;
      if (minute > 59) continue;
      const tz = zone ? (ZONES[zone.toLowerCase()] ?? defaultZone) : defaultZone;
      // No year: the next such date on or after the email (allowing a week back for typos and late mail).
      let y = year ?? receivedAt.getUTCFullYear();
      let at = zonedToUtc(y, month, day, hour, minute, tz);
      if (!year && at.getTime() < receivedAt.getTime() - 7 * 86_400_000) {
        y += 1;
        at = zonedToUtc(y, month, day, hour, minute, tz);
      }
      // Something years away is a date in a signature or a typo, not an interview.
      if (at.getTime() < receivedAt.getTime() - 86_400_000 || at.getTime() > receivedAt.getTime() + 180 * 86_400_000) continue;
      found.set(at.getTime(), at);
    }
  }
  return [...found.values()].sort((a, b) => a.getTime() - b.getTime());
}

export function findDuration(text: string): number | null {
  const m = text.match(/\b(\d{2,3}|one|an?)[\s-]*(minute|min|hour|hr)s?\b/i);
  if (!m) return null;
  const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : 1;
  const minutes = /^h/i.test(m[2]!) ? n * 60 : n;
  return minutes >= 10 && minutes <= 480 ? minutes : null;
}

const MEETING_LINK = /https?:\/\/(?:[\w-]+\.)?(?:zoom\.us\/(?:j|my|w)\/[^\s<>"')]+|meet\.google\.com\/[a-z-]+|teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"')]+|teams\.live\.com\/meet\/[^\s<>"')]+|[\w-]+\.webex\.com\/[^\s<>"')]+|whereby\.com\/[^\s<>"')]+)/i;

export function findMeetingLink(text: string): string | null {
  // A link at the end of a sentence keeps the sentence's punctuation off it.
  return text.match(MEETING_LINK)?.[0].replace(/[.,;:!?]+$/, "") ?? null;
}
