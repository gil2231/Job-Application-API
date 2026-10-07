/** Turning email parts into plain text, and reading calendar invites. */

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", "#39": "'" };

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6]|table)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#\d+|#x[0-9a-f]+|\w+);/gi, (m, e: string) => {
      const lower = e.toLowerCase();
      if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16));
      if (lower.startsWith("#")) return String.fromCodePoint(Number(lower.slice(1)));
      return ENTITIES[lower] ?? m;
    })
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/**
 * The new part of a reply: drops quoted lines and everything from the
 * "On ... wrote:" line or a forwarded/original-message divider on, so an old
 * message quoted underneath isn't read as news.
 */
export function stripQuoted(text: string): string {
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    const t = line.trim();
    if (/^On .{4,200} wrote:$/i.test(t) || /^-{2,}\s*(Original Message|Forwarded message)\s*-{2,}$/i.test(t) || (/^From: .+$/i.test(t) && out.length > 3)) break;
    if (t.startsWith(">")) continue;
    out.push(line);
  }
  return out.join("\n").trim();
}

/** "Jane Doe <jane@acme.com>" → { name, address }. */
export function parseAddress(raw: string): { name: string | null; address: string } {
  const m = raw.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1]!.trim() || null, address: m[2]!.trim().toLowerCase() };
  return { name: null, address: raw.trim().toLowerCase() };
}

export function senderDomain(address: string): string {
  return address.split("@")[1]?.toLowerCase() ?? "";
}

// ─── iCalendar ──────────────────────────────────────────────────────────────

/** Wall-clock time in an IANA zone → UTC. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): Date {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offsetAt = (t: number) => {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(t));
    const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute")) - t;
  };
  try {
    const first = guess - offsetAt(guess);
    return new Date(guess - offsetAt(first));
  } catch {
    return new Date(guess);
  }
}

function parseIcsDate(value: string, params: string, defaultZone: string): Date | null {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = "0", mi = "0", , z] = m;
  if (z) return new Date(Date.UTC(+y!, +mo! - 1, +d!, +h, +mi));
  const tzid = params.match(/TZID=("?)([^;:"]+)\1/i)?.[2];
  let zone = defaultZone;
  if (tzid) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tzid });
      zone = tzid;
    } catch {
      // Windows zone names ("Pacific Standard Time") aren't IANA; fall back.
    }
  }
  return zonedToUtc(+y!, +mo!, +d!, +h, +mi, zone);
}

const unescapeIcs = (v: string) => v.replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1").trim();

/** The first event of a text/calendar part. Cancellations are ignored. */
export function parseIcs(ics: string, defaultZone = "UTC"): { start: Date; end: Date | null; location: string | null; summary: string | null } | null {
  const unfolded = ics.replace(/\r?\n[ \t]/g, "");
  if (/^METHOD:CANCEL/im.test(unfolded)) return null;
  const event = unfolded.match(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/)?.[1];
  if (!event) return null;
  const prop = (name: string) => {
    const m = event.match(new RegExp(`^${name}((?:;[^:\\r\\n]*)?):(.*)$`, "im"));
    return m ? { params: m[1] ?? "", value: m[2]!.trim() } : null;
  };
  const dtstart = prop("DTSTART");
  if (!dtstart) return null;
  const start = parseIcsDate(dtstart.value, dtstart.params, defaultZone);
  if (!start) return null;
  const dtend = prop("DTEND");
  const location = prop("LOCATION");
  const summary = prop("SUMMARY");
  return {
    start,
    end: dtend ? parseIcsDate(dtend.value, dtend.params, defaultZone) : null,
    location: location ? unescapeIcs(location.value) || null : null,
    summary: summary ? unescapeIcs(summary.value) || null : null,
  };
}
