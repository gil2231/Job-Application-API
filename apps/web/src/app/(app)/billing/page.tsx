import type { Metadata } from "next";
import { getSubscription, getUsage } from "@autoapply/database";
import { USAGE_LABELS } from "@autoapply/shared";
import { requireUser } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { PageHeader } from "@/components/page-header";
import { PricingCards } from "@/components/pricing";
import { Badge } from "@/components/ui/badge";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { ManageBillingButton } from "./manage-billing-button";

export const metadata: Metadata = { title: "Plan & billing" };

const STATUS_LABEL: Record<string, string> = { ACTIVE: "Active", TRIALING: "Trial", PAST_DUE: "Payment due", CANCELED: "Canceled", INCOMPLETE: "Payment incomplete" };

export default async function BillingPage({ searchParams }: { searchParams: Promise<{ checkout?: string }> }) {
  const user = await requireUser();
  const { checkout } = await searchParams;
  const [usage, sub] = await Promise.all([getUsage(user.id), getSubscription(user.id)]);
  const paid = !!sub?.stripeSubscriptionId && sub.status !== "CANCELED";

  return (
    <div className="grid gap-6">
      <PageHeader title="Plan & billing" description="Your plan, this month's usage, and payment details." actions={sub ? <ManageBillingButton /> : null} />

      {checkout === "success" && (
        <div role="status" className="border-success/30 bg-success/5 rounded-lg border px-4 py-3 text-sm">
          Thanks! Your payment went through. Your plan updates here as soon as Stripe confirms it, usually within a few seconds; refresh if it still says Free.
        </div>
      )}
      {checkout === "canceled" && <div className="bg-muted rounded-lg px-4 py-3 text-sm">Checkout was canceled. You haven&apos;t been charged.</div>}
      {!usage.billingEnabled && (
        <div className="bg-muted rounded-lg px-4 py-3 text-sm">
          Billing isn&apos;t set up on this server, so every account has the {usage.plan.name} plan&apos;s limits. Add the Stripe keys described in docs/deployment.md to turn plans on.
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            {usage.plan.name} plan
            {sub && paid && <Badge variant={sub.status === "PAST_DUE" ? "destructive" : "secondary"}>{STATUS_LABEL[sub.status] ?? sub.status}</Badge>}
          </CardTitle>
          <CardDescription>
            {paid && sub?.currentPeriodEnd
              ? sub.cancelAtPeriodEnd
                ? `Ends on ${formatDate(sub.currentPeriodEnd)}. You'll move to Free after that.`
                : `Renews on ${formatDate(sub.currentPeriodEnd)}.`
              : `Usage resets on ${formatDate(usage.resetsAt)}.`}
          </CardDescription>
          {sub?.status === "PAST_DUE" && (
            <CardAction>
              <ManageBillingButton label="Update payment method" />
            </CardAction>
          )}
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          {usage.metrics.map((m) => (
            <div key={m.metric} className="grid gap-2">
              <div className="flex items-baseline justify-between text-sm">
                <span className="font-medium">{USAGE_LABELS[m.metric]}</span>
                <span className="text-muted-foreground tabular-nums">
                  {m.used} of {m.limit} this month
                </span>
              </div>
              <Progress value={Math.min(100, (m.used / Math.max(1, m.limit)) * 100)} aria-label={`${USAGE_LABELS[m.metric]} used`} />
            </div>
          ))}
        </CardContent>
      </Card>

      <section className="grid gap-4">
        <h2 className="text-sm font-semibold">Plans</h2>
        <PricingCards mode="billing" currentPlan={usage.billingEnabled ? usage.plan.id : undefined} billingEnabled={usage.billingEnabled} />
        <p className="text-muted-foreground text-center text-xs">Payments are handled by Stripe. Applyance never sees or stores your card number.</p>
      </section>
    </div>
  );
}
