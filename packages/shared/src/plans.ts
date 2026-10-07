/**
 * Applyance plans. Prices, limits and copy for the pricing page and the
 * billing page all come from here, so changing a plan is a one-file edit.
 *
 * Prices shown here are for display only. What Stripe charges is set on the
 * Stripe price whose id is in STRIPE_PRICE_PRO_MONTHLY / STRIPE_PRICE_PRO_YEARLY;
 * keep the two in step when you change a price.
 */

export type PlanId = "free" | "pro";
export type BillingInterval = "month" | "year";

/** Monthly usage that plans limit. Counted per calendar month (UTC). */
export type UsageMetric = "applications" | "tailoredDocuments";

export interface Plan {
  id: PlanId;
  name: string;
  tagline: string;
  /** Display prices in US dollars. */
  price: { month: number; year: number };
  limits: Record<UsageMetric, number>;
  features: string[];
}

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    tagline: "Try Applyance on your own job search.",
    price: { month: 0, year: 0 },
    limits: { applications: 25, tailoredDocuments: 10 },
    features: [
      "25 applications a month",
      "10 tailored resumes or cover letters a month",
      "LinkedIn saved jobs import and job board search",
      "Match scores, rules and recommendations",
      "Flightpath application tracker",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    tagline: "For an active search, applying every day.",
    price: { month: 29, year: 290 },
    limits: { applications: 500, tailoredDocuments: 200 },
    features: [
      "500 applications a month",
      "200 tailored resumes or cover letters a month",
      "Everything in Free",
      "Priority support",
    ],
  },
};

export const PLAN_ORDER: PlanId[] = ["free", "pro"];

export const USAGE_LABELS: Record<UsageMetric, string> = {
  applications: "Applications",
  tailoredDocuments: "Tailored resumes and cover letters",
};

/**
 * Billing is on only when Stripe is configured. Without it (local development
 * or a self-hosted install) every account gets the paid plan's limits and the
 * billing pages say billing isn't set up.
 */
export function isBillingEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return !!env.STRIPE_SECRET_KEY;
}

export function getPlan(id: string | null | undefined): Plan {
  return id && id in PLANS ? PLANS[id as PlanId] : PLANS.free;
}

/** "2026-10" for the calendar month (UTC) that `now` falls in. */
export function usagePeriod(now: Date = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** First instant of the next usage period, when counts reset. */
export function usageResetsAt(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}

export function formatPrice(dollars: number): string {
  return dollars === 0 ? "$0" : `$${dollars % 1 === 0 ? dollars : dollars.toFixed(2)}`;
}
