"use client";

import { ChevronDown, Send } from "lucide-react";
import type { AutomationMode } from "@autoapply/shared";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

const MODES: Array<{ mode: AutomationMode; label: string; hint: string }> = [
  { mode: "MANUAL", label: "Manual", hint: "Fill it in, you click Submit" },
  { mode: "REVIEW", label: "Review", hint: "Fill it in, submit after you approve" },
  { mode: "AUTO", label: "Auto", hint: "Submit when every safety check passes" },
];

/** Apply in the default mode from Settings, or pick a mode for this batch. */
export function ApplyButton({
  onApply,
  disabled,
  size = "sm",
  label = "Apply",
}: {
  onApply: (mode?: AutomationMode) => void;
  disabled?: boolean;
  size?: "xs" | "sm";
  label?: string;
}) {
  return (
    <div className="inline-flex">
      <Button size={size} disabled={disabled} onClick={() => onApply()} className="rounded-r-none">
        <Send /> {label}
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size={size} disabled={disabled} aria-label="Choose how to apply" className="border-primary-foreground/20 rounded-l-none border-l px-1.5">
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-muted-foreground text-xs font-normal">Apply as…</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {MODES.map((m) => (
            <DropdownMenuItem key={m.mode} onSelect={() => onApply(m.mode)} className="flex-col items-start gap-0">
              <span className="text-sm">{m.label} mode</span>
              <span className="text-muted-foreground text-xs">{m.hint}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
