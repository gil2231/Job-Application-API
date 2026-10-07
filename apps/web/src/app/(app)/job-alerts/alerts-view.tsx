"use client";

import { useMemo, useState } from "react";
import { AlertCircle, ExternalLink, Plus, RefreshCw, Trash2 } from "lucide-react";
import { addAlertMatchesAction, checkSavedSearchNowAction, deleteSavedSearchAction, setSavedSearchAlertsAction } from "@/actions/alerts";
import { ActionButton, useServerAction } from "@/components/action-button";
import { TimeAgo } from "@/components/local-time";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { SavedSearchDialog, type SavedSearchValues } from "./saved-search-form";

export interface SavedSearchRowView extends SavedSearchValues {
  id: string;
  lastRunAt: string | null;
  lastError: string | null;
  lastNewCount: number | null;
}

export interface AlertMatchRow {
  id: string;
  searchId: string;
  searchName: string;
  url: string;
  title: string;
  company: string;
  location: string | null;
  salaryText: string | null;
  postedAt: string | null;
  foundAt: string;
  added: boolean;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function AlertsSwitch({ search }: { search: SavedSearchRowView }) {
  const { pending, run } = useServerAction();
  return (
    <div className="flex items-center gap-2">
      <Switch
        id={`alerts-${search.id}`}
        checked={search.alertsEnabled}
        disabled={pending}
        onCheckedChange={(v) => run(() => setSavedSearchAlertsAction(search.id, v))}
        aria-label={`Daily emails for ${search.name}`}
      />
      <Label htmlFor={`alerts-${search.id}`} className="text-[13px] font-normal">
        Daily email
      </Label>
    </div>
  );
}

export function SavedSearchList({ searches }: { searches: SavedSearchRowView[] }) {
  return (
    <Card className="gap-0 py-0">
      <ul className="divide-y" data-testid="saved-searches">
        {searches.map((s) => (
          <li key={s.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center" data-testid="saved-search">
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                {s.name}
                {!s.alertsEnabled && <Badge variant="muted">Paused</Badge>}
              </p>
              <p className="text-muted-foreground truncate text-[13px]">
                {[s.query || "Any keywords", s.location, plural(s.boards.length, "board"), s.matchAny ? "any keyword" : null, s.searchDescriptions ? "titles and descriptions" : null].filter(Boolean).join(" · ")}
              </p>
              <p className="text-muted-foreground text-xs">
                {s.lastRunAt ? (
                  <>
                    Checked <TimeAgo value={s.lastRunAt} />
                    {s.lastNewCount != null && s.lastNewCount > 0 && ` · ${plural(s.lastNewCount, "new job")}`}
                  </>
                ) : (
                  "Not checked yet"
                )}
              </p>
              {s.lastError && (
                <p className="text-warning mt-1 flex gap-1.5 text-xs">
                  <AlertCircle className="mt-0.5 size-3 shrink-0" />
                  {s.lastError}
                </p>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <AlertsSwitch search={s} />
              <ActionButton size="xs" variant="outline" action={() => checkSavedSearchNowAction(s.id)}>
                <RefreshCw /> Check now
              </ActionButton>
              <SavedSearchDialog initial={s} trigger="edit" />
              <ActionButton size="xs" variant="ghost" aria-label={`Delete ${s.name}`} action={() => deleteSavedSearchAction(s.id)}>
                <Trash2 />
              </ActionButton>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

export function AlertMatches({ matches, days }: { matches: AlertMatchRow[]; days: number }) {
  const addable = useMemo(() => matches.filter((m) => !m.added), [matches]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { pending, run } = useServerAction();
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  // Adding goes per saved search, since each one knows its boards.
  const add = () => {
    const picked = matches.filter((m) => selected.has(m.id));
    const bySearch = new Map<string, string[]>();
    for (const m of picked) bySearch.set(m.searchId, [...(bySearch.get(m.searchId) ?? []), m.url]);
    run(
      async () => {
        const results = [];
        for (const [searchId, urls] of bySearch) results.push(await addAlertMatchesAction(searchId, urls));
        const failed = results.find((r) => !r.ok);
        return failed ?? { ok: true, message: results.map((r) => r.message).join(" ") };
      },
      { onSuccess: () => setSelected(new Set()) },
    );
  };

  return (
    <Card className="gap-0 pb-0">
      <CardHeader className="border-b pb-4">
        <CardTitle className="text-sm">New matches</CardTitle>
        <CardDescription>Jobs your saved searches found in the last {days} days. Add the ones you want and they&apos;re scored like any other job.</CardDescription>
      </CardHeader>
      {matches.length === 0 ? (
        <CardContent className="text-muted-foreground py-8 text-center text-sm">Nothing new yet. New postings show up here and in your morning email.</CardContent>
      ) : (
        <>
          <div className="bg-muted/40 flex flex-wrap items-center justify-between gap-3 border-b px-5 py-2">
            <div className="flex items-center gap-3">
              <Checkbox
                id="alerts-select-all"
                aria-label="Select all"
                disabled={addable.length === 0}
                checked={addable.length > 0 && addable.every((m) => selected.has(m.id)) ? true : selected.size > 0 ? "indeterminate" : false}
                onCheckedChange={() => setSelected(addable.every((m) => selected.has(m.id)) ? new Set() : new Set(addable.map((m) => m.id)))}
              />
              <Label htmlFor="alerts-select-all" className="text-[13px] font-normal">
                {addable.length ? `Select all ${addable.length}` : "All of these are in your jobs"}
              </Label>
            </div>
            <Button size="sm" onClick={add} disabled={pending || selected.size === 0}>
              <Plus /> {selected.size === 0 ? "Add jobs" : selected.size === 1 ? "Add 1 job" : `Add ${selected.size} jobs`}
            </Button>
          </div>
          <ul className="divide-y" data-testid="alert-matches">
            {matches.map((m) => (
              <li key={m.id} className="flex items-start gap-3 px-5 py-3" data-testid="alert-match">
                <Checkbox className="mt-0.5" aria-label={`Select ${m.title} at ${m.company}`} disabled={m.added} checked={!m.added && selected.has(m.id)} onCheckedChange={() => toggle(m.id)} />
                <div className="min-w-0 flex-1 text-[13px]">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <a href={m.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                      {m.title}
                    </a>
                    {m.added && <Badge variant="muted">Added</Badge>}
                  </div>
                  <p className="text-muted-foreground truncate">{[m.company, m.location, m.salaryText].filter(Boolean).join(" · ")}</p>
                  <p className="text-muted-foreground text-xs">
                    {m.searchName} · found <TimeAgo value={m.foundAt} />
                  </p>
                </div>
                <a href={m.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground mt-0.5" aria-label={`Open ${m.title} posting`}>
                  <ExternalLink className="size-3.5" />
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
