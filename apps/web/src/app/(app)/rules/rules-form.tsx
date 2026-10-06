"use client";

import { useState } from "react";
import type { AutomationRuleView } from "@autoapply/database";
import {
  AUTOMATION_MODES,
  EMPLOYMENT_TYPES,
  enumLabel,
  MATCH_DIMENSION_LABELS,
  MATCH_DIMENSIONS,
  WORK_ARRANGEMENTS,
  type MatchWeights,
} from "@autoapply/shared";
import { saveRulesAction } from "@/actions/settings";
import { Field, FormMessage, SubmitButton, useActionForm } from "@/components/form";
import { TagInput } from "@/components/tag-input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useToastOnSuccess } from "../profile/use-toast-on-success";

const MODE_HELP: Record<string, string> = {
  MANUAL: "Fill the application; you click Submit.",
  REVIEW: "Fill everything and stop before the final submission for your review.",
  AUTO: "Submit automatically, only when every safety check passes. Otherwise falls back to Review.",
};

function CheckboxGroup({ name, values, selected }: { name: string; values: readonly string[]; selected: string[] }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2">
      {values.map((v) => (
        <div key={v} className="flex items-center gap-2">
          <Checkbox id={`${name}-${v}`} name={name} value={v} defaultChecked={selected.includes(v)} />
          <Label htmlFor={`${name}-${v}`} className="font-normal">
            {enumLabel(v)}
          </Label>
        </div>
      ))}
    </div>
  );
}

export function RulesForm({ rule }: { rule: AutomationRuleView }) {
  const { state, onSubmit, pending } = useActionForm(saveRulesAction, { ok: false });
  useToastOnSuccess(state);
  const [weights, setWeights] = useState<MatchWeights>(rule.matchWeights);
  const [autoSubmit, setAutoSubmit] = useState(rule.autoSubmitEnabled);
  const [mode, setMode] = useState<string>(rule.defaultMode);
  const total = MATCH_DIMENSIONS.reduce((n, d) => n + (Number(weights[d]) || 0), 0);
  const e = state.errors ?? {};

  return (
    <form onSubmit={onSubmit} className="grid gap-5" noValidate>
      <FormMessage state={state} />
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Qualification</CardTitle>
          <CardDescription>A job must pass every rule here to be marked Qualified.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Minimum match score" htmlFor="minMatchScore" error={e.minMatchScore}>
            <Input id="minMatchScore" name="minMatchScore" type="number" min={0} max={100} defaultValue={rule.minMatchScore} />
          </Field>
          <Field label="Minimum salary (annual)" htmlFor="minSalary" error={e.minSalary} hint="Jobs that list no salary are not excluded.">
            <Input id="minSalary" name="minSalary" type="number" min={0} step={1000} placeholder="e.g. 70000" defaultValue={rule.minSalary ?? ""} />
          </Field>
          <Field label="Preferred locations" htmlFor="preferredLocations" error={e.preferredLocations} className="sm:col-span-2">
            <TagInput id="preferredLocations" name="preferredLocations" defaultValue={rule.preferredLocations} placeholder="e.g. New York, NY; Remote" />
          </Field>
          <div className="grid gap-2 sm:col-span-2">
            <Label className="text-[13px]">Work arrangement</Label>
            <CheckboxGroup name="workArrangements" values={WORK_ARRANGEMENTS.filter((w) => w !== "UNKNOWN")} selected={rule.workArrangements} />
            <p className="text-muted-foreground text-xs">Leave all unchecked to accept any arrangement.</p>
          </div>
          <div className="grid gap-2 sm:col-span-2">
            <Label className="text-[13px]">Employment type</Label>
            <CheckboxGroup name="employmentTypes" values={EMPLOYMENT_TYPES} selected={rule.employmentTypes} />
          </div>
          <Field label="Excluded industries" htmlFor="excludedIndustries" error={e.excludedIndustries}>
            <TagInput id="excludedIndustries" name="excludedIndustries" defaultValue={rule.excludedIndustries} />
          </Field>
          <Field label="Excluded companies" htmlFor="excludedCompanies" error={e.excludedCompanies}>
            <TagInput id="excludedCompanies" name="excludedCompanies" defaultValue={rule.excludedCompanies} />
          </Field>
          <Field
            label="Include keywords"
            htmlFor="requiredKeywords"
            error={e.requiredKeywords}
            hint='A job must mention at least one of these to qualify, e.g. "SaaS" or "medical devices". Leave empty to allow any.'
          >
            <TagInput id="requiredKeywords" name="requiredKeywords" defaultValue={rule.requiredKeywords} />
          </Field>
          <Field label="Exclude keywords" htmlFor="excludedKeywords" error={e.excludedKeywords} hint='Jobs mentioning any of these are skipped, e.g. "commission-only".'>
            <TagInput id="excludedKeywords" name="excludedKeywords" defaultValue={rule.excludedKeywords} />
          </Field>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Checkbox id="requiresSponsorship" name="requiresSponsorship" defaultChecked={rule.requiresSponsorship} />
            <Label htmlFor="requiresSponsorship" className="font-normal">
              I require visa sponsorship (exclude jobs that state they don&apos;t sponsor)
            </Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Match score weighting</CardTitle>
          <CardDescription>How much each factor counts toward the 0–100 score. Must total 100%.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {MATCH_DIMENSIONS.map((d) => (
            <div key={d} className="grid grid-cols-[140px_1fr_72px] items-center gap-3">
              <Label htmlFor={`weight_${d}`} className="text-[13px] font-normal">
                {MATCH_DIMENSION_LABELS[d]}
              </Label>
              <input
                type="range"
                min={0}
                max={60}
                step={5}
                value={weights[d]}
                onChange={(ev) => setWeights((w) => ({ ...w, [d]: Number(ev.target.value) }))}
                className="accent-primary w-full"
                aria-label={`${MATCH_DIMENSION_LABELS[d]} weight`}
              />
              <div className="relative">
                <Input
                  id={`weight_${d}`}
                  name={`weight_${d}`}
                  type="number"
                  min={0}
                  max={100}
                  value={weights[d]}
                  onChange={(ev) => setWeights((w) => ({ ...w, [d]: Number(ev.target.value) }))}
                  className="h-8 pr-6 text-right tabular-nums"
                />
                <span className="text-muted-foreground absolute top-1/2 right-2 -translate-y-1/2 text-xs">%</span>
              </div>
            </div>
          ))}
          <p className={cn("text-right text-sm font-medium tabular-nums", total === 100 ? "text-success" : "text-destructive")}>
            Total {total}%{e.matchWeights ? ` · ${e.matchWeights}` : total !== 100 ? " · must equal 100%" : ""}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Automation</CardTitle>
          <CardDescription>AutoApply never bypasses CAPTCHAs, MFA or other security checks. Those always come to you.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <Field label="Default mode" htmlFor="defaultMode" hint={MODE_HELP[mode]}>
            <Select name="defaultMode" value={mode} onValueChange={setMode}>
              <SelectTrigger id="defaultMode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUTOMATION_MODES.map((m) => (
                  <SelectItem key={m} value={m}>
                    {enumLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid gap-1.5">
            <Label htmlFor="autoSubmitEnabled" className="text-[13px]">
              Auto-submit
            </Label>
            <div className="flex h-9 items-center gap-3">
              <Switch id="autoSubmitEnabled" name="autoSubmitEnabled" checked={autoSubmit} onCheckedChange={setAutoSubmit} />
              <span className="text-sm">{autoSubmit ? "On" : "Off"}</span>
            </div>
            <p className="text-muted-foreground text-xs">
              {autoSubmit ? "Auto mode may submit when every check passes." : "Auto mode is treated as Review until this is on."}
            </p>
          </div>
          <Field label="Maximum applications per day" htmlFor="maxApplicationsPerDay" error={e.maxApplicationsPerDay}>
            <Input id="maxApplicationsPerDay" name="maxApplicationsPerDay" type="number" min={1} max={500} defaultValue={rule.maxApplicationsPerDay} />
          </Field>
          <Field label="Maximum concurrent applications" htmlFor="maxConcurrentApplications" error={e.maxConcurrentApplications}>
            <Input id="maxConcurrentApplications" name="maxConcurrentApplications" type="number" min={1} max={10} defaultValue={rule.maxConcurrentApplications} />
          </Field>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <SubmitButton pending={pending} pendingLabel="Saving…" disabled={total !== 100}>
          Save rules
        </SubmitButton>
      </div>
    </form>
  );
}
