"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { detectPlatformFromUrl } from "@autoapply/ats-adapters";
import { enumLabel, WORK_ARRANGEMENTS } from "@autoapply/shared";
import { addJobAction, restoreJobAction } from "@/actions/jobs";
import { useServerAction } from "@/components/action-button";
import { Field, FormMessage, SubmitButton, useActionForm } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

function AddJobForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const { state, onSubmit, pending } = useActionForm(addJobAction, { ok: false });
  const restore = useServerAction();
  const [url, setUrl] = useState("");
  const detection = useMemo(() => (url ? detectPlatformFromUrl(url) : null), [url]);

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message);
      onDone();
      router.refresh();
    }
  }, [state, onDone, router]);

  const e = state.errors ?? {};
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      {!state.ok && state.data?.jobId && (
        <div className="flex items-center gap-2 text-sm">
          {state.data.deleted ? (
            <Button type="button" size="sm" variant="outline" disabled={restore.pending} onClick={() => restore.run(() => restoreJobAction(state.data!.jobId), { onSuccess: onDone })}>
              Restore deleted job
            </Button>
          ) : (
            <Button type="button" size="sm" variant="outline" onClick={() => router.push(`/jobs/${state.data!.jobId}`)}>
              View existing job
            </Button>
          )}
        </div>
      )}
      <Field
        label="Job URL"
        htmlFor="url"
        error={e.url}
        hint={
          detection && detection.platform !== "UNKNOWN" ? (
            <span>
              Detected platform: <Badge variant="secondary">{enumLabel(detection.platform)}</Badge>
            </span>
          ) : (
            "The posting's URL. Duplicates are detected automatically."
          )
        }
      >
        <Input id="url" name="url" type="url" placeholder="https://…" value={url} onChange={(ev) => setUrl(ev.target.value)} aria-invalid={!!e.url} autoFocus />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Job title" htmlFor="title" error={e.title}>
          <Input id="title" name="title" aria-invalid={!!e.title} />
        </Field>
        <Field label="Company" htmlFor="company" error={e.company}>
          <Input id="company" name="company" aria-invalid={!!e.company} />
        </Field>
        <Field label="Location" htmlFor="location" error={e.location}>
          <Input id="location" name="location" placeholder="e.g. New York, NY" />
        </Field>
        <Field label="Work arrangement" htmlFor="workArrangement">
          <Select name="workArrangement" defaultValue="UNKNOWN">
            <SelectTrigger id="workArrangement">
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
        <Field label="Salary" htmlFor="salaryText" error={e.salaryText} hint='As listed, e.g. "$70,000 – $80,000".'>
          <Input id="salaryText" name="salaryText" />
        </Field>
        <Field label="Application URL" htmlFor="applicationUrl" error={e.applicationUrl} hint="If applying happens on a different page.">
          <Input id="applicationUrl" name="applicationUrl" type="url" placeholder="https://…" aria-invalid={!!e.applicationUrl} />
        </Field>
      </div>
      <Field label="Job description" htmlFor="description" error={e.description} hint="Paste it to enable matching against your profile.">
        <Textarea id="description" name="description" rows={5} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton pending={pending} pendingLabel="Adding…">
          Add job
        </SubmitButton>
      </div>
    </form>
  );
}

export function AddJobDialog() {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus /> Add job
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add a job</DialogTitle>
          <DialogDescription>Paste a job posting URL and the details you see on it.</DialogDescription>
        </DialogHeader>
        {open && <AddJobForm onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}
