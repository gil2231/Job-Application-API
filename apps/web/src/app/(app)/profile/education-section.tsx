"use client";

import { useState } from "react";
import { GraduationCap, Pencil, Plus } from "lucide-react";
import type { ProfileEducation } from "@autoapply/database";
import { deleteEducationAction, saveEducationAction } from "@/actions/profile";
import { Field, FormMessage, SubmitButton, useActionForm } from "@/components/form";
import { EmptyState } from "@/components/page-header";
import { TagInput } from "@/components/tag-input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ConfirmDeleteButton } from "./delete-button";
import { formatMonthYear, toDateInput } from "./dates";
import { useToastOnSuccess } from "./use-toast-on-success";

function EducationForm({ record, onDone }: { record?: ProfileEducation; onDone: () => void }) {
  const { state, onSubmit, pending } = useActionForm(saveEducationAction, { ok: false });
  useToastOnSuccess(state, onDone);
  const e = state.errors ?? {};
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      {record && <input type="hidden" name="id" value={record.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="School" htmlFor="school" error={e.school} className="sm:col-span-2">
          <Input id="school" name="school" defaultValue={record?.school} required aria-invalid={!!e.school} />
        </Field>
        <Field label="Degree" htmlFor="degree" error={e.degree}>
          <Input id="degree" name="degree" placeholder="e.g. Bachelor of Science" defaultValue={record?.degree ?? ""} />
        </Field>
        <Field label="Major" htmlFor="major" error={e.major}>
          <Input id="major" name="major" defaultValue={record?.major ?? ""} />
        </Field>
        <Field label="Concentrations" htmlFor="concentrations" error={e.concentrations}>
          <TagInput id="concentrations" name="concentrations" defaultValue={record?.concentrations} />
        </Field>
        <Field label="Minor" htmlFor="minor" error={e.minor}>
          <Input id="minor" name="minor" defaultValue={record?.minor ?? ""} />
        </Field>
        <Field label="GPA" htmlFor="gpa" error={e.gpa}>
          <Input id="gpa" name="gpa" type="number" step="0.01" min={0} max={10} defaultValue={record?.gpa ?? ""} aria-invalid={!!e.gpa} />
        </Field>
        <Field label="GPA scale" htmlFor="gpaScale" error={e.gpaScale}>
          <Input id="gpaScale" name="gpaScale" type="number" step="0.01" min={1} max={10} placeholder="4.0" defaultValue={record?.gpaScale ?? ""} />
        </Field>
        <Field label="Start date" htmlFor="startDate" error={e.startDate}>
          <Input id="startDate" name="startDate" type="date" defaultValue={toDateInput(record?.startDate)} />
        </Field>
        <Field label="Graduation date" htmlFor="graduationDate" error={e.graduationDate} hint="Expected date if still enrolled.">
          <Input id="graduationDate" name="graduationDate" type="date" defaultValue={toDateInput(record?.graduationDate)} aria-invalid={!!e.graduationDate} />
        </Field>
        <Field label="Relevant coursework" htmlFor="coursework" error={e.coursework} className="sm:col-span-2">
          <TagInput id="coursework" name="coursework" defaultValue={record?.coursework} />
        </Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Save
        </SubmitButton>
      </div>
    </form>
  );
}

export function EducationSection({ records }: { records: ProfileEducation[] }) {
  const [editing, setEditing] = useState<ProfileEducation | "new" | null>(null);
  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus /> Add education
        </Button>
      </div>
      {records.length === 0 ? (
        <EmptyState icon={GraduationCap} title="No education added" description="Add each school you attended. Applications pull degree, major, GPA and dates from here." />
      ) : (
        <ul className="divide-y rounded-lg border">
          {records.map((r) => (
            <li key={r.id} className="flex items-start gap-4 p-4">
              <div className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-md">
                <GraduationCap className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{r.school}</p>
                <p className="text-muted-foreground text-sm">{[r.degree, r.major].filter(Boolean).join(", ") || "Degree not set"}</p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {[r.startDate && formatMonthYear(r.startDate), r.graduationDate && formatMonthYear(r.graduationDate)].filter(Boolean).join(" – ")}
                  {r.gpa != null && ` · GPA ${r.gpa}${r.gpaScale ? ` / ${r.gpaScale}` : ""}`}
                  {r.minor && ` · Minor in ${r.minor}`}
                </p>
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setEditing(r)}>
                  <Pencil />
                </Button>
                <ConfirmDeleteButton title="Remove this education?" description={`${r.school} will be removed from your Master Profile.`} action={() => deleteEducationAction(r.id)} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add education" : "Edit education"}</DialogTitle>
            <DialogDescription>Only enter what is true. Applications never add qualifications you don&apos;t list here.</DialogDescription>
          </DialogHeader>
          {editing !== null && <EducationForm record={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
