import { canonicalSkillKey, computeYearsOfExperience } from "@autoapply/shared";
import { detectSkills } from "../job-analysis/heuristic";
import { htmlToText } from "../job-analysis/text";

/**
 * The Master Profile as the writing features see it. Every sentence they
 * produce is checked against this; nothing outside it may be claimed.
 * A FullProfile from @autoapply/database fits this shape.
 */
export interface WritingProfile {
  firstName?: string | null;
  lastName?: string | null;
  preferredName?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  linkedinUrl?: string | null;
  portfolioUrl?: string | null;
  websiteUrl?: string | null;
  githubUrl?: string | null;
  currentTitle?: string | null;
  summary?: string | null;
  yearsExperience?: number | null;
  employment: Array<{
    company: string;
    title: string;
    location?: string | null;
    startDate: Date | string;
    endDate?: Date | string | null;
    isCurrent?: boolean;
    description?: string | null;
    responsibilities?: string[];
    achievements?: string[];
    skills?: string[];
  }>;
  education: Array<{
    school: string;
    degree?: string | null;
    major?: string | null;
    minor?: string | null;
    concentrations?: string[];
    gpa?: number | null;
    gpaScale?: number | null;
    startDate?: Date | string | null;
    graduationDate?: Date | string | null;
    coursework?: string[];
  }>;
  skills: Array<{ name: string; category?: string }>;
}

export interface WritingJob {
  id: string;
  title: string;
  company: string;
  description?: string | null;
  /** Skills from the job analysis, when it has run. */
  skills?: string[];
}

/** One resume bullet from the profile, with a stable id the model can refer to. */
export interface ProfileBullet {
  id: string;
  text: string;
}

export interface ProfileRole {
  id: string;
  index: number;
  company: string;
  title: string;
  bullets: ProfileBullet[];
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** Each role's achievements and responsibilities as bullets, achievements first. */
export function profileRoles(profile: WritingProfile): ProfileRole[] {
  return profile.employment.map((e, i) => {
    const id = `r${i + 1}`;
    const texts = [...(e.achievements ?? []), ...(e.responsibilities ?? [])].map(clean).filter(Boolean);
    if (!texts.length && clean(e.description)) {
      texts.push(...clean(e.description).split(/(?<=[.!?])\s+(?=[A-Z])/).map(clean).filter(Boolean));
    }
    const unique = [...new Set(texts)];
    return { id, index: i, company: e.company, title: e.title, bullets: unique.map((text, j) => ({ id: `${id}.b${j + 1}`, text })) };
  });
}

/** Every skill the profile shows: the skills list plus skills named on roles. */
export function profileSkillNames(profile: WritingProfile): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const name of [...profile.skills.map((s) => s.name), ...profile.employment.flatMap((e) => e.skills ?? [])]) {
    const key = canonicalSkillKey(name);
    if (!name.trim() || seen.has(key)) continue;
    seen.add(key);
    out.push(name.trim());
  }
  return out;
}

export function fullName(profile: WritingProfile): string {
  return [clean(profile.firstName), clean(profile.lastName)].filter(Boolean).join(" ");
}

export function yearsOfExperience(profile: WritingProfile, now = new Date()): number | null {
  if (profile.yearsExperience != null) return Math.floor(profile.yearsExperience);
  if (!profile.employment.length) return null;
  return Math.floor(computeYearsOfExperience(profile.employment, now));
}

const monthYear = (d: Date | string | null | undefined) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" }) : null);

export function roleDates(e: WritingProfile["employment"][number]): string {
  const start = monthYear(e.startDate);
  const end = e.isCurrent || !e.endDate ? "Present" : monthYear(e.endDate);
  return [start, end].filter(Boolean).join(" – ");
}

/**
 * The profile written out as plain facts, with ids for bullets. This is all the
 * model is told about the person, and what generated text is checked against.
 */
export function factSheet(profile: WritingProfile, now = new Date()): string {
  const lines: string[] = [];
  const name = fullName(profile);
  if (name) lines.push(`Name: ${name}`);
  if (profile.currentTitle) lines.push(`Current title: ${clean(profile.currentTitle)}`);
  const location = [profile.city, profile.state, profile.country].map(clean).filter(Boolean).join(", ");
  if (location) lines.push(`Location: ${location}`);
  const years = yearsOfExperience(profile, now);
  if (years != null) lines.push(`Total professional experience: ${years} years`);
  if (profile.summary) lines.push(`Own summary: ${clean(profile.summary)}`);
  const roles = profileRoles(profile);
  if (roles.length) lines.push("", "Employment:");
  profile.employment.forEach((e, i) => {
    const role = roles[i]!;
    lines.push(`[${role.id}] ${clean(e.title)} at ${clean(e.company)}${e.location ? `, ${clean(e.location)}` : ""} (${roleDates(e)})`);
    for (const b of role.bullets) lines.push(`  [${b.id}] ${b.text}`);
    if (e.skills?.length) lines.push(`  Skills used: ${e.skills.join(", ")}`);
  });
  if (profile.education.length) lines.push("", "Education:");
  for (const ed of profile.education) {
    const credential = [clean(ed.degree), clean(ed.major) ? `in ${clean(ed.major)}` : ""].filter(Boolean).join(" ");
    const grad = monthYear(ed.graduationDate);
    lines.push(`- ${clean(ed.school)}${credential ? `: ${credential}` : ""}${ed.minor ? `, minor in ${clean(ed.minor)}` : ""}${grad ? ` (${grad})` : ""}${ed.gpa != null ? `, GPA ${ed.gpa}${ed.gpaScale ? `/${ed.gpaScale}` : ""}` : ""}`);
    if (ed.concentrations?.length) lines.push(`  Concentrations: ${ed.concentrations.join(", ")}`);
    if (ed.coursework?.length) lines.push(`  Coursework: ${ed.coursework.join(", ")}`);
  }
  const skills = profileSkillNames(profile);
  if (skills.length) lines.push("", `Skills: ${skills.join(", ")}`);
  return lines.join("\n");
}

/** Skills the job asks for, from its analysis or its description. */
export function jobSkills(job: WritingJob, profileSkills: string[]): string[] {
  const fromText = job.description ? detectSkills(`${job.title}\n${htmlToText(job.description)}`, profileSkills) : detectSkills(job.title, profileSkills);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of [...(job.skills ?? []), ...fromText]) {
    const key = canonicalSkillKey(s);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}
