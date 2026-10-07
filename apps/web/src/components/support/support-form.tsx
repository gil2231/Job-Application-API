"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { SUPPORT_CATEGORIES, SUPPORT_CATEGORY_LABELS, SUPPORT_MESSAGE_MAX, type SupportCategory } from "@autoapply/shared";
import { sendSupportRequestAction } from "@/actions/support";
import { Field, FormMessage, SubmitButton, useActionForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToastOnSuccess } from "@/app/(app)/profile/use-toast-on-success";

export interface SupportFormProps {
  /** Signed-out visitors also give their name and an email to reply to. */
  signedIn: boolean;
  defaultCategory?: SupportCategory;
  applicationId?: string;
  /** Called after a successful send; without it the form shows a confirmation in place. */
  onSent?: () => void;
  onCancel?: () => void;
}

export function SupportForm({ signedIn, defaultCategory = "BUG", applicationId, onSent, onCancel }: SupportFormProps) {
  const pathname = usePathname();
  const { state, onSubmit, pending } = useActionForm(sendSupportRequestAction, { ok: false });
  useToastOnSuccess(state, onSent);
  const e = state.errors ?? {};

  if (state.ok && !onSent) {
    return (
      <div role="status" className="grid justify-items-start gap-2 rounded-lg border p-5">
        <CheckCircle2 className="text-success size-5" />
        <p className="font-medium">Message sent</p>
        <p className="text-muted-foreground text-sm">We&apos;ll reply by email{signedIn ? " to the address on your account" : ""}.</p>
        {signedIn && (
          <Button asChild variant="outline" size="sm" className="mt-2">
            <Link href="/dashboard">Back to Applyance</Link>
          </Button>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="pagePath" value={pathname} />
      {applicationId && <input type="hidden" name="applicationId" value={applicationId} />}
      <div aria-hidden className="absolute -left-[9999px] h-0 overflow-hidden">
        <label htmlFor="support-website">Website</label>
        <input id="support-website" name="website" tabIndex={-1} autoComplete="off" />
      </div>
      {!signedIn && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Your name" htmlFor="support-name" error={e.name}>
            <Input id="support-name" name="name" autoComplete="name" />
          </Field>
          <Field label="Email to reply to" htmlFor="support-email" error={e.email}>
            <Input id="support-email" name="email" type="email" autoComplete="email" aria-invalid={!!e.email} />
          </Field>
        </div>
      )}
      <Field label="What is this about?" htmlFor="support-category" error={e.category}>
        <Select name="category" defaultValue={defaultCategory}>
          <SelectTrigger id="support-category" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SUPPORT_CATEGORIES.map((c) => (
              <SelectItem key={c} value={c}>
                {SUPPORT_CATEGORY_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Summary" htmlFor="support-subject" error={e.subject}>
        <Input id="support-subject" name="subject" maxLength={150} placeholder="e.g. Resume upload never finishes" aria-invalid={!!e.subject} />
      </Field>
      <Field
        label="What happened?"
        htmlFor="support-message"
        error={e.message}
        hint="What you were doing, what you expected, and what happened instead. Please don't include passwords or card numbers."
      >
        <Textarea id="support-message" name="message" rows={6} maxLength={SUPPORT_MESSAGE_MAX} aria-invalid={!!e.message} />
      </Field>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <SubmitButton pending={pending} pendingLabel="Sending…">
          Send report
        </SubmitButton>
      </div>
    </form>
  );
}
