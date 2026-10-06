"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { AlertCircle, ArrowLeft, ExternalLink, Globe, Loader2, Plus, Search } from "lucide-react";
import { toast } from "sonner";
import type { BoardSearchFormInput } from "@autoapply/shared";
import { enumLabel } from "@autoapply/shared";
import { importBoardJobsAction, searchJobBoardsAction, type BoardSearchData, type ImportResultData } from "@/actions/ingestion";
import { Field, FormMessage } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action";
import { formatRelative } from "@/lib/format";
import { ImportResult } from "./import-dialog";

export interface SavedBoardSearchView {
  boards: string[];
  query: string;
  location: string | null;
  searchDescriptions: boolean;
}

function SearchResults({
  data,
  message,
  selected,
  setSelected,
}: {
  data: BoardSearchData;
  message?: string;
  selected: Set<string>;
  setSelected: (next: Set<string>) => void;
}) {
  const selectable = data.results.filter((r) => r.known === "new");
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.url));
  const someSelected = selectable.some((r) => selected.has(r.url));
  const toggle = (url: string) => {
    const next = new Set(selected);
    if (next.has(url)) next.delete(url);
    else next.add(url);
    setSelected(next);
  };
  const failed = data.boards.filter((b) => b.error);

  return (
    <div className="grid gap-3" data-testid="board-search-results">
      <p className="text-sm">{message}</p>
      {failed.length > 0 && (
        <ul className="border-warning/30 bg-warning/5 grid gap-1 rounded-lg border px-3 py-2 text-[13px]">
          {failed.map((b) => (
            <li key={b.url} className="flex gap-2">
              <AlertCircle className="text-warning mt-0.5 size-3.5 shrink-0" />
              <span>
                <span className="font-medium">{b.label}</span>: {b.error}
              </span>
            </li>
          ))}
        </ul>
      )}
      {data.notices.map((n) => (
        <p key={n} className="text-muted-foreground text-xs">
          {n}
        </p>
      ))}
      {data.results.length === 0 ? (
        <div className="text-muted-foreground rounded-lg border px-4 py-8 text-center text-sm">
          No open jobs on these boards match. Try fewer or broader keywords, or turn on &ldquo;Also match descriptions&rdquo;.
        </div>
      ) : (
        <div className="rounded-lg border">
          <div className="bg-muted/40 flex items-center gap-3 border-b px-3 py-2">
            <Checkbox
              id="board-select-all"
              aria-label="Select all new jobs"
              disabled={selectable.length === 0}
              checked={allSelected ? true : someSelected ? "indeterminate" : false}
              onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.url)))}
            />
            <Label htmlFor="board-select-all" className="text-[13px] font-normal">
              {selectable.length === 0
                ? "All of these are already in your list"
                : selectable.length === data.results.length
                  ? `Select all ${data.results.length}`
                  : `Select all ${selectable.length} new`}
            </Label>
          </div>
          <ul className="max-h-[22rem] divide-y overflow-y-auto">
            {data.results.map((r) => {
              const isNew = r.known === "new";
              return (
                <li key={r.url} className="flex items-start gap-3 px-3 py-2.5" data-testid="board-result">
                  <Checkbox className="mt-0.5" aria-label={`Select ${r.title} at ${r.company}`} disabled={!isNew} checked={isNew && selected.has(r.url)} onCheckedChange={() => toggle(r.url)} />
                  <div className="min-w-0 flex-1 text-[13px]">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                        {r.title}
                      </a>
                      {r.known === "in_list" && <Badge variant="muted">In your list</Badge>}
                      {r.known === "removed" && <Badge variant="muted">Removed earlier</Badge>}
                    </div>
                    <p className="text-muted-foreground truncate">
                      {[r.company, r.location, r.workArrangement && r.workArrangement !== "UNKNOWN" ? enumLabel(r.workArrangement) : null, r.salaryText].filter(Boolean).join(" · ")}
                    </p>
                    <p className="text-muted-foreground text-xs">
                      {r.provider}
                      {r.postedAt && ` · posted ${formatRelative(r.postedAt)}`}
                      {r.matchedIn === "description" && " · keywords found in the description"}
                    </p>
                  </div>
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground mt-0.5" aria-label={`Open ${r.title} posting`}>
                    <ExternalLink className="size-3.5" />
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function BoardSearch({ saved, onDone }: { saved: SavedBoardSearchView | null; onDone: () => void }) {
  const router = useRouter();
  const [form, setForm] = useState<BoardSearchFormInput>({
    boards: saved?.boards.join("\n") ?? "",
    query: saved?.query ?? "",
    location: saved?.location ?? "",
    searchDescriptions: saved?.searchDescriptions ?? false,
  });
  // The search the results came from; adding re-reads exactly these boards.
  const [searched, setSearched] = useState<BoardSearchFormInput | null>(null);
  const [search, setSearch] = useState<ActionResult<BoardSearchData> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [imported, setImported] = useState<ActionResult<ImportResultData> | null>(null);
  const [searching, startSearch] = useTransition();
  const [adding, startAdding] = useTransition();
  const errors = (search && !search.ok ? search.errors : undefined) ?? {};
  const set = <K extends keyof BoardSearchFormInput>(key: K, value: BoardSearchFormInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const boardCount = useMemo(() => form.boards.split(/[\n,]+/).filter((l) => l.trim()).length, [form.boards]);

  const runSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const input = { ...form };
    startSearch(async () => {
      const result = await searchJobBoardsAction(input);
      setSearch(result);
      if (result.ok && result.data) {
        setSearched(input);
        setSelected(new Set(result.data.results.filter((r) => r.known === "new").map((r) => r.url)));
      }
    });
  };

  const add = () => {
    if (!searched) return;
    const urls = [...selected];
    startAdding(async () => {
      const result = await importBoardJobsAction({ ...searched, urls });
      if (result.data) {
        setImported(result);
        router.refresh();
      } else toast.error(result.message ?? "Couldn't add the jobs");
    });
  };

  if (imported) return <ImportResult result={imported} onDone={onDone} />;

  if (search?.ok && search.data) {
    return (
      <div className="grid gap-4">
        <SearchResults data={search.data} message={search.message} selected={selected} setSelected={setSelected} />
        <div className="flex flex-wrap justify-between gap-2">
          <Button type="button" variant="outline" onClick={() => setSearch(null)}>
            <ArrowLeft /> Change search
          </Button>
          <Button type="button" onClick={add} disabled={adding || selected.size === 0}>
            {adding ? <Loader2 className="animate-spin" /> : <Plus />}
            {adding ? "Adding…" : selected.size === 1 ? "Add 1 job" : `Add ${selected.size} jobs`}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={runSearch} className="grid gap-4" noValidate>
      <FormMessage state={search ?? undefined} />
      <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
        <Field label="Keywords" htmlFor="board-query" error={errors.query} hint='Every word must appear in the job title. Use "quotes" for phrases and -word to skip jobs that mention it.'>
          <Input id="board-query" value={form.query} onChange={(e) => set("query", e.target.value)} placeholder='"account executive" -commission' aria-invalid={!!errors.query} autoFocus />
        </Field>
        <Field label="Location" htmlFor="board-location" error={errors.location} hint="Optional, e.g. New York or Remote.">
          <Input id="board-location" value={form.location ?? ""} onChange={(e) => set("location", e.target.value)} placeholder="Any location" />
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="board-descriptions" checked={form.searchDescriptions} onCheckedChange={(v) => set("searchDescriptions", v === true)} />
        <Label htmlFor="board-descriptions" className="text-[13px] font-normal">
          Also match descriptions, not just job titles
        </Label>
      </div>
      <Field
        label="Job boards to search"
        htmlFor="board-list"
        error={errors.boards}
        hint={
          <>
            One per line, up to 25: a company&apos;s Greenhouse, Lever or Ashby job board link (for example boards.greenhouse.io/acme or jobs.lever.co/acme). Open a company&apos;s careers
            page and copy the link of its job list. These boards publish their openings for anyone to read; AutoApply never searches LinkedIn.
          </>
        }
      >
        <Textarea
          id="board-list"
          rows={5}
          value={form.boards}
          onChange={(e) => set("boards", e.target.value)}
          placeholder={"https://boards.greenhouse.io/acme\nhttps://jobs.lever.co/globex\nhttps://jobs.ashbyhq.com/initech"}
          aria-invalid={!!errors.boards}
        />
      </Field>
      <div className="flex items-center justify-between gap-2">
        <p className="text-muted-foreground text-xs">{boardCount > 0 && `${boardCount} board${boardCount === 1 ? "" : "s"}`}</p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button type="submit" disabled={searching}>
            {searching ? <Loader2 className="animate-spin" /> : <Search />}
            {searching ? "Searching…" : "Search"}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function BoardSearchDialog({ saved }: { saved: SavedBoardSearchView | null }) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Globe /> Search job boards
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Search job boards</DialogTitle>
          <DialogDescription>Find open jobs on companies&apos; public job boards by keyword, then pick the ones to add. Added jobs are scored like any other.</DialogDescription>
        </DialogHeader>
        {open && <BoardSearch saved={saved} onDone={() => setOpen(false)} />}
      </DialogContent>
    </Dialog>
  );
}
