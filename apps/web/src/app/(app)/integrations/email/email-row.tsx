"use client";

import { useState } from "react";
import Link from "next/link";
import { Link2, X } from "lucide-react";
import { STAGE_META, type TrackerStage } from "@autoapply/shared";
import { dismissEmailAction, linkEmailAction } from "@/actions/mail";
import { useServerAction } from "@/components/action-button";
import { LocalTime } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const KIND: Record<string, { label: string; variant: "info" | "success" | "warning" | "muted" | "destructive" }> = {
  CONFIRMATION: { label: "Application received", variant: "muted" },
  RESPONSE: { label: "Reply", variant: "info" },
  INTERVIEW: { label: "Interview", variant: "warning" },
  OFFER: { label: "Offer", variant: "success" },
  REJECTION: { label: "Rejection", variant: "muted" },
};

export interface EmailRowData {
  id: string;
  fromName: string | null;
  fromAddress: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  kind: string;
  stage: string | null;
  outcome: string;
  application: { id: string; label: string } | null;
  provider: "GOOGLE" | "MICROSOFT";
}

function outcomeText(email: EmailRowData) {
  const stage = email.stage && email.stage in STAGE_META ? STAGE_META[email.stage as TrackerStage].label : null;
  switch (email.outcome) {
    case "MOVED":
      return `Moved to ${stage}`;
    case "INTERVIEW_ADDED":
      return "Interview added";
    case "SUGGESTED":
      return `Looks like ${stage}: check the application`;
    case "UNMATCHED":
      return "Couldn't tell which application this is about";
    case "AMBIGUOUS":
      return "Could be more than one of your applications";
    case "DISMISSED":
      return "Dismissed";
    default:
      return "No change needed";
  }
}

export function EmailRow({ email, applications }: { email: EmailRowData; applications: Array<{ id: string; label: string }> }) {
  const { pending, run } = useServerAction();
  const [choice, setChoice] = useState<string>("");
  const kind = KIND[email.kind] ?? KIND.RESPONSE!;
  const needsMatch = email.outcome === "UNMATCHED" || email.outcome === "AMBIGUOUS";
  return (
    <li className="grid gap-2 px-4 py-3" data-testid="email-row">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{email.subject}</p>
          <p className="text-muted-foreground truncate text-xs">
            {email.fromName ? `${email.fromName} <${email.fromAddress}>` : email.fromAddress} · <LocalTime value={email.receivedAt} pattern="MMM d, h:mm a" />
            {" · "}
            {email.provider === "GOOGLE" ? "Gmail" : "Outlook"}
          </p>
        </div>
        <Badge variant={kind.variant}>{kind.label}</Badge>
      </div>
      {email.snippet && <p className="text-muted-foreground line-clamp-2 text-[13px]">{email.snippet}</p>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <span className={needsMatch ? "text-[color-mix(in_oklch,var(--warning),black_25%)] dark:text-warning font-medium" : "font-medium"} data-testid="email-outcome">
          {outcomeText(email)}
        </span>
        {email.application && (
          <Link href={`/applications/${email.application.id}`} className="text-primary hover:underline">
            {email.application.label}
          </Link>
        )}
      </div>
      {needsMatch && (
        <div className="flex flex-wrap items-center gap-2">
          <Select value={choice} onValueChange={setChoice} disabled={pending || applications.length === 0}>
            <SelectTrigger size="sm" className="w-72 max-w-full" aria-label="Application this email is about">
              <SelectValue placeholder={applications.length ? "Choose the application" : "No sent applications"} />
            </SelectTrigger>
            <SelectContent>
              {applications.map((a) => (
                <SelectItem key={a.id} value={a.id}>
                  {a.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" disabled={!choice || pending} onClick={() => run(() => linkEmailAction(email.id, choice))}>
            <Link2 /> Match
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => dismissEmailAction(email.id))}>
            <X /> Not about a job
          </Button>
        </div>
      )}
    </li>
  );
}
