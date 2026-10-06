import "server-only";
import Stripe from "stripe";
import { applyStripeSubscription, claimStripeEvent, releaseStripeEvent } from "@autoapply/database";
import { subscriptionState } from "./stripe-sync";

let client: Stripe | null = null;

/** The Stripe client, or null when billing isn't configured (STRIPE_SECRET_KEY unset). */
export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  client ??= new Stripe(key, { appInfo: { name: "Applyance" }, maxNetworkRetries: 2 });
  return client;
}

export function appUrl(path = ""): string {
  return `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}${path}`;
}

/**
 * Apply one verified webhook event. Each event id is handled once; if handling
 * throws, the id is released so Stripe's retry can apply it.
 */
export async function handleStripeEvent(stripe: Stripe, event: Stripe.Event): Promise<void> {
  if (!(await claimStripeEvent(event.id, event.type))) return;
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        if (session.mode !== "subscription" || !session.subscription) break;
        const subId = typeof session.subscription === "string" ? session.subscription : session.subscription.id;
        // Read the subscription fresh so its state is current, not as of the event.
        const sub = await stripe.subscriptions.retrieve(subId);
        await applyStripeSubscription(subscriptionState(sub), session.client_reference_id);
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = await stripe.subscriptions.retrieve(event.data.object.id).catch(() => event.data.object);
        await applyStripeSubscription(subscriptionState(sub), sub.metadata?.userId);
        break;
      }
      default:
        break;
    }
  } catch (error) {
    await releaseStripeEvent(event.id);
    throw error;
  }
}
