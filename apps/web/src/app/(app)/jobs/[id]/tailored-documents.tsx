"use client";

import { useState } from "react";
import { Check, Download, FileText, Loader2, Pencil, RefreshCw, Sparkles, Trash2 } from "lucide-react";
import type { GeneratedForJob, GeneratedKind } from "@autoapply/database";
import type { CoverLetterContent, GenerationInfo, ResumeContent } from "@autoapply/shared";
import { MAX_COVER_LETTER_CHARS, MAX_SUMMARY_CHARS } from "@autoapply/shared";
import { approveGeneratedAction, deleteGeneratedAction, generateDocumentAction, saveGeneratedEditsAction } from "@/actions/generated";
import { useServerAction } from "@/components/action-button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatRelative } from "@/lib/format";

type Generated = NonNullable<GeneratedForJob["resume"]> | NonNullable<GeneratedForJob["coverLetter"]>;

const COPY: Record<GeneratedKind, { title: string; slug: string; create: string; noun: string }> = {
  resume: { title: "Tailored resume", slug: "resume", create: "Tailor resume", noun: "resume" },
  coverLetter: { title: "Cover letter", slug: "cover-letter", create: "Write cover letter", noun: "cover letter" },
};

function GenerationNote({ info }: { info: GenerationInfo }) {
  return (
    <div className="text-muted-foreground grid gap-0.5 text-xs">
      <p>
        {info.method === "ai" ? `Written with AI (${info.model ?? "AI"}) from your Master Profile` : "Built from your Master Profile"} <span suppressHydrationWarning>{formatRelative(info.generatedAt)}</span>
        {info.edited ? ", then edited by you" : ""}.
      </p>
      {info.fallbackReason && <p>{info.fallbackReason}.</p>}
      {info.matchedSkills.length > 0 && <p>Highlights skills the job asks for that you have: {info.matchedSkills.slice(0, 8).join(", ")}.</p>}
    </div>
  );
}

function ResumePreview({ content }: { content: ResumeContent }) {
  return (
    <div className="grid gap-3 rounded-lg border p-3 text-[13px]" data-testid="resume-preview">
      {content.summary && <p>{content.summary}</p>}
      {content.skills.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {content.skills.map((s) => (
            <Badge key={s} variant={content.generation.matchedSkills.includes(s) ? "success" : "muted"}>
              {s}
            </Badge>
          ))}
        </div>
      )}
      {content.experience.map((role, i) => (
        <div key={i} className="grid gap-1">
          <p className="flex flex-wrap justify-between gap-x-3">
            <span className="font-medium">
              {role.title}, {role.company}
            </span>
            <span className="text-muted-foreground text-xs">{role.dates}</span>
          </p>
          {role.bullets.length > 0 && (
            <ul className="grid gap-0.5">
              {role.bullets.map((b, j) => (
                <li key={j} className="flex gap-2">
                  <span className="text-muted-foreground">•</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}

function LetterPreview({ content }: { content: CoverLetterContent }) {
  return (
    <div className="grid max-h-80 gap-2 overflow-y-auto rounded-lg border p-3 text-[13px] leading-relaxed" data-testid="cover-letter-preview">
      {content.paragraphs.map((p, i) => (
        <p key={i} className={p.startsWith("• ") ? "pl-3" : undefined}>
          {p}
        </p>
      ))}
    </div>
  );
}

function EditDialog({ kind, doc }: { kind: GeneratedKind; doc: Generated }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useServerAction();
  const resume = kind === "resume" ? (doc.content as ResumeContent) : null;
  const letter = kind === "coverLetter" ? (doc.content as CoverLetterContent) : null;
  const [summary, setSummary] = useState(resume?.summary ?? "");
  const [skills, setSkills] = useState(resume?.skills.join(", ") ?? "");
  const [text, setText] = useState(letter?.paragraphs.join("\n\n") ?? "");
  const save = () => run(() => saveGeneratedEditsAction(kind, doc.id, resume ? { summary, skills } : { text }), { onSuccess: () => setOpen(false) });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="xs" variant="outline">
          <Pencil /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Edit {COPY[kind].noun}</DialogTitle>
          <DialogDescription>
            {resume ? "Roles, dates and bullets come from your Master Profile; change them there and regenerate." : "Change anything you like. It's your letter."}
            {doc.document ? " Saving makes this a draft again until you approve it." : ""}
          </DialogDescription>
        </DialogHeader>
        {resume ? (
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor={`summary-${doc.id}`}>Summary</Label>
              <Textarea id={`summary-${doc.id}`} value={summary} onChange={(e) => setSummary(e.target.value)} rows={4} maxLength={MAX_SUMMARY_CHARS} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor={`skills-${doc.id}`}>Skills, in order</Label>
              <Textarea id={`skills-${doc.id}`} value={skills} onChange={(e) => setSkills(e.target.value)} rows={3} />
              <p className="text-muted-foreground text-xs">Separate skills with commas.</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor={`letter-${doc.id}`}>Letter</Label>
            <Textarea id={`letter-${doc.id}`} value={text} onChange={(e) => setText(e.target.value)} rows={16} maxLength={MAX_COVER_LETTER_CHARS} />
            <p className="text-muted-foreground text-xs">Leave a blank line between paragraphs. Start a line with &ldquo;• &rdquo; for a bullet.</p>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={save} disabled={pending || (!resume && !text.trim())}>
            {pending && <Loader2 className="animate-spin" />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DocumentPanel({ kind, jobId, doc, aiLabel }: { kind: GeneratedKind; jobId: string; doc: Generated | null; aiLabel: string }) {
  const { pending, run } = useServerAction();
  const copy = COPY[kind];
  const testId = `generated-${copy.slug}`;

  if (!doc || !doc.content) {
    return (
      <div className="grid gap-2 rounded-lg border border-dashed p-3" data-testid={testId}>
        <p className="text-sm font-medium">{copy.title}</p>
        <p className="text-muted-foreground text-[13px]">
          {kind === "resume" ? "Your experience and skills, ordered for this job. Only facts from your Master Profile are used." : "A letter for this job written only from your Master Profile."} {aiLabel}
        </p>
        <Button size="sm" className="w-fit" disabled={pending} onClick={() => run(() => generateDocumentAction(jobId, kind))}>
          {pending ? <Loader2 className="animate-spin" /> : <Sparkles />} {copy.create}
        </Button>
      </div>
    );
  }

  const approved = !!doc.document;
  const href = (format: "pdf" | "docx") => `/api/generated/${copy.slug}/${doc.id}?format=${format}`;
  return (
    <div className="grid gap-3 rounded-lg border p-3" data-testid={testId} data-state={approved ? "approved" : "draft"}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">{copy.title}</p>
        {approved ? (
          <Badge variant="success">
            <Check /> Approved for this job
          </Badge>
        ) : (
          <Badge variant="warning">Draft: not used until you approve it</Badge>
        )}
      </div>
      <GenerationNote info={doc.content.generation} />
      {kind === "resume" ? <ResumePreview content={doc.content as ResumeContent} /> : <LetterPreview content={doc.content as CoverLetterContent} />}
      <div className="flex flex-wrap gap-2">
        {!approved && (
          <Button size="xs" disabled={pending} onClick={() => run(() => approveGeneratedAction(kind, doc.id))}>
            <Check /> Approve for this job
          </Button>
        )}
        <EditDialog kind={kind} doc={doc} />
        <Button size="xs" variant="outline" asChild>
          <a href={href("pdf")} download>
            <Download /> PDF
          </a>
        </Button>
        <Button size="xs" variant="outline" asChild>
          <a href={href("docx")} download>
            <FileText /> Word
          </a>
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="xs" variant="outline" disabled={pending}>
              <RefreshCw /> Regenerate
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Regenerate this {copy.noun}?</AlertDialogTitle>
              <AlertDialogDescription>
                It&apos;s rebuilt from your current Master Profile{doc.content.generation.edited ? ", replacing your edits" : ""}.{approved ? " You'll need to approve it again." : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={() => run(() => generateDocumentAction(jobId, kind))}>Regenerate</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="xs" variant="outline" className="text-destructive" disabled={pending}>
              <Trash2 /> Remove
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this {copy.noun}?</AlertDialogTitle>
              <AlertDialogDescription>The application for this job goes back to your default {copy.noun}.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => run(() => deleteGeneratedAction(kind, doc.id))}>
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {pending && <Loader2 className="text-muted-foreground size-4 animate-spin self-center" aria-label="Working" />}
      </div>
      {approved && doc.document && <p className="text-muted-foreground text-xs">Saved as {doc.document.fileName} in Documents.</p>}
    </div>
  );
}

export function TailoredDocuments({ jobId, generated, ai }: { jobId: string; generated: GeneratedForJob; ai: { on: boolean; model: string | null } }) {
  const aiLabel = ai.on ? `AI (${ai.model}) helps choose and write; anything it can't back up from your profile is left out.` : "AI is off, so it's assembled from your profile. Turn on AI in Settings for written summaries.";
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Resume and cover letter for this job</CardTitle>
        <CardDescription>Approved documents are uploaded with this job&apos;s application instead of your defaults.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        <DocumentPanel kind="resume" jobId={jobId} doc={generated.resume} aiLabel={aiLabel} />
        <DocumentPanel kind="coverLetter" jobId={jobId} doc={generated.coverLetter} aiLabel={aiLabel} />
      </CardContent>
    </Card>
  );
}
