"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, ExternalLink, KeyRound, Pencil, ShieldAlert, SkipForward, TriangleAlert, UserCheck } from "lucide-react";
import type { AttentionItem } from "@autoapply/database";
import { enumLabel } from "@autoapply/shared";
import { approveAnswerAction, completeHumanStepAction, markSubmittedAction, skipApplicationAction, skipQuestionAction } from "@/actions/applications";
import { useServerAction } from "@/components/action-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { formatRelative } from "@/lib/format";

type Question = AttentionItem["questions"][number];

const HEADINGS: Record<string, { title: string; icon: React.ComponentType<{ className?: string }> }> = {
  CAPTCHA: { title: "CAPTCHA detected", icon: ShieldAlert },
  MFA: { title: "Authentication required", icon: KeyRound },
  AUTH_REQUIRED: { title: "Authentication required", icon: KeyRound },
  QUESTION_REVIEW: { title: "Review required", icon: UserCheck },
  LOW_CONFIDENCE_MAPPING: { title: "Review required", icon: UserCheck },
  FINAL_REVIEW: { title: "Ready for your review", icon: UserCheck },
};

function QuestionRow({ question }: { question: Question }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(question.answer?.value ?? "");
  const { pending, run } = useServerAction();
  const suggestion = question.answer?.value;
  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium">
          &ldquo;{question.label}&rdquo;
          {question.required && <span className="text-destructive"> *</span>}
        </p>
        {question.answer && <span className="text-muted-foreground shrink-0 text-xs">Confidence {question.answer.confidence}%</span>}
      </div>
      {editing ? (
        <Textarea value={value} onChange={(e) => setValue(e.target.value)} rows={3} autoFocus aria-label={`Answer for ${question.label}`} />
      ) : (
        <div className="text-sm">
          <span className="text-muted-foreground text-xs">Suggested answer</span>
          <p className={suggestion ? "" : "text-muted-foreground italic"}>{suggestion || "No answer could be found in your profile."}</p>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {editing ? (
          <>
            <Button size="xs" disabled={pending || !value.trim()} onClick={() => run(() => approveAnswerAction(question.id, value), { onSuccess: () => setEditing(false) })}>
              <Check /> Save &amp; approve
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            {suggestion && (
              <Button size="xs" disabled={pending} onClick={() => run(() => approveAnswerAction(question.id))}>
                <Check /> Approve
              </Button>
            )}
            <Button size="xs" variant="outline" disabled={pending} onClick={() => setEditing(true)}>
              <Pencil /> {suggestion ? "Edit" : "Answer"}
            </Button>
            {!question.required && (
              <Button size="xs" variant="outline" disabled={pending} onClick={() => run(() => skipQuestionAction(question.id))}>
                <SkipForward /> Skip
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function AttentionCard({ item }: { item: AttentionItem }) {
  const { pending, run } = useServerAction();
  const reason = item.attentionReason ?? (item.status === "REVIEW_REQUIRED" ? "QUESTION_REVIEW" : "AUTH_REQUIRED");
  const heading = HEADINGS[reason] ?? { title: enumLabel(reason), icon: TriangleAlert };
  const url = item.job.applicationUrl ?? item.job.url;
  const isAuth = reason === "MFA" || reason === "AUTH_REQUIRED";

  return (
    <Card className="gap-4">
      <CardHeader className="gap-3">
        <div className="flex items-center gap-2">
          <heading.icon className="text-warning size-4" />
          <span className="text-xs font-semibold tracking-wider uppercase">{heading.title}</span>
          <Badge variant="muted" className="ml-auto">
            Waiting {formatRelative(item.updatedAt).replace(" ago", "")}
          </Badge>
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
        {item.questions.length > 0 && (
          <div className="grid gap-2">
            {item.questions.map((q) => (
              <QuestionRow key={q.id} question={q} />
            ))}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          {item.questions.length === 0 && (
            <>
              <Button size="sm" variant="outline" asChild>
                <a href={url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink /> {isAuth ? "Open browser" : "Open application"}
                </a>
              </Button>
              {reason === "FINAL_REVIEW" ? (
                <Button size="sm" disabled={pending} onClick={() => run(() => markSubmittedAction(item.id))}>
                  <Check /> I submitted it
                </Button>
              ) : (
                <Button size="sm" disabled={pending} onClick={() => run(() => completeHumanStepAction(item.id))}>
                  <Check /> {reason === "CAPTCHA" ? "I've completed it" : isAuth ? "Continue" : "Try again"}
                </Button>
              )}
            </>
          )}
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => skipApplicationAction(item.id))}>
            <SkipForward /> Skip application
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
