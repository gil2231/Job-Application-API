import type Stripe from "stripe";
import type { StripeSubscriptionState } from "@autoapply/database";
import type { BillingInterval, PlanId } from "@autoapply/shared";

/**
 * Pure mapping between Stripe objects and Applyance plans, kept apart from
 * the Stripe client so it can be unit tested without network access.
 */

export function priceIdFor(plan: PlanId, interval: BillingInterval, env: Record<string, string | undefined> = process.env): string | null {
  if (plan !== "pro") return null;
  return (interval === "year" ? env.STRIPE_PRICE_PRO_YEARLY : env.STRIPE_PRICE_PRO_MONTHLY) || null;
}

/** The plan a Stripe price belongs to. Unknown prices map to null and are never treated as paid. */
export function planForPrice(priceId: string | null | undefined, env: Record<string, string | undefined> = process.env): PlanId | null {
  if (!priceId) return null;
  if (priceId === env.STRIPE_PRICE_PRO_MONTHLY || priceId === env.STRIPE_PRICE_PRO_YEARLY) return "pro";
  return null;
}

const STATUS: Record<string, StripeSubscriptionState["status"]> = {
  active: "ACTIVE",
  trialing: "TRIALING",
  past_due: "PAST_DUE",
  incomplete: "INCOMPLETE",
  // Every other status ends paid access.
  canceled: "CANCELED",
  incomplete_expired: "CANCELED",
  unpaid: "CANCELED",
  paused: "CANCELED",
};

export function subscriptionState(sub: Stripe.Subscription, env: Record<string, string | undefined> = process.env): StripeSubscriptionState {
  const item = sub.items.data[0];
  const priceId = item?.price?.id ?? null;
  const plan = planForPrice(priceId, env);
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  return {
    stripeCustomerId: customer,
    stripeSubscriptionId: sub.id,
    stripePriceId: priceId,
    plan: plan ?? "free",
    // A subscription to a price we don't recognize never unlocks a paid plan.
    status: plan ? (STATUS[sub.status] ?? "CANCELED") : "CANCELED",
    interval: item?.price?.recurring?.interval ?? null,
    currentPeriodEnd: item?.current_period_end ? new Date(item.current_period_end * 1000) : null,
    cancelAtPeriodEnd: sub.cancel_at_period_end,
  };
}

/** The webhook events Applyance acts on. Configure exactly these in the Stripe dashboard. */
export const STRIPE_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
] as const;
