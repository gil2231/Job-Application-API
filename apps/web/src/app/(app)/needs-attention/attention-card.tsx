"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, ExternalLink, KeyRound, Pencil, RefreshCw, RotateCcw, Send, ShieldAlert, SkipForward, Sparkles, TriangleAlert, Upload, UserCheck } from "lucide-react";
import type { AttentionItem } from "@autoapply/database";
import { isPlaceholderOption } from "@autoapply/automation";
import { enumLabel } from "@autoapply/shared";
import {
  approveAnswerAction,
  approveSubmissionAction,
  completeHumanStepAction,
  markSubmittedAction,
  recheckQuestionAction,
  skipApplicationAction,
  skipQuestionAction,
} from "@/actions/applications";
import { useServerAction } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatRelative } from "@/lib/format";

type Question = AttentionItem["questions"][number];

const HEADINGS: Record<string, { title: string; icon: React.ComponentType<{ className?: string }> }> = {
  CAPTCHA: { title: "CAPTCHA detected", icon: ShieldAlert },
  MFA: { title: "Authentication required", icon: KeyRound },
  AUTH_REQUIRED: { title: "Authentication required", icon: KeyRound },
  QUESTION_REVIEW: { title: "Review required", icon: UserCheck },
  LOW_CONFIDENCE_MAPPING: { title: "Review required", icon: UserCheck },
  VALIDATION_ERROR: { title: "The site rejected an answer", icon: TriangleAlert },
  CONTRADICTION: { title: "Answers disagree", icon: TriangleAlert },
  FINAL_REVIEW: { title: "Ready for your review", icon: UserCheck },
  UNSUPPORTED_SITE: { title: "Can't fill this site", icon: TriangleAlert },
  REPEATED_FAILURE: { title: "Failed several times", icon: TriangleAlert },
};

function questionOptions(question: Question): string[] {
  const raw = Array.isArray(question.options) ? (question.options as unknown[]) : [];
  return raw.filter((o): o is string => typeof o === "string" && !isPlaceholderOption(o));
}

/** The input that fits the field: a dropdown for choices, checkboxes for multi-select, text otherwise. */
function AnswerInput({ question, value, onChange }: { question: Question; value: string; onChange: (v: string) => void }) {
  const options = questionOptions(question);
  const label = `Answer for ${question.label}`;
  if (question.fieldType === "CHECKBOX" && options.length > 1) {
    const picked = new Set(value.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean));
    return (
      <div className="grid gap-1.5" role="group" aria-label={label}>
        {options.map((o) => (
          <Label key={o} className="font-normal">
            <Checkbox
              checked={picked.has(o)}
              onCheckedChange={(checked) => {
                const next = new Set(picked);
                if (checked) next.add(o);
                else next.delete(o);
                onChange(options.filter((x) => next.has(x)).join(", "));
              }}
            />
            {o}
          </Label>
        ))}
      </div>
    );
  }
  const choices = question.fieldType === "CHECKBOX" ? ["Yes", "No"] : (question.fieldType === "SELECT" || question.fieldType === "RADIO") && options.length ? options : null;
  if (choices) {
    return (
      <Select value={choices.includes(value) ? value : ""} onValueChange={onChange}>
        <SelectTrigger size="sm" className="w-full sm:w-80" aria-label={label}>
          <SelectValue placeholder="Choose an answer" />
        </SelectTrigger>
        <SelectContent>
          {choices.map((o) => (
            <SelectItem key={o} value={o}>
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  return <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} autoFocus aria-label={label} />;
}

function QuestionRow({ question }: { question: Question }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(question.answer?.value ?? "");
  const [remember, setRemember] = useState(false);
  const { pending, run } = useServerAction();
  const suggestion = question.answer?.value;
  const isFile = question.fieldType === "FILE";

  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium">
          &ldquo;{question.label}&rdquo;
          {question.required && <span className="text-destructive"> *</span>}
        </p>
        {question.answer && !isFile && <span className="text-muted-foreground shrink-0 text-xs">Confidence {question.answer.confidence}%</span>}
      </div>
      {question.reviewReason && <p className="text-muted-foreground text-[13px]">{question.reviewReason}</p>}
      {isFile ? null : editing ? (
        <AnswerInput question={question} value={value} onChange={setValue} />
      ) : (
        <div className="text-sm">
          {question.answer?.source === "AI_GENERATED" ? (
            <Badge variant="info" className="mb-1" data-testid="ai-draft">
              <Sparkles /> AI draft: check it before approving
            </Badge>
          ) : (
            <span className="text-muted-foreground text-xs">Suggested answer</span>
          )}
          <p className={suggestion ? "" : "text-muted-foreground italic"}>{suggestion || "No answer could be found in your profile."}</p>
        </div>
      )}
      {!isFile && (
        <Label className="text-muted-foreground w-fit text-xs font-normal">
          <Checkbox checked={remember} onCheckedChange={(c) => setRemember(c === true)} />
          Remember this answer for future applications
        </Label>
      )}
      <div className="flex flex-wrap gap-2">
        {isFile ? (
          <>
            <Button size="xs" variant="outline" asChild>
              <Link href="/documents">
                <Upload /> Upload in Documents
              </Link>
            </Button>
            <Button size="xs" disabled={pending} onClick={() => run(() => recheckQuestionAction(question.id))}>
              <RefreshCw /> I&apos;ve uploaded it
            </Button>
          </>
        ) : editing ? (
          <>
            <Button size="xs" disabled={pending || !value.trim()} onClick={() => run(() => approveAnswerAction(question.id, value, remember), { onSuccess: () => setEditing(false) })}>
              <Check /> Save &amp; approve
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            {suggestion && (
              <Button size="xs" disabled={pending} onClick={() => run(() => approveAnswerAction(question.id, undefined, remember))}>
                <Check /> Approve
              </Button>
            )}
            <Button size="xs" variant="outline" disabled={pending} onClick={() => setEditing(true)}>
              <Pencil /> {suggestion ? "Edit" : "Answer"}
            </Button>
          </>
        )}
        {!question.required && (
          <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => skipQuestionAction(question.id))}>
            <SkipForward /> Skip question
          </Button>
        )}
      </div>
    </div>
  );
}

function FilledSummary({ item }: { item: AttentionItem }) {
  if (!item.filled.length && !item.latestScreenshot) return null;
  return (
    <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
      {item.filled.length > 0 && (
        <details className="rounded-lg border px-3 py-2 text-sm" open={item.filled.length <= 8}>
          <summary className="cursor-pointer text-xs font-medium">
            {item.filled.length} answer{item.filled.length === 1 ? "" : "s"} filled in
          </summary>
          <dl className="mt-2 grid gap-1.5">
            {item.filled.map((q) => (
              <div key={q.id} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3 text-[13px]">
                <dt className="text-muted-foreground truncate" title={q.label}>
                  {q.label}
                </dt>
                <dd className="truncate" title={q.value ?? undefined}>
                  {q.status === "SKIPPED" ? <span className="text-muted-foreground italic">Left blank</span> : q.value == null ? <span className="text-muted-foreground italic">Hidden (sensitive)</span> : q.value}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      )}
      {item.latestScreenshot && (
        <a href={`/api/files?key=${encodeURIComponent(item.latestScreenshot.key)}`} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-lg border">
          {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-gated file route */}
          <img src={`/api/files?key=${encodeURIComponent(item.latestScreenshot.key)}`} alt={item.latestScreenshot.caption ?? "Latest screenshot"} className="aspect-[4/3] w-full object-cover object-top" />
          <p className="text-muted-foreground border-t px-2 py-1 text-[11px]">{item.latestScreenshot.caption ?? "Latest screenshot"}</p>
        </a>
      )}
    </div>
  );
}

/** Stops the browser extension can help finish in the person's own browser. */
const FINISH_IN_BROWSER = new Set(["CAPTCHA", "AUTH_REQUIRED", "MFA", "UNSUPPORTED_SITE", "FINAL_REVIEW"]);

export function AttentionCard({ item }: { item: AttentionItem }) {
  const { pending, run } = useServerAction();
  const reason = item.attentionReason ?? (item.status === "READY" ? "FINAL_REVIEW" : item.status === "REVIEW_REQUIRED" ? "QUESTION_REVIEW" : "AUTH_REQUIRED");
  const heading = HEADINGS[reason] ?? { title: enumLabel(reason), icon: TriangleAlert };
  const url = item.job.applicationUrl ?? item.job.url;
  const isAuth = reason === "MFA" || reason === "AUTH_REQUIRED";
  const isFinal = reason === "FINAL_REVIEW" || reason === "CONTRADICTION";
  const hasQuestions = item.questions.length > 0;

  const open = (
    <Button size="sm" variant="outline" asChild>
      <a href={url} target="_blank" rel="noopener noreferrer">
        <ExternalLink /> {isAuth ? "Open browser" : "Open application"}
      </a>
    </Button>
  );
  const submittedMyself = (
    <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => markSubmittedAction(item.id))}>
      <Check /> I submitted it
    </Button>
  );
  const retry = (label: string, Icon = RotateCcw) => (
    <Button size="sm" disabled={pending} onClick={() => run(() => completeHumanStepAction(item.id))}>
      <Icon /> {label}
    </Button>
  );

  return (
    <Card className="gap-4" data-testid="attention-card">
      <CardHeader className="gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <heading.icon className="text-warning size-4" />
          <span className="text-xs font-semibold tracking-wider uppercase">{heading.title}</span>
          <Badge variant="outline" className="ml-auto">
            {enumLabel(item.mode)} mode
          </Badge>
          <Badge variant="muted">Waiting {formatRelative(item.updatedAt).replace(" ago", "")}</Badge>
        </div>
        <dl className="grid grid-cols-[80px_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Company</dt>
          <dd className="font-medium">{item.job.company}</dd>
          <dt className="text-muted-foreground">Role</dt>
          <dd>
            <Link href={`/applications/${item.id}`} className="hover:underline">
              {item.job.title}
            </Link>
          </dd>
        </dl>
        {item.attentionDetail && <p className="text-muted-foreground text-sm">{item.attentionDetail}</p>}
      </CardHeader>
      <CardContent className="grid gap-3">
        {hasQuestions && (
          <div className="grid gap-2">
            {item.questions.map((q) => (
              <QuestionRow key={q.id} question={q} />
            ))}
          </div>
        )}
        {isFinal && !hasQuestions && <FilledSummary item={item} />}
        <div className="flex flex-wrap gap-2">
          {!hasQuestions &&
            (isFinal ? (
              <>
                <Button size="sm" disabled={pending} onClick={() => run(() => approveSubmissionAction(item.id))}>
                  <Send /> {item.status === "READY" ? "Let Applyance submit" : "Approve & submit"}
                </Button>
                {open}
                {submittedMyself}
              </>
            ) : reason === "CAPTCHA" ? (
              <>
                <Button size="sm" asChild>
                  <Link href="/captcha">
                    <ShieldAlert /> Solve in Applyance
                  </Link>
                </Button>
                {open}
                {retry("I've completed it", Check)}
                {submittedMyself}
              </>
            ) : isAuth ? (
              <>
                {open}
                {retry("Continue", Check)}
              </>
            ) : reason === "UNSUPPORTED_SITE" ? (
              <>
                {open}
                {submittedMyself}
                {retry("Try again")}
              </>
            ) : (
              <>
                {retry("Try again")}
                {open}
              </>
            ))}
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => skipApplicationAction(item.id))}>
            <SkipForward /> Skip application
          </Button>
        </div>
        {!hasQuestions && FINISH_IN_BROWSER.has(reason) && !/(^|\.)linkedin\.com$/i.test(new URL(url).hostname) && (
          <p className="text-muted-foreground text-xs">
            Or open the Applyance browser extension and choose Finish in my browser: it opens this application in your own browser with your answers filled in, and you {isAuth ? "sign in" : "solve the check and submit"} yourself.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
