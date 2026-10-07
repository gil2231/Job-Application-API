"use server";

import { audit, getStripeCustomerId, getSubscription, saveStripeCustomer } from "@autoapply/database";
import type { BillingInterval } from "@autoapply/shared";
import { authedAction, type ActionResult } from "@/lib/action";
import { appUrl, getStripe } from "@/lib/stripe";
import { priceIdFor } from "@/lib/stripe-sync";

const NOT_SET_UP = "Billing isn't set up on this server yet.";

async function customerFor(user: { id: string; email: string; name: string }): Promise<string> {
  const stripe = getStripe()!;
  const existing = await getStripeCustomerId(user.id);
  if (existing) return existing;
  const customer = await stripe.customers.create(
    { email: user.email, name: user.name, metadata: { userId: user.id } },
    // Retrying this action never creates a second customer for the account.
    { idempotencyKey: `customer-${user.id}` },
  );
  await saveStripeCustomer(user.id, customer.id);
  return customer.id;
}

/** Start Stripe Checkout for the Pro plan. Returns the checkout page URL to send the browser to. */
export async function startCheckoutAction(interval: BillingInterval): Promise<ActionResult<{ url: string }>> {
  return authedAction(async (user) => {
    const stripe = getStripe();
    if (!stripe) return { ok: false, message: NOT_SET_UP };
    if (interval !== "month" && interval !== "year") return { ok: false, message: "Choose monthly or yearly" };
    const price = priceIdFor("pro", interval);
    if (!price) return { ok: false, message: "The Pro plan's Stripe price isn't set on this server yet." };

    const current = await getSubscription(user.id);
    if (current?.stripeSubscriptionId && ["ACTIVE", "TRIALING", "PAST_DUE"].includes(current.status)) {
      return { ok: false, message: "You already have a paid plan. Use Manage billing to change it." };
    }
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: await customerFor(user),
      client_reference_id: user.id,
      line_items: [{ price, quantity: 1 }],
      subscription_data: { metadata: { userId: user.id } },
      allow_promotion_codes: true,
      success_url: appUrl("/billing?checkout=success"),
      cancel_url: appUrl("/billing?checkout=canceled"),
    });
    if (!session.url) return { ok: false, message: "Stripe didn't return a checkout page. Please try again." };
    await audit(user.id, "billing.checkout_started", { metadata: { interval } });
    return { ok: true, data: { url: session.url } };
  });
}

/** Open the Stripe customer portal (change plan, update card, invoices, cancel). */
export async function openBillingPortalAction(): Promise<ActionResult<{ url: string }>> {
  return authedAction(async (user) => {
    const stripe = getStripe();
    if (!stripe) return { ok: false, message: NOT_SET_UP };
    const customer = await getStripeCustomerId(user.id);
    if (!customer) return { ok: false, message: "There's no billing account yet. Choose a plan first." };
    const session = await stripe.billingPortal.sessions.create({ customer, return_url: appUrl("/billing") });
    return { ok: true, data: { url: session.url } };
  });
}
