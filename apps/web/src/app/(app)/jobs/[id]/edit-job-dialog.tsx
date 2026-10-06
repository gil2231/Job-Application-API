"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { enumLabel, WORK_ARRANGEMENTS, type WorkArrangement } from "@autoapply/shared";
import { updateJobDetailsAction } from "@/actions/ingestion";
import { Field, FormMessage, SubmitButton, useActionForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action";

export interface EditableJob {
  id: string;
  title: string;
  company: string;
  location: string | null;
  workArrangement: WorkArrangement;
  salaryText: string | null;
  applicationUrl: string | null;
  description: string | null;
}

function EditJobForm({ job, onDone }: { job: EditableJob; onDone: () => void }) {
  const router = useRouter();
  // The toast is raised here rather than in an effect: saving can change the
  // job's status, which unmounts the "Add description" banner hosting this form.
  const action = useMemo(
    () => async (prev: ActionResult, formData: FormData) => {
      const result = await updateJobDetailsAction(job.id, prev, formData);
      if (result.ok) toast.success(result.message);
      return result;
    },
    [job.id],
  );
  const { state, onSubmit, pending } = useActionForm(action, { ok: false });
  useEffect(() => {
    if (state.ok) {
      onDone();
      router.refresh();
    }
  }, [state, onDone, router]);
  const e = state.errors ?? {};
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Job title" htmlFor="edit-title" error={e.title}>
          <Input id="edit-title" name="title" defaultValue={job.title} aria-invalid={!!e.title} />
        </Field>
        <Field label="Company" htmlFor="edit-company" error={e.company}>
          <Input id="edit-company" name="company" defaultValue={job.company} aria-invalid={!!e.company} />
        </Field>
        <Field label="Location" htmlFor="edit-location" error={e.location}>
          <Input id="edit-location" name="location" defaultValue={job.location ?? ""} placeholder="e.g. New York, NY" />
        </Field>
        <Field label="Work arrangement" htmlFor="edit-workArrangement">
          <Select name="workArrangement" defaultValue={job.workArrangement}>
            <SelectTrigger id="edit-workArrangement">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WORK_ARRANGEMENTS.map((w) => (
                <SelectItem key={w} value={w}>
                  {w === "UNKNOWN" ? "Not specified" : enumLabel(w)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Salary" htmlFor="edit-salaryText" error={e.salaryText} hint='As listed, e.g. "$70,000 – $80,000".'>
          <Input id="edit-salaryText" name="salaryText" defaultValue={job.salaryText ?? ""} />
        </Field>
        <Field label="Application URL" htmlFor="edit-applicationUrl" error={e.applicationUrl} hint="If applying happens on a different page.">
          <Input id="edit-applicationUrl" name="applicationUrl" type="url" defaultValue={job.applicationUrl ?? ""} aria-invalid={!!e.applicationUrl} />
        </Field>
      </div>
      <Field label="Job description" htmlFor="edit-description" error={e.description} hint="Paste the full posting. Requirements, skills and pay are read from it.">
        <Textarea id="edit-description" name="description" rows={10} defaultValue={job.description ?? ""} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton pending={pending} pendingLabel="Saving and analyzing…">
          Save and re-analyze
        </SubmitButton>
      </div>
    </form>
  );
}

export function EditJobDialog({ job, defaultOpen = false, label = "Edit details" }: { job: EditableJob; defaultOpen?: boolean; label?: string }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Pencil /> {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit job details</DialogTitle>
          <DialogDescription>The job is analyzed and scored again when you save.</DialogDescription>
        </DialogHeader>
        {open && <EditJobForm job={job} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}
