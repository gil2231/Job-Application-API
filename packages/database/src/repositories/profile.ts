import type { Education, Employment, MasterProfile, Prisma, Skill } from "@prisma/client";
import type { EducationInput, EmploymentInput, PersonalInput, ProfessionalInput, SkillCategory } from "@autoapply/shared";
import { prisma } from "../client";
import { NotFoundError } from "./errors";

const toNumber = (d: Prisma.Decimal | null): number | null => (d == null ? null : Number(d));

export type ProfileEducation = Omit<Education, "gpa" | "gpaScale"> & { gpa: number | null; gpaScale: number | null };
export type ProfileEmployment = Employment;
export type ProfileSkill = Omit<Skill, "yearsExperience"> & { yearsExperience: number | null };
export type FullProfile = Omit<MasterProfile, "yearsExperience"> & {
  yearsExperience: number | null;
  education: ProfileEducation[];
  employment: ProfileEmployment[];
  skills: ProfileSkill[];
};

/** Load (creating if missing) the user's Master Profile with all sections. */
export async function getFullProfile(userId: string): Promise<FullProfile> {
  const profile = await prisma.masterProfile.upsert({
    where: { userId },
    update: {},
    create: { userId },
    include: {
      education: { orderBy: [{ graduationDate: { sort: "desc", nulls: "first" } }, { sortOrder: "asc" }] },
      employment: { orderBy: [{ isCurrent: "desc" }, { startDate: "desc" }] },
      skills: { orderBy: [{ category: "asc" }, { name: "asc" }] },
    },
  });
  return {
    ...profile,
    yearsExperience: toNumber(profile.yearsExperience),
    education: profile.education.map((e) => ({ ...e, gpa: toNumber(e.gpa), gpaScale: toNumber(e.gpaScale) })),
    skills: profile.skills.map((s) => ({ ...s, yearsExperience: toNumber(s.yearsExperience) })),
  };
}

async function profileIdFor(userId: string): Promise<string> {
  const profile = await prisma.masterProfile.upsert({ where: { userId }, update: {}, create: { userId }, select: { id: true } });
  return profile.id;
}

export async function updatePersonal(userId: string, input: PersonalInput): Promise<void> {
  await prisma.masterProfile.upsert({ where: { userId }, update: input, create: { userId, ...input } });
}

const SKILL_FIELDS: Array<[keyof ProfessionalInput, SkillCategory]> = [
  ["skills", "SKILL"],
  ["software", "SOFTWARE"],
  ["technicalSkills", "TECHNICAL"],
  ["languages", "LANGUAGE"],
];

/** Save professional details and replace the skill lists in one transaction. */
export async function updateProfessional(userId: string, input: ProfessionalInput): Promise<void> {
  const profileId = await profileIdFor(userId);
  const skillRows: Prisma.SkillCreateManyInput[] = [];
  for (const [field, category] of SKILL_FIELDS) {
    const seen = new Set<string>();
    for (const name of input[field] as string[]) {
      const normalizedName = name.toLowerCase();
      if (seen.has(normalizedName)) continue;
      seen.add(normalizedName);
      skillRows.push({ profileId, name, normalizedName, category });
    }
  }
  await prisma.$transaction([
    prisma.masterProfile.update({
      where: { id: profileId },
      data: {
        currentTitle: input.currentTitle,
        targetTitles: input.targetTitles,
        summary: input.summary,
        industries: input.industries,
        yearsExperience: input.yearsExperience,
      },
    }),
    prisma.skill.deleteMany({ where: { profileId } }),
    prisma.skill.createMany({ data: skillRows }),
  ]);
}

// Education and employment rows are always looked up through the owner's profile.

export async function createEducation(userId: string, input: EducationInput) {
  const profileId = await profileIdFor(userId);
  return prisma.education.create({ data: { ...input, profileId } });
}

export async function updateEducation(userId: string, id: string, input: EducationInput) {
  const { count } = await prisma.education.updateMany({ where: { id, profile: { userId } }, data: input });
  if (count === 0) throw new NotFoundError("Education record");
}

export async function deleteEducation(userId: string, id: string) {
  const { count } = await prisma.education.deleteMany({ where: { id, profile: { userId } } });
  if (count === 0) throw new NotFoundError("Education record");
}

const employmentData = (input: EmploymentInput) => ({
  ...input,
  startDate: input.startDate!,
  endDate: input.isCurrent ? null : input.endDate,
});

export async function createEmployment(userId: string, input: EmploymentInput) {
  const profileId = await profileIdFor(userId);
  return prisma.employment.create({ data: { ...employmentData(input), profileId } });
}

export async function updateEmployment(userId: string, id: string, input: EmploymentInput) {
  const { count } = await prisma.employment.updateMany({ where: { id, profile: { userId } }, data: employmentData(input) });
  if (count === 0) throw new NotFoundError("Employment record");
}

export async function deleteEmployment(userId: string, id: string) {
  const { count } = await prisma.employment.deleteMany({ where: { id, profile: { userId } } });
  if (count === 0) throw new NotFoundError("Employment record");
}

export interface ProfileCompleteness {
  percent: number;
  missing: string[];
}

/** Which parts of the profile applications will need but are still empty. */
export function profileCompleteness(profile: FullProfile, documentCounts: { resumes: number }): ProfileCompleteness {
  const checks: Array<[string, boolean]> = [
    ["First name", !!profile.firstName],
    ["Last name", !!profile.lastName],
    ["Email", !!profile.email],
    ["Phone", !!profile.phone],
    ["City", !!profile.city],
    ["LinkedIn URL", !!profile.linkedinUrl],
    ["Current title", !!profile.currentTitle],
    ["Target titles", profile.targetTitles.length > 0],
    ["Professional summary", !!profile.summary],
    ["Skills", profile.skills.some((s) => s.category === "SKILL")],
    ["Education", profile.education.length > 0],
    ["Employment history", profile.employment.length > 0],
    ["Resume", documentCounts.resumes > 0],
  ];
  const done = checks.filter(([, ok]) => ok).length;
  return { percent: Math.round((done / checks.length) * 100), missing: checks.filter(([, ok]) => !ok).map(([label]) => label) };
}
