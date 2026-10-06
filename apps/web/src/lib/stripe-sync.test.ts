import { describe, expect, it } from "vitest";
import type Stripe from "stripe";
import { planForPrice, priceIdFor, subscriptionState } from "./stripe-sync";

const env = { STRIPE_PRICE_PRO_MONTHLY: "price_month", STRIPE_PRICE_PRO_YEARLY: "price_year" };

function sub(overrides: { status?: string; price?: string; interval?: string; customer?: string } = {}): Stripe.Subscription {
  return {
    id: "sub_1",
    status: overrides.status ?? "active",
    customer: overrides.customer ?? "cus_1",
    cancel_at_period_end: false,
    metadata: {},
    items: { data: [{ price: { id: overrides.price ?? "price_month", recurring: { interval: overrides.interval ?? "month" } }, current_period_end: 1_800_000_000 }] },
  } as unknown as Stripe.Subscription;
}

describe("stripe sync", () => {
  it("maps prices to plans both ways", () => {
    expect(priceIdFor("pro", "month", env)).toBe("price_month");
    expect(priceIdFor("pro", "year", env)).toBe("price_year");
    expect(priceIdFor("free", "month", env)).toBeNull();
    expect(planForPrice("price_year", env)).toBe("pro");
    expect(planForPrice("price_other", env)).toBeNull();
    expect(planForPrice(undefined, env)).toBeNull();
  });

  it("reads plan, status and period from a subscription", () => {
    expect(subscriptionState(sub(), env)).toEqual({
      stripeCustomerId: "cus_1",
      stripeSubscriptionId: "sub_1",
      stripePriceId: "price_month",
      plan: "pro",
      status: "ACTIVE",
      interval: "month",
      currentPeriodEnd: new Date(1_800_000_000_000),
      cancelAtPeriodEnd: false,
    });
    expect(subscriptionState(sub({ status: "past_due" }), env).status).toBe("PAST_DUE");
    for (const status of ["canceled", "unpaid", "incomplete_expired", "paused", "something_new"]) {
      expect(subscriptionState(sub({ status }), env).status).toBe("CANCELED");
    }
  });

  it("never treats an unknown price as paid", () => {
    expect(subscriptionState(sub({ price: "price_from_elsewhere" }), env)).toMatchObject({ plan: "free", status: "CANCELED" });
  });
});
