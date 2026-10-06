"use client";

import { forgotPasswordAction } from "@/actions/auth";
import { Field, FormMessage, SubmitButton, useActionForm } from "@/components/form";
import { Input } from "@/components/ui/input";

export function ForgotPasswordForm() {
  const { state, onSubmit, pending } = useActionForm(forgotPasswordAction, { ok: false });
  if (state.ok) {
    return (
      <p role="status" className="border-success/30 bg-success/5 mt-8 rounded-md border px-3 py-3 text-sm">
        {state.message}
      </p>
    );
  }
  return (
    <form onSubmit={onSubmit} className="mt-8 grid gap-4" noValidate>
      <FormMessage state={state} />
      <Field label="Email" htmlFor="email" error={state.errors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus aria-invalid={!!state.errors?.email} />
      </Field>
      <SubmitButton pending={pending} className="mt-2 w-full" pendingLabel="Sending…">
        Send reset link
      </SubmitButton>
    </form>
  );
}
