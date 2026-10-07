import { getStripe, handleStripeEvent } from "@/lib/stripe";

/**
 * Stripe webhook. The request is trusted only after its signature checks out
 * against STRIPE_WEBHOOK_SECRET; the body must be read raw for that.
 */
export async function POST(request: Request) {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !secret) return Response.json({ error: "Billing is not configured" }, { status: 404 });

  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing signature" }, { status: 400 });
  const body = await request.text();
  let event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }
  try {
    await handleStripeEvent(stripe, event);
  } catch (error) {
    console.error("[stripe] webhook handling failed", event.type, event.id, error);
    // A 500 makes Stripe retry the delivery later.
    return Response.json({ error: "Handler failed" }, { status: 500 });
  }
  return Response.json({ received: true });
}
