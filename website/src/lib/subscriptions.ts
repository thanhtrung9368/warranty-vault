import { prisma } from '@/lib/prisma';
import {
  BILLING_CYCLES,
  monthlyEquivalent,
  SUBSCRIPTION_ACTIVE_STATUSES,
  SUBSCRIPTION_STATUSES,
  type BillingCycle,
  type SubscriptionStatus,
} from '@/lib/subscription-types';

export type SubscriptionFilter = {
  q?: string;
  category?: string;
  status?: string; // 'ACTIVE_PAUSED' (default), 'ALL', or specific status
  billingCycle?: string;
  sort?: 'renewal' | 'name' | 'price' | 'monthly' | 'recent';
  dir?: 'asc' | 'desc';
};

export async function listSubscriptions(userId: string, filter: SubscriptionFilter = {}) {
  const {
    q,
    category,
    status = 'ACTIVE_PAUSED',
    billingCycle,
    sort = 'renewal',
    dir = 'asc',
  } = filter;

  const where: Record<string, unknown> = { userId };
  if (q?.trim()) {
    const term = q.trim();
    where.OR = [
      { name: { contains: term } },
      { brand: { contains: term } },
      { plan: { contains: term } },
      { notes: { contains: term } },
    ];
  }
  if (category) where.category = category;
  if (status === 'ALL') {
    // no filter
  } else if (status === 'ACTIVE_PAUSED') {
    where.status = { in: SUBSCRIPTION_ACTIVE_STATUSES };
  } else if ((SUBSCRIPTION_STATUSES as readonly string[]).includes(status)) {
    where.status = status;
  }
  if (billingCycle && (BILLING_CYCLES as readonly string[]).includes(billingCycle)) {
    where.billingCycle = billingCycle;
  }

  const subs = await prisma.subscription.findMany({
    where,
    orderBy:
      sort === 'name'
        ? { name: dir }
        : sort === 'price'
          ? { price: dir }
          : sort === 'recent'
            ? { createdAt: dir }
            : sort === 'renewal'
              ? { renewalDate: dir }
              : { renewalDate: 'asc' }, // monthly handled below
    include: {
      _count: { select: { payments: true } },
    },
  });

  if (sort === 'monthly') {
    subs.sort((a, b) => {
      const ma = monthlyEquivalent(a.price, a.billingCycle as BillingCycle, a.intervalDays) ?? 0;
      const mb = monthlyEquivalent(b.price, b.billingCycle as BillingCycle, b.intervalDays) ?? 0;
      return dir === 'asc' ? ma - mb : mb - ma;
    });
  }

  return subs;
}

export async function getSubscription(userId: string, id: string) {
  return prisma.subscription.findFirst({
    where: { id, userId },
    include: {
      payments: { orderBy: { paidAt: 'asc' } },
    },
  });
}

export async function subscriptionTotals(userId: string) {
  const subs = await prisma.subscription.findMany({
    where: { userId, status: { in: SUBSCRIPTION_ACTIVE_STATUSES } },
    select: {
      id: true,
      name: true,
      price: true,
      billingCycle: true,
      intervalDays: true,
      renewalDate: true,
      status: true,
      autoRenew: true,
    },
  });
  let monthly = 0;
  let yearly = 0;
  for (const s of subs) {
    const m = monthlyEquivalent(s.price, s.billingCycle as BillingCycle, s.intervalDays);
    if (m != null) {
      monthly += m;
      yearly += m * 12;
    }
  }
  // Upcoming renewals — only ACTIVE + autoRenew + not LIFETIME.
  const upcoming = subs
    .filter(
      (s) =>
        (s.status as SubscriptionStatus) === 'ACTIVE' &&
        s.autoRenew &&
        s.billingCycle !== 'LIFETIME',
    )
    .sort((a, b) => a.renewalDate.getTime() - b.renewalDate.getTime())
    .slice(0, 5);
  return {
    count: subs.length,
    monthly,
    yearly,
    upcoming,
  };
}

// Group monthly cost by category — used by the stats page.
export async function subscriptionMonthlyByCategory(userId: string) {
  const subs = await prisma.subscription.findMany({
    where: { userId, status: { in: SUBSCRIPTION_ACTIVE_STATUSES } },
    select: {
      price: true,
      billingCycle: true,
      intervalDays: true,
      category: true,
    },
  });
  const map = new Map<string, number>();
  for (const s of subs) {
    const m = monthlyEquivalent(s.price, s.billingCycle as BillingCycle, s.intervalDays);
    if (m == null) continue;
    const key = s.category ?? 'OTHER';
    map.set(key, (map.get(key) ?? 0) + m);
  }
  return [...map.entries()]
    .map(([category, monthly]) => ({ category, monthly }))
    .sort((a, b) => b.monthly - a.monthly);
}
