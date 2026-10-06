"use client";

import { savePersonalAction } from "@/actions/profile";
import { Field, FormMessage, SubmitButton, useActionForm } from "@/components/form";
import { Input } from "@/components/ui/input";
import { useToastOnSuccess } from "./use-toast-on-success";
import type { FullProfile } from "@autoapply/database";

const FIELDS: Array<{ name: keyof FullProfile; label: string; type?: string; autoComplete?: string; placeholder?: string; span?: boolean }> = [
  { name: "firstName", label: "First name", autoComplete: "given-name" },
  { name: "lastName", label: "Last name", autoComplete: "family-name" },
  { name: "preferredName", label: "Preferred name", placeholder: "Optional" },
  { name: "email", label: "Email", type: "email", autoComplete: "email" },
  { name: "phone", label: "Phone", type: "tel", autoComplete: "tel", placeholder: "+1 555 123 4567" },
  { name: "addressLine1", label: "Address", autoComplete: "address-line1", span: true },
  { name: "addressLine2", label: "Apartment, suite, etc.", autoComplete: "address-line2", span: true },
  { name: "city", label: "City", autoComplete: "address-level2" },
  { name: "state", label: "State / province", autoComplete: "address-level1" },
  { name: "postalCode", label: "ZIP / postal code", autoComplete: "postal-code" },
  { name: "country", label: "Country", autoComplete: "country-name" },
  { name: "linkedinUrl", label: "LinkedIn", type: "url", placeholder: "https://www.linkedin.com/in/…" },
  { name: "portfolioUrl", label: "Portfolio", type: "url", placeholder: "https://…" },
  { name: "websiteUrl", label: "Website", type: "url", placeholder: "https://…" },
  { name: "githubUrl", label: "GitHub", type: "url", placeholder: "https://github.com/…" },
];

export function PersonalForm({ profile }: { profile: FullProfile }) {
  const { state, onSubmit, pending } = useActionForm(savePersonalAction, { ok: false });
  useToastOnSuccess(state);
  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((f) => (
          <Field key={f.name} label={f.label} htmlFor={f.name} error={state.errors?.[f.name]} className={f.span ? "sm:col-span-2" : undefined}>
            <Input
              id={f.name}
              name={f.name}
              type={f.type ?? "text"}
              autoComplete={f.autoComplete}
              placeholder={f.placeholder}
              defaultValue={(profile[f.name] as string | null) ?? ""}
              aria-invalid={!!state.errors?.[f.name]}
            />
          </Field>
        ))}
      </div>
      <div className="flex justify-end">
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Save personal details
        </SubmitButton>
      </div>
    </form>
  );
}
