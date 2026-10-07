"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, Briefcase, FileUp, GraduationCap, Info, Loader2, Sparkles } from "lucide-react";
import {
  RESUME_PERSONAL_FIELDS,
  type DraftEducation,
  type DraftEmployment,
  type ResumeDraft,
  type ResumePersonalField,
  type ResumeReading,
} from "@autoapply/shared";
import { confirmResumeImportAction, readResumeAction } from "@/actions/resume-import";
import { Field, FormMessage } from "@/components/form";
import { TagInput } from "@/components/tag-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export interface CurrentProfile {
  personal: Record<ResumePersonalField, string | null>;
  currentTitle: string | null;
  summary: string | null;
  skills: string[];
  employment: Array<{ company: string; title: string }>;
  education: string[];
}

type Reading = ResumeReading & { fileName: string };

const PERSONAL_LABELS: Record<ResumePersonalField, string> = {
  firstName: "First name",
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  city: "City",
  state: "State / province",
  postalCode: "Postal code",
  country: "Country",
  linkedinUrl: "LinkedIn",
  githubUrl: "GitHub",
  portfolioUrl: "Portfolio",
  websiteUrl: "Website",
};

const SKILL_LISTS = [
  ["skills", "Skills"],
  ["software", "Software"],
  ["technicalSkills", "Technical skills"],
  ["languages", "Languages"],
] as const;

const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase();
const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

interface ScalarRow {
  value: string;
  include: boolean;
  current: string | null;
}

interface EmploymentRow extends Omit<DraftEmployment, "responsibilities" | "achievements"> {
  include: boolean;
  duplicate: boolean;
  responsibilities: string;
  achievements: string;
}

interface EducationRow extends Omit<DraftEducation, "gpa" | "gpaScale"> {
  include: boolean;
  duplicate: boolean;
  gpa: string;
  gpaScale: string;
}

interface ReviewState {
  personal: Record<ResumePersonalField, ScalarRow>;
  currentTitle: ScalarRow;
  summary: ScalarRow;
  skills: Record<(typeof SKILL_LISTS)[number][0], string[]>;
  skippedSkills: number;
  employment: EmploymentRow[];
  education: EducationRow[];
}

/** A resume value is pre-selected when the profile has nothing there yet, or the same thing. */
const scalar = (value: string | null, current: string | null): ScalarRow => ({ value: value ?? "", include: !!value && (!current || same(value, current)), current });

function toReview(draft: ResumeDraft, current: CurrentProfile): ReviewState {
  const owned = new Set(current.skills.map(key));
  let skippedSkills = 0;
  const skills = Object.fromEntries(
    SKILL_LISTS.map(([list]) => [
      list,
      draft.skills[list].filter((s) => {
        if (!owned.has(key(s))) return true;
        skippedSkills++;
        return false;
      }),
    ]),
  ) as ReviewState["skills"];
  const jobs = new Set(current.employment.map((e) => `${key(e.company)}|${key(e.title)}`));
  const schools = new Set(current.education.map(key));
  return {
    personal: Object.fromEntries(RESUME_PERSONAL_FIELDS.map((k) => [k, scalar(draft.personal[k], current.personal[k])])) as ReviewState["personal"],
    currentTitle: scalar(draft.currentTitle, current.currentTitle),
    summary: scalar(draft.summary, current.summary),
    skills,
    skippedSkills,
    employment: draft.employment.map((e) => {
      const duplicate = jobs.has(`${key(e.company)}|${key(e.title)}`);
      return { ...e, include: !duplicate, duplicate, responsibilities: e.responsibilities.join("\n"), achievements: e.achievements.join("\n") };
    }),
    education: draft.education.map((e) => {
      const duplicate = schools.has(key(e.school));
      return { ...e, include: !duplicate, duplicate, gpa: e.gpa == null ? "" : String(e.gpa), gpaScale: e.gpaScale == null ? "" : String(e.gpaScale) };
    }),
  };
}

const lines = (s: string) => s.split("\n").map((l) => l.trim()).filter(Boolean);
const orNull = (s: string) => (s.trim() ? s.trim() : null);

export function ResumeImport({
  current,
  resumes,
  aiOn,
  hasResume,
}: {
  current: CurrentProfile;
  resumes: Array<{ id: string; label: string; fileName: string }>;
  aiOn: boolean;
  hasResume: boolean;
}) {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [documentId, setDocumentId] = useState<string>("");
  const [reading, setReading] = useState<Reading | null>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [saveResume, setSaveResume] = useState(!hasResume);
  const [error, setError] = useState<{ message?: string; errors?: Record<string, string> } | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const read = () => {
    setError(null);
    const fd = new FormData();
    if (file) fd.set("file", file);
    else if (documentId) fd.set("documentId", documentId);
    else {
      setError({ message: "Choose your resume file" });
      return;
    }
    startTransition(async () => {
      const result = await readResumeAction(fd);
      if (!result.ok || !result.data) {
        setError({ message: result.message ?? "Something went wrong. Please try again." });
        return;
      }
      setReading(result.data);
      setReview(toReview(result.data.draft, current));
      window.scrollTo({ top: 0 });
    });
  };

  const save = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!review) return;
    setError(null);
    const form = new FormData(event.currentTarget);
    const personal: Record<string, string> = {};
    for (const k of RESUME_PERSONAL_FIELDS) {
      const row = review.personal[k];
      if (row.include && row.value.trim()) personal[k] = row.value.trim();
    }
    const payload = {
      personal,
      ...(review.currentTitle.include && review.currentTitle.value.trim() ? { currentTitle: review.currentTitle.value } : {}),
      ...(review.summary.include && review.summary.value.trim() ? { summary: review.summary.value } : {}),
      skills: Object.fromEntries(SKILL_LISTS.map(([list]) => [list, lines(String(form.get(`skills.${list}`) ?? ""))])),
      employment: review.employment
        .filter((e) => e.include)
        .map((e) => ({
          company: e.company,
          title: e.title,
          location: orNull(e.location ?? ""),
          startDate: e.startDate || null,
          endDate: e.isCurrent ? null : e.endDate || null,
          isCurrent: e.isCurrent,
          responsibilities: lines(e.responsibilities),
          achievements: lines(e.achievements),
        })),
      education: review.education
        .filter((e) => e.include)
        .map((e) => ({
          school: e.school,
          degree: orNull(e.degree ?? ""),
          major: orNull(e.major ?? ""),
          minor: orNull(e.minor ?? ""),
          gpa: e.gpa.trim() || null,
          gpaScale: e.gpaScale.trim() || null,
          startDate: e.startDate || null,
          graduationDate: e.graduationDate || null,
        })),
      saveResume: !!file && saveResume,
    };
    const fd = new FormData();
    fd.set("payload", JSON.stringify(payload));
    if (payload.saveResume && file) fd.set("file", file);
    startTransition(async () => {
      const result = await confirmResumeImportAction(fd);
      if (!result.ok) {
        setError({ message: result.message, errors: errorsByRow(result.errors, review) });
        return;
      }
      toast.success(result.message ?? "Profile updated");
      router.push("/profile");
    });
  };

  if (!review || !reading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FileUp className="size-4" />
            Choose your resume
          </CardTitle>
          <CardDescription>
            PDF, Word (.docx) or text, up to 10 MB.{" "}
            {aiOn
              ? "Your AI provider reads it, and every value it finds is checked against the resume text."
              : "The built-in reader finds your contact details, work history, education and skills. Turn on AI in Settings for resumes with unusual layouts."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <FormMessage state={error ? { ok: false, message: error.message } : undefined} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Upload a file" htmlFor="resume-file">
              <Input
                ref={fileInput}
                id="resume-file"
                type="file"
                accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  if (e.target.files?.[0]) setDocumentId("");
                }}
              />
            </Field>
            {resumes.length > 0 && (
              <Field label="Or use a resume in Documents" htmlFor="resume-document">
                <Select
                  value={documentId}
                  onValueChange={(v) => {
                    setDocumentId(v);
                    setFile(null);
                    if (fileInput.current) fileInput.current.value = "";
                  }}
                >
                  <SelectTrigger id="resume-document" className="w-full">
                    <SelectValue placeholder="Choose a resume" />
                  </SelectTrigger>
                  <SelectContent>
                    {resumes.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>
          <div>
            <Button onClick={read} disabled={pending || (!file && !documentId)}>
              {pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
              {pending ? "Reading your resume…" : "Read resume"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const e = error?.errors ?? {};
  const set = (patch: Partial<ReviewState>) => setReview({ ...review, ...patch });
  const setJob = (i: number, patch: Partial<EmploymentRow>) => set({ employment: review.employment.map((row, j) => (j === i ? { ...row, ...patch } : row)) });
  const setSchool = (i: number, patch: Partial<EducationRow>) => set({ education: review.education.map((row, j) => (j === i ? { ...row, ...patch } : row)) });
  const found =
    RESUME_PERSONAL_FIELDS.some((k) => review.personal[k].value) ||
    review.employment.length + review.education.length > 0 ||
    SKILL_LISTS.some(([l]) => review.skills[l].length) ||
    !!review.summary.value;

  return (
    <form ref={formRef} onSubmit={save} className="grid gap-6" noValidate>
      <div className="bg-muted/50 grid gap-1 rounded-md border px-4 py-3 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <Info className="text-muted-foreground size-4" />
          {reading.method === "ai" ? `Read ${reading.fileName} with AI` : `Read ${reading.fileName} with the built-in reader`}
        </p>
        <p className="text-muted-foreground">
          Check each field. Only what's ticked is added to your profile, and every value here is copied from your resume.
          {reading.fallbackReason && ` AI wasn't used: ${reading.fallbackReason}.`}
        </p>
        {reading.removed.length > 0 && (
          <details className="text-muted-foreground">
            <summary className="cursor-pointer">
              Left out {reading.removed.length} value{reading.removed.length === 1 ? "" : "s"} the AI suggested that aren't in your resume
            </summary>
            <ul className="mt-1 list-disc pl-5">
              {reading.removed.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      {!found && (
        <div role="alert" className="border-warning/40 bg-warning/10 rounded-md border px-3 py-2 text-sm">
          No profile details were found in this resume. Its layout may be unusual; you can fill in your profile by hand, or turn on AI in Settings and try again.
        </div>
      )}
      <FormMessage state={error ? { ok: false, message: error.message } : undefined} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contact details and summary</CardTitle>
          <CardDescription>Ticked values replace what's in your profile now.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {RESUME_PERSONAL_FIELDS.filter((k) => review.personal[k].value || review.personal[k].include).map((k) => (
            <ScalarField
              key={k}
              id={`personal-${k}`}
              label={PERSONAL_LABELS[k]}
              row={review.personal[k]}
              error={e[`personal.${k}`]}
              onChange={(row) => set({ personal: { ...review.personal, [k]: row } })}
            />
          ))}
          {review.currentTitle.value && (
            <ScalarField id="currentTitle" label="Current title" row={review.currentTitle} error={e.currentTitle} onChange={(row) => set({ currentTitle: row })} />
          )}
          {review.summary.value && (
            <ScalarField id="summary" label="Summary" row={review.summary} error={e.summary} multiline onChange={(row) => set({ summary: row })} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Skills</CardTitle>
          <CardDescription>
            These are added to your existing skills. Remove any you don't want.
            {review.skippedSkills > 0 && ` ${review.skippedSkills} already in your profile ${review.skippedSkills === 1 ? "is" : "are"} left out.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {SKILL_LISTS.map(([list, label]) => (
            <Field key={list} label={label} htmlFor={`skills-${list}`} error={e[`skills.${list}`]}>
              <TagInput id={`skills-${list}`} name={`skills.${list}`} defaultValue={review.skills[list]} placeholder="None found" />
            </Field>
          ))}
        </CardContent>
      </Card>

      <Section icon={Briefcase} title="Work history" empty="No jobs were found in this resume." count={review.employment.length}>
        {review.employment.map((job, i) => (
          <RecordCard
            key={i}
            id={`employment-${i}`}
            title={`${job.title} · ${job.company}`}
            include={job.include}
            duplicate={job.duplicate}
            onInclude={(include) => setJob(i, { include })}
            warning={!job.monthsKnown && job.startDate ? "Your resume gives only years here. Check the months." : !job.startDate ? "Add a start date." : null}
          >
            <Field label="Title" htmlFor={`employment-${i}-title`} error={e[`employment.${i}.title`]}>
              <Input id={`employment-${i}-title`} value={job.title} onChange={(ev) => setJob(i, { title: ev.target.value })} />
            </Field>
            <Field label="Company" htmlFor={`employment-${i}-company`} error={e[`employment.${i}.company`]}>
              <Input id={`employment-${i}-company`} value={job.company} onChange={(ev) => setJob(i, { company: ev.target.value })} />
            </Field>
            <Field label="Location" htmlFor={`employment-${i}-location`} error={e[`employment.${i}.location`]}>
              <Input id={`employment-${i}-location`} value={job.location ?? ""} onChange={(ev) => setJob(i, { location: ev.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Start" htmlFor={`employment-${i}-start`} error={e[`employment.${i}.startDate`]}>
                <Input id={`employment-${i}-start`} type="month" value={job.startDate ?? ""} onChange={(ev) => setJob(i, { startDate: ev.target.value || null, monthsKnown: true })} />
              </Field>
              <Field label="End" htmlFor={`employment-${i}-end`} error={e[`employment.${i}.endDate`]}>
                <Input
                  id={`employment-${i}-end`}
                  type="month"
                  disabled={job.isCurrent}
                  value={job.isCurrent ? "" : (job.endDate ?? "")}
                  onChange={(ev) => setJob(i, { endDate: ev.target.value || null, monthsKnown: true })}
                />
              </Field>
            </div>
            <div className="flex items-center gap-2 sm:col-span-2">
              <Checkbox id={`employment-${i}-current`} checked={job.isCurrent} onCheckedChange={(v) => setJob(i, { isCurrent: v === true })} />
              <Label htmlFor={`employment-${i}-current`} className="font-normal">
                I currently work here
              </Label>
            </div>
            <Field label="Responsibilities" htmlFor={`employment-${i}-resp`} hint="One per line." className="sm:col-span-2">
              <Textarea id={`employment-${i}-resp`} rows={3} value={job.responsibilities} onChange={(ev) => setJob(i, { responsibilities: ev.target.value })} />
            </Field>
            <Field label="Achievements" htmlFor={`employment-${i}-ach`} hint="One per line. Bullets with numbers go here." className="sm:col-span-2">
              <Textarea id={`employment-${i}-ach`} rows={3} value={job.achievements} onChange={(ev) => setJob(i, { achievements: ev.target.value })} />
            </Field>
          </RecordCard>
        ))}
      </Section>

      <Section icon={GraduationCap} title="Education" empty="No schools were found in this resume." count={review.education.length}>
        {review.education.map((ed, i) => (
          <RecordCard
            key={i}
            id={`education-${i}`}
            title={[ed.degree, ed.school].filter(Boolean).join(" · ")}
            include={ed.include}
            duplicate={ed.duplicate}
            onInclude={(include) => setSchool(i, { include })}
            warning={!ed.monthsKnown && ed.graduationDate ? "Your resume gives only years here. Check the months." : null}
          >
            <Field label="School" htmlFor={`education-${i}-school`} error={e[`education.${i}.school`]} className="sm:col-span-2">
              <Input id={`education-${i}-school`} value={ed.school} onChange={(ev) => setSchool(i, { school: ev.target.value })} />
            </Field>
            <Field label="Degree" htmlFor={`education-${i}-degree`} error={e[`education.${i}.degree`]}>
              <Input id={`education-${i}-degree`} value={ed.degree ?? ""} onChange={(ev) => setSchool(i, { degree: ev.target.value })} />
            </Field>
            <Field label="Major" htmlFor={`education-${i}-major`} error={e[`education.${i}.major`]}>
              <Input id={`education-${i}-major`} value={ed.major ?? ""} onChange={(ev) => setSchool(i, { major: ev.target.value })} />
            </Field>
            <Field label="Minor" htmlFor={`education-${i}-minor`} error={e[`education.${i}.minor`]}>
              <Input id={`education-${i}-minor`} value={ed.minor ?? ""} onChange={(ev) => setSchool(i, { minor: ev.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="GPA" htmlFor={`education-${i}-gpa`} error={e[`education.${i}.gpa`]}>
                <Input id={`education-${i}-gpa`} inputMode="decimal" value={ed.gpa} onChange={(ev) => setSchool(i, { gpa: ev.target.value })} />
              </Field>
              <Field label="Out of" htmlFor={`education-${i}-scale`} error={e[`education.${i}.gpaScale`]}>
                <Input id={`education-${i}-scale`} inputMode="decimal" value={ed.gpaScale} onChange={(ev) => setSchool(i, { gpaScale: ev.target.value })} />
              </Field>
            </div>
            <Field label="Start" htmlFor={`education-${i}-start`} error={e[`education.${i}.startDate`]}>
              <Input id={`education-${i}-start`} type="month" value={ed.startDate ?? ""} onChange={(ev) => setSchool(i, { startDate: ev.target.value || null, monthsKnown: true })} />
            </Field>
            <Field label="Graduation" htmlFor={`education-${i}-grad`} error={e[`education.${i}.graduationDate`]}>
              <Input
                id={`education-${i}-grad`}
                type="month"
                value={ed.graduationDate ?? ""}
                onChange={(ev) => setSchool(i, { graduationDate: ev.target.value || null, monthsKnown: true })}
              />
            </Field>
          </RecordCard>
        ))}
      </Section>

      <div className="bg-background sticky bottom-0 flex flex-col gap-3 border-t py-4 sm:flex-row sm:items-center sm:justify-between">
        {file ? (
          <div className="flex items-center gap-2">
            <Checkbox id="save-resume" checked={saveResume} onCheckedChange={(v) => setSaveResume(v === true)} />
            <Label htmlFor="save-resume" className="font-normal">
              Also save {file.name} to Documents as a resume
            </Label>
          </div>
        ) : (
          <span />
        )}
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setReview(null);
              setReading(null);
              setError(null);
            }}
          >
            Start over
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Add to profile
          </Button>
        </div>
      </div>
    </form>
  );
}

/** Server errors index records among the included ones; map them back to the rows on screen. */
function errorsByRow(errors: Record<string, string> | undefined, review: ReviewState): Record<string, string> | undefined {
  if (!errors) return errors;
  const index = (rows: Array<{ include: boolean }>) => rows.flatMap((r, i) => (r.include ? [i] : []));
  const maps: Record<string, number[]> = { employment: index(review.employment), education: index(review.education) };
  return Object.fromEntries(
    Object.entries(errors).map(([k, v]) => {
      const m = /^(employment|education)\.(\d+)\.(.+)$/.exec(k);
      return m ? [`${m[1]}.${maps[m[1]!]![Number(m[2])]}.${m[3]}`, v] : [k, v];
    }),
  );
}

function ScalarField({
  id,
  label,
  row,
  error,
  multiline,
  onChange,
}: {
  id: string;
  label: string;
  row: ScalarRow;
  error?: string;
  multiline?: boolean;
  onChange: (row: ScalarRow) => void;
}) {
  const replaces = row.include && row.current && !same(row.current, row.value);
  return (
    <div className={cn("grid gap-2 sm:grid-cols-[1.25rem_9rem_1fr] sm:items-start", !row.include && "opacity-70")}>
      <Checkbox id={`${id}-include`} aria-label={`Use ${label}`} checked={row.include} onCheckedChange={(v) => onChange({ ...row, include: v === true })} className="mt-2.5" />
      <Label htmlFor={id} className="text-[13px] sm:mt-2.5">
        {label}
      </Label>
      <div className="grid gap-1">
        {multiline ? (
          <Textarea id={id} rows={4} value={row.value} aria-invalid={!!error} onChange={(e) => onChange({ ...row, value: e.target.value })} />
        ) : (
          <Input id={id} value={row.value} aria-invalid={!!error} onChange={(e) => onChange({ ...row, value: e.target.value })} />
        )}
        {error ? (
          <p className="text-destructive text-xs">{error}</p>
        ) : row.current && !same(row.current, row.value) ? (
          <p className="text-muted-foreground line-clamp-2 text-xs">
            {replaces ? "Replaces" : "Your profile has"} “{row.current}”
          </p>
        ) : row.current ? (
          <p className="text-muted-foreground text-xs">Already in your profile</p>
        ) : null}
      </div>
    </div>
  );
}

function Section({
  icon: Icon,
  title,
  empty,
  count,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  empty: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="grid gap-3">
      <h2 className="flex items-center gap-2 text-base font-semibold">
        <Icon className="size-4" />
        {title}
      </h2>
      {count === 0 ? <p className="text-muted-foreground text-sm">{empty}</p> : children}
    </section>
  );
}

function RecordCard({
  id,
  title,
  include,
  duplicate,
  warning,
  onInclude,
  children,
}: {
  id: string;
  title: string;
  include: boolean;
  duplicate: boolean;
  warning: string | null;
  onInclude: (include: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("gap-3 py-4", !include && "opacity-70")} data-testid={id}>
      <CardHeader className="px-4">
        <div className="flex flex-wrap items-center gap-2">
          <Checkbox id={`${id}-include`} checked={include} onCheckedChange={(v) => onInclude(v === true)} />
          <Label htmlFor={`${id}-include`} className="font-medium">
            {title || "Untitled"}
          </Label>
          {duplicate && <Badge variant="muted">Already in your profile</Badge>}
          {include && warning && (
            <Badge variant="warning">
              <AlertTriangle />
              {warning}
            </Badge>
          )}
        </div>
      </CardHeader>
      {include && <CardContent className="grid gap-3 px-4 sm:grid-cols-2">{children}</CardContent>}
    </Card>
  );
}
