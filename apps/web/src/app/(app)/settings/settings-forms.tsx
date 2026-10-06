"use client";

import { useState } from "react";
import type { UserSettingsView } from "@autoapply/database";
import { revokeBrowserSessionAction } from "@/actions/applications";
import { saveAiSettingsAction } from "@/actions/ingestion";
import { changePasswordAction, revokeOtherSessionsAction, revokeSessionAction, saveSettingsAction, updateNameAction } from "@/actions/settings";
import { ActionButton } from "@/components/action-button";
import { Field, FormMessage, SubmitButton, useActionForm } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToastOnSuccess } from "../profile/use-toast-on-success";

export function AccountForm({ name, email }: { name: string; email: string }) {
  const { state, onSubmit, pending } = useActionForm(updateNameAction, { ok: false });
  useToastOnSuccess(state);
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <Field label="Name" htmlFor="name" error={state.errors?.name}>
        <Input id="name" name="name" defaultValue={name} />
      </Field>
      <Field label="Email" htmlFor="account-email" hint="Your sign-in email.">
        <Input id="account-email" value={email} disabled readOnly />
      </Field>
      <div className="flex justify-end">
        <SubmitButton pending={pending} size="sm">
          Save
        </SubmitButton>
      </div>
    </form>
  );
}

export function PasswordForm() {
  const { state, onSubmit, pending } = useActionForm(changePasswordAction, { ok: false });
  useToastOnSuccess(state);
  const e = state.errors ?? {};
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate key={state.ok ? "done" : "form"}>
      <FormMessage state={state} />
      <Field label="Current password" htmlFor="currentPassword" error={e.currentPassword}>
        <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" />
      </Field>
      <Field label="New password" htmlFor="newPassword" error={e.newPassword}>
        <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" />
      </Field>
      <Field label="Confirm new password" htmlFor="confirmPassword" error={e.confirmPassword}>
        <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" />
      </Field>
      <div className="flex justify-end">
        <SubmitButton pending={pending} size="sm">
          Change password
        </SubmitButton>
      </div>
    </form>
  );
}

export function PreferencesForm({ settings }: { settings: UserSettingsView }) {
  const { state, onSubmit, pending } = useActionForm(saveSettingsAction, { ok: false });
  useToastOnSuccess(state);
  const e = state.errors ?? {};
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Field mapping confidence (%)" htmlFor="fieldConfidenceThreshold" error={e.fieldConfidenceThreshold}>
          <Input id="fieldConfidenceThreshold" name="fieldConfidenceThreshold" type="number" min={50} max={100} defaultValue={settings.fieldConfidenceThreshold} />
        </Field>
        <Field label="Answer confidence (%)" htmlFor="answerConfidenceThreshold" error={e.answerConfidenceThreshold}>
          <Input id="answerConfidenceThreshold" name="answerConfidenceThreshold" type="number" min={50} max={100} defaultValue={settings.answerConfidenceThreshold} />
        </Field>
        <Field label="Keep screenshots (days)" htmlFor="screenshotRetentionDays" error={e.screenshotRetentionDays}>
          <Input id="screenshotRetentionDays" name="screenshotRetentionDays" type="number" min={1} max={365} defaultValue={settings.screenshotRetentionDays} />
        </Field>
        <Field label="Time zone" htmlFor="timezone" error={e.timezone}>
          <Input id="timezone" name="timezone" defaultValue={settings.timezone} list="timezones" />
          <datalist id="timezones">
            {(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []).map((tz) => (
              <option key={tz} value={tz} />
            ))}
          </datalist>
        </Field>
      </div>
      <div className="flex items-center gap-2">
        <Checkbox id="emailNotifications" name="emailNotifications" defaultChecked={settings.emailNotifications} />
        <Label htmlFor="emailNotifications" className="font-normal">
          Email me when an application needs my attention
        </Label>
      </div>
      <div className="flex justify-end">
        <SubmitButton pending={pending} size="sm">
          Save preferences
        </SubmitButton>
      </div>
    </form>
  );
}

export function SessionList({ sessions, currentId }: { sessions: Array<{ id: string; device: string; ip: string | null; lastSeen: string; created: string }>; currentId: string }) {
  return (
    <div className="grid gap-3">
      <ul className="divide-y rounded-lg border">
        {sessions.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 text-sm font-medium">
                {s.device}
                {s.id === currentId && <Badge variant="success">This device</Badge>}
              </p>
              <p className="text-muted-foreground text-xs">
                {s.ip ?? "Unknown IP"} · active {s.lastSeen} · signed in {s.created}
              </p>
            </div>
            {s.id !== currentId && (
              <ActionButton size="xs" variant="outline" action={() => revokeSessionAction(s.id)}>
                Sign out
              </ActionButton>
            )}
          </li>
        ))}
      </ul>
      {sessions.length > 1 && (
        <div className="flex justify-end">
          <ActionButton size="sm" variant="outline" action={revokeOtherSessionsAction}>
            Sign out all other sessions
          </ActionButton>
        </div>
      )}
    </div>
  );
}

export function BrowserSessionList({ sessions }: { sessions: Array<{ id: string; domain: string; platform: string; lastUsed: string | null; expires: string | null }> }) {
  if (!sessions.length) {
    return <p className="text-muted-foreground text-sm">None yet. Each application site the worker opens keeps its cookies here, so a sign-in you finish once is remembered.</p>;
  }
  return (
    <ul className="divide-y rounded-lg border">
      {sessions.map((s) => (
        <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{s.domain}</p>
            <p className="text-muted-foreground text-xs">
              {s.platform} · {s.lastUsed ? `used ${s.lastUsed}` : "not used yet"}
              {s.expires ? ` · expires ${s.expires}` : ""}
            </p>
          </div>
          <ActionButton size="xs" variant="outline" action={() => revokeBrowserSessionAction(s.id)}>
            Remove
          </ActionButton>
        </li>
      ))}
    </ul>
  );
}

export interface AIProviderChoice {
  id: string;
  label: string;
  keyName: string;
  configured: boolean;
  defaultModel: string;
}

export function AnalysisForm({ settings, providers }: { settings: UserSettingsView; providers: AIProviderChoice[] }) {
  const { state, onSubmit, pending } = useActionForm(saveAiSettingsAction, { ok: false });
  useToastOnSuccess(state);
  const e = state.errors ?? {};
  const [providerId, setProviderId] = useState(settings.aiProvider ?? "none");
  const chosen = providers.find((p) => p.id === providerId);
  return (
    <form onSubmit={onSubmit} className="grid gap-4" noValidate>
      <FormMessage state={state} />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Provider"
          htmlFor="aiProvider"
          error={e.aiProvider}
          hint={!chosen || chosen.configured ? "The built-in tools are used whenever AI is off or fails." : `${chosen.label} needs ${chosen.keyName} set on the server. Until then the built-in tools are used.`}
        >
          <Select name="aiProvider" value={providerId} onValueChange={setProviderId}>
            <SelectTrigger id="aiProvider">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Built-in tools (no AI)</SelectItem>
              {providers.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Model" htmlFor="aiModel" error={e.aiModel} hint={chosen ? `Leave blank for ${chosen.defaultModel}.` : "Not used by the built-in tools."}>
          <Input id="aiModel" name="aiModel" defaultValue={settings.aiModel ?? ""} placeholder={chosen?.defaultModel ?? ""} />
        </Field>
      </div>
      <div className="flex justify-end">
        <SubmitButton pending={pending} size="sm">
          Save AI settings
        </SubmitButton>
      </div>
    </form>
  );
}
