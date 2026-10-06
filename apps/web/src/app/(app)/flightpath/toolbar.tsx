"use client";

import { useEffect, useState } from "react";
import { Columns3, Rows3, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { useSearchParamsState } from "@/lib/use-search-params-state";
import { cn } from "@/lib/utils";

const VIEWS = [
  { value: "board", label: "Board", icon: Columns3 },
  { value: "table", label: "Table", icon: Rows3 },
] as const;

export function FlightpathToolbar({ view }: { view: "board" | "table" }) {
  const { params, set } = useSearchParamsState();
  const [q, setQ] = useState(params.get("q") ?? "");
  useEffect(() => {
    if (q === (params.get("q") ?? "")) return;
    const t = setTimeout(() => set({ q }), 300);
    return () => clearTimeout(t);
  }, [q, params, set]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="bg-muted inline-flex w-fit rounded-lg p-0.5" role="tablist" aria-label="View">
        {VIEWS.map((v) => (
          <button
            key={v.value}
            role="tab"
            aria-selected={view === v.value}
            onClick={() => set({ view: v.value === "board" ? null : v.value, stage: null, sort: null, dir: null })}
            className={cn(
              "text-muted-foreground inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors",
              view === v.value ? "bg-background text-foreground shadow-sm" : "hover:text-foreground",
            )}
          >
            <v.icon className="size-3.5" /> {v.label}
          </button>
        ))}
      </div>
      <div className="relative w-full sm:w-64">
        <Search className="text-muted-foreground absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search company, role or location" className="h-8 pl-8" aria-label="Search applications" />
      </div>
    </div>
  );
}
