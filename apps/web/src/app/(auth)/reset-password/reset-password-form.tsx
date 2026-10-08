"use client";

import Link from "next/link";
import { resetPasswordAction } from "@/actions/auth";
import { Field, FormMessage, SubmitButton, useActionForm } from "@/components/form";
import { Input } from "@/components/ui/input";

export function ResetPasswordForm({ token }: { token: string }) {
  const { state, onSubmit, pending } = useActionForm(resetPasswordAction, { ok: false });
  return (
    <form method="post" onSubmit={onSubmit} className="mt-8 grid gap-4" noValidate>
      <FormMessage state={state} />
      {state.message?.includes("expired") && (
        <Link href="/forgot-password" className="text-primary text-sm font-medium hover:underline">
          Send me a new link
        </Link>
      )}
      <input type="hidden" name="token" value={token} />
      <Field label="New password" htmlFor="password" error={state.errors?.password} hint="At least 10 characters, with a letter and a number">
        <Input id="password" name="password" type="password" autoComplete="new-password" required autoFocus aria-invalid={!!state.errors?.password} />
      </Field>
      <Field label="Confirm new password" htmlFor="confirmPassword" error={state.errors?.confirmPassword}>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required aria-invalid={!!state.errors?.confirmPassword} />
      </Field>
      <SubmitButton pending={pending} className="mt-2 w-full" pendingLabel="Saving…">
        Set new password
      </SubmitButton>
    </form>
  );
}
