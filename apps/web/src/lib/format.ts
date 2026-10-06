import { format, formatDistanceToNowStrict } from "date-fns";
import { enumLabel, formatSalaryRange, type SalaryPeriod } from "@autoapply/shared";

export function formatDate(value: Date | string | null | undefined, pattern = "MMM d, yyyy"): string {
  if (!value) return "—";
  return format(new Date(value), pattern);
}

export function formatRelative(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return `${formatDistanceToNowStrict(new Date(value))} ago`;
}

export function formatSalary(job: { salaryMin: number | null; salaryMax: number | null; salaryCurrency: string | null; salaryPeriod: string | null }) {
  return formatSalaryRange(job.salaryMin, job.salaryMax, job.salaryCurrency ?? "USD", (job.salaryPeriod as SalaryPeriod | null) ?? "YEAR");
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export { enumLabel };
