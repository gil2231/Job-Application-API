import type { SubscriptionStatus } from "@prisma/client";
import { getPlan, isBillingEnabled, PLANS, usagePeriod, usageResetsAt, type Plan, type UsageMetric } from "@autoapply/shared";
import { prisma } from "../client";

/** Statuses that keep the paid plan's limits. PAST_DUE keeps them while Stripe retries the card. */
const PAID_STATUSES: SubscriptionStatus[] = ["ACTIVE", "TRIALING", "PAST_DUE"];

export async function getSubscription(userId: string) {
  return prisma.subscription.findUnique({ where: { userId } });
}

/** The plan whose limits apply to this account right now. */
export async function getEffectivePlan(userId: string): Promise<Plan> {
  if (!isBillingEnabled()) return PLANS.pro;
  const sub = await getSubscription(userId);
  return sub && PAID_STATUSES.includes(sub.status) ? getPlan(sub.plan) : PLANS.free;
}

export async function getUsage(userId: string, now: Date = new Date()) {
  const period = usagePeriod(now);
  const [plan, rows] = await Promise.all([getEffectivePlan(userId), prisma.usageCounter.findMany({ where: { userId, period } })]);
  const used = Object.fromEntries(rows.map((r) => [r.metric, r.count])) as Partial<Record<UsageMetric, number>>;
  const metrics = (Object.keys(plan.limits) as UsageMetric[]).map((metric) => ({
    metric,
    used: used[metric] ?? 0,
    limit: plan.limits[metric],
  }));
  return { plan, period, resetsAt: usageResetsAt(now), metrics, billingEnabled: isBillingEnabled() };
}

/**
 * Reserve up to `amount` units of a monthly allowance and return how many were
 * granted (0..amount). The increment is a single conditional statement, so two
 * requests at once can't both take the last unit.
 */
export async function consumeUsage(userId: string, metric: UsageMetric, amount = 1, now: Date = new Date()): Promise<number> {
  if (amount <= 0) return 0;
  const plan = await getEffectivePlan(userId);
  const limit = plan.limits[metric];
  const period = usagePeriod(now);
  await prisma.$executeRaw`
    INSERT INTO "UsageCounter" ("userId", "metric", "period", "count") VALUES (${userId}, ${metric}, ${period}, 0)
    ON CONFLICT DO NOTHING`;
  // FOR UPDATE makes a concurrent request wait and then read the new count.
  const rows = await prisma.$queryRaw<Array<{ granted: number }>>`
    WITH cur AS (
      SELECT "count" AS old FROM "UsageCounter"
       WHERE "userId" = ${userId} AND "metric" = ${metric} AND "period" = ${period}
       FOR UPDATE
    )
    UPDATE "UsageCounter" u
       SET "count" = cur.old + LEAST(${amount}::int, GREATEST(${limit}::int - cur.old, 0))
      FROM cur
     WHERE u."userId" = ${userId} AND u."metric" = ${metric} AND u."period" = ${period}
    RETURNING LEAST(${amount}::int, GREATEST(${limit}::int - cur.old, 0))::int AS granted`;
  return rows[0]?.granted ?? 0;
}

/** Give back units reserved for work that didn't happen (for example, a duplicate application). */
export async function refundUsage(userId: string, metric: UsageMetric, amount: number, now: Date = new Date()): Promise<void> {
  if (amount <= 0) return;
  await prisma.$executeRaw`
    UPDATE "UsageCounter" SET "count" = GREATEST("count" - ${amount}::int, 0)
     WHERE "userId" = ${userId} AND "metric" = ${metric} AND "period" = ${usagePeriod(now)}`;
}

export class PlanLimitError extends Error {
  constructor(
    readonly metric: UsageMetric,
    readonly limit: number,
  ) {
    super(
      metric === "applications"
        ? `You've used all ${limit} applications on your plan this month.`
        : `You've used all ${limit} tailored resumes and cover letters on your plan this month.`,
    );
  }
}

// ── Stripe sync ─────────────────────────────────────────────────────────────

export async function getStripeCustomerId(userId: string): Promise<string | null> {
  const sub = await prisma.subscription.findUnique({ where: { userId }, select: { stripeCustomerId: true } });
  return sub?.stripeCustomerId ?? null;
}

/** Remember the Stripe customer made for this account before the first checkout. */
export async function saveStripeCustomer(userId: string, stripeCustomerId: string): Promise<void> {
  await prisma.subscription.upsert({
    where: { userId },
    create: { userId, stripeCustomerId, plan: "free", status: "CANCELED" },
    update: { stripeCustomerId },
  });
}

export interface StripeSubscriptionState {
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  stripePriceId: string | null;
  plan: string;
  status: SubscriptionStatus;
  interval: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

/** Apply a subscription's state from Stripe. Returns false when no account has that customer. */
export async function applyStripeSubscription(state: StripeSubscriptionState, userIdHint?: string | null): Promise<boolean> {
  const existing =
    (await prisma.subscription.findUnique({ where: { stripeCustomerId: state.stripeCustomerId }, select: { userId: true } })) ??
    (userIdHint ? await prisma.subscription.findUnique({ where: { userId: userIdHint }, select: { userId: true } }) : null);
  const userId = existing?.userId ?? userIdHint;
  if (!userId || !(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) return false;
  const data = { ...state };
  await prisma.subscription.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  return true;
}

/**
 * Record a webhook event id. Returns false when it was already handled, so
 * Stripe's retries and duplicate deliveries are applied once.
 */
export async function claimStripeEvent(id: string, type: string): Promise<boolean> {
  try {
    await prisma.stripeEvent.create({ data: { id, type } });
    return true;
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") return false;
    throw error;
  }
}

/** Let a failed handler be retried by Stripe's next delivery. */
export async function releaseStripeEvent(id: string): Promise<void> {
  await prisma.stripeEvent.deleteMany({ where: { id } });
}

// ── Admin views ─────────────────────────────────────────────────────────────

/** "Pro", "Pro (payment due)", "Free"... for one account's subscription row. */
export function planLabel(sub: { plan: string; status: SubscriptionStatus } | null | undefined): string {
  if (!isBillingEnabled()) return "Billing off";
  if (!sub || !PAID_STATUSES.includes(sub.status)) return PLANS.free.name;
  const name = getPlan(sub.plan).name;
  return sub.status === "PAST_DUE" ? `${name} (payment due)` : sub.status === "TRIALING" ? `${name} (trial)` : name;
}

/** Paying accounts and monthly recurring revenue at list price (before discounts and taxes). */
export async function getBillingSummary() {
  const subs = await prisma.subscription.findMany({
    where: { status: { in: PAID_STATUSES }, stripeSubscriptionId: { not: null } },
    select: { plan: true, status: true, interval: true, cancelAtPeriodEnd: true },
  });
  let mrr = 0;
  for (const s of subs) {
    const price = getPlan(s.plan).price;
    mrr += s.interval === "year" ? price.year / 12 : price.month;
  }
  return {
    enabled: isBillingEnabled(),
    paying: subs.length,
    pastDue: subs.filter((s) => s.status === "PAST_DUE").length,
    canceling: subs.filter((s) => s.cancelAtPeriodEnd).length,
    mrr: Math.round(mrr * 100) / 100,
  };
}
