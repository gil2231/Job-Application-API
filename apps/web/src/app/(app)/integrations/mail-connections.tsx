"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2, Mail, RefreshCw, Unplug } from "lucide-react";
import { toast } from "sonner";
import type { MailConnectionView } from "@autoapply/database";
import { disconnectMailAction, syncMailNowAction, updateMailSettingsAction } from "@/actions/mail";
import { useServerAction } from "@/components/action-button";
import { TimeAgo } from "@/components/local-time";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

type Provider = "GOOGLE" | "MICROSOFT";

const NAMES: Record<Provider, { title: string; slug: string; mail: string; calendar: string }> = {
  GOOGLE: { title: "Gmail and Google Calendar", slug: "google", mail: "Gmail", calendar: "Google Calendar" },
  MICROSOFT: { title: "Outlook and Outlook Calendar", slug: "microsoft", mail: "Outlook", calendar: "Outlook Calendar" },
};

const ERRORS: Record<string, string> = {
  not_configured: "Email sync isn't set up on this server yet.",
  state: "That sign-in link expired or came from another tab. Try connecting again.",
  denied: "You cancelled the sign-in, so nothing was connected.",
  scopes: "Applyance wasn't given access to email or calendar. Connect again and allow both.",
  no_mail_scope: "Connected, but without access to email. Connect again and allow reading email to update Flightpath.",
  provider: "The provider didn't finish the sign-in. Try again.",
};

/** Shows the result of the provider's redirect once, then tidies the URL. */
export function MailConnectNotice() {
  const params = useSearchParams();
  const router = useRouter();
  const shown = useRef(false);
  useEffect(() => {
    if (shown.current) return;
    const connected = params.get("connected");
    const error = params.get("mail_error");
    if (!connected && !error) return;
    shown.current = true;
    if (connected && !error) toast.success(`${connected === "google" ? "Google" : "Microsoft"} account connected. Reading your recent job email now.`);
    if (error) toast.error(ERRORS[error] ?? ERRORS.provider);
    router.replace("/integrations", { scroll: false });
  }, [params, router]);
  return null;
}

function Toggle({ id, label, hint, checked, disabled, onChange }: { id: string; label: string; hint: string; checked: boolean; disabled?: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex items-start gap-3">
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} className="mt-0.5" />
      <span className="grid gap-0.5">
        <span className="text-sm">{label}</span>
        <span className="text-muted-foreground text-xs">{hint}</span>
      </span>
    </label>
  );
}

function ConnectedAccount({ connection }: { connection: MailConnectionView }) {
  const names = NAMES[connection.provider];
  const { pending, run } = useServerAction();
  const set = (patch: Record<string, boolean>) => run(() => updateMailSettingsAction(connection.id, patch));
  const reconnect = connection.status === "NEEDS_RECONNECT";
  const key = connection.provider.toLowerCase();
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-sm font-medium">{connection.email}</span>
        {reconnect ? <Badge variant="destructive">Reconnect needed</Badge> : <Badge variant="success">Connected</Badge>}
        <span className="text-muted-foreground text-xs">
          {connection.lastSyncedAt ? (
            <>
              Synced <TimeAgo value={connection.lastSyncedAt} />
            </>
          ) : (
            "Not synced yet"
          )}
        </span>
      </div>
      {connection.lastError && <p className="text-destructive text-xs">{connection.lastError}</p>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Toggle
          id={`${key}-read`}
          label="Update Flightpath from email"
          hint={`Reads replies from employers in ${names.mail}.`}
          checked={connection.readEmail}
          disabled={pending || reconnect}
          onChange={(v) => set({ readEmail: v })}
        />
        <Toggle
          id={`${key}-auto`}
          label="Move cards automatically"
          hint={connection.autoUpdate ? "Clear updates move the card; unclear ones are left as a note." : "Every update is left as a note on the application for you."}
          checked={connection.autoUpdate}
          disabled={pending || reconnect || !connection.readEmail}
          onChange={(v) => set({ autoUpdate: v })}
        />
        <Toggle
          id={`${key}-calendar`}
          label={`Add interviews to ${names.calendar}`}
          hint="Events follow your changes to each interview."
          checked={connection.calendarSync}
          disabled={pending || reconnect}
          onChange={(v) => set({ calendarSync: v })}
        />
      </div>
      <div className="flex flex-wrap gap-2">
        {reconnect ? (
          <Button size="sm" asChild>
            <a href={`/api/integrations/${names.slug}/connect`}>Connect again</a>
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => syncMailNowAction(connection.id))}>
            {pending ? <Loader2 className="animate-spin" /> : <RefreshCw />} Sync now
          </Button>
        )}
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button size="sm" variant="ghost" disabled={pending}>
              <Unplug /> Disconnect
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Disconnect {connection.email}?</AlertDialogTitle>
              <AlertDialogDescription>
                Applyance stops reading this account and forgets the emails it read from it. Moves already made in Flightpath stay, and interviews already on your calendar stay there.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction variant="destructive" onClick={() => run(() => disconnectMailAction(connection.id))}>
                Disconnect
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}

export function MailConnections({ connections, setup, toReview }: { connections: MailConnectionView[]; setup: Record<Provider, string[]>; toReview: number }) {
  return (
    <div className="grid gap-3">
      <ul className="divide-y rounded-lg border" data-testid="mail-connections">
        {(["GOOGLE", "MICROSOFT"] as const).map((provider) => {
          const names = NAMES[provider];
          const connection = connections.find((c) => c.provider === provider);
          const missing = setup[provider];
          return (
            <li key={provider} className="flex items-start gap-3 px-4 py-3" data-testid={`mail-${names.slug}`}>
              <div className="bg-muted text-muted-foreground grid size-8 shrink-0 place-items-center rounded-md"><Mail className="size-4" /></div>
              <div className="grid min-w-0 flex-1 gap-2">
                <p className="text-sm font-medium">{names.title}</p>
                {connection ? (
                  <ConnectedAccount connection={connection} />
                ) : missing.length ? (
                  <p className="text-muted-foreground text-xs">Not set up on this server yet. It needs {missing.join(" and ")}.</p>
                ) : (
                  <p className="text-muted-foreground text-xs">Not connected.</p>
                )}
              </div>
              {!connection && (
                <Button size="sm" asChild={!missing.length} disabled={missing.length > 0}>
                  {missing.length ? <span>Connect</span> : <a href={`/api/integrations/${names.slug}/connect`}>Connect</a>}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {connections.length > 0 && (
        <p className="text-sm">
          <Link href="/integrations/email" className="text-primary hover:underline">
            Email activity
          </Link>
          {toReview > 0 && <span className="text-muted-foreground"> · {toReview} email{toReview === 1 ? "" : "s"} to match to an application</span>}
        </p>
      )}
    </div>
  );
}
