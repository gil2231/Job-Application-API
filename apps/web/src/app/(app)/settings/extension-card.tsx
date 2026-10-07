"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Puzzle } from "lucide-react";
import { toast } from "sonner";
import { createExtensionCodeAction, disconnectExtensionAction } from "@/actions/extension";
import { ActionButton } from "@/components/action-button";
import { Button } from "@/components/ui/button";

interface Connection {
  id: string;
  browser: string;
  connected: string;
  lastUsed: string | null;
}

/** Create a pairing code for the browser extension, and list the extensions connected to this account. */
export function ExtensionCard({ connections, serverAddress }: { connections: Connection[]; serverAddress: string }) {
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [code]);

  // Once the extension connects, it shows up in the list below.
  useEffect(() => {
    if (!code) return;
    const timer = setInterval(() => router.refresh(), 4000);
    return () => clearInterval(timer);
  }, [code, router]);

  const left = code ? Math.max(0, new Date(code.expiresAt).getTime() - now) : 0;
  const expired = !!code && left === 0;

  const create = () =>
    startTransition(async () => {
      const result = await createExtensionCodeAction();
      if (result.ok && result.data) {
        setCode(result.data);
        setNow(Date.now());
      } else toast.error(result.message ?? "Couldn't create a code");
    });

  return (
    <div className="grid gap-4">
      <ol className="text-muted-foreground grid list-decimal gap-1 pl-5 text-sm">
        <li>Install the Applyance extension in Chrome, Edge or Brave and click its icon.</li>
        <li>Create a code here and type it into the extension. It works once, for 10 minutes.</li>
      </ol>
      {code && !expired ? (
        <div className="bg-muted/50 grid gap-1 rounded-lg border px-4 py-3" data-testid="extension-code">
          <span className="text-muted-foreground text-xs">Your code</span>
          <span className="font-mono text-2xl font-semibold tracking-[0.2em]">{code.code}</span>
          <span className="text-muted-foreground text-xs">
            Expires in {Math.floor(left / 60000)}:{String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}. Server address for the extension: <span className="font-mono">{serverAddress}</span>
          </span>
        </div>
      ) : null}
      <div>
        <Button size="sm" onClick={create} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <Puzzle />}
          {code ? "Create a new code" : "Create code"}
        </Button>
      </div>
      {connections.length > 0 && (
        <ul className="divide-y rounded-lg border">
          {connections.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{c.browser}</p>
                <p className="text-muted-foreground text-xs">
                  Connected {c.connected}
                  {c.lastUsed ? ` · last used ${c.lastUsed}` : ""}
                </p>
              </div>
              <ActionButton size="xs" variant="outline" action={() => disconnectExtensionAction(c.id)}>
                Disconnect
              </ActionButton>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
