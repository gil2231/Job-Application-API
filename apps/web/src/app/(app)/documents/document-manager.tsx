"use client";

import { useState } from "react";
import { Download, FileText, Star, Upload } from "lucide-react";
import type { DocumentListItem } from "@autoapply/database";
import { DOCUMENT_TYPES, enumLabel, type DocumentType } from "@autoapply/shared";
import { deleteDocumentAction, setDefaultDocumentAction, uploadDocumentAction } from "@/actions/documents";
import { useServerAction } from "@/components/action-button";
import { Field, FormMessage, SubmitButton, useActionForm } from "@/components/form";
import { EmptyState } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatBytes, formatDate } from "@/lib/format";
import { ConfirmDeleteButton } from "../profile/delete-button";
import { useToastOnSuccess } from "../profile/use-toast-on-success";

const PLURAL: Record<DocumentType, string> = {
  RESUME: "Resumes",
  COVER_LETTER: "Cover letters",
  CERTIFICATION: "Certifications",
  TRANSCRIPT: "Transcripts",
  PORTFOLIO: "Portfolio files",
  OTHER: "Other",
};

function UploadForm({ jobs, onDone }: { jobs: Array<{ id: string; title: string; company: string }>; onDone: () => void }) {
  const { state, onSubmit, pending } = useActionForm(uploadDocumentAction, { ok: false });
  const [type, setType] = useState<DocumentType>("RESUME");
  const [jobId, setJobId] = useState("none");
  useToastOnSuccess(state, onDone);
  const variant = type === "RESUME" || type === "COVER_LETTER";
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <Field label="File" htmlFor="file" error={state.errors?.file} hint="PDF, Word, text or image. Up to 10 MB.">
        <Input id="file" name="file" type="file" accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg" aria-invalid={!!state.errors?.file} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" htmlFor="type" error={state.errors?.type}>
          <Select name="type" value={type} onValueChange={(v) => setType(v as DocumentType)}>
            <SelectTrigger id="type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOCUMENT_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {enumLabel(t)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Name" htmlFor="name" error={state.errors?.name} hint="Defaults to the file name.">
          <Input id="name" name="name" placeholder="e.g. Sales resume 2026" />
        </Field>
      </div>
      {variant && (
        <>
          <Field label="Use for" htmlFor="jobId" hint="Job-specific documents are used instead of the default for that job.">
            <Select value={jobId} onValueChange={setJobId}>
              <SelectTrigger id="jobId">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">All jobs (general)</SelectItem>
                {jobs.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.title} · {j.company}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {jobId !== "none" && <input type="hidden" name="jobId" value={jobId} />}
          </Field>
          {jobId === "none" && (
            <div className="flex items-center gap-2">
              <Checkbox id="isDefault" name="isDefault" />
              <Label htmlFor="isDefault" className="font-normal">
                Make this my default {type === "RESUME" ? "resume" : "cover letter"}
              </Label>
            </div>
          )}
        </>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton pending={pending} pendingLabel="Uploading…">
          Upload
        </SubmitButton>
      </div>
    </form>
  );
}

export function DocumentManager({ documents, jobs }: { documents: DocumentListItem[]; jobs: Array<{ id: string; title: string; company: string }> }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useServerAction();
  const groups = DOCUMENT_TYPES.map((type) => ({ type, docs: documents.filter((d) => d.type === type) })).filter((g) => g.docs.length > 0);

  return (
    <div className="grid gap-4">
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setOpen(true)}>
          <Upload /> Upload document
        </Button>
      </div>
      {documents.length === 0 ? (
        <EmptyState icon={FileText} title="No documents yet" description="Upload at least one resume. You can keep several, set a default, and attach job-specific versions." />
      ) : (
        groups.map((group) => (
          <div key={group.type} className="rounded-lg border">
            <div className="bg-muted/40 border-b px-4 py-2 text-xs font-semibold tracking-wide uppercase">{PLURAL[group.type]}</div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Used for</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead className="w-0" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {group.docs.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{d.name}</span>
                        {d.isDefault && (
                          <Badge variant="info">
                            <Star /> Default
                          </Badge>
                        )}
                      </div>
                      <span className="text-muted-foreground text-xs">{d.fileName}</span>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-[13px]">{d.job ? `${d.job.title} · ${d.job.company}` : "All jobs"}</TableCell>
                    <TableCell className="text-muted-foreground text-[13px]">{formatBytes(d.sizeBytes)}</TableCell>
                    <TableCell className="text-muted-foreground text-[13px]">{formatDate(d.createdAt)}</TableCell>
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        {(d.type === "RESUME" || d.type === "COVER_LETTER") && !d.isDefault && !d.job && (
                          <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => setDefaultDocumentAction(d.id))}>
                            Make default
                          </Button>
                        )}
                        <Button variant="ghost" size="icon-sm" asChild aria-label="Download">
                          <a href={`/api/documents/${d.id}`}>
                            <Download />
                          </a>
                        </Button>
                        <ConfirmDeleteButton title="Delete this document?" description={`${d.name} will be permanently deleted.`} action={() => deleteDocumentAction(d.id)} />
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ))
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload document</DialogTitle>
            <DialogDescription>Files are stored privately and only used for your own applications.</DialogDescription>
          </DialogHeader>
          {open && <UploadForm jobs={jobs} onDone={() => setOpen(false)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
