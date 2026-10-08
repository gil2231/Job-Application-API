"use client";

import Link from "next/link";
import { signUpAction } from "@/actions/auth";
import { Field, FormMessage, SubmitButton, useActionForm } from "@/components/form";
import { Input } from "@/components/ui/input";

export function SignUpForm() {
  const { state, onSubmit, pending } = useActionForm(signUpAction, { ok: false });
  return (
    <form method="post" onSubmit={onSubmit} className="mt-8 grid gap-4" noValidate>
      <FormMessage state={state} />
      <Field label="Full name" htmlFor="name" error={state.errors?.name}>
        <Input id="name" name="name" autoComplete="name" required autoFocus aria-invalid={!!state.errors?.name} />
      </Field>
      <Field label="Email" htmlFor="email" error={state.errors?.email}>
        <Input id="email" name="email" type="email" autoComplete="email" required aria-invalid={!!state.errors?.email} />
      </Field>
      <Field label="Password" htmlFor="password" error={state.errors?.password} hint="At least 10 characters, with a letter and a number.">
        <Input id="password" name="password" type="password" autoComplete="new-password" required aria-invalid={!!state.errors?.password} />
      </Field>
      <SubmitButton pending={pending} className="mt-2 w-full" pendingLabel="Creating account…">
        Create account
      </SubmitButton>
      <p className="text-muted-foreground text-center text-xs">
        By creating an account, you agree to the{" "}
        <Link href="/terms" target="_blank" className="text-foreground underline underline-offset-2">
          Terms of Service
        </Link>{" "}
        and{" "}
        <Link href="/privacy" target="_blank" className="text-foreground underline underline-offset-2">
          Privacy Policy
        </Link>
        .
      </p>
    </form>
  );
}
