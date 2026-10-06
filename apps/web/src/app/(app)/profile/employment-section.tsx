"use client";

import { useState } from "react";
import { Briefcase, Pencil, Plus } from "lucide-react";
import type { ProfileEmployment } from "@autoapply/database";
import { EMPLOYMENT_TYPES, enumLabel } from "@autoapply/shared";
import { deleteEmploymentAction, saveEmploymentAction } from "@/actions/profile";
import { Field, FormMessage, SubmitButton, useActionForm } from "@/components/form";
import { EmptyState } from "@/components/page-header";
import { TagInput } from "@/components/tag-input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDeleteButton } from "./delete-button";
import { formatMonthYear, toDateInput } from "./dates";
import { useToastOnSuccess } from "./use-toast-on-success";

function EmploymentForm({ record, onDone }: { record?: ProfileEmployment; onDone: () => void }) {
  const { state, onSubmit, pending } = useActionForm(saveEmploymentAction, { ok: false });
  const [isCurrent, setIsCurrent] = useState(record?.isCurrent ?? false);
  useToastOnSuccess(state, onDone);
  const e = state.errors ?? {};
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      {record && <input type="hidden" name="id" value={record.id} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Company" htmlFor="company" error={e.company}>
          <Input id="company" name="company" defaultValue={record?.company} aria-invalid={!!e.company} />
        </Field>
        <Field label="Title" htmlFor="title" error={e.title}>
          <Input id="title" name="title" defaultValue={record?.title} aria-invalid={!!e.title} />
        </Field>
        <Field label="Employment type" htmlFor="employmentType" error={e.employmentType}>
          <Select name="employmentType" defaultValue={record?.employmentType ?? "FULL_TIME"}>
            <SelectTrigger id="employmentType">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EMPLOYMENT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {enumLabel(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Location" htmlFor="location" error={e.location}>
          <Input id="location" name="location" placeholder="e.g. New York, NY or Remote" defaultValue={record?.location ?? ""} />
        </Field>
        <Field label="Start date" htmlFor="startDate" error={e.startDate}>
          <Input id="startDate" name="startDate" type="date" defaultValue={toDateInput(record?.startDate)} aria-invalid={!!e.startDate} />
        </Field>
        <Field label="End date" htmlFor="endDate" error={e.endDate}>
          <Input id="endDate" name="endDate" type="date" disabled={isCurrent} defaultValue={toDateInput(record?.endDate)} aria-invalid={!!e.endDate} />
        </Field>
        <div className="flex items-center gap-2 sm:col-span-2">
          <Checkbox id="isCurrent" name="isCurrent" checked={isCurrent} onCheckedChange={(v) => setIsCurrent(v === true)} />
          <Label htmlFor="isCurrent" className="font-normal">
            I currently work here
          </Label>
        </div>
        <Field label="Description" htmlFor="description" error={e.description} className="sm:col-span-2">
          <Textarea id="description" name="description" rows={3} defaultValue={record?.description ?? ""} />
        </Field>
        <Field label="Responsibilities" htmlFor="responsibilities" error={e.responsibilities} className="sm:col-span-2" hint="One per line.">
          <Textarea id="responsibilities" name="responsibilities" rows={4} defaultValue={record?.responsibilities.join("\n")} />
        </Field>
        <Field label="Achievements" htmlFor="achievements" error={e.achievements} className="sm:col-span-2" hint="One per line. Include real numbers where you have them.">
          <Textarea id="achievements" name="achievements" rows={4} defaultValue={record?.achievements.join("\n")} />
        </Field>
        <Field label="Skills used" htmlFor="skills" error={e.skills} className="sm:col-span-2">
          <TagInput id="skills" name="skills" defaultValue={record?.skills} />
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

export function EmploymentSection({ records }: { records: ProfileEmployment[] }) {
  const [editing, setEditing] = useState<ProfileEmployment | "new" | null>(null);
  return (
    <div className="grid gap-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setEditing("new")}>
          <Plus /> Add position
        </Button>
      </div>
      {records.length === 0 ? (
        <EmptyState icon={Briefcase} title="No employment added" description="Add each role. Work-history sections on applications and experience calculations come from here." />
      ) : (
        <ul className="divide-y rounded-lg border">
          {records.map((r) => (
            <li key={r.id} className="flex items-start gap-4 p-4">
              <div className="bg-muted text-muted-foreground grid size-9 shrink-0 place-items-center rounded-md">
                <Briefcase className="size-4" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-medium">{r.title}</p>
                  {r.isCurrent && <Badge variant="success">Current</Badge>}
                </div>
                <p className="text-muted-foreground text-sm">
                  {r.company} · {enumLabel(r.employmentType)}
                  {r.location && ` · ${r.location}`}
                </p>
                <p className="text-muted-foreground mt-1 text-xs">
                  {formatMonthYear(r.startDate)} – {r.isCurrent ? "Present" : formatMonthYear(r.endDate)}
                </p>
                {r.achievements.length > 0 && (
                  <ul className="text-muted-foreground mt-2 list-disc space-y-0.5 pl-4 text-sm">
                    {r.achievements.slice(0, 3).map((a) => (
                      <li key={a}>{a}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="icon-sm" aria-label="Edit" onClick={() => setEditing(r)}>
                  <Pencil />
                </Button>
                <ConfirmDeleteButton title="Remove this position?" description={`${r.title} at ${r.company} will be removed from your Master Profile.`} action={() => deleteEmploymentAction(r.id)} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add position" : "Edit position"}</DialogTitle>
            <DialogDescription>Applications only use what you enter here. Nothing is embellished.</DialogDescription>
          </DialogHeader>
          {editing !== null && <EmploymentForm record={editing === "new" ? undefined : editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
