"use client";

import type { FullProfile } from "@autoapply/database";
import { saveProfessionalAction } from "@/actions/profile";
import { Field, FormMessage, SubmitButton, useActionForm } from "@/components/form";
import { TagInput } from "@/components/tag-input";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useToastOnSuccess } from "./use-toast-on-success";

export function ProfessionalForm({ profile }: { profile: FullProfile }) {
  const { state, onSubmit, pending } = useActionForm(saveProfessionalAction, { ok: false });
  useToastOnSuccess(state);
  const skills = (category: string) => profile.skills.filter((s) => s.category === category).map((s) => s.name);
  const e = state.errors ?? {};

  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Current title" htmlFor="currentTitle" error={e.currentTitle}>
          <Input id="currentTitle" name="currentTitle" defaultValue={profile.currentTitle ?? ""} aria-invalid={!!e.currentTitle} />
        </Field>
        <Field label="Years of experience" htmlFor="yearsExperience" error={e.yearsExperience} hint="Leave blank to calculate it from your employment history.">
          <Input
            id="yearsExperience"
            name="yearsExperience"
            type="number"
            min={0}
            max={70}
            step={0.5}
            defaultValue={profile.yearsExperience ?? ""}
            aria-invalid={!!e.yearsExperience}
          />
        </Field>
        <Field label="Target titles" htmlFor="targetTitles" error={e.targetTitles} className="sm:col-span-2" hint="Press Enter or comma after each title.">
          <TagInput id="targetTitles" name="targetTitles" defaultValue={profile.targetTitles} placeholder="e.g. Business Development Representative" />
        </Field>
        <Field label="Professional summary" htmlFor="summary" error={e.summary} className="sm:col-span-2">
          <Textarea id="summary" name="summary" rows={5} defaultValue={profile.summary ?? ""} aria-invalid={!!e.summary} />
        </Field>
        <Field label="Industries" htmlFor="industries" error={e.industries} className="sm:col-span-2">
          <TagInput id="industries" name="industries" defaultValue={profile.industries} placeholder="e.g. SaaS, Fintech" />
        </Field>
        <Field label="Skills" htmlFor="skills" error={e.skills} className="sm:col-span-2">
          <TagInput id="skills" name="skills" defaultValue={skills("SKILL")} placeholder="e.g. Prospecting, Cold calling" />
        </Field>
        <Field label="Software" htmlFor="software" error={e.software}>
          <TagInput id="software" name="software" defaultValue={skills("SOFTWARE")} placeholder="e.g. Salesforce, HubSpot" />
        </Field>
        <Field label="Technical skills" htmlFor="technicalSkills" error={e.technicalSkills}>
          <TagInput id="technicalSkills" name="technicalSkills" defaultValue={skills("TECHNICAL")} placeholder="e.g. SQL, Excel modeling" />
        </Field>
        <Field label="Languages" htmlFor="languages" error={e.languages} className="sm:col-span-2">
          <TagInput id="languages" name="languages" defaultValue={skills("LANGUAGE")} placeholder="e.g. English (native), Spanish (professional)" />
        </Field>
      </div>
      <div className="flex justify-end">
        <SubmitButton pending={pending} pendingLabel="Saving…">
          Save professional details
        </SubmitButton>
      </div>
    </form>
  );
}
