"use client";

import { useState } from "react";
import { BookOpenText, Lock, Pencil, Plus, Sparkles } from "lucide-react";
import type { AnswerListItem, AnswerSuggestion } from "@autoapply/database";
import { ANSWER_CATEGORIES, enumLabel, type AnswerCategory } from "@autoapply/shared";
import { deleteAnswerAction, saveAnswerAction } from "@/actions/answers";
import { Field, FormMessage, SubmitButton, useActionForm } from "@/components/form";
import { EmptyState } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { ConfirmDeleteButton } from "../profile/delete-button";
import { useToastOnSuccess } from "../profile/use-toast-on-success";

interface Draft {
  id?: string;
  questionKey?: string;
  question: string;
  answer: string;
  category: AnswerCategory;
  confidence: number;
  autoSubmitAllowed: boolean;
  requiresHumanReview: boolean;
  hint?: string;
}

function AnswerForm({ draft, onDone }: { draft: Draft; onDone: () => void }) {
  const { state, onSubmit, pending } = useActionForm(saveAnswerAction, { ok: false });
  useToastOnSuccess(state, onDone);
  const e = state.errors ?? {};
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      {draft.id && <input type="hidden" name="id" value={draft.id} />}
      {draft.questionKey && <input type="hidden" name="questionKey" value={draft.questionKey} />}
      <Field label="Question" htmlFor="question" error={e.question}>
        <Input id="question" name="question" defaultValue={draft.question} aria-invalid={!!e.question} />
      </Field>
      <Field label="Answer" htmlFor="answer" error={e.answer} hint={draft.hint ?? "Leave blank to always be asked for this one."}>
        <Textarea id="answer" name="answer" rows={5} defaultValue={draft.answer} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" htmlFor="category" error={e.category}>
          <Select name="category" defaultValue={draft.category}>
            <SelectTrigger id="category">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ANSWER_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {enumLabel(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Confidence (%)" htmlFor="confidence" error={e.confidence} hint="How sure you are this answer fits every employer.">
          <Input id="confidence" name="confidence" type="number" min={0} max={100} defaultValue={draft.confidence} />
        </Field>
      </div>
      <div className="grid gap-2">
        <div className="flex items-center gap-2">
          <Checkbox id="autoSubmitAllowed" name="autoSubmitAllowed" defaultChecked={draft.autoSubmitAllowed} />
          <Label htmlFor="autoSubmitAllowed" className="font-normal">
            Allow automatic submission with this answer
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="requiresHumanReview" name="requiresHumanReview" defaultChecked={draft.requiresHumanReview} />
          <Label htmlFor="requiresHumanReview" className="font-normal">
            Always ask me to review before using it
          </Label>
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Save answer
        </SubmitButton>
      </div>
    </form>
  );
}

export function AnswerLibrary({ answers, suggestions, threshold }: { answers: AnswerListItem[]; suggestions: AnswerSuggestion[]; threshold: number }) {
  const [draft, setDraft] = useState<Draft | null>(null);

  return (
    <div className="grid gap-5">
      {suggestions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Common questions you haven&apos;t answered</CardTitle>
            <CardDescription>Where your Master Profile states the fact, the answer is suggested for you. The rest need your input; nothing is guessed.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="divide-y rounded-lg border">
              {suggestions.map((s) => (
                <li key={s.key} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{s.question}</p>
                    <p className="text-muted-foreground text-xs">
                      {s.derived ? (
                        <span className="inline-flex items-center gap-1">
                          <Sparkles className="text-primary size-3" /> From your profile: {s.derived.answer}
                        </span>
                      ) : (
                        "Needs your answer"
                      )}
                    </p>
                  </div>
                  <Badge variant="outline">{enumLabel(s.category)}</Badge>
                  <Button
                    size="xs"
                    variant={s.derived ? "default" : "outline"}
                    onClick={() =>
                      setDraft({
                        questionKey: s.key,
                        question: s.question,
                        answer: s.derived?.answer ?? "",
                        category: s.category,
                        confidence: s.derived ? Math.round(s.derived.confidence * 100) : 100,
                        autoSubmitAllowed: s.autoSubmitAllowed,
                        requiresHumanReview: s.requiresHumanReview,
                        hint: s.derived?.explanation,
                      })
                    }
                  >
                    {s.derived ? "Review & save" : "Answer"}
                  </Button>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <Card className="gap-0 pb-0">
        <CardHeader className="border-b pb-4">
          <CardTitle className="text-sm">Your answers</CardTitle>
          <CardDescription>Answers under {threshold}% confidence always go to Needs Attention first.</CardDescription>
          <div className="col-start-2 row-span-2 row-start-1 self-start justify-self-end">
            <Button
              size="sm"
              onClick={() => setDraft({ question: "", answer: "", category: "OTHER", confidence: 100, autoSubmitAllowed: false, requiresHumanReview: true })}
            >
              <Plus /> Add answer
            </Button>
          </div>
        </CardHeader>
        {answers.length === 0 ? (
          <EmptyState icon={BookOpenText} title="No saved answers" description="Start with the common questions above, or add your own." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">Question</TableHead>
                <TableHead>Answer</TableHead>
                <TableHead>Category</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead>Auto-submit</TableHead>
                <TableHead>Review</TableHead>
                <TableHead className="w-0" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {answers.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="max-w-64 pl-5 whitespace-normal">{a.question}</TableCell>
                  <TableCell className="max-w-80 text-[13px] whitespace-normal">
                    {a.isSensitive && <Lock className="text-muted-foreground mr-1 inline size-3" aria-label="Encrypted" />}
                    {a.answer ? <span className="line-clamp-2">{a.answer}</span> : <span className="text-muted-foreground italic">Ask me each time</span>}
                  </TableCell>
                  <TableCell className="text-[13px]">{enumLabel(a.category)}</TableCell>
                  <TableCell className="text-[13px]">{enumLabel(a.source)}</TableCell>
                  <TableCell>
                    <span className={a.confidence < threshold ? "text-warning text-[13px] font-medium" : "text-[13px]"}>{a.confidence}%</span>
                  </TableCell>
                  <TableCell>{a.autoSubmitAllowed ? <Badge variant="success">Allowed</Badge> : <Badge variant="muted">No</Badge>}</TableCell>
                  <TableCell>{a.requiresHumanReview ? <Badge variant="warning">Required</Badge> : <Badge variant="muted">No</Badge>}</TableCell>
                  <TableCell className="pr-3">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Edit"
                        onClick={() =>
                          setDraft({
                            id: a.id,
                            questionKey: a.questionKey,
                            question: a.question,
                            answer: a.answer,
                            category: a.category,
                            confidence: a.confidence,
                            autoSubmitAllowed: a.autoSubmitAllowed,
                            requiresHumanReview: a.requiresHumanReview,
                          })
                        }
                      >
                        <Pencil />
                      </Button>
                      <ConfirmDeleteButton title="Delete this answer?" description="Applications will ask you for it again." action={() => deleteAnswerAction(a.id)} />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Dialog open={draft !== null} onOpenChange={(open) => !open && setDraft(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit answer" : "Save answer"}</DialogTitle>
            <DialogDescription>Only write what is true for you. Demographic answers are encrypted at rest.</DialogDescription>
          </DialogHeader>
          {draft && <AnswerForm draft={draft} onDone={() => setDraft(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}
