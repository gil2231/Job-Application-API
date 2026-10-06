"use client";

import { useEffect } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { saveRecommendationKeywordsAction } from "@/actions/recommendations";
import { Field, FormMessage, SubmitButton, useActionForm } from "@/components/form";
import { TagInput } from "@/components/tag-input";
import { Card, CardContent } from "@/components/ui/card";

export function KeywordsForm({ keywords }: { keywords: string[] }) {
  const { state, onSubmit, pending } = useActionForm(saveRecommendationKeywordsAction, { ok: false });
  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
  }, [state]);
  return (
    <Card>
      <CardContent>
        <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end" noValidate>
          <div className="sm:col-span-2">
            <FormMessage state={state} />
          </div>
          <Field
            label="Your keywords"
            htmlFor="recommendation-keywords"
            error={state.errors?.keywords}
            hint="Roles, industries, products or skills you want, e.g. account executive, SaaS, medical devices. Press Enter after each one."
          >
            <TagInput id="recommendation-keywords" name="keywords" defaultValue={keywords} placeholder="Add a keyword" />
          </Field>
          <SubmitButton pending={pending} pendingLabel="Saving…" className="sm:mb-6">
            <Save /> Save keywords
          </SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
