/** Sender domains that say something about whether an email is about a job application. */

/** Hiring systems and interview schedulers that send email on an employer's behalf. */
export const ATS_SENDER_DOMAINS = [
  "greenhouse.io",
  "greenhouse-mail.io",
  "lever.co",
  "hire.lever.co",
  "ashbyhq.com",
  "myworkday.com",
  "myworkdayjobs.com",
  "workday.com",
  "smartrecruiters.com",
  "icims.com",
  "jobvite.com",
  "taleo.net",
  "successfactors.com",
  "bamboohr.com",
  "workable.com",
  "recruitee.com",
  "breezy.hr",
  "jazzhr.com",
  "applytojob.com",
  "rippling.com",
  "pinpointhq.com",
  "teamtailor.com",
  "personio.de",
  "gem.com",
  "goodtime.io",
  "calendly.com",
  "paradox.ai",
  "hirevue.com",
  "codesignal.com",
  "hackerrank.com",
];

/**
 * Job boards and social sites. Their email is alerts and newsletters about
 * other jobs, not replies from an employer, so it is never read as one.
 */
export const IGNORED_SENDER_DOMAINS = [
  "linkedin.com",
  "indeed.com",
  "indeedemail.com",
  "glassdoor.com",
  "ziprecruiter.com",
  "monster.com",
  "dice.com",
  "wellfound.com",
  "angel.co",
  "builtin.com",
  "simplyhired.com",
  "careerbuilder.com",
  "otta.com",
  "welcometothejungle.com",
  "hired.com",
  "handshake.com",
  "joinhandshake.com",
];

const endsWithDomain = (domain: string, list: string[]) => list.some((d) => domain === d || domain.endsWith(`.${d}`));

export const isAtsSender = (domain: string) => endsWithDomain(domain, ATS_SENDER_DOMAINS);
export const isIgnoredSender = (domain: string) => endsWithDomain(domain, IGNORED_SENDER_DOMAINS);

/** Free mailbox providers: a recruiter's personal address says nothing about the company. */
export const PERSONAL_MAIL_DOMAINS = ["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "yahoo.com", "icloud.com", "me.com", "proton.me", "protonmail.com", "aol.com"];
