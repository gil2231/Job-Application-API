import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { audit, unsubscribeUser } from "@autoapply/database";
import { verifyUnsubscribeToken, type UnsubscribeKind } from "@autoapply/notifications";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = { title: "Unsubscribe" };
export const dynamic = "force-dynamic";

const LABELS: Record<UnsubscribeKind, string> = { attention: "Needs Attention emails", job_alerts: "daily job alert emails" };

async function unsubscribe(formData: FormData) {
  "use server";
  const verified = verifyUnsubscribeToken(String(formData.get("token") ?? ""));
  if (!verified) return;
  await unsubscribeUser(verified.userId, verified.kind);
  await audit(verified.userId, "settings.unsubscribed", { metadata: { kind: verified.kind, via: "link" } });
  redirect(`/unsubscribe?done=${verified.kind}`);
}

/**
 * Unsubscribe from an email link without signing in. Opening the link changes
 * nothing (mail scanners open links too); the person confirms with a button.
 */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string; done?: string }> }) {
  const { token = "", done } = await searchParams;
  const verified = token ? verifyUnsubscribeToken(token) : null;
  const doneKind = done === "attention" || done === "job_alerts" ? done : null;

  return (
    <div className="bg-muted/30 grid min-h-screen place-items-center px-4 py-12">
      <Card className="w-full max-w-md">
        <CardHeader>
          <p className="mb-2 text-sm font-semibold tracking-tight">Applyance</p>
          <CardTitle>{doneKind ? "You're unsubscribed" : verified ? "Unsubscribe?" : "This link doesn't work"}</CardTitle>
          <CardDescription>
            {doneKind
              ? `You won't get ${LABELS[doneKind]} anymore. You can turn them back on any time in Settings.`
              : verified
                ? `Stop sending ${LABELS[verified.kind]} to this account. Other emails aren't affected.`
                : "The unsubscribe link is incomplete or was changed. You can turn emails off in Settings after signing in."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          {verified && !doneKind && (
            <form action={unsubscribe}>
              <input type="hidden" name="token" value={token} />
              <Button type="submit">Unsubscribe</Button>
            </form>
          )}
          <Button variant="outline" asChild>
            <Link href="/settings#notifications">Notification settings</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
