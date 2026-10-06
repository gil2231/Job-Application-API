/** Date → "YYYY-MM-DD" for <input type="date"> (dates are stored as UTC calendar dates). */
export function toDateInput(value: Date | string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

export function formatMonthYear(value: Date | string | null | undefined): string {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
}
