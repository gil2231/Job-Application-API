"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ExternalLink, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { enumLabel } from "@autoapply/shared";
import { addFoundJobsAction, type FoundJobRow } from "@/actions/find-jobs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { formatRelative } from "@/lib/format";

/** Search results with checkboxes and an Add button. */
export function FoundJobsList({ rows, idPrefix, emptyText }: { rows: FoundJobRow[]; idPrefix: string; emptyText: string }) {
  const router = useRouter();
  const [added, setAdded] = useState<Set<string>>(new Set());
  const known = (r: FoundJobRow) => (added.has(r.url) ? "in_list" : r.known);
  const selectable = rows.filter((r) => known(r) === "new");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, startAdding] = useTransition();
  const allSelected = selectable.length > 0 && selectable.every((r) => selected.has(r.url));
  const someSelected = selectable.some((r) => selected.has(r.url));
  const toggle = (url: string) => {
    const next = new Set(selected);
    if (next.has(url)) next.delete(url);
    else next.add(url);
    setSelected(next);
  };

  const add = () => {
    const picked = rows.filter((r) => selected.has(r.url));
    startAdding(async () => {
      const result = await addFoundJobsAction({
        jobs: picked.map(({ url, title, company, location, postedAt, salaryText, workArrangement }) => ({ url, title, company, location, postedAt, salaryText, workArrangement })),
      });
      if (!result.ok) {
        toast.error(result.message ?? "Couldn't add the jobs");
        return;
      }
      toast.success(result.message);
      setAdded(new Set([...added, ...picked.map((r) => r.url)]));
      setSelected(new Set());
      router.refresh();
    });
  };

  if (!rows.length) return <div className="text-muted-foreground rounded-lg border px-4 py-8 text-center text-sm">{emptyText}</div>;

  return (
    <div className="rounded-lg border" data-testid={`${idPrefix}-results`}>
      <div className="bg-muted/40 flex flex-wrap items-center gap-3 border-b px-3 py-2">
        <Checkbox
          id={`${idPrefix}-select-all`}
          aria-label="Pick every new result"
          disabled={selectable.length === 0}
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.url)))}
        />
        <Label htmlFor={`${idPrefix}-select-all`} className="flex-1 text-[13px] font-normal">
          {selectable.length === 0 ? "All of these are in your list" : `Select all ${selectable.length} new`}
        </Label>
        <Button type="button" size="xs" onClick={add} disabled={adding || selected.size === 0}>
          {adding ? <Loader2 className="animate-spin" /> : <Plus />}
          {adding ? "Adding…" : selected.size === 1 ? "Add 1 job" : `Add ${selected.size} jobs`}
        </Button>
      </div>
      <ul className="max-h-[28rem] divide-y overflow-y-auto">
        {rows.map((r) => {
          const state = known(r);
          return (
            <li key={r.url} className="flex items-start gap-3 px-3 py-2.5" data-testid="found-job">
              <Checkbox className="mt-0.5" aria-label={`Select ${r.title} at ${r.company}`} disabled={state !== "new"} checked={state === "new" && selected.has(r.url)} onCheckedChange={() => toggle(r.url)} />
              <div className="min-w-0 flex-1 text-[13px]">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="font-medium hover:underline">
                    {r.title}
                  </a>
                  {state === "in_list" && <Badge variant="muted">In your list</Badge>}
                  {state === "removed" && <Badge variant="muted">Removed earlier</Badge>}
                </div>
                <p className="text-muted-foreground truncate">
                  {[r.company, r.location, r.workArrangement && r.workArrangement !== "UNKNOWN" ? enumLabel(r.workArrangement) : null, r.salaryText].filter(Boolean).join(" · ")}
                </p>
                <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-1 text-xs">
                  {r.sources.map((s) => (
                    <Badge key={s} variant="outline" className="px-1.5 py-0 text-[11px] font-normal">
                      {s}
                    </Badge>
                  ))}
                  {r.postedAt && <span>· posted {formatRelative(r.postedAt)}</span>}
                  {r.fits.length > 0 && (
                    <span className="text-primary" title="Your preferences this job fits">
                      · fits {r.fits.slice(0, 4).join(", ")}
                      {r.fits.length > 4 && ` +${r.fits.length - 4}`}
                    </span>
                  )}
                  {r.matchedIn === "description" && <span>· keywords in the description</span>}
                </div>
              </div>
              <a href={r.url} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground mt-0.5" aria-label={`Open ${r.title} posting`}>
                <ExternalLink className="size-3.5" />
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
