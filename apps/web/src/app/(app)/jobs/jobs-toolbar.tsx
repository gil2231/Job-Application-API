"use client";

import { useEffect, useState } from "react";
import { ListFilter, Search, X } from "lucide-react";
import { APPLICATION_STATUSES, enumLabel, JOB_STATUSES, WORK_ARRANGEMENTS, type Platform } from "@autoapply/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSearchParamsState } from "@/lib/use-search-params-state";

function MultiSelect({ label, param, options }: { label: string; param: string; options: Array<{ value: string; label: string }> }) {
  const { params, set } = useSearchParamsState();
  const selected = new Set((params.get(param) ?? "").split(",").filter(Boolean));
  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    set({ [param]: [...next].join(",") });
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="border-dashed">
          {label}
          {selected.size > 0 && (
            <Badge variant="info" className="ml-0.5 rounded-sm px-1">
              {selected.size}
            </Badge>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        <DropdownMenuLabel>{label}</DropdownMenuLabel>
        {options.map((o) => (
          <DropdownMenuCheckboxItem key={o.value} checked={selected.has(o.value)} onCheckedChange={() => toggle(o.value)} onSelect={(e) => e.preventDefault()}>
            {o.label}
          </DropdownMenuCheckboxItem>
        ))}
        {selected.size > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuCheckboxItem checked={false} onCheckedChange={() => set({ [param]: null })}>
              Clear
            </DropdownMenuCheckboxItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const FILTER_KEYS = ["q", "status", "platform", "remote", "minMatch", "company", "location", "minSalary", "savedFrom", "savedTo"];

export function JobsToolbar({ companies, platforms }: { companies: string[]; platforms: Platform[] }) {
  const { params, set } = useSearchParamsState();
  const [q, setQ] = useState(params.get("q") ?? "");

  // Debounce free-text search into the URL.
  useEffect(() => {
    const current = params.get("q") ?? "";
    if (q === current) return;
    const t = setTimeout(() => set({ q }), 300);
    return () => clearTimeout(t);
  }, [q, params, set]);

  const activeMore = ["company", "location", "minSalary", "savedFrom", "savedTo"].filter((k) => params.get(k)).length;
  const anyActive = FILTER_KEYS.some((k) => params.get(k));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative w-full sm:w-64">
        <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title, company, location" className="h-8 pl-8" aria-label="Search jobs" />
      </div>
      <MultiSelect label="Status" param="status" options={[...JOB_STATUSES, ...APPLICATION_STATUSES].filter((s, i, a) => a.indexOf(s) === i).map((s) => ({ value: s, label: enumLabel(s) }))} />
      <MultiSelect label="Platform" param="platform" options={platforms.map((p) => ({ value: p, label: enumLabel(p) }))} />
      <Select value={params.get("remote") ?? "any"} onValueChange={(v) => set({ remote: v === "any" ? null : v })}>
        <SelectTrigger size="sm" className="w-auto min-w-32 border-dashed" aria-label="Work arrangement">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Any arrangement</SelectItem>
          {WORK_ARRANGEMENTS.filter((w) => w !== "UNKNOWN").map((w) => (
            <SelectItem key={w} value={w}>
              {enumLabel(w)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={params.get("minMatch") ?? "any"} onValueChange={(v) => set({ minMatch: v === "any" ? null : v })}>
        <SelectTrigger size="sm" className="w-auto min-w-28 border-dashed" aria-label="Minimum match">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Any match</SelectItem>
          {[50, 60, 70, 80, 90].map((m) => (
            <SelectItem key={m} value={String(m)}>
              Match ≥ {m}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="border-dashed">
            <ListFilter /> More
            {activeMore > 0 && (
              <Badge variant="info" className="ml-0.5 rounded-sm px-1">
                {activeMore}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="grid w-80 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="f-company" className="text-xs">
              Company
            </Label>
            <Select value={params.get("company") ?? "any"} onValueChange={(v) => set({ company: v === "any" ? null : v })}>
              <SelectTrigger id="f-company" size="sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Any company</SelectItem>
                {companies.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="f-location" className="text-xs">
              Location contains
            </Label>
            <Input id="f-location" className="h-8" defaultValue={params.get("location") ?? ""} onBlur={(e) => set({ location: e.target.value.trim() })} onKeyDown={(e) => e.key === "Enter" && set({ location: e.currentTarget.value.trim() })} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="f-salary" className="text-xs">
              Minimum salary (annual, top of range)
            </Label>
            <Input id="f-salary" type="number" min={0} step={5000} className="h-8" defaultValue={params.get("minSalary") ?? ""} onBlur={(e) => set({ minSalary: e.target.value })} onKeyDown={(e) => e.key === "Enter" && set({ minSalary: e.currentTarget.value })} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1.5">
              <Label htmlFor="f-from" className="text-xs">
                Saved from
              </Label>
              <Input id="f-from" type="date" className="h-8" defaultValue={params.get("savedFrom") ?? ""} onChange={(e) => set({ savedFrom: e.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="f-to" className="text-xs">
                Saved to
              </Label>
              <Input id="f-to" type="date" className="h-8" defaultValue={params.get("savedTo") ?? ""} onChange={(e) => set({ savedTo: e.target.value })} />
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {anyActive && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQ("");
            set(Object.fromEntries(FILTER_KEYS.map((k) => [k, null])));
          }}
        >
          Reset <X />
        </Button>
      )}
    </div>
  );
}
