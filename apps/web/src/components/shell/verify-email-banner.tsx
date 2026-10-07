"use client";

import { MailCheck } from "lucide-react";
import { resendVerificationAction } from "@/actions/auth";
import { ActionButton } from "@/components/action-button";

export function VerifyEmailBanner({ email }: { email: string }) {
  return (
    <div role="status" className="bg-primary/5 border-b px-4 py-2 sm:px-8">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <MailCheck className="text-primary size-4" />
        <span>
          Confirm your email with the link we sent to <strong className="font-medium">{email}</strong>, so you can reset your password if you ever need to.
        </span>
        <ActionButton action={resendVerificationAction} size="xs" variant="ghost" className="text-primary">
          Send a new link
        </ActionButton>
      </div>
    </div>
  );
}
