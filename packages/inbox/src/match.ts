/**
 * Which sent application an email is about. Looks for the company in the
 * sender's domain, the sender's name, the subject and the body, and uses the
 * job title to pick between applications at the same company. Never guesses:
 * a tie is reported as ambiguous for the user to settle.
 */
import { isAtsSender, PERSONAL_MAIL_DOMAINS } from "./senders";
import { senderDomain } from "./text";
import type { MailSummary } from "./types";

export interface MatchCandidate {
  id: string;
  company: string;
  title: string;
  urls: string[];
}

export type MatchResult =
  | { result: "matched"; applicationId: string; strength: "strong" | "body" }
  | { result: "ambiguous"; candidates: string[] }
  | { result: "unmatched" };

const SUFFIXES = /\b(?:inc|incorporated|llc|l\.l\.c|ltd|limited|corp|corporation|co|company|plc|gmbh|ag|sa|s\.a|bv|b\.v|pty|technologies|technology|labs|group|holdings)\b\.?/g;

/** "Acme, Inc." → "acme". */
export function normalizeCompany(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(SUFFIXES, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const compact = (s: string) => s.replace(/\s+/g, "");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Domain labels that could name the company: "mail.acme-corp.co.uk" → ["acmecorp"]. */
function domainNames(domain: string): string[] {
  if (!domain || PERSONAL_MAIL_DOMAINS.includes(domain) || isAtsSender(domain)) return [];
  const labels = domain.split(".").filter((l) => !["com", "co", "io", "ai", "net", "org", "uk", "us", "de", "app", "dev", "mail", "email", "careers", "jobs", "talent", "recruiting", "hr", "notifications", "noreply", "no-reply", "info", "em", "e"].includes(l));
  return labels.map((l) => l.replace(/-/g, ""));
}

function wordRegex(phrase: string, flags = "i") {
  return new RegExp(`(?<![\\p{L}\\p{N}])${phrase.split(" ").map(escape).join("[\\s\\-.]*")}(?![\\p{L}\\p{N}])`, `${flags}u`);
}

interface Scored {
  candidate: MatchCandidate;
  company: number;
  title: number;
  bodyOnly: boolean;
}

/** Score how clearly an email names an application's company and job. */
function score(c: MatchCandidate, email: { fromName: string; domains: string[]; subject: string; body: string }): Scored {
  const norm = normalizeCompany(c.company);
  if (norm.length < 2) return { candidate: c, company: 0, title: 0, bodyOnly: false };
  const anyCase = wordRegex(norm);
  let company = 0;
  if (email.domains.some((d) => d === compact(norm) || (d.length >= 4 && compact(norm).startsWith(d)) || (compact(norm).length >= 4 && d.startsWith(compact(norm))))) company += 3;
  if (anyCase.test(email.fromName)) company += 3;
  if (anyCase.test(email.subject)) company += 2;
  let bodyOnly = false;
  if (company === 0) {
    // In the body a one-word name must appear as written ("Ramp", not "ramp up").
    const original = c.company.replace(SUFFIXES, " ").replace(/[^\p{L}\p{N}&]+/gu, " ").trim();
    const inBody = norm.includes(" ") ? anyCase.test(email.body) : original && wordRegex(original, "").test(email.body);
    if (inBody) {
      company = 1;
      bodyOnly = true;
    }
  }
  const title = normalizeCompany(c.title);
  const titleHit = title.length >= 3 && (wordRegex(title).test(email.subject) || wordRegex(title).test(email.body));
  return { candidate: c, company, title: titleHit ? 1 : 0, bodyOnly };
}

/**
 * Match an email to one application. `threadApplicationId` is the application
 * an earlier email in the same conversation was matched to; it wins over a
 * tie between applications at the same company.
 */
export function matchApplication(email: Pick<MailSummary, "fromName" | "fromAddress" | "subject"> & { text: string }, candidates: MatchCandidate[], threadApplicationId?: string | null): MatchResult {
  if (threadApplicationId && candidates.some((c) => c.id === threadApplicationId)) return { result: "matched", applicationId: threadApplicationId, strength: "strong" };
  const domain = senderDomain(email.fromAddress);
  const input = { fromName: email.fromName ?? "", domains: domainNames(domain), subject: email.subject, body: email.text.slice(0, 6000) };
  const scored = candidates.map((c) => score(c, input)).filter((s) => s.company > 0);
  if (scored.length === 0) return { result: "unmatched" };

  // The best-named company first; ties between different companies are ambiguous.
  const best = Math.max(...scored.map((s) => s.company));
  const top = scored.filter((s) => s.company === best);
  const companies = new Set(top.map((s) => normalizeCompany(s.candidate.company)));
  if (companies.size > 1) return { result: "ambiguous", candidates: top.map((s) => s.candidate.id) };

  // Several applications at that company: the job title decides.
  let pool = top;
  if (pool.length > 1) {
    const titled = pool.filter((s) => s.title > 0);
    if (titled.length === 1) pool = titled;
    else return { result: "ambiguous", candidates: (titled.length ? titled : pool).map((s) => s.candidate.id) };
  }
  const chosen = pool[0]!;
  return { result: "matched", applicationId: chosen.candidate.id, strength: chosen.bodyOnly ? "body" : "strong" };
}

/** Cheap check on headers and preview, before the full message is fetched. */
export function mightBeAboutApplications(summary: Pick<MailSummary, "fromName" | "fromAddress" | "subject" | "snippet">, companies: string[]): boolean {
  const domain = senderDomain(summary.fromAddress);
  if (isAtsSender(domain)) return true;
  const hay = `${summary.fromName ?? ""}\n${summary.subject}\n${summary.snippet}`;
  const names = domainNames(domain);
  return companies.some((company) => {
    const norm = normalizeCompany(company);
    if (norm.length < 2) return false;
    if (names.some((d) => d === compact(norm) || (d.length >= 4 && compact(norm).startsWith(d)))) return true;
    return wordRegex(norm).test(hay);
  });
}
