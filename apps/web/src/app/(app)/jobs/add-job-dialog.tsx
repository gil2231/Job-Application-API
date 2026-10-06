"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { detectPlatformFromUrl } from "@autoapply/ats-adapters";
import { enumLabel, WORK_ARRANGEMENTS } from "@autoapply/shared";
import { lookupPostingAction, type PostingDetails } from "@/actions/ingestion";
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
  const [prefill, setPrefill] = useState<{ version: number; data: Partial<PostingDetails> }>({ version: 0, data: {} });
  const [lookupPending, startLookup] = useTransition();
  const isLinkedIn = /linkedin\.com/i.test(url);
  const lookup = () =>
    startLookup(async () => {
      const result = await lookupPostingAction(url);
      if (result.ok && result.data) {
        setPrefill((p) => ({ version: p.version + 1, data: result.data! }));
        toast.success(result.message);
      } else toast.error(result.message ?? "Couldn't read the posting");
    });
  const d = prefill.data;

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
        <div className="flex gap-2">
          <Input id="url" name="url" type="url" placeholder="https://…" value={url} onChange={(ev) => setUrl(ev.target.value)} aria-invalid={!!e.url} autoFocus />
          <Button
            type="button"
            variant="outline"
            disabled={!url || isLinkedIn || lookupPending}
            onClick={lookup}
            title={isLinkedIn ? "LinkedIn pages aren't read. Copy the details from the posting." : "Fill in the details from the public posting"}
          >
            {lookupPending ? <Loader2 className="animate-spin" /> : <Sparkles />} Fetch details
          </Button>
        </div>
      </Field>
      <div key={prefill.version} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Job title" htmlFor="title" error={e.title}>
            <Input id="title" name="title" defaultValue={d.title ?? ""} aria-invalid={!!e.title} />
          </Field>
          <Field label="Company" htmlFor="company" error={e.company}>
            <Input id="company" name="company" defaultValue={d.company ?? ""} aria-invalid={!!e.company} />
          </Field>
          <Field label="Location" htmlFor="location" error={e.location}>
            <Input id="location" name="location" defaultValue={d.location ?? ""} placeholder="e.g. New York, NY" />
          </Field>
          <Field label="Work arrangement" htmlFor="workArrangement">
            <Select name="workArrangement" defaultValue={d.workArrangement ?? "UNKNOWN"}>
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
            <Input id="salaryText" name="salaryText" defaultValue={d.salaryText ?? ""} />
          </Field>
          <Field label="Application URL" htmlFor="applicationUrl" error={e.applicationUrl} hint="If applying happens on a different page.">
            <Input id="applicationUrl" name="applicationUrl" type="url" defaultValue={d.applicationUrl ?? ""} placeholder="https://…" aria-invalid={!!e.applicationUrl} />
          </Field>
        </div>
        <Field label="Job description" htmlFor="description" error={e.description} hint="Paste it to enable matching against your profile.">
          <Textarea id="description" name="description" rows={5} defaultValue={d.description ?? ""} />
        </Field>
      </div>
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
          <DialogDescription>Paste a job posting URL. Fetch details fills in public postings; for LinkedIn, copy the details from the posting.</DialogDescription>
        </DialogHeader>
        {open && <AddJobForm onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}
