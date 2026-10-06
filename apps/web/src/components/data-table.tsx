"use client";

import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TableHead } from "@/components/ui/table";
import { useSearchParamsState } from "@/lib/use-search-params-state";
import { cn } from "@/lib/utils";

export function SortableHead({ column, children, className, defaultSort }: { column: string; children: React.ReactNode; className?: string; defaultSort: string }) {
  const { params, set } = useSearchParamsState();
  const sort = params.get("sort") ?? defaultSort;
  const dir = params.get("dir") ?? "desc";
  const active = sort === column;
  return (
    <TableHead className={className} aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : undefined}>
      <button
        type="button"
        className={cn("hover:text-foreground -ml-1 inline-flex items-center gap-1 rounded px-1", active && "text-foreground")}
        onClick={() => set({ sort: column, dir: active && dir === "desc" ? "asc" : "desc" })}
      >
        {children}
        {active ? dir === "asc" ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" /> : <ChevronsUpDown className="size-3 opacity-40" />}
      </button>
    </TableHead>
  );
}

export function Pagination({ page, pageCount, total, pageSize }: { page: number; pageCount: number; total: number; pageSize: number }) {
  const { set } = useSearchParamsState();
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="text-muted-foreground flex items-center justify-between gap-4 px-1 text-xs">
      <span>
        {from}–{to} of {total.toLocaleString()}
      </span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="icon-sm" disabled={page <= 1} onClick={() => set({ page: String(page - 1) }, { resetPage: false })} aria-label="Previous page">
          <ChevronLeft />
        </Button>
        <span className="px-2 tabular-nums">
          Page {page} of {pageCount}
        </span>
        <Button variant="outline" size="icon-sm" disabled={page >= pageCount} onClick={() => set({ page: String(page + 1) }, { resetPage: false })} aria-label="Next page">
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}
