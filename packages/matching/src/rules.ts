import {
  enumLabel,
  formatSalaryRange,
  type EmploymentType,
  type JobAnalysis,
  type QualificationResult,
  type RuleCheck,
  type WorkArrangement,
} from "@autoapply/shared";
import { companyMatches, containsPhrase, industryMatches, isRemotePreference, locationMatches } from "./normalize";

/** The qualification rules from the user's AutomationRule. */
export interface QualificationRules {
  minMatchScore: number;
  minSalary: number | null;
  preferredLocations: string[];
  workArrangements: WorkArrangement[];
  employmentTypes: EmploymentType[];
  excludedIndustries: string[];
  excludedCompanies: string[];
  excludedKeywords: string[];
  requiresSponsorship: boolean;
}

export interface QualificationInput {
  title: string;
  company: string;
  location: string | null;
  description: string | null;
  salaryText: string | null;
  matchScore: number;
  analysis: JobAnalysis;
}

const money = (n: number) => formatSalaryRange(n, n, "USD", "YEAR");
const list = (values: string[]) => values.map((v) => enumLabel(v)).join(", ");

/**
 * Check a job against every rule. A job qualifies only when no rule fails and
 * it has a description to judge it by. Rules the posting can't answer
 * (salary not listed, sponsorship not mentioned) are reported as unknown and
 * don't disqualify it; Phase 3 automation re-checks them on the live form.
 */
export function evaluateRules(job: QualificationInput, rules: QualificationRules, now: Date = new Date()): QualificationResult {
  const a = job.analysis;
  const checks: RuleCheck[] = [];
  const add = (rule: RuleCheck["rule"], label: string, outcome: RuleCheck["outcome"], detail: string) => checks.push({ rule, label, outcome, detail });

  add(
    "description",
    "Job description",
    a.hasDescription ? "pass" : "unknown",
    a.hasDescription ? "Analyzed from the full posting." : "No description yet. Add it so requirements can be checked.",
  );

  const scoreLabel = `Match score of at least ${rules.minMatchScore}`;
  // A score from the title alone would be guesswork, so the job isn't scored until the description is in.
  if (!a.hasDescription) add("minMatchScore", scoreLabel, "unknown", "Scored once the description is added.");
  else if (job.matchScore >= rules.minMatchScore) add("minMatchScore", scoreLabel, "pass", `Scored ${job.matchScore}.`);
  else add("minMatchScore", scoreLabel, "fail", `Scored ${job.matchScore}.`);

  if (rules.minSalary != null) {
    const label = `Salary of at least ${money(rules.minSalary)}`;
    if (a.commissionOnly) add("minSalary", label, "fail", "Pay is commission-only.");
    else if (!a.salary) add("minSalary", label, "unknown", "No salary listed.");
    else {
      const listed = formatSalaryRange(a.salary.annualMin, a.salary.annualMax, a.salary.currency, "YEAR");
      add("minSalary", label, a.salary.annualMax >= rules.minSalary ? "pass" : "fail", `Lists about ${listed} a year.`);
    }
  }

  const cities = rules.preferredLocations.filter((l) => !isRemotePreference(l));
  if (rules.preferredLocations.length) {
    const label = `Location: ${rules.preferredLocations.join(", ")}`;
    const location = job.location ?? a.location;
    if (a.workArrangement === "REMOTE") add("location", label, "pass", "Remote role.");
    else if (!location) add("location", label, "unknown", "No location listed.");
    else {
      const match = cities.find((c) => locationMatches(location, c));
      add("location", label, match ? "pass" : "fail", match ? `${location} matches ${match}.` : `${location} isn't one of your locations.`);
    }
  }

  if (rules.workArrangements.length) {
    const label = `Work arrangement: ${list(rules.workArrangements)}`;
    if (a.workArrangement === "UNKNOWN") add("workArrangement", label, "unknown", "The posting doesn't say whether it's remote, hybrid or on-site.");
    else add("workArrangement", label, rules.workArrangements.includes(a.workArrangement) ? "pass" : "fail", `${enumLabel(a.workArrangement)} role.`);
  }

  if (rules.employmentTypes.length) {
    const label = `Employment type: ${list(rules.employmentTypes)}`;
    if (!a.employmentType) add("employmentType", label, "unknown", "The posting doesn't state the employment type.");
    else add("employmentType", label, rules.employmentTypes.includes(a.employmentType) ? "pass" : "fail", `${enumLabel(a.employmentType)}.`);
  }

  if (rules.excludedIndustries.length) {
    const label = "Not in an excluded industry";
    const haystack = [a.industry, job.company, job.title].filter(Boolean).join(" ");
    const hit = rules.excludedIndustries.find((i) => (a.industry && industryMatches(a.industry, i)) || containsPhrase(haystack, i));
    if (hit) add("excludedIndustries", label, "fail", `Matches excluded industry "${hit}".`);
    else add("excludedIndustries", label, a.industry ? "pass" : "unknown", a.industry ? `${a.industry}.` : "Industry not clear from the posting.");
  }

  if (rules.excludedCompanies.length) {
    const hit = rules.excludedCompanies.find((c) => companyMatches(job.company, c));
    add("excludedCompanies", "Not an excluded company", hit ? "fail" : "pass", hit ? `${job.company} is on your excluded list.` : `${job.company} isn't excluded.`);
  }

  if (rules.excludedKeywords.length) {
    const text = [job.title, job.description, job.salaryText].filter(Boolean).join("\n");
    const hit = rules.excludedKeywords.find((k) => containsPhrase(text, k) || (/commission/i.test(k) && a.commissionOnly));
    add("excludedKeywords", "No excluded keywords", hit ? "fail" : "pass", hit ? `Mentions "${hit}".` : "None of your excluded keywords appear.");
  }

  if (rules.requiresSponsorship) {
    const label = "Offers visa sponsorship";
    const s = a.sponsorship;
    if (s.available === false) add("sponsorship", label, "fail", s.text ?? "The posting says it can't sponsor.");
    else if (s.available === true) add("sponsorship", label, "pass", s.text ?? "The posting offers sponsorship.");
    else add("sponsorship", label, "unknown", "Sponsorship isn't mentioned.");
  }

  const failed = checks.some((c) => c.outcome === "fail");
  const status = failed ? "NOT_QUALIFIED" : a.hasDescription ? "QUALIFIED" : "NEEDS_DETAILS";
  return { qualified: status === "QUALIFIED", status, checks, evaluatedAt: now.toISOString() };
}
