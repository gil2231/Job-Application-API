"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowLeft, Loader2, Pencil, Save, Search, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { findJobsAction, recommendedOpeningsAction, saveSearchPreferencesAction, type FoundJobsData } from "@/actions/find-jobs";
import { Field, FormMessage, SubmitButton, useActionForm } from "@/components/form";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action";
import { FoundJobsList } from "./found-jobs-list";
import { RecommendedList, type RecommendedRow } from "./recommended-list";

function PreferencesBox({ text, isDefault }: { text: string; isDefault: boolean }) {
  const { state, onSubmit, pending } = useActionForm(saveSearchPreferencesAction, { ok: false });
  // The form state when Edit was pressed; a successful save after that closes the box.
  const [openedWith, setOpenedWith] = useState<ActionResult | null>(null);
  const editing = openedWith !== null && !(state.ok && state !== openedWith);
  const setEditing = (open: boolean) => setOpenedWith(open ? state : null);
  useEffect(() => {
    if (state.ok && state.message) toast.success(state.message);
  }, [state]);

  if (!editing) {
    return (
      <div className="flex items-start gap-3 rounded-lg border px-3 py-2.5" data-testid="search-preferences">
        <div className="min-w-0 flex-1 text-[13px]">
          <p className="text-muted-foreground text-xs">Your job preferences{isDefault && " (a starting list; make it yours)"}</p>
          <p className="line-clamp-2">{text || "None yet. Add roles, industries, keywords and places."}</p>
        </div>
        <Button type="button" size="xs" variant="outline" onClick={() => setEditing(true)}>
          <Pencil /> Edit preferences
        </Button>
      </div>
    );
  }
  return (
    <form onSubmit={onSubmit} className="grid gap-2 rounded-lg border px-3 py-3" noValidate>
      <FormMessage state={state} />
      <Field
        label="Your job preferences"
        htmlFor="search-preferences"
        error={state.errors?.preferences}
        hint="Roles, industries, keywords and places, separated by commas, e.g. Account Executive, SaaS, FinTech, Entry Level, NYC. New openings need one of your roles or keywords in the title and, if you list places, must be in one of them. Searches list jobs that fit more of these first."
      >
        <Textarea id="search-preferences" name="preferences" rows={5} defaultValue={text} autoFocus />
      </Field>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(false)}>
          Cancel
        </Button>
        <SubmitButton pending={pending} pendingLabel="Saving…" size="sm">
          <Save /> Save preferences
        </SubmitButton>
      </div>
    </form>
  );
}

function NewOpenings() {
  const [result, setResult] = useState<ActionResult<FoundJobsData> | null>(null);
  useEffect(() => {
    let live = true;
    recommendedOpeningsAction().then((r) => live && setResult(r));
    return () => {
      live = false;
    };
  }, []);
  if (!result) {
    return (
      <div className="grid gap-2" aria-label="Looking for new openings">
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          <Loader2 className="size-3.5 animate-spin" /> Looking across company job boards and job sites…
        </p>
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    );
  }
  if (!result.ok || !result.data) return <p className="text-muted-foreground text-xs">{result.message ?? "New openings couldn't be loaded."}</p>;
  return <FoundJobsList rows={result.data.results} idPrefix="openings" emptyText="No new openings fit your preferences right now. Try adding roles or keywords." />;
}

/** "Searches … plus The Muse, Himalayas and Jobicy", naming whichever outside sources are switched on. */
function coverage(searchesLinkedIn: boolean, searchesAdzuna: boolean) {
  const outside = [...(searchesLinkedIn ? ["LinkedIn, Indeed, Glassdoor"] : []), ...(searchesAdzuna ? ["Adzuna"] : []), "The Muse", "Himalayas", "Jobicy"];
  return `Searches hundreds of company job boards (Greenhouse, Lever, Ashby, Workday, Workable, SmartRecruiters, Recruitee) plus ${outside.slice(0, -1).join(", ")} and ${outside.at(-1)}, all at once. Results that fit your preferences come first.`;
}

export function JobFinder({ preferences, saved, searchesLinkedIn, searchesAdzuna }: { preferences: { text: string; isDefault: boolean }; saved: RecommendedRow[]; searchesLinkedIn: boolean; searchesAdzuna: boolean }) {
  const [query, setQuery] = useState("");
  const [location, setLocation] = useState("");
  const [search, setSearch] = useState<ActionResult<FoundJobsData> | null>(null);
  const [searching, startSearch] = useTransition();
  const errors = (search && !search.ok ? search.errors : undefined) ?? {};

  const run = (event: React.FormEvent) => {
    event.preventDefault();
    startSearch(async () => setSearch(await findJobsAction({ query, location })));
  };

  return (
    <Card>
      <CardContent className="grid gap-4">
        <form onSubmit={run} className="grid gap-2" role="search" noValidate>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative flex-1">
              <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
              <Input
                aria-label="Search all job sites"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search any job title or keyword, e.g. account executive"
                className="h-10 pl-9"
                aria-invalid={!!errors.query}
              />
            </div>
            <Input aria-label="Location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Anywhere" className="h-10 sm:w-44" />
            <Button type="submit" className="h-10" disabled={searching}>
              {searching ? <Loader2 className="animate-spin" /> : <Search />}
              {searching ? "Searching…" : "Search"}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">{coverage(searchesLinkedIn, searchesAdzuna)}</p>
          {search && !search.ok && <p className="text-destructive text-[13px]">{search.message}</p>}
        </form>

        {search?.ok && search.data ? (
          <section className="grid gap-3" aria-label="Search results">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm" data-testid="search-summary">
                {search.message} <span className="text-muted-foreground">({search.data.seconds}s)</span>
              </p>
              <Button type="button" variant="ghost" size="xs" onClick={() => setSearch(null)}>
                <ArrowLeft /> Back to recommendations
              </Button>
            </div>
            {search.data.notices.map((n) => (
              <p key={n} className="text-muted-foreground text-xs">
                {n}
              </p>
            ))}
            <FoundJobsList key={`${query}|${location}`} rows={search.data.results} idPrefix="search" emptyText="No open jobs match. Try fewer or broader keywords, or another place." />
          </section>
        ) : (
          <section className="grid gap-3" aria-labelledby="recommended-heading">
            <h2 id="recommended-heading" className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="text-primary size-4" /> Recommended for you
            </h2>
            <PreferencesBox text={preferences.text} isDefault={preferences.isDefault} />
            {saved.length > 0 && (
              <div className="grid gap-1.5">
                <p className="text-muted-foreground text-xs font-medium">From your jobs</p>
                <RecommendedList rows={saved} hasKeywords />
              </div>
            )}
            <div className="grid gap-1.5">
              <p className="text-muted-foreground text-xs font-medium">New openings</p>
              <NewOpenings key={preferences.text} />
            </div>
          </section>
        )}
      </CardContent>
    </Card>
  );
}
