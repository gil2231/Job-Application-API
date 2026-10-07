/** The local date (YYYY-MM-DD) and hour (0-23) at `now` in a time zone. An unknown zone falls back to UTC. */
export function localDateHour(now: Date, timeZone: string): { date: string; hour: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23" }).formatToParts(now);
  } catch {
    return localDateHour(now, "UTC");
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")) % 24 };
}

/** "8 AM", "12 PM", for settings and emails. */
export function formatHour(hour: number): string {
  const h = hour % 12 === 0 ? 12 : hour % 12;
  return `${h} ${hour < 12 ? "AM" : "PM"}`;
}
