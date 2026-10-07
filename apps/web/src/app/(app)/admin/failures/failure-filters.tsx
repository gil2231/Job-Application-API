"use client";

import { enumLabel, FAILURE_TYPES, PLATFORMS } from "@autoapply/shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSearchParamsState } from "@/lib/use-search-params-state";
import { cn } from "@/lib/utils";

const SCOPES = [
  { value: "failed", label: "Failed" },
  { value: "stuck", label: "Stuck on users" },
  { value: "all", label: "Both" },
];

export function FailureFilters({ total }: { total: number }) {
  const { params, set } = useSearchParamsState();
  const scope = params.get("scope") ?? "failed";
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Which applications">
        {SCOPES.map((s) => (
          <button
            key={s.value}
            role="tab"
            aria-selected={scope === s.value}
            onClick={() => set({ scope: s.value === "failed" ? null : s.value })}
            className={cn(
              "text-muted-foreground hover:text-foreground inline-flex h-8 items-center rounded-md px-3 text-sm font-medium",
              scope === s.value && "bg-muted text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
        <span className="text-muted-foreground ml-2 text-xs tabular-nums">{total.toLocaleString()} total</span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Select value={params.get("failureType") ?? "any"} onValueChange={(v) => set({ failureType: v === "any" ? null : v })}>
          <SelectTrigger size="sm" className="w-auto min-w-36 border-dashed" aria-label="Cause">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any cause</SelectItem>
            {FAILURE_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {enumLabel(t)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={params.get("platform") ?? "any"} onValueChange={(v) => set({ platform: v === "any" ? null : v })}>
          <SelectTrigger size="sm" className="w-auto min-w-36 border-dashed" aria-label="Site type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any site type</SelectItem>
            {PLATFORMS.map((p) => (
              <SelectItem key={p} value={p}>
                {enumLabel(p)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
