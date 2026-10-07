"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatPrice, PLAN_ORDER, PLANS, type BillingInterval, type PlanId } from "@autoapply/shared";
import { startCheckoutAction } from "@/actions/billing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function IntervalToggle({ value, onChange }: { value: BillingInterval; onChange: (v: BillingInterval) => void }) {
  const yearlySaving = Math.round((1 - PLANS.pro.price.year / (PLANS.pro.price.month * 12)) * 100);
  return (
    <div role="radiogroup" aria-label="Billing period" className="bg-muted inline-flex rounded-lg p-1 text-sm">
      {(["month", "year"] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn("rounded-md px-3 py-1.5 font-medium transition-colors", value === v ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}
        >
          {v === "month" ? "Monthly" : `Yearly${yearlySaving > 0 ? ` (save ${yearlySaving}%)` : ""}`}
        </button>
      ))}
    </div>
  );
}

/**
 * Plan cards from packages/shared/src/plans.ts. On the public site the buttons
 * lead to sign-up; on the Billing page they start Stripe Checkout.
 */
export function PricingCards({ mode, currentPlan, billingEnabled = true }: { mode: "public" | "billing"; currentPlan?: PlanId; billingEnabled?: boolean }) {
  const [interval, setInterval] = useState<BillingInterval>("month");
  const [pending, startTransition] = useTransition();

  const checkout = () =>
    startTransition(async () => {
      const result = await startCheckoutAction(interval);
      if (result.ok && result.data) window.location.assign(result.data.url);
      else toast.error(result.message ?? "Couldn't start checkout");
    });

  return (
    <div className="grid gap-6">
      <div className="flex justify-center">
        <IntervalToggle value={interval} onChange={setInterval} />
      </div>
      <div className="mx-auto grid w-full max-w-3xl gap-5 md:grid-cols-2">
        {PLAN_ORDER.map((id) => {
          const plan = PLANS[id];
          const featured = id === "pro";
          const price = interval === "month" ? plan.price.month : plan.price.year;
          const isCurrent = currentPlan === id;
          return (
            <div key={id} className={cn("bg-card relative flex flex-col rounded-xl border p-6", featured && "border-primary shadow-primary/10 shadow-lg")}>
              {featured && <Badge className="absolute -top-2.5 left-6">Most popular</Badge>}
              <h3 className="text-lg font-semibold">{plan.name}</h3>
              <p className="text-muted-foreground mt-1 text-sm">{plan.tagline}</p>
              <p className="mt-5 flex items-baseline gap-1">
                <span className="text-4xl font-semibold tracking-tight">{formatPrice(price)}</span>
                <span className="text-muted-foreground text-sm">{price === 0 ? "forever" : interval === "month" ? "per month" : "per year"}</span>
              </p>
              <ul className="mt-6 grid flex-1 gap-2.5 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <Check className="text-primary mt-0.5 size-4 shrink-0" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                {mode === "public" ? (
                  <Button asChild className="w-full" variant={featured ? "default" : "outline"}>
                    <Link href="/sign-up">{featured ? "Start with Pro" : "Start free"}</Link>
                  </Button>
                ) : isCurrent ? (
                  <Button className="w-full" variant="outline" disabled>
                    Your current plan
                  </Button>
                ) : id === "pro" ? (
                  <Button className="w-full" onClick={checkout} disabled={pending || !billingEnabled}>
                    {pending && <Loader2 className="animate-spin" />}
                    Upgrade to Pro
                  </Button>
                ) : (
                  <p className="text-muted-foreground text-center text-xs">To move to Free, cancel Pro in Manage billing. Pro stays on until the end of the period you paid for.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
