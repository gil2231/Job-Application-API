"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, Download, KeyRound, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  confirmTwoFactorSetupAction,
  deleteAccountAction,
  disableTwoFactorAction,
  regenerateRecoveryCodesAction,
  startTwoFactorSetupAction,
} from "@/actions/account";
import { Field, FormMessage, SubmitButton, useActionForm } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { ActionResult } from "@/lib/action";
import { useToastOnSuccess } from "../profile/use-toast-on-success";

type CodesResult = ActionResult<{ recoveryCodes: string[] }>;

function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const text = `Applyance recovery codes\nEach code works once. Keep them somewhere safe.\n\n${codes.join("\n")}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: "applyance-recovery-codes.txt" });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div className="grid gap-4">
      <div>
        <p className="text-sm font-medium">Save your recovery codes</p>
        <p className="text-muted-foreground mt-1 text-sm">If you lose your phone, each of these lets you sign in once. This is the only time they&apos;re shown.</p>
      </div>
      <ul aria-label="Recovery codes" className="bg-muted grid grid-cols-2 gap-x-6 gap-y-1.5 rounded-lg p-4 font-mono text-sm">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="outline" onClick={download}>
          <Download /> Download
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(text).then(() => toast.success("Copied"))}>
          <Copy /> Copy
        </Button>
        <Button type="button" size="sm" onClick={onDone} className="ml-auto">
          I&apos;ve saved them
        </Button>
      </div>
    </div>
  );
}

function SetupFlow({ onCancel, onDone }: { onCancel: () => void; onDone: () => void }) {
  const router = useRouter();
  const [setup, setSetup] = useState<{ secret: string; qrSvg: string } | null>(null);
  const [loading, startLoading] = useTransition();
  const { state, onSubmit, pending } = useActionForm<CodesResult>(confirmTwoFactorSetupAction, { ok: false });

  if (state.ok && state.data)
    return (
      <RecoveryCodes
        codes={state.data.recoveryCodes}
        onDone={() => {
          onDone();
          router.refresh();
        }}
      />
    );
  if (!setup) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button
          size="sm"
          disabled={loading}
          onClick={() =>
            startLoading(async () => {
              const result = await startTwoFactorSetupAction();
              if (result.ok && result.data) setSetup(result.data);
              else toast.error(result.message ?? "Couldn't start setup");
            })
          }
        >
          {loading && <Loader2 className="animate-spin" />}
          Continue
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    );
  }
  return (
    <div className="grid gap-5 sm:grid-cols-[180px_1fr]">
      {/* The SVG is generated on the server from the otpauth link; it holds no user-supplied markup. */}
      <div className="size-[180px] rounded-lg border bg-white p-2" role="img" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
      <form onSubmit={onSubmit} className="grid content-start gap-3" noValidate>
        <ol className="text-muted-foreground list-decimal space-y-1 pl-4 text-sm">
          <li>Open an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…).</li>
          <li>Scan the QR code, or enter this key by hand:</li>
        </ol>
        <code className="bg-muted rounded px-2 py-1 font-mono text-xs break-all" data-testid="totp-secret">
          {setup.secret.match(/.{1,4}/g)?.join(" ")}
        </code>
        <FormMessage state={state} />
        <Field label="Code from the app" htmlFor="setup-code" error={state.errors?.code}>
          <Input id="setup-code" name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="123456" className="max-w-40 font-mono tracking-widest" />
        </Field>
        <div className="flex gap-2">
          <SubmitButton pending={pending} size="sm" pendingLabel="Checking…">
            Turn on
          </SubmitButton>
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}

function RegenerateCodes() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { state, onSubmit, pending } = useActionForm<CodesResult>(regenerateRecoveryCodesAction, { ok: false });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <KeyRound /> New recovery codes
        </Button>
      </DialogTrigger>
      <DialogContent>
        {state.ok && state.data ? (
          <RecoveryCodes
            codes={state.data.recoveryCodes}
            onDone={() => {
              setOpen(false);
              router.refresh();
            }}
          />
        ) : (
          <form onSubmit={onSubmit} className="grid gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>Make new recovery codes</DialogTitle>
              <DialogDescription>Your current recovery codes will stop working.</DialogDescription>
            </DialogHeader>
            <FormMessage state={state} />
            <Field label="Code from your authenticator app" htmlFor="regen-code" error={state.errors?.code}>
              <Input id="regen-code" name="code" autoComplete="one-time-code" maxLength={20} className="font-mono" />
            </Field>
            <DialogFooter>
              <SubmitButton pending={pending} size="sm">
                Make new codes
              </SubmitButton>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function DisableTwoFactor() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const { state, onSubmit, pending } = useActionForm(disableTwoFactorAction, { ok: false });
  // Refresh only after the toast, so the result is shown before the card switches to "off".
  useToastOnSuccess(state, () => {
    setOpen(false);
    router.refresh();
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="text-destructive">
          Turn off
        </Button>
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={onSubmit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Turn off two-factor sign-in?</DialogTitle>
            <DialogDescription>Signing in will need only your password again.</DialogDescription>
          </DialogHeader>
          <FormMessage state={state} />
          <Field label="Password" htmlFor="disable-password">
            <Input id="disable-password" name="password" type="password" autoComplete="current-password" />
          </Field>
          <Field label="Code from your app, or a recovery code" htmlFor="disable-code">
            <Input id="disable-code" name="code" autoComplete="one-time-code" maxLength={20} className="font-mono" />
          </Field>
          <DialogFooter>
            <SubmitButton pending={pending} size="sm" variant="destructive">
              Turn off
            </SubmitButton>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function TwoFactorSection({ enabled, enabledAt, recoveryCodesLeft }: { enabled: boolean; enabledAt: string | null; recoveryCodesLeft: number }) {
  const [settingUp, setSettingUp] = useState(false);
  // Stay in the setup flow until the recovery codes have been saved, even once two-factor is on.
  if (enabled && !settingUp) {
    return (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <Badge className="bg-success/15 text-[color-mix(in_oklch,var(--success),black_25%)] dark:text-success gap-1">
            <ShieldCheck className="size-3" /> On
          </Badge>
          <span className="text-muted-foreground">
            Since {enabledAt}. {recoveryCodesLeft} of 10 recovery codes left.
          </span>
        </div>
        {recoveryCodesLeft <= 3 && <p className="text-sm text-[color-mix(in_oklch,var(--warning),black_35%)] dark:text-warning">You&apos;re running low on recovery codes. Make new ones.</p>}
        <div className="flex flex-wrap gap-2">
          <RegenerateCodes />
          <DisableTwoFactor />
        </div>
      </div>
    );
  }
  return (
    <div className="grid gap-4">
      <p className="text-muted-foreground text-sm">Off. With it on, signing in also needs a 6-digit code from an app on your phone.</p>
      {settingUp ? (
        <SetupFlow onCancel={() => setSettingUp(false)} onDone={() => setSettingUp(false)} />
      ) : (
        <div>
          <Button size="sm" onClick={() => setSettingUp(true)}>
            <ShieldCheck /> Set up two-factor sign-in
          </Button>
        </div>
      )}
    </div>
  );
}

export function DataPrivacySection({ twoFactorEnabled, hasSubscription }: { twoFactorEnabled: boolean; hasSubscription: boolean }) {
  const [open, setOpen] = useState(false);
  const { state, onSubmit, pending } = useActionForm(deleteAccountAction, { ok: false });
  const e = state.errors ?? {};
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <div className="grid content-start gap-2">
        <p className="text-sm font-medium">Download your data</p>
        <p className="text-muted-foreground text-sm">A ZIP with everything in your account as JSON, plus your uploaded and approved documents.</p>
        <div>
          <Button asChild size="sm" variant="outline">
            <a href="/api/account/export" download>
              <Download /> Download my data
            </a>
          </Button>
        </div>
      </div>
      <div className="grid content-start gap-2">
        <p className="text-sm font-medium">Delete your account</p>
        <p className="text-muted-foreground text-sm">
          Permanently deletes your profile, documents, jobs, applications and history{hasSubscription ? ", and cancels your subscription right away" : ""}. This can&apos;t be undone.
        </p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="text-destructive w-fit">
              <Trash2 /> Delete account
            </Button>
          </DialogTrigger>
          <DialogContent>
            <form onSubmit={onSubmit} className="grid gap-4" noValidate>
              <DialogHeader>
                <DialogTitle>Delete your account?</DialogTitle>
                <DialogDescription>
                  Everything in your account is deleted right away, including your files. Download your data first if you want a copy.
                </DialogDescription>
              </DialogHeader>
              <FormMessage state={state} />
              <Field label="Password" htmlFor="delete-password" error={e.password}>
                <Input id="delete-password" name="password" type="password" autoComplete="current-password" />
              </Field>
              {twoFactorEnabled && (
                <Field label="Code from your app, or a recovery code" htmlFor="delete-code" error={e.code}>
                  <Input id="delete-code" name="code" autoComplete="one-time-code" maxLength={20} className="font-mono" />
                </Field>
              )}
              <Field label='Type "DELETE" to confirm' htmlFor="delete-confirm" error={e.confirm}>
                <Input id="delete-confirm" name="confirm" autoComplete="off" />
              </Field>
              <DialogFooter>
                <SubmitButton pending={pending} size="sm" variant="destructive" pendingLabel="Deleting…">
                  Delete everything
                </SubmitButton>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
