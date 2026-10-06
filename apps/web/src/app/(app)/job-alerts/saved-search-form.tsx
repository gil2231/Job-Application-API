"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellRing, Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import type { SavedSearchFormInput } from "@autoapply/shared";
import { createSavedSearchAction, updateSavedSearchAction } from "@/actions/alerts";
import { Field, FormMessage } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action";

export interface SavedSearchValues {
  id?: string;
  name: string;
  boards: string[];
  query: string;
  location: string | null;
  searchDescriptions: boolean;
  matchAny: boolean;
  alertsEnabled: boolean;
}

/** A short name for a search, from its keywords. */
export function suggestSearchName(query: string, location?: string | null) {
  const words = query
    .replace(/(^|\s)-\S+/g, " ")
    .replace(/"/g, "")
    .trim()
    .replace(/\s+/g, " ");
  const name = [words, location?.trim()].filter(Boolean).join(" in ");
  return (name || "My search").slice(0, 80);
}

export function SavedSearchForm({ initial, onDone }: { initial: SavedSearchValues; onDone: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState<SavedSearchFormInput>({
    name: initial.name,
    boards: initial.boards.join("\n"),
    query: initial.query,
    location: initial.location ?? "",
    searchDescriptions: initial.searchDescriptions,
    matchAny: initial.matchAny,
    alertsEnabled: initial.alertsEnabled,
  });
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const [pending, start] = useTransition();
  const errors = (result && !result.ok ? result.errors : undefined) ?? {};
  const set = <K extends keyof SavedSearchFormInput>(key: K, value: SavedSearchFormInput[K]) => setForm((f) => ({ ...f, [key]: value }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const input = { ...form };
    start(async () => {
      const res = initial.id ? await updateSavedSearchAction(initial.id, input) : await createSavedSearchAction(input);
      setResult(res);
      if (res.ok) {
        toast.success(res.message ?? "Saved");
        router.refresh();
        onDone();
      }
    });
  };

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <FormMessage state={result ?? undefined} />
      <Field label="Name" htmlFor="search-name" error={errors.name}>
        <Input id="search-name" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Account executive roles" aria-invalid={!!errors.name} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <Field label="Keywords" htmlFor="search-query" error={errors.query} hint={`Use "quotes" for phrases and -word to skip jobs that mention it.`}>
          <Input id="search-query" value={form.query} onChange={(e) => set("query", e.target.value)} placeholder='"account executive" -commission' aria-invalid={!!errors.query} />
        </Field>
        <Field label="Location" htmlFor="search-location" error={errors.location} hint="Optional.">
          <Input id="search-location" value={form.location ?? ""} onChange={(e) => set("location", e.target.value)} placeholder="Any location" />
        </Field>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <div className="flex items-center gap-2">
          <Checkbox id="search-any" checked={form.matchAny} onCheckedChange={(v) => set("matchAny", v === true)} />
          <Label htmlFor="search-any" className="text-[13px] font-normal">
            Match any keyword, not all of them
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Checkbox id="search-descriptions" checked={form.searchDescriptions} onCheckedChange={(v) => set("searchDescriptions", v === true)} />
          <Label htmlFor="search-descriptions" className="text-[13px] font-normal">
            Also match descriptions
          </Label>
        </div>
      </div>
      <Field label="Job boards" htmlFor="search-boards" error={errors.boards} hint="One per line, up to 25 Greenhouse, Lever or Ashby job board links.">
        <Textarea
          id="search-boards"
          rows={4}
          value={form.boards}
          onChange={(e) => set("boards", e.target.value)}
          placeholder={"https://boards.greenhouse.io/acme\nhttps://jobs.lever.co/globex"}
          aria-invalid={!!errors.boards}
        />
      </Field>
      <div className="flex items-center gap-2">
        <Checkbox id="search-alerts" checked={form.alertsEnabled} onCheckedChange={(v) => set("alertsEnabled", v === true)} />
        <Label htmlFor="search-alerts" className="text-[13px] font-normal">
          Email me new matches every morning
        </Label>
      </div>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <BellRing />}
          {pending ? "Saving…" : initial.id ? "Save changes" : "Save search"}
        </Button>
      </div>
    </form>
  );
}

export function SavedSearchDialog({ initial, trigger }: { initial: SavedSearchValues; trigger: "new" | "edit" }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger === "new" ? (
          <Button size="sm">
            <Plus /> New saved search
          </Button>
        ) : (
          <Button size="xs" variant="outline" aria-label={`Edit ${initial.name}`}>
            <Pencil /> Edit
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{trigger === "new" ? "New saved search" : "Edit saved search"}</DialogTitle>
          <DialogDescription>Applyance runs your saved searches every morning and emails you the jobs posted since the last run.</DialogDescription>
        </DialogHeader>
        {open && <SavedSearchForm initial={initial} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}
