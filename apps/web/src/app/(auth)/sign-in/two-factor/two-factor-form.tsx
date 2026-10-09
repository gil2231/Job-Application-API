"use client";

import { verifyTwoFactorSignInAction } from "@/actions/auth";
import { Field, FormMessage, SubmitButton, useActionForm } from "@/components/form";
import { Input } from "@/components/ui/input";

export function TwoFactorForm() {
  const { state, onSubmit, pending } = useActionForm(verifyTwoFactorSignInAction, { ok: false });
  return (
    <form method="post" onSubmit={onSubmit} className="mt-8 grid gap-4" noValidate>
      <FormMessage state={state} />
      <Field label="Authentication code" htmlFor="code" error={state.errors?.code} hint="A 6-digit code, or a recovery code like k3f9q-x7m2p">
        <Input id="code" name="code" autoComplete="one-time-code" inputMode="text" autoFocus required maxLength={20} aria-invalid={!!state.errors?.code} className="font-mono tracking-widest" />
      </Field>
      <SubmitButton pending={pending} className="mt-2 w-full" pendingLabel="Checking…">
        Verify
      </SubmitButton>
    </form>
  );
}
