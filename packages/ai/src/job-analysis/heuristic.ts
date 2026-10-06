import {
  canonicalSkill,
  canonicalSkillKey,
  parseSalary,
  SKILL_TERMS,
  type EducationLevel,
  type EmploymentType,
  type JobAnalysis,
  type SeniorityLevel,
  type WorkArrangement,
} from "@autoapply/shared";
import { htmlToText, sentenceAround, termPattern } from "./text";
import type { JobAnalysisInput } from "./types";

// ── Sections ────────────────────────────────────────────────────────────────

type SectionKind = "required" | "preferred" | "other";

const PREFERRED_HEADING = /(preferred|nice[- ]to[- ]haves?|bonus( points)?|pluses|\bplus\b|desired|ideal(ly)?|extra credit|stand out|even better)/i;
const REQUIRED_HEADING =
  /(requirements|required|qualifications|what you('|’)ll need|what you need|what we('|’)re looking for|what you bring|you bring|must[- ]haves?|you have|who you are|about you|minimum|basic qualifications|skills|experience)/i;
const OTHER_HEADING =
  /(responsibilit|what you('|’)ll do|the role|about (us|the (company|team|role))|benefits|perks|compensation|our (team|mission|values)|why join|equal opportunity|how to apply|day[- ]to[- ]day|in this role)/i;
const COMMON_HEADING =
  /^(requirements|qualifications|(minimum|basic|preferred|required|additional) qualifications|nice[- ]to[- ]haves?|what you('|’)ll (need|do|bring)|responsibilities|about you|who you are|what we('|’)re looking for|bonus points|benefits|about us|about the (role|team|company)|the role|you have|you bring|must[- ]haves?|skills|experience|perks)$/i;
const BULLET =/^\s*([•·▪◦*‣\-–—]|\d{1,2}[.)])\s+/;

function headingKind(line: string): SectionKind | null {
  const text = line.replace(/[:：]\s*$/, "").trim();
  if (!text || text.length > 70 || BULLET.test(line)) return null;
  if (/[.!?]$/.test(text)) return null;
  const words = text.split(/\s+/);
  const titleCase = words.every((w) => !/^[a-z]/.test(w) || /^(a|an|and|the|of|to|for|in|on)$/.test(w)) && !/^(experience|familiarity|knowledge|proficiency|ability|strong|excellent)\b/i.test(text);
  const looksLikeHeading =
    /[:：]\s*$/.test(line) || COMMON_HEADING.test(text) || (words.length <= 6 && !/\d/.test(text) && (titleCase || text === text.toUpperCase()));
  if (!looksLikeHeading) return null;
  if (PREFERRED_HEADING.test(text)) return "preferred";
  if (OTHER_HEADING.test(text)) return "other";
  if (REQUIRED_HEADING.test(text)) return "required";
  return null;
}

interface Sections {
  required: string[];
  preferred: string[];
  /** Text outside any preferred section (used for requirement extraction). */
  requiredText: string;
}

export function splitSections(text: string): Sections {
  const required: string[] = [];
  const preferred: string[] = [];
  const outsidePreferred: string[] = [];
  let current: SectionKind | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const kind = headingKind(line);
    if (kind) {
      current = kind;
      continue;
    }
    if (current !== "preferred") outsidePreferred.push(line);
    const item = line.replace(BULLET, "").trim();
    if (item.length < 3) continue;
    if (current === "required" && required.length < 25) required.push(item.slice(0, 300));
    if (current === "preferred" && preferred.length < 25) preferred.push(item.slice(0, 300));
  }
  return { required, preferred, requiredText: outsidePreferred.join("\n") };
}

// ── Individual extractors ───────────────────────────────────────────────────

export function detectSeniority(title: string, experienceYearsMin: number | null): SeniorityLevel | null {
  const t = title.toLowerCase();
  if (/\bintern(ship)?\b|\bco-?op\b/.test(t)) return "INTERN";
  if (/\b(chief|vp|svp|evp|vice president|head of|cto|ceo|cfo|coo|cmo|cro|president)\b/.test(t)) return "EXECUTIVE";
  if (/\bdirector\b/.test(t)) return "DIRECTOR";
  if (/\b(manager|management)\b/.test(t) && !/\b(account|product|project|program|success|case|community|partner|territory|channel|marketing|content|social media)\s+manager\b/.test(t)) {
    return "MANAGER";
  }
  if (/\b(lead|staff|principal|architect|distinguished)\b/.test(t)) return "LEAD";
  if (/\b(senior|sr\.?|iii|iv)\b/.test(t)) return "SENIOR";
  if (/\b(junior|jr\.?|entry[- ]level|entry|graduate|new grad|apprentice|trainee)\b|\b(i)$/.test(t)) return "ENTRY";
  if (/\b(bdr|sdr|business development representative|sales development representative)\b/.test(t)) return "ENTRY";
  if (/\bassociate\b/.test(t) && !/\bassociate (director|vice president|vp|partner)\b/.test(t)) return "ENTRY";
  if (experienceYearsMin != null) return experienceYearsMin < 2 ? "ENTRY" : experienceYearsMin < 5 ? "MID" : "SENIOR";
  return null;
}

const DEPARTMENTS: Array<[string, RegExp]> = [
  ["Sales", /\b(sales|account executive|ae|bdr|sdr|business development|account manager|territory|inside sales|sales engineer)\b/i],
  ["Customer Success", /\b(customer success|customer support|support (engineer|specialist)|customer experience|csm|client success|account management)\b/i],
  ["Engineering", /\b(engineer(ing)?|developer|software|devops|sre|programmer|qa|quality assurance|firmware)\b/i],
  ["Data", /\b(data|analytics|machine learning|ml|scientist|bi analyst|business intelligence)\b/i],
  ["Product", /\b(product manager|product owner|product management|product lead)\b/i],
  ["Design", /\b(designer|design|ux|ui|user experience|researcher)\b/i],
  ["Marketing", /\b(marketing|growth|seo|content|brand|communications|social media|demand gen)\b/i],
  ["Finance", /\b(finance|financial|accountant|accounting|controller|fp&a|treasury|tax|audit)\b/i],
  ["People", /\b(recruit(er|ing)|talent|people|hr|human resources|payroll)\b/i],
  ["Legal", /\b(legal|counsel|attorney|lawyer|paralegal|compliance)\b/i],
  ["Operations", /\b(operations|ops|logistics|supply chain|procurement|program manager|project manager)\b/i],
  ["IT", /\b(it support|help ?desk|system administrator|sysadmin|network)\b/i],
];

export function detectDepartment(title: string): string | null {
  for (const [name, pattern] of DEPARTMENTS) if (pattern.test(title)) return name;
  return null;
}

export function detectWorkArrangement(title: string, location: string | null, text: string): WorkArrangement {
  const head = `${title}\n${location ?? ""}`;
  if (/\bhybrid\b/i.test(head)) return "HYBRID";
  if (/\bremote\b/i.test(head) && !/\b(not|non)[- ]remote\b/i.test(head)) return "REMOTE";
  if (/\b(not|non)[- ]remote\b|\bnot (a )?remote (role|position|job)\b|\bremote work is not\b/i.test(text)) return "ONSITE";
  if (/\bhybrid\b/i.test(text)) return "HYBRID";
  if (/\b(fully remote|100% remote|remote[- ]first|work from (home|anywhere)|remote (role|position|job|opportunity)|this (role|position) is remote|remote within|remote \(|\bremote, )/i.test(text)) return "REMOTE";
  if (/\b(on[- ]?site|in[- ]office|in the office|in[- ]person)\b/i.test(text)) return "ONSITE";
  return "UNKNOWN";
}

export function detectEmploymentType(title: string, text: string): EmploymentType | null {
  if (/\bintern(ship)?\b|\bco-?op\b/i.test(title)) return "INTERNSHIP";
  if (/\b(contract(or)?|contract-to-hire|1099|c2c|corp[- ]to[- ]corp)\b/i.test(title)) return "CONTRACT";
  if (/\bpart[- ]time\b/i.test(title)) return "PART_TIME";
  if (/\b(temporary|temp|seasonal)\b/i.test(title)) return "TEMPORARY";
  if (/\bfreelance\b/i.test(title)) return "FREELANCE";
  if (/\bfull[- ]time\b/i.test(text)) return "FULL_TIME";
  if (/\bpart[- ]time\b/i.test(text)) return "PART_TIME";
  if (/\b(this is a contract|contract (role|position)|contract-to-hire|1099 contractor|w2 contract)\b/i.test(text)) return "CONTRACT";
  if (/\binternship\b/i.test(text)) return "INTERNSHIP";
  if (/\b(temporary (role|position)|seasonal (role|position))\b/i.test(text)) return "TEMPORARY";
  return null;
}

export const COMMISSION_ONLY = /\b(commission[- ]only|100% commission|commission[- ]based only|straight commission|uncapped commission only|no base salary)\b/i;

const SALARY_CANDIDATE =
  /(?:USD|CAD|GBP|EUR|AUD|[$£€])\s?\d[\d,.]*\s*[kK]?(?:\s*(?:-|–|—|to)\s*(?:USD|CAD|GBP|EUR|AUD|[$£€])?\s?\d[\d,.]*\s*[kK]?)?(?:\s*(?:USD|CAD|GBP|EUR|AUD))?(?:\s*(?:per|an|a|\/)\s*(?:hour|hr|year|yr|annum|month))?/g;

export function detectSalary(salaryText: string | null | undefined, text: string): JobAnalysis["salary"] {
  const candidates = salaryText ? [salaryText] : [];
  for (const match of text.matchAll(SALARY_CANDIDATE)) candidates.push(match[0]);
  for (const candidate of candidates) {
    const parsed = parseSalary(candidate);
    // Ignore amounts that can't be pay (e.g. "$5M ARR", "$1B in funding") or are implausibly low.
    if (!parsed || parsed.annualMax < 15_000 || parsed.annualMax > 2_000_000) continue;
    return { text: candidate.trim(), ...parsed };
  }
  return null;
}

const YEARS =
  /(?:(?:minimum|at least|min\.?)\s+(?:of\s+)?)?(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|–|to)\s*\d{1,2}\s*)?\+?\s*(?:years?|yrs?)(?:'|’)?\s+(?:of\s+)?(?:[\w/&-]+\s+){0,5}?(?:experience|exp\b)/gi;

export function detectExperienceYears(requiredText: string, fullText: string): number | null {
  const find = (text: string) => [...text.matchAll(YEARS)].map((m) => Number(m[1])).filter((n) => n > 0 && n <= 30);
  const required = find(requiredText);
  const values = required.length ? required : find(fullText);
  return values.length ? Math.min(...values) : null;
}

const EDUCATION_PATTERNS: Array<[EducationLevel, RegExp]> = [
  ["HIGH_SCHOOL", /\b(high school( diploma)?|ged)\b/i],
  ["ASSOCIATE", /\bassociate(?:'|’)?s? degree\b/i],
  ["BACHELOR", /\b(bachelor(?:'|’)?s?|undergraduate degree|4[- ]year degree|four[- ]year degree|college degree|university degree|B\.S\.|B\.A\.|BS\/BA|BA\/BS)\b/i],
  ["MASTER", /\b(master(?:'|’)?s?( degree)?|MBA|M\.S\.|graduate degree)\b/i],
  ["DOCTORATE", /\b(ph\.?d\.?|doctorate|doctoral degree)\b/i],
];
const LEVEL_ORDER: EducationLevel[] = ["NONE", "HIGH_SCHOOL", "ASSOCIATE", "BACHELOR", "MASTER", "DOCTORATE"];

export function detectEducation(requiredText: string, fullText: string): JobAnalysis["education"] {
  const search = (text: string) => {
    const found: Array<{ level: EducationLevel; index: number }> = [];
    for (const [level, pattern] of EDUCATION_PATTERNS) {
      const m = pattern.exec(text);
      if (m) found.push({ level, index: m.index });
    }
    return found;
  };
  // Degrees mentioned only under "preferred" are not requirements.
  const found = search(requiredText);
  const text = requiredText;
  if (!found.length) {
    return /\bno degree (is )?required\b|\bdegree not required\b/i.test(fullText)
      ? { level: "NONE", text: "No degree required", equivalentExperienceAccepted: true }
      : null;
  }
  const lowest = found.sort((a, b) => LEVEL_ORDER.indexOf(a.level) - LEVEL_ORDER.indexOf(b.level))[0]!;
  return {
    level: lowest.level,
    text: sentenceAround(text, lowest.index),
    equivalentExperienceAccepted: /\b(or )?equivalent (practical |professional |work |relevant )?(experience|combination)|or related experience|in lieu of a degree\b/i.test(fullText),
  };
}

const NO_SPONSORSHIP = [
  /\b(unable|not able|cannot|can ?not|will not|won(?:'|’)t|do(?:es)? not|are not able to|is not able to)\s+(?:to\s+)?(?:currently\s+)?(?:provide|offer|support)?\s*(?:visa\s+|immigration\s+|employment\s+)?sponsor(ship)?/i,
  /\bno (?:visa |immigration )?sponsorship\b/i,
  /\bwithout (?:the need for )?(?:current or future |now or in the future )?(?:visa |employer |company )?sponsorship\b/i,
  /\bsponsorship (?:is )?not (?:available|provided|offered|possible)\b/i,
  /\bnot (?:eligible|able) (?:for|to offer) (?:visa )?sponsorship\b/i,
];
const YES_SPONSORSHIP = [
  /\b(?:visa |h-?1b |immigration )?sponsorship (?:is )?(?:available|provided|offered)\b/i,
  /\b(?:we|will|can|able to) (?:also )?sponsor (?:visas?|h-?1b|work (?:visas?|authorization))\b/i,
  /\bopen to sponsor(?:ing|ship)\b/i,
];

export function detectSponsorship(text: string): JobAnalysis["sponsorship"] {
  for (const pattern of NO_SPONSORSHIP) {
    const m = pattern.exec(text);
    if (m) return { available: false, text: sentenceAround(text, m.index) };
  }
  for (const pattern of YES_SPONSORSHIP) {
    const m = pattern.exec(text);
    if (m) return { available: true, text: sentenceAround(text, m.index) };
  }
  return { available: null, text: null };
}

export function detectTravel(text: string): JobAnalysis["travel"] {
  const percent = /(\d{1,3})\s*%\s*(?:of\s+(?:the\s+)?time\s+)?(?:domestic\s+|international\s+|overnight\s+)?travel|travel\s*(?:requirements?)?\s*[:(]?\s*(?:up to|of|approximately|about|around|~)?\s*(\d{1,3})\s*%/i.exec(text);
  if (percent) {
    const value = Number(percent[1] ?? percent[2]);
    if (value >= 0 && value <= 100) return { required: value > 0, percent: value, text: sentenceAround(text, percent.index) };
  }
  const none = /\bno travel\b|\btravel (?:is )?not required\b|\bminimal travel\b/i.exec(text);
  if (none) return { required: false, percent: null, text: sentenceAround(text, none.index) };
  const some = /\btravel (?:is )?required\b|\b(?:willing(?:ness)?|able|ability) to travel\b|\bfrequent travel\b|\bregular travel\b|\bwill travel\b|\btravel to (?:client|customer)/i.exec(text);
  if (some) return { required: true, percent: null, text: sentenceAround(text, some.index) };
  return { required: null, percent: null, text: null };
}

const INDUSTRIES: Array<[string, RegExp]> = [
  ["Software", /\b(saas|software|cloud platform|developer tools|b2b software|enterprise software)\b/gi],
  ["Fintech", /\b(fintech|payments?|banking|neobank|lending|financial services|trading platform)\b/gi],
  ["Healthcare", /\b(healthcare|health care|health tech|healthtech|clinical|patients?|hospitals?|medical)\b/gi],
  ["Biotech", /\b(biotech|pharma(ceutical)?s?|life sciences|drug discovery)\b/gi],
  ["E-commerce", /\b(e-?commerce|online retail|marketplace|direct[- ]to[- ]consumer|dtc)\b/gi],
  ["Retail", /\b(retail|consumer goods|cpg)\b/gi],
  ["Education", /\b(edtech|education|students|learning platform|universit(y|ies)|schools?)\b/gi],
  ["Cybersecurity", /\b(cybersecurity|security platform|threat detection|zero trust)\b/gi],
  ["Insurance", /\b(insurance|insurtech|underwriting)\b/gi],
  ["Real estate", /\b(real estate|proptech|property management)\b/gi],
  ["Marketing technology", /\b(martech|adtech|advertising technology)\b/gi],
  ["Logistics", /\b(logistics|supply chain|freight|shipping|fulfillment)\b/gi],
  ["Media", /\b(media|publishing|streaming|entertainment)\b/gi],
  ["Gaming", /\b(gaming|video games?|game studio)\b/gi],
  ["Hospitality", /\b(hospitality|hotels?|restaurants?|travel industry)\b/gi],
  ["Government", /\b(government|public sector|federal agency)\b/gi],
  ["Nonprofit", /\b(non-?profit|charity|mission-driven organization)\b/gi],
  ["Telecommunications", /\b(telecom(munications)?|wireless carrier)\b/gi],
  ["Energy", /\b(energy|renewables?|solar|utilities|oil and gas)\b/gi],
  ["Automotive", /\b(automotive|vehicles?|ev charging)\b/gi],
  ["Manufacturing", /\b(manufacturing|industrial|factory)\b/gi],
  ["Staffing", /\b(staffing agency|recruiting agency|staffing firm)\b/gi],
  ["Consulting", /\b(consulting firm|management consulting|professional services)\b/gi],
  ["Artificial intelligence", /\b(artificial intelligence|ai[- ]powered|generative ai|ai company)\b/gi],
];

export function detectIndustry(text: string): string | null {
  let best: { name: string; count: number } | null = null;
  for (const [name, pattern] of INDUSTRIES) {
    const count = [...text.matchAll(pattern)].length;
    if (count >= 2 && (!best || count > best.count)) best = { name, count };
  }
  return best?.name ?? null;
}

/** Skills mentioned in the posting: the shared vocabulary plus the user's own skills. */
export function detectSkills(text: string, knownSkills: string[] = []): string[] {
  const found: Array<{ name: string; index: number }> = [];
  const seen = new Set<string>();
  const consider = (name: string, term: string) => {
    const key = canonicalSkillKey(name);
    if (seen.has(key)) return;
    const m = termPattern(term).exec(text);
    if (m) {
      seen.add(key);
      found.push({ name, index: m.index });
    }
  };
  // The user's own skills first, so their spelling is kept and short names like "Go" still match.
  for (const skill of knownSkills) if (skill.trim().length >= 1) consider(canonicalSkill(skill), skill);
  for (const term of SKILL_TERMS) if (term.searchable) consider(term.canonical, term.term);
  return found.sort((a, b) => a.index - b.index).map((f) => f.name).slice(0, 40);
}

// ── Analyzer ────────────────────────────────────────────────────────────────

/** Deterministic analysis: works without any AI provider and never invents facts. */
export function analyzeJobHeuristically(input: JobAnalysisInput, now: Date = new Date()): JobAnalysis {
  const description = input.description ? htmlToText(input.description) : "";
  const full = `${input.title}\n${description}`;
  const sections = splitSections(description);
  const experienceYearsMin = detectExperienceYears(sections.requiredText, description);
  const workArrangement =
    input.workArrangement && input.workArrangement !== "UNKNOWN" ? input.workArrangement : detectWorkArrangement(input.title, input.location ?? null, description);

  return {
    version: 1,
    method: "heuristic",
    analyzedAt: now.toISOString(),
    hasDescription: description.length >= 80,
    company: input.company,
    role: input.title,
    department: detectDepartment(input.title),
    seniority: detectSeniority(input.title, experienceYearsMin),
    location: input.location ?? null,
    workArrangement,
    employmentType: detectEmploymentType(input.title, description),
    commissionOnly: COMMISSION_ONLY.test(full) || COMMISSION_ONLY.test(input.salaryText ?? ""),
    salary: detectSalary(input.salaryText, description),
    requiredQualifications: sections.required,
    preferredQualifications: sections.preferred,
    experienceYearsMin,
    education: detectEducation(sections.requiredText, description),
    skills: detectSkills(full, input.knownSkills),
    industry: detectIndustry(full),
    sponsorship: detectSponsorship(description),
    travel: detectTravel(description),
    platform: input.platform,
  };
}
