import { RESUME_PERSONAL_FIELDS, RESUME_SKILL_LISTS, type ResumeDraft } from "@autoapply/shared";
import { textMentionsMonth } from "./dates";

/**
 * The resume-import counterpart of checkClaims: every value in a draft must be
 * written in the resume. A model's answer is checked field by field, and
 * anything it can't be traced to is dropped and listed, never kept.
 */

const squash = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9%$+#&']+/g, " ")
    .trim();
const urlKey = (s: string) => squash(s.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/+$/, ""));

export interface GroundedDraft {
  draft: ResumeDraft;
  removed: string[];
}

export function groundDraft(draft: ResumeDraft, resumeText: string): GroundedDraft {
  const source = ` ${squash(resumeText)} `;
  const digits = resumeText.replace(/\D/g, "");
  const has = (value: string) => {
    const v = squash(value);
    return !!v && source.includes(` ${v} `);
  };
  const removed: string[] = [];
  const keep = (label: string, value: string | null | undefined, ok: (v: string) => boolean = has): string | null => {
    if (value == null || value.trim() === "") return null;
    if (ok(value)) return value.trim();
    removed.push(`${label} "${value}"`);
    return null;
  };
  const year = (ym: string | null) => (ym && resumeText.includes(ym.slice(0, 4)) ? ym : null);

  const personal = { ...draft.personal };
  for (const key of RESUME_PERSONAL_FIELDS) {
    const value = personal[key];
    if (key === "phone") {
      personal[key] = keep("phone", value, (v) => v.replace(/\D/g, "").length >= 7 && digits.includes(v.replace(/\D/g, "")));
    } else if (key.endsWith("Url")) {
      personal[key] = keep("link", value, (v) => ` ${squash(resumeText.replace(/https?:\/\/(www\.)?|www\./gi, ""))} `.includes(` ${urlKey(v)} `));
    } else if (key === "email") {
      personal[key] = keep("email", value, (v) => resumeText.toLowerCase().includes(v.toLowerCase()));
    } else {
      personal[key] = keep(key.replace(/([A-Z])/g, " $1").toLowerCase(), value);
    }
  }

  const skills = Object.fromEntries(
    RESUME_SKILL_LISTS.map((list) => [list, draft.skills[list].filter((s) => keep("skill", s) !== null)]),
  ) as ResumeDraft["skills"];

  const employment = draft.employment.flatMap((job) => {
    const company = keep("employer", job.company);
    const title = keep("job title", job.title);
    if (!company || !title) return [];
    const startDate = year(job.startDate);
    const endDate = job.isCurrent ? null : year(job.endDate);
    const monthsKnown =
      job.monthsKnown &&
      !!startDate &&
      textMentionsMonth(resumeText, startDate) &&
      (job.isCurrent || (!!endDate && textMentionsMonth(resumeText, endDate)));
    return [
      {
        ...job,
        company,
        title,
        location: keep("location", job.location),
        startDate,
        endDate,
        monthsKnown,
        responsibilities: job.responsibilities.filter((b) => keep("bullet", b) !== null),
        achievements: job.achievements.filter((b) => keep("bullet", b) !== null),
      },
    ];
  });

  const education = draft.education.flatMap((ed) => {
    const school = keep("school", ed.school);
    if (!school) return [];
    const gpaOk = (n: number | null) => n == null || new RegExp(`(^|[^\\d.])${String(n).replace(".", "\\.")}0*($|[^\\d])`).test(resumeText);
    const gpa = gpaOk(ed.gpa) ? ed.gpa : (removed.push(`GPA "${ed.gpa}"`), null);
    const startDate = year(ed.startDate);
    const graduationDate = year(ed.graduationDate);
    return [
      {
        ...ed,
        school,
        degree: keep("degree", ed.degree),
        major: keep("major", ed.major),
        minor: keep("minor", ed.minor),
        gpa,
        gpaScale: gpa != null && gpaOk(ed.gpaScale) ? ed.gpaScale : null,
        startDate,
        graduationDate,
        monthsKnown:
          ed.monthsKnown &&
          [startDate, graduationDate].every((d) => d == null || textMentionsMonth(resumeText, d)) &&
          !!(startDate || graduationDate),
      },
    ];
  });

  return {
    draft: {
      personal,
      currentTitle: keep("current title", draft.currentTitle),
      summary: keep("summary", draft.summary),
      skills,
      employment,
      education,
    },
    removed: [...new Set(removed)],
  };
}
