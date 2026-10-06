"use client";

import { signInAction } from "@/actions/auth";
import { Field, FormMessage, SubmitButton, useActionForm } from "@/components/form";
import { Input } from "@/components/ui/input";

export function SignInForm({ next }: { next?: string }) {
  const { state, onSubmit, pending } = useActionForm(signInAction, { ok: false });
  return (
    <form onSubmit={onSubmit} className="mt-8 grid gap-4" noValidate>
      <FormMessage state={state} />
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label="Email" htmlFor="email" error={state.errors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus aria-invalid={!!state.errors?.email} />
      </Field>
      <Field label="Password" htmlFor="password" error={state.errors?.password}>
        <Input id="password" name="password" type="password" autoComplete="current-password" required aria-invalid={!!state.errors?.password} />
      </Field>
      <SubmitButton pending={pending} className="mt-2 w-full" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>
    </form>
  );
}
