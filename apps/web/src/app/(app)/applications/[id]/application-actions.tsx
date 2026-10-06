"use client";

import { useState } from "react";
import { Check, ExternalLink, RotateCcw, Send, SkipForward } from "lucide-react";
import type { ApplicationStatus, AttentionReason, TrackerStage } from "@autoapply/shared";
import { addNoteAction, approveSubmissionAction, markSubmittedAction, retryApplicationsAction, skipApplicationAction } from "@/actions/applications";
import { useServerAction } from "@/components/action-button";
import { StageMenu, useStageMover } from "@/components/stage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ApplicationActions({
  applicationId,
  status,
  stage,
  lockedBy,
  jobUrl,
  attentionReason,
  hasOpenQuestions,
}: {
  applicationId: string;
  status: ApplicationStatus;
  stage: TrackerStage;
  lockedBy: string | null;
  jobUrl: string;
  attentionReason: AttentionReason | null;
  hasOpenQuestions: boolean;
}) {
  const { pending, run } = useServerAction();
  const mover = useStageMover();
  const canApprove = (status === "READY" || status === "REVIEW_REQUIRED") && !hasOpenQuestions && (!attentionReason || attentionReason === "FINAL_REVIEW" || attentionReason === "CONTRADICTION");
  const canMarkSubmitted = status === "READY" || status === "REVIEW_REQUIRED" || status === "WAITING_FOR_USER";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {mover.dialog}
      <StageMenu card={{ id: applicationId, stage, lockedBy }} onMove={(to) => mover.move({ id: applicationId, stage, lockedBy }, to)} pending={mover.pending} variant="button" />
      {canApprove && (
        <Button size="sm" disabled={pending} onClick={() => run(() => approveSubmissionAction(applicationId))}>
          <Send /> {status === "READY" ? "Let AutoApply submit" : "Approve & submit"}
        </Button>
      )}
      {canMarkSubmitted && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => markSubmittedAction(applicationId))}>
          <Check /> I submitted it
        </Button>
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
