"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { format } from "date-fns";
import { CalendarClock, CalendarPlus, Check, ExternalLink, MoreHorizontal, Pencil, Trash2, Users, X } from "lucide-react";
import { toast } from "sonner";
import type { InterviewRound } from "@autoapply/database";
import { enumLabel, INTERVIEW_KINDS, INTERVIEW_STATUSES, type InterviewKind, type InterviewStatus } from "@autoapply/shared";
import { addInterviewAction, deleteInterviewAction, setInterviewStatusAction, updateInterviewAction } from "@/actions/tracker";
import { useServerAction } from "@/components/action-button";
import { Field, FormMessage, SubmitButton } from "@/components/form";
import { LocalTime } from "@/components/local-time";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action";
import { cn } from "@/lib/utils";

const KIND_LABEL: Record<InterviewKind, string> = {
  PHONE_SCREEN: "Phone screen",
  RECRUITER: "Recruiter call",
  HIRING_MANAGER: "Hiring manager",
  TECHNICAL: "Technical",
  BEHAVIORAL: "Behavioral",
  CASE_STUDY: "Case study",
  PANEL: "Panel",
  ONSITE: "Onsite",
  FINAL: "Final round",
  OTHER: "Other",
};

const STATUS_VARIANT: Record<InterviewStatus, "info" | "success" | "muted"> = { SCHEDULED: "info", COMPLETED: "success", CANCELLED: "muted" };

type Round = Pick<InterviewRound, "id" | "kind" | "title" | "scheduledAt" | "durationMinutes" | "location" | "interviewers" | "notes" | "status">;

export function InterviewsCard({ applicationId, rounds, canAdd }: { applicationId: string; rounds: Round[]; canAdd: boolean }) {
  const [editing, setEditing] = useState<Round | "new" | null>(null);
  const [deleting, setDeleting] = useState<Round | null>(null);
  const { pending, run } = useServerAction();
  const [now] = useState(() => Date.now());

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Interviews</CardTitle>
        <CardDescription>
          {canAdd
            ? "Rounds, dates and notes. Adding the first one moves the application to Interviewing."
            : "Interview rounds can be added once the application is submitted."}
        </CardDescription>
        {canAdd && (
          <CardAction>
            <Button size="sm" variant="outline" onClick={() => setEditing("new")}>
              <CalendarPlus /> Add interview
            </Button>
          </CardAction>
        )}
      </CardHeader>
      {rounds.length > 0 && (
        <CardContent>
          <ol className="grid gap-3" aria-label="Interview rounds">
            {rounds.map((r, i) => {
              const past = r.scheduledAt && new Date(r.scheduledAt).getTime() < now;
              return (
                <li key={r.id} className={cn("grid gap-1.5 rounded-lg border p-3", r.status === "CANCELLED" && "opacity-60")} data-testid="interview-round">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        <span className="text-muted-foreground mr-1.5 tabular-nums">{i + 1}.</span>
                        {r.title || KIND_LABEL[r.kind]}
                        {r.title && <span className="text-muted-foreground font-normal"> · {KIND_LABEL[r.kind]}</span>}
                      </p>
                      <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs">
                        <span className="inline-flex items-center gap-1">
                          <CalendarClock className="size-3.5" />
                          {r.scheduledAt ? <LocalTime value={r.scheduledAt} /> : "Date not set"}
                          {r.durationMinutes ? ` · ${r.durationMinutes} min` : ""}
                        </span>
                        {r.interviewers && (
                          <span className="inline-flex items-center gap-1">
                            <Users className="size-3.5" /> {r.interviewers}
                          </span>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <Badge variant={STATUS_VARIANT[r.status]}>{r.status === "SCHEDULED" && past ? "Awaiting update" : enumLabel(r.status)}</Badge>
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon-sm" variant="ghost" className="size-7" aria-label={`Actions for ${r.title || KIND_LABEL[r.kind]}`} disabled={pending}>
                            <MoreHorizontal className="size-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onSelect={() => setEditing(r)}>
                            <Pencil /> Edit
                          </DropdownMenuItem>
                          {r.status !== "COMPLETED" && (
                            <DropdownMenuItem onSelect={() => run(() => setInterviewStatusAction(r.id, "COMPLETED"))}>
                              <Check /> Mark completed
                            </DropdownMenuItem>
                          )}
                          {r.status !== "CANCELLED" && (
                            <DropdownMenuItem onSelect={() => run(() => setInterviewStatusAction(r.id, "CANCELLED"))}>
                              <X /> Mark cancelled
                            </DropdownMenuItem>
                          )}
                          {r.status !== "SCHEDULED" && (
                            <DropdownMenuItem onSelect={() => run(() => setInterviewStatusAction(r.id, "SCHEDULED"))}>
                              <CalendarClock /> Mark scheduled
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(r)}>
                            <Trash2 /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  {r.location && (
                    <p className="text-xs break-words">
                      {/^https?:\/\//i.test(r.location) ? (
                        <a href={r.location} target="_blank" rel="noopener noreferrer" className="text-primary inline-flex items-center gap-1 hover:underline">
                          <ExternalLink className="size-3" /> Join link
                        </a>
                      ) : (
                        r.location
                      )}
                    </p>
                  )}
                  {r.notes && <p className="text-[13px] whitespace-pre-wrap">{r.notes}</p>}
                </li>
              );
            })}
          </ol>
        </CardContent>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing === "new" ? "Add interview" : "Edit interview"}</DialogTitle>
            <DialogDescription>Times are in your own time zone.</DialogDescription>
          </DialogHeader>
          {editing !== null && (
            <InterviewForm
              key={editing === "new" ? "new" : editing.id}
              round={editing === "new" ? null : editing}
              action={editing === "new" ? addInterviewAction.bind(null, applicationId) : updateInterviewAction.bind(null, editing.id)}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this interview?</AlertDialogTitle>
            <AlertDialogDescription>Its date and notes are removed. The application stays in its current stage.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleting) run(() => deleteInterviewAction(deleting.id));
                setDeleting(null);
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function InterviewForm({ round, action, onDone }: { round: Round | null; action: (prev: ActionResult, formData: FormData) => Promise<ActionResult>; onDone: () => void }) {
  const [state, dispatch, pending] = useActionState<ActionResult, FormData>(action, { ok: false });
  const [kind, setKind] = useState<InterviewKind>(round?.kind ?? "PHONE_SCREEN");
  const [status, setStatus] = useState<InterviewStatus>(round?.status ?? "SCHEDULED");

  useEffect(() => {
    if (state.ok) {
      toast.success(state.message ?? "Saved");
      onDone();
    }
  }, [state, onDone]);

  const e = state.errors ?? {};
  return (
    <form
      noValidate
      className="grid gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const formData = new FormData(event.currentTarget);
        // datetime-local has no time zone; send the exact instant the person picked in theirs.
        const local = formData.get("scheduledAtLocal");
        formData.delete("scheduledAtLocal");
        formData.set("scheduledAt", typeof local === "string" && local ? new Date(local).toISOString() : "");
        formData.set("kind", kind);
        formData.set("status", status);
        startTransition(() => dispatch(formData));
      }}
    >
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" htmlFor="interview-kind" error={e.kind}>
          <Select value={kind} onValueChange={(v) => setKind(v as InterviewKind)}>
            <SelectTrigger id="interview-kind">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {INTERVIEW_KINDS.map((k) => (
                <SelectItem key={k} value={k}>
                  {KIND_LABEL[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Name (optional)" htmlFor="interview-title" error={e.title} hint='e.g. "Round 2 with the VP"'>
          <Input id="interview-title" name="title" defaultValue={round?.title ?? ""} maxLength={120} />
        </Field>
        <Field label="Date and time" htmlFor="interview-when" error={e.scheduledAt} hint="Leave empty if it isn't booked yet.">
          <Input id="interview-when" name="scheduledAtLocal" type="datetime-local" defaultValue={round?.scheduledAt ? format(new Date(round.scheduledAt), "yyyy-MM-dd'T'HH:mm") : ""} aria-invalid={!!e.scheduledAt} />
        </Field>
        <Field label="Length (minutes)" htmlFor="interview-duration" error={e.durationMinutes}>
          <Input id="interview-duration" name="durationMinutes" type="number" min={5} max={600} step={5} defaultValue={round?.durationMinutes ?? ""} aria-invalid={!!e.durationMinutes} />
        </Field>
        <Field label="Where" htmlFor="interview-location" error={e.location} hint="Address or meeting link" className="sm:col-span-2">
          <Input id="interview-location" name="location" defaultValue={round?.location ?? ""} maxLength={500} />
        </Field>
        <Field label="With" htmlFor="interview-interviewers" error={e.interviewers} hint="Names or roles of the interviewers" className="sm:col-span-2">
          <Input id="interview-interviewers" name="interviewers" defaultValue={round?.interviewers ?? ""} maxLength={300} />
        </Field>
        <Field label="Notes" htmlFor="interview-notes" error={e.notes} className="sm:col-span-2">
          <Textarea id="interview-notes" name="notes" rows={4} defaultValue={round?.notes ?? ""} maxLength={5000} placeholder="Prep, questions asked, how it went…" />
        </Field>
        {round && (
          <Field label="Status" htmlFor="interview-status" error={e.status}>
            <Select value={status} onValueChange={(v) => setStatus(v as InterviewStatus)}>
              <SelectTrigger id="interview-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVIEW_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {enumLabel(s)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <SubmitButton pending={pending}>{round ? "Save" : "Add interview"}</SubmitButton>
      </div>
    </form>
  );
}
