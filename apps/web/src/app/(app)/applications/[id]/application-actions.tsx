"use client";

import { useState } from "react";
import { ExternalLink, RotateCcw, SkipForward } from "lucide-react";
import { APPLICATION_OUTCOMES, enumLabel, type ApplicationOutcome, type ApplicationStatus } from "@autoapply/shared";
import { addNoteAction, retryApplicationsAction, setOutcomeAction, skipApplicationAction } from "@/actions/applications";
import { useServerAction } from "@/components/action-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const OUTCOME_LABEL: Record<ApplicationOutcome, string> = {
  NONE: "No response yet",
  RESPONDED: "Responded",
  INTERVIEW: "Interview",
  OFFER: "Offer",
  DECLINED: "Rejected",
};

export function ApplicationActions({ applicationId, status, outcome, jobUrl }: { applicationId: string; status: ApplicationStatus; outcome: ApplicationOutcome; jobUrl: string }) {
  const { pending, run } = useServerAction();
  const submitted = status === "SUBMITTED" || status === "REJECTED";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {submitted && (
        <Select value={outcome} onValueChange={(v) => run(() => setOutcomeAction(applicationId, v))} disabled={pending}>
          <SelectTrigger size="sm" className="w-44" aria-label="Outcome">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {APPLICATION_OUTCOMES.map((o) => (
              <SelectItem key={o} value={o}>
                {OUTCOME_LABEL[o] ?? enumLabel(o)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      {status === "FAILED" && (
        <Button size="sm" disabled={pending} onClick={() => run(() => retryApplicationsAction([applicationId]))}>
          <RotateCcw /> Retry
        </Button>
      )}
      {!["SUBMITTED", "PROCESSING", "REJECTED", "SKIPPED"].includes(status) && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => skipApplicationAction(applicationId))}>
          <SkipForward /> Skip
        </Button>
      )}
      <Button size="sm" variant="outline" asChild>
        <a href={jobUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink /> Open application
        </a>
      </Button>
    </div>
  );
}

export function NoteForm({ applicationId }: { applicationId: string }) {
  const [note, setNote] = useState("");
  const { pending, run } = useServerAction();
  return (
    <form
      className="flex gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(() => addNoteAction(applicationId, note), { onSuccess: () => setNote("") });
      }}
    >
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note (e.g. recruiter called)" maxLength={2000} aria-label="Note" />
      <Button type="submit" variant="outline" disabled={pending || !note.trim()}>
        Add
      </Button>
    </form>
  );
}
