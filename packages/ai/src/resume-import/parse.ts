import {
  emptyResumeDraft,
  type DraftEducation,
  type DraftEmployment,
  type ResumeDraft,
  type ResumeSkillList,
} from "@autoapply/shared";
import { findDateRange, parseDate, SINGLE_DATE } from "./dates";

/**
 * Deterministic resume parser. It finds the usual sections (contact block,
 * summary, experience, education, skills) and copies text out of them; it never
 * writes anything that isn't in the resume. Layouts it can't follow come back
 * as empty fields for the person to fill in, not guesses.
 */

type Section = "header" | "summary" | "experience" | "education" | "skills" | "software" | "technical" | "languages" | "other";

const HEADINGS: Array<[RegExp, Section]> = [
  [/^(professional |career |executive )?(summary|profile|overview)$|^(about( me)?|objective|career objective|professional objective|personal statement)$/, "summary"],
  [
    /^((professional|work|relevant|employment|career|sales|industry|related|selected|military)\s+)?(experience|history|background)$|^employment( history)?$|^work$|^(professional |work )?experience\s*(&|and)\s*\w+$/,
    "experience",
  ],
  [/^(education|academic background|academics|education (&|and) (training|certifications?|credentials))$/, "education"],
  [/^(languages?|spoken languages)$/, "languages"],
  [/^(software|tools|software (&|and) tools|tools (&|and) (software|technologies|platforms)|platforms|systems)$/, "software"],
  [/^(technical skills|technologies|tech stack|programming( languages)?|technical proficiencies)$/, "technical"],
  [
    /^((key|core|relevant|professional|additional|other)\s+)?(skills|competencies|expertise|proficiencies|strengths|qualifications)(\s*(&|and)\s*\w+(\s+\w+)?)?$|^skills (summary|overview)$|^areas of expertise$/,
    "skills",
  ],
  [
    /^(certifications?|licenses?( (&|and) certifications?)?|certifications? (&|and) licenses?|awards?|honou?rs?( (&|and) awards?)?|projects?|(selected |personal |academic )projects|volunteer(ing| experience| work)?|community( involvement| service)?|interests|hobbies|activities|leadership( experience)?|publications?|references?|affiliations?|memberships?|extracurriculars?|additional information|training|courses|coursework)$/,
    "other",
  ],
];

const BULLET = /^\s*(?:[•●▪◦‣∙·○■□➢►▶✓✔*–-]|\d{1,2}[.)])\s+/;

/** Words that make a phrase a job title rather than a company. */
const TITLE_WORDS =
  /\b(engineer|developer|programmer|manager|director|head|lead|leader|chief|officer|president|vp|vice|executive|representative|rep|associate|analyst|consultant|specialist|coordinator|administrator|assistant|intern|internship|designer|architect|scientist|researcher|advisor|adviser|agent|recruiter|partner|founder|co-founder|owner|supervisor|strategist|writer|editor|teacher|instructor|tutor|professor|nurse|technician|clerk|accountant|controller|auditor|attorney|lawyer|paralegal|operator|planner|buyer|producer|marketer|account|sales|sdr|bdr|ae|cto|ceo|cfo|coo|cmo|principal|staff|senior|junior|sr|jr|trainee|apprentice|fellow|volunteer|cashier|server|bartender|driver|mechanic|electrician|therapist|counselor|pharmacist|physician|cook|chef|barista|ambassador|generalist|member|contractor|freelancer|freelance)\b/i;
const COMPANY_WORDS =
  /\b(inc|inc\.|llc|l\.l\.c|ltd|limited|corp|corporation|co\.|company|group|holdings|technologies|technology|labs|systems|solutions|partners|bank|capital|ventures|studio|studios|agency|university|college|hospital|health|foundation|institute|gmbh|s\.a\.|plc|ag)\b/i;
const SCHOOL_WORDS = /\b(university|universit[éeà]|college|institute|school|academy|polytechnic|conservatory|seminary)\b/i;
const DEGREE =
  /\b(bachelor(?:'s|s)?(?: of [a-z]+(?: [a-z]+)?)?|master(?:'s|s)?(?: of [a-z]+(?: [a-z]+)?)?|doctor(?:ate)?(?: of [a-z]+)?|associate(?:'s)? (?:degree|of [a-z]+(?: [a-z]+)?)|ph\.?\s?d\.?|m\.?b\.?a\.?|b\.?\s?s\.?c?\.?|b\.?\s?a\.?|b\.?b\.?a\.?|b\.?\s?eng\.?|b\.?f\.?a\.?|m\.?\s?s\.?c?\.?|m\.?\s?a\.?|m\.?\s?eng\.?|m\.?f\.?a\.?|m\.?p\.?h\.?|j\.?d\.?|m\.?d\.?|ed\.?d\.?|a\.?\s?a\.?s?\.?|high school diploma|ged|diploma|certificate)(?=$|[\s,.;:|)(-])/i;

const EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i;
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)|\d{2,4})[\s.-]?\d{3,4}[\s.-]?\d{3,4}/;
const URL = /\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|io|dev|me|net|org|co|ai|app|page|site|xyz|tech|design|us|uk|ca)(?:\/[^\s|,;)]*)?/gi;

const US_STATES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California", CO: "Colorado", CT: "Connecticut", DE: "Delaware",
  DC: "District of Columbia", FL: "Florida", GA: "Georgia", HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland", MA: "Massachusetts", MI: "Michigan", MN: "Minnesota",
  MS: "Mississippi", MO: "Missouri", MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio", OK: "Oklahoma", OR: "Oregon",
  PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina", SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah",
  VT: "Vermont", VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
  // Canadian provinces
  AB: "Alberta", BC: "British Columbia", MB: "Manitoba", NB: "New Brunswick", NL: "Newfoundland and Labrador", NS: "Nova Scotia",
  ON: "Ontario", PE: "Prince Edward Island", QC: "Quebec", SK: "Saskatchewan",
};
const STATE_NAMES = new Set(Object.values(US_STATES).map((s) => s.toLowerCase()));
const COUNTRIES = new Set([
  "united states", "usa", "us", "united kingdom", "uk", "canada", "australia", "germany", "france", "india", "ireland", "spain",
  "italy", "netherlands", "mexico", "brazil", "singapore", "japan", "new zealand", "sweden", "switzerland", "israel", "portugal",
]);
/** "Austin, TX", "Austin, Texas", "Austin, TX 78701", "London, United Kingdom". */
const LOCATION = /^([A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3}),\s*([A-Z]{2}|[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})(?:\s+(\d{5}(?:-\d{4})?|[A-Z]\d[A-Z]\s?\d[A-Z]\d))?(?:,\s*([A-Z][A-Za-z]+(?:\s+[A-Z][a-z]+)*))?$/;

const tidy = (s: string) => s.replace(/\s+/g, " ").replace(/^[\s|,;:–—-]+|[\s|,;:–—-]+$/g, "").trim();
const headingKey = (line: string) =>
  line
    .toLowerCase()
    .replace(/[^a-z&\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

function sectionOf(line: string): Section | null {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 45 || BULLET.test(trimmed)) return null;
  // "Skills: Python, SQL" is a labelled line inside a section, not a heading.
  if (/:\s*\S/.test(trimmed)) return null;
  const key = headingKey(trimmed);
  if (!key || key.split(" ").length > 5) return null;
  for (const [re, section] of HEADINGS) if (re.test(key)) return section;
  return null;
}

function splitSections(lines: string[]): Array<{ section: Section; lines: string[] }> {
  const out: Array<{ section: Section; lines: string[] }> = [{ section: "header", lines: [] }];
  for (const line of lines) {
    const section = sectionOf(line);
    if (section) out.push({ section, lines: [] });
    else out[out.length - 1]!.lines.push(line);
  }
  return out;
}

export interface ParsedLocation {
  city: string;
  state: string | null;
  postalCode: string | null;
  country: string | null;
}

export function parseLocation(text: string): ParsedLocation | null {
  const m = LOCATION.exec(text.trim());
  if (!m) return null;
  const [, city, region, postal, country] = m;
  const upper = region!.toUpperCase();
  const isState = (region!.length === 2 && upper in US_STATES) || STATE_NAMES.has(region!.toLowerCase());
  const isCountry = COUNTRIES.has(region!.toLowerCase());
  if (!isState && !isCountry) return null;
  return {
    city: city!,
    state: isState ? region! : null,
    postalCode: postal ?? null,
    country: isCountry ? region! : (country ?? null),
  };
}

const withProtocol = (url: string) => (/^https?:\/\//i.test(url) ? url : `https://${url}`);
const stripTrailing = (url: string) => url.replace(/[.,;:)]+$/, "");

function parseHeader(lines: string[], draft: ResumeDraft) {
  const pieces = lines.flatMap((l) => l.split(/\s+[|•·◦▪]\s+|\s{3,}|\t|\s+\|\s*|\s*\|\s+/)).map(tidy).filter(Boolean);
  const all = lines.join("\n");
  const p = draft.personal;
  p.email = EMAIL.exec(all)?.[0] ?? null;
  for (const raw of all.match(URL) ?? []) {
    if (raw.includes("@") || EMAIL.test(raw)) continue;
    const url = stripTrailing(raw);
    const host = url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").toLowerCase();
    if (p.email && p.email.toLowerCase().endsWith(host.split("/")[0]!)) continue;
    if (host.startsWith("linkedin.com/")) p.linkedinUrl ??= withProtocol(url);
    else if (host.startsWith("github.com/")) p.githubUrl ??= withProtocol(url);
    else if (/behance|dribbble|portfolio/.test(host)) p.portfolioUrl ??= withProtocol(url);
    else p.websiteUrl ??= withProtocol(url);
  }
  for (const piece of pieces) {
    if (EMAIL.test(piece) || /linkedin|github|https?:/i.test(piece)) continue;
    const phone = PHONE.exec(piece)?.[0];
    if (!p.phone && phone && phone.replace(/\D/g, "").length >= 10 && phone.replace(/\D/g, "").length <= 15) {
      p.phone = phone.trim();
      continue;
    }
    if (!p.city) {
      const loc = parseLocation(piece.replace(/^(based in|location:?)\s+/i, ""));
      if (loc) {
        p.city = loc.city;
        p.state = loc.state;
        p.postalCode = loc.postalCode;
        p.country = loc.country;
      }
    }
  }
  // The name is the first short line made only of name-like words.
  for (const line of lines.slice(0, 6)) {
    const candidate = tidy(line.split(/\s+[|•·]\s+|\s{3,}|\t/)[0] ?? "");
    if (!candidate || /[@\d/:]/.test(candidate) || candidate.length > 50) continue;
    const words = candidate.split(/\s+/);
    if (words.length < 2 || words.length > 4) continue;
    if (!words.every((w) => /^[A-ZÀ-Ý][A-Za-zÀ-ÿ.'’-]*$/.test(w) || /^[A-ZÀ-Ý.'’-]+$/.test(w))) continue;
    if (TITLE_WORDS.test(candidate) || parseLocation(candidate)) continue;
    const proper = (w: string) => (w === w.toUpperCase() && w.length > 2 ? w[0] + w.slice(1).toLowerCase() : w);
    p.firstName = proper(words[0]!);
    p.lastName = proper(words[words.length - 1]!.replace(/,$/, ""));
    break;
  }
}

const isBullet = (line: string) => BULLET.test(line);
const stripBullet = (line: string) => line.replace(BULLET, "").trim();
const hasFigure = (s: string) => /\d|%|\$/.test(s);

/** Split a header line into its parts: "Title | Company", "Company — City, ST", "Title at Company". */
function headerParts(line: string): string[] {
  return line
    .split(/\s+[|•·]\s+|\s*\|\s*|\s+[–—]\s+|\s+-\s+|\t|\s{3,}|\s+at\s+|\s+@\s+/)
    .flatMap((part) => {
      // "Acme Corp, Austin, TX": keep the location whole.
      const t = tidy(part);
      if (!t || parseLocation(t)) return [t];
      const comma = t.indexOf(", ");
      if (comma > 0 && parseLocation(t.slice(comma + 2))) return [t.slice(0, comma), t.slice(comma + 2)];
      if (comma > 0 && !COMPANY_WORDS.test(t.slice(comma + 2).split(" ")[0] ?? "") && t.split(", ").length === 2) {
        return t.split(", ");
      }
      return [t];
    })
    .map(tidy)
    .filter(Boolean);
}

function looksLikeEntryHeader(line: string): boolean {
  const t = line.trim();
  return !!t && !isBullet(t) && t.length <= 120 && !/[.!?]$/.test(t) && !/^[a-z]/.test(t);
}

function parseExperience(lines: string[]): DraftEmployment[] {
  const anchors: number[] = [];
  lines.forEach((line, i) => {
    if (!isBullet(line) && findDateRange(line)) anchors.push(i);
  });
  const entries: DraftEmployment[] = [];
  // Where each entry's header starts, so the previous entry's bullets stop there.
  const starts = anchors.map((a, n) => {
    let s = a;
    const floor = n > 0 ? anchors[n - 1]! + 1 : 0;
    while (s - 1 >= floor && a - (s - 1) <= 2 && looksLikeEntryHeader(lines[s - 1]!) && lines[s - 1]!.trim()) s--;
    return s;
  });
  anchors.forEach((anchor, n) => {
    const range = findDateRange(lines[anchor]!)!;
    const end = n + 1 < anchors.length ? starts[n + 1]! : lines.length;
    const headerLines = lines.slice(starts[n], anchor).concat(tidy(lines[anchor]!.replace(range.match, " ")));
    let body = anchor + 1;
    // Up to two short lines after the dates can still be header (layouts that put the title below).
    while (body < end && body - anchor <= 2 && looksLikeEntryHeader(lines[body]!) && headerParts(lines[body]!).length <= 3 && lines[body]!.length <= 80) {
      if (!lines[body]!.trim()) break;
      headerLines.push(lines[body]!);
      body++;
    }

    let location: string | null = null;
    const parts: string[] = [];
    for (const part of headerLines.flatMap(headerParts)) {
      if (parseLocation(part) || /^(remote|hybrid|on-?site)$/i.test(part)) location ??= part;
      else if (!/^\(?\s*(full[- ]time|part[- ]time|contract|internship|temporary|freelance)\s*\)?$/i.test(part)) parts.push(part.replace(/[()]/g, "").trim());
    }
    const titleIdx = parts.findIndex((p) => TITLE_WORDS.test(p) && !COMPANY_WORDS.test(p));
    const companyIdx = parts.findIndex((p, i) => i !== titleIdx && (COMPANY_WORDS.test(p) || !TITLE_WORDS.test(p)));
    let title = titleIdx >= 0 ? parts[titleIdx]! : null;
    let company = companyIdx >= 0 ? parts[companyIdx]! : null;
    // Unclassified pairs read "Title, Company" order.
    if (!title && !company && parts.length >= 2) [title, company] = [parts[0]!, parts[1]!];
    else if (!title) title = parts.find((p) => p !== company) ?? null;
    else if (!company) company = parts.find((p) => p !== title) ?? null;
    if (!title || !company) return;

    const responsibilities: string[] = [];
    const achievements: string[] = [];
    const items: string[] = [];
    for (const line of lines.slice(body, end)) {
      if (!line.trim()) continue;
      if (isBullet(line) || items.length === 0) items.push(stripBullet(line));
      else if (/^[a-z(]/.test(line) || !/[.!?;]$/.test(items[items.length - 1]!)) items[items.length - 1] += ` ${line.trim()}`;
      else items.push(line.trim());
    }
    for (const item of items.map(tidy).filter((s) => s.length > 2)) (hasFigure(item) ? achievements : responsibilities).push(item);

    entries.push({
      company: company.slice(0, 200),
      title: title.slice(0, 200),
      location,
      startDate: range.start?.value ?? null,
      endDate: range.end?.value ?? null,
      isCurrent: range.isCurrent,
      monthsKnown: !!range.start?.monthKnown && (range.isCurrent || !!range.end?.monthKnown),
      responsibilities: responsibilities.slice(0, 50),
      achievements: achievements.slice(0, 50),
    });
  });
  return entries;
}

function degreeParts(text: string): { degree: string; major: string | null } | null {
  const m = DEGREE.exec(text);
  if (!m) return null;
  let degree = tidy(m[0]);
  const rest = text.slice(m.index + m[0].length);
  // "Bachelor of Science in Economics", "B.S., Computer Science", "BA Economics".
  const inMatch = /^\s*(?:degree\s+)?(?:in|,|:|-|–)?\s*([A-Za-z&][A-Za-z&' -]{1,80}?)(?=\s*(?:[,;|(]|\s[–—-]\s|\bminor\b|\bgpa\b|$))/i.exec(rest);
  let major = inMatch ? tidy(inMatch[1]!) : null;
  if (major && (SCHOOL_WORDS.test(major) || DEGREE.test(major) || /^(with|cum|magna|summa|honou?rs)\b/i.test(major))) major = null;
  degree = degree.replace(/\s+(in|of)$/i, "");
  return { degree, major };
}

function parseEducation(lines: string[]): DraftEducation[] {
  const entries: DraftEducation[] = [];
  let pendingDegree: { degree: string; major: string | null } | null = null;
  let current: DraftEducation | null = null;
  for (const raw of lines) {
    const line = stripBullet(raw);
    if (!line) continue;
    const range = findDateRange(line);
    const single = !range ? SINGLE_DATE.exec(line) : null;
    const gpa = /\bGPA\b[:\s]*([0-9](?:\.\d{1,2})?)(?:\s*(?:\/|out of)\s*([0-9](?:\.\d{1,2})?))?|([0-9]\.\d{1,2})\s*\/\s*([0-9](?:\.\d{1,2})?)\s*GPA/i.exec(line);
    const minor = /\bminors?(?:\s+in)?\s*:?\s*([A-Za-z&][A-Za-z&' ]{1,60}?)(?=\s*(?:[,;|(]|$))/i.exec(line)?.[1];
    const undated = [range?.match, single?.[0], gpa?.[0]].reduce<string>((acc, cut) => (cut ? acc.replace(cut, " ") : acc), line);
    const parts = undated
      .split(/\s+[|•·]\s+|\s*\|\s*|\s+[–—]\s+|\t|\s{3,}/)
      .map(tidy)
      .filter((p) => p && !parseLocation(p));
    // "State College, BA History": the school is the comma-separated run before the degree.
    let schoolPart: string | undefined;
    const others: string[] = [];
    for (const part of parts) {
      if (schoolPart === undefined && SCHOOL_WORDS.test(part)) {
        const pieces = part.split(/,\s*/);
        const stop = pieces.findIndex((piece, i) => i > 0 && (DEGREE.test(piece) || parseLocation(pieces.slice(i).join(", ")) || !/[A-Za-z]/.test(piece)));
        const kept = stop === -1 ? pieces : pieces.slice(0, stop);
        if (DEGREE.test(kept.join(", ").replace(SCHOOL_WORDS, "").replace(/\bof\b.*$/i, ""))) {
          others.push(part);
          continue;
        }
        schoolPart = kept.join(", ");
        if (stop !== -1) others.push(pieces.slice(stop).join(", "));
      } else others.push(part);
    }
    const degree = degreeParts(others.join(", "));

    if (schoolPart) {
      current = {
        school: tidy(schoolPart).slice(0, 200),
        degree: pendingDegree?.degree ?? null,
        major: pendingDegree?.major ?? null,
        minor: null,
        gpa: null,
        gpaScale: null,
        startDate: null,
        graduationDate: null,
        monthsKnown: false,
      };
      pendingDegree = null;
      entries.push(current);
    } else if (degree && current?.degree) {
      // A second degree line before another school: it belongs to the next school.
      pendingDegree = degree;
      continue;
    }
    if (!current) {
      if (degree) pendingDegree = degree;
      continue;
    }
    if (degree && !current.degree) {
      current.degree = degree.degree;
      current.major = degree.major;
    }
    if (minor && !current.minor) current.minor = tidy(minor);
    if (gpa && current.gpa == null) {
      current.gpa = Number(gpa[1] ?? gpa[3]);
      const scale = gpa[2] ?? gpa[4];
      current.gpaScale = scale ? Number(scale) : null;
      if (current.gpaScale != null && current.gpa > current.gpaScale) [current.gpa, current.gpaScale] = [null, null];
    }
    if (range && !current.graduationDate) {
      current.startDate = range.start?.value ?? null;
      current.graduationDate = range.isCurrent ? null : (range.end?.value ?? null);
      current.monthsKnown = !!range.start?.monthKnown && !!range.end?.monthKnown;
    } else if (single && !current.graduationDate && !gpa?.[0].includes(single[1]!)) {
      const d = parseDate(single[1]!);
      if (d) {
        current.graduationDate = d.value;
        current.monthsKnown = d.monthKnown;
      }
    }
  }
  return entries.filter((e) => e.school.length > 1);
}

const LABEL_LISTS: Array<[RegExp, ResumeSkillList]> = [
  [/^(spoken )?languages?$/, "languages"],
  [/^(software|tools|platforms|systems|applications|crm|crms|tools (&|and) (software|platforms|technologies)|software (&|and) tools)$/, "software"],
  [/^(technical( skills)?|technologies|tech( stack)?|programming( languages)?|languages (&|and) frameworks|frameworks|databases|cloud|data)$/, "technicalSkills"],
];

const SECTION_LIST: Partial<Record<Section, ResumeSkillList>> = {
  skills: "skills",
  software: "software",
  technical: "technicalSkills",
  languages: "languages",
};

function parseSkills(lines: string[], fallback: ResumeSkillList, out: ResumeDraft["skills"]) {
  for (const raw of lines) {
    let line = stripBullet(raw);
    if (!line) continue;
    let list = fallback;
    const label = /^([A-Za-z][A-Za-z &/-]{1,40}):\s*(.+)$/.exec(line);
    if (label) {
      const key = headingKey(label[1]!);
      list = LABEL_LISTS.find(([re]) => re.test(key))?.[1] ?? fallback;
      line = label[2]!;
    }
    // Commas inside parentheses ("Spanish (reading, writing)") stay with their item.
    const items: string[] = [];
    let depth = 0;
    let buf = "";
    for (const ch of line) {
      if (ch === "(") depth++;
      if (ch === ")") depth = Math.max(0, depth - 1);
      if (depth === 0 && /[,;|•·▪]/.test(ch)) {
        items.push(buf);
        buf = "";
      } else buf += ch;
    }
    items.push(buf);
    for (const item of items.map(tidy)) {
      if (!item || item.length > 60 || item.split(/\s+/).length > 6 || /[.!?]$/.test(item)) continue;
      if (!out[list].some((s) => s.toLowerCase() === item.toLowerCase())) out[list].push(item);
    }
  }
}

export function parseResumeText(text: string): ResumeDraft {
  const draft = emptyResumeDraft();
  const lines = text.split("\n").map((l) => l.trim());
  const sections = splitSections(lines);
  parseHeader(sections[0]!.lines.filter(Boolean), draft);
  // A one-section resume with no headings still gets its contact details from the top lines.
  if (sections.length === 1) return draft;

  for (const { section, lines: body } of sections.slice(1)) {
    if (section === "summary" && !draft.summary) {
      const text = tidy(body.filter(Boolean).map(stripBullet).join(" "));
      draft.summary = text ? text.slice(0, 5000) : null;
    } else if (section === "experience") {
      draft.employment.push(...parseExperience(body));
    } else if (section === "education") {
      draft.education.push(...parseEducation(body));
    } else if (SECTION_LIST[section]) {
      parseSkills(body, SECTION_LIST[section]!, draft.skills);
    }
  }
  // Contact details sometimes sit at the bottom or in a sidebar.
  if (!draft.personal.email) draft.personal.email = EMAIL.exec(text)?.[0] ?? null;
  draft.currentTitle = draft.employment.find((e) => e.isCurrent)?.title ?? null;
  return draft;
}
