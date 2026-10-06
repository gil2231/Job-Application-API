"use client";

import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Chip-style list input. Submits its values as one newline-separated field
 * named `name`, which the shared zod list schemas split back into an array.
 */
export function TagInput({
  id,
  name,
  defaultValue = [],
  placeholder,
  invalid,
}: {
  id: string;
  name: string;
  defaultValue?: string[];
  placeholder?: string;
  invalid?: boolean;
}) {
  const [tags, setTags] = React.useState<string[]>(defaultValue);
  const [draft, setDraft] = React.useState("");

  const add = (raw: string) => {
    const parts = raw.split(/[,\n]/).map((p) => p.trim()).filter(Boolean);
    if (!parts.length) return;
    setTags((prev) => {
      const seen = new Set(prev.map((p) => p.toLowerCase()));
      return [...prev, ...parts.filter((p) => !seen.has(p.toLowerCase()) && (seen.add(p.toLowerCase()), true))];
    });
    setDraft("");
  };

  return (
    <div
      className={cn(
        "border-input dark:bg-input/30 focus-within:border-ring focus-within:ring-ring/50 flex min-h-9 flex-wrap items-center gap-1.5 rounded-md border bg-transparent px-2 py-1.5 shadow-xs focus-within:ring-[3px]",
        invalid && "border-destructive",
      )}
      onClick={() => document.getElementById(id)?.focus()}
    >
      {tags.map((tag) => (
        <span key={tag} className="bg-secondary text-secondary-foreground inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium">
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            className="text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              setTags((prev) => prev.filter((t) => t !== tag));
            }}
          >
            <X className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        placeholder={tags.length ? "" : placeholder}
        onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && tags.length) {
            setTags((prev) => prev.slice(0, -1));
          }
        }}
        onBlur={() => add(draft)}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (/[,\n]/.test(text)) {
            e.preventDefault();
            add(text);
          }
        }}
        className="placeholder:text-muted-foreground min-w-24 flex-1 bg-transparent text-sm outline-none"
      />
      <input type="hidden" name={name} value={[...tags, ...(draft.trim() ? [draft.trim()] : [])].join("\n")} />
    </div>
  );
}
