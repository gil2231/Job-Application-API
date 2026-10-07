"use client";

import { SUPPORT_CATEGORIES, SUPPORT_CATEGORY_LABELS } from "@autoapply/shared";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSearchParamsState } from "@/lib/use-search-params-state";
import { cn } from "@/lib/utils";

const STATUSES = [
  { value: "open", label: "Open" },
  { value: "resolved", label: "Resolved" },
  { value: "all", label: "All" },
];

export function ReportFilters({ total }: { total: number }) {
  const { params, set } = useSearchParamsState();
  const status = params.get("status") ?? "open";
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Which reports">
        {STATUSES.map((s) => (
          <button
            key={s.value}
            role="tab"
            aria-selected={status === s.value}
            onClick={() => set({ status: s.value === "open" ? null : s.value })}
            className={cn(
              "text-muted-foreground hover:text-foreground inline-flex h-8 items-center rounded-md px-3 text-sm font-medium",
              status === s.value && "bg-muted text-foreground",
            )}
          >
            {s.label}
          </button>
        ))}
        <span className="text-muted-foreground ml-2 text-xs tabular-nums">{total.toLocaleString()} total</span>
      </div>
      <Select value={params.get("category") ?? "any"} onValueChange={(v) => set({ category: v === "any" ? null : v })}>
        <SelectTrigger size="sm" className="w-auto min-w-44 border-dashed" aria-label="Topic">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="any">Any topic</SelectItem>
          {SUPPORT_CATEGORIES.map((c) => (
            <SelectItem key={c} value={c}>
              {SUPPORT_CATEGORY_LABELS[c]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
