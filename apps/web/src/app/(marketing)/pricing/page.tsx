import type { Metadata } from "next";
import { PLANS } from "@autoapply/shared";
import { PricingCards } from "@/components/pricing";

export const metadata: Metadata = { title: "Pricing", description: "Applyance plans: start free, upgrade to Pro for an active search." };

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
      <h1 className="text-center text-4xl font-semibold tracking-tight">Pricing</h1>
      <p className="text-muted-foreground mx-auto mt-3 mb-10 max-w-xl text-center">
        Start free with {PLANS.free.limits.applications} applications a month. Upgrade when your search picks up, and cancel any time.
      </p>
      <PricingCards mode="public" />
      <div className="text-muted-foreground mx-auto mt-12 grid max-w-3xl gap-4 text-sm sm:grid-cols-2">
        <p>
          <strong className="text-foreground">What counts as an application?</strong> Each job you send to the queue. Retrying one that failed doesn&apos;t count again. Limits reset on the 1st of each month.
        </p>
        <p>
          <strong className="text-foreground">How do payments work?</strong> Payments are handled by Stripe. Prices are in US dollars, and taxes may be added at checkout where they apply.
        </p>
      </div>
    </div>
  );
}
