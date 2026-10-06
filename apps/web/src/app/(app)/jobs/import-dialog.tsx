"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CheckCircle2, FileSpreadsheet, Link2, Upload } from "lucide-react";
import { toast } from "sonner";
import { importFileAction, importUrlsAction, type ImportResultData } from "@/actions/ingestion";
import { Field, FormMessage, SubmitButton, useActionForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action";

const ISSUE_LABELS: Record<string, string> = {
  invalid: "Skipped",
  duplicate: "Duplicate",
  previously_removed: "Removed earlier",
  already_processed: "Already processed",
  fetch_failed: "Couldn't read",
  limit: "Limit",
};

function ImportResult({ result, onDone }: { result: ActionResult<ImportResultData>; onDone: () => void }) {
  const data = result.data!;
  const stats: Array<[string, number]> = [
    ["New", data.created],
    ["Already in list", data.duplicates],
    ["Removed or processed", data.skipped],
    ["Couldn't read", data.failed],
  ];
  return (
    <div className="grid gap-4" data-testid="import-result">
      <div className="flex items-start gap-3">
        <CheckCircle2 className="text-success mt-0.5 size-5 shrink-0" />
        <div className="text-sm">
          <p className="font-medium">{result.message}</p>
          <p className="text-muted-foreground mt-0.5">
            New jobs are being analyzed and scored now. They appear in the table as they finish.
            {data.needsDetails > 0 && ` ${data.needsDetails} need a description before they can be qualified; open them and use Edit details.`}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stats.map(([label, value]) => (
          <div key={label} className="rounded-lg border px-3 py-2">
            <dt className="text-muted-foreground text-xs">{label}</dt>
            <dd className="text-lg font-semibold tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {data.issues.length > 0 && (
        <div className="grid gap-1.5">
          <p className="text-[13px] font-medium">Details</p>
          <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border text-[13px]">
            {data.issues.map((issue, i) => (
              <li key={i} className="flex gap-3 px-3 py-2">
                <span className="text-muted-foreground w-28 shrink-0 text-xs">
                  {ISSUE_LABELS[issue.kind] ?? issue.kind}
                  {issue.row ? ` · row ${issue.row}` : ""}
                </span>
                <span className="min-w-0 flex-1">
                  {issue.title && <span className="font-medium">{issue.title}: </span>}
                  {issue.message}
                  {!issue.title && issue.url && <span className="text-muted-foreground block truncate text-xs">{issue.url}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex justify-end">
        <Button onClick={onDone}>Done</Button>
      </div>
    </div>
  );
}

function useImportResult(state: ActionResult<ImportResultData>) {
  const router = useRouter();
  useEffect(() => {
    if (state.data) router.refresh();
    if (state.data && !state.ok && state.message) toast.message(state.message);
  }, [state, router]);
  return state.data ? state : null;
}

function FileImportForm({ onDone }: { onDone: () => void }) {
  const { state, onSubmit, pending } = useActionForm(importFileAction, { ok: false });
  const result = useImportResult(state);
  if (result) return <ImportResult result={result} onDone={onDone} />;
  const e = state.errors ?? {};
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <div className="bg-muted/50 grid gap-2 rounded-lg p-3 text-[13px]">
        <p className="font-medium">Get your saved jobs from LinkedIn</p>
        <ol className="text-muted-foreground list-decimal space-y-1 pl-4">
          <li>On LinkedIn, open Settings &amp; Privacy → Data privacy → Get a copy of your data.</li>
          <li>Choose &ldquo;Want something in particular?&rdquo;, tick Jobs, and request the archive.</li>
          <li>When LinkedIn emails you, download the archive and upload it here (or the Saved Jobs.csv inside it).</li>
        </ol>
        <p className="text-muted-foreground">
          AutoApply never signs in to LinkedIn or reads its pages. Any spreadsheet with a job URL column also works; title, company, location and description columns are
          picked up when present.
        </p>
      </div>
      <Field label="Export file" htmlFor="import-file" error={e.file} hint="A LinkedIn data archive (.zip) or a .csv file, up to 10 MB.">
        <Input id="import-file" name="file" type="file" accept=".csv,.zip,text/csv,application/zip" aria-invalid={!!e.file} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton pending={pending} pendingLabel="Importing…">
          <Upload /> Import
        </SubmitButton>
      </div>
    </form>
  );
}

function UrlImportForm({ onDone }: { onDone: () => void }) {
  const { state, onSubmit, pending } = useActionForm(importUrlsAction, { ok: false });
  const result = useImportResult(state);
  if (result) return <ImportResult result={result} onDone={onDone} />;
  const e = state.errors ?? {};
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <Field
        label="Job URLs"
        htmlFor="import-urls"
        error={e.text}
        hint="One per line, up to 100. Greenhouse, Lever, Ashby, SmartRecruiters, Workday and most careers pages are filled in from the posting. LinkedIn links are added for you to complete."
      >
        <Textarea id="import-urls" name="text" rows={8} placeholder={"https://boards.greenhouse.io/acme/jobs/123456\nhttps://jobs.lever.co/acme/…"} aria-invalid={!!e.text} />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton pending={pending} pendingLabel="Importing…">
          <Link2 /> Import URLs
        </SubmitButton>
      </div>
    </form>
  );
}

export function ImportDialog() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Upload /> Import
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import jobs</DialogTitle>
          <DialogDescription>Duplicates and jobs you&apos;ve removed are skipped automatically.</DialogDescription>
        </DialogHeader>
        {open && (
          <Tabs defaultValue="file">
            <TabsList>
              <TabsTrigger value="file">
                <FileSpreadsheet /> LinkedIn export or CSV
              </TabsTrigger>
              <TabsTrigger value="urls">
                <Link2 /> Paste URLs
              </TabsTrigger>
            </TabsList>
            <TabsContent value="file">
              <FileImportForm onDone={close} />
            </TabsContent>
            <TabsContent value="urls">
              <UrlImportForm onDone={close} />
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
