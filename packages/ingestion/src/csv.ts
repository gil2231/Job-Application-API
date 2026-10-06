/**
 * RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF/LF, and a UTF-8 BOM.
 * Returns rows of raw strings; the caller maps headers.
 */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((cell) => cell.trim() !== ""));
}

export function normalizeHeader(header: string): string {
  return header.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Parse dates as LinkedIn and spreadsheets write them ("10/3/24, 2:15 PM", "2024-10-03 14:15:00 UTC"). */
export function parseLooseDate(value: string | undefined | null): Date | null {
  if (!value) return null;
  const v = value.trim();
  if (!v) return null;
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i.exec(v);
  if (us) {
    const [, m, d, y, hh, mm, ss, ampm] = us;
    let year = Number(y);
    if (year < 100) year += 2000;
    let hour = hh ? Number(hh) : 0;
    if (ampm) hour = (hour % 12) + (ampm.toUpperCase() === "PM" ? 12 : 0);
    const date = new Date(Date.UTC(year, Number(m) - 1, Number(d), hour, mm ? Number(mm) : 0, ss ? Number(ss) : 0));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  // A bare number isn't a date, though Date() would read "42" as 2042.
  if (/^\d+$/.test(v)) return null;
  const date = new Date(v.replace(/ UTC$/, "Z").replace(/^(\d{4}-\d{2}-\d{2}) (\d)/, "$1T$2"));
  if (Number.isNaN(date.getTime())) return null;
  // Reject absurd years from mis-parsed values.
  const year = date.getUTCFullYear();
  return year >= 2000 && year <= 2100 ? date : null;
}
