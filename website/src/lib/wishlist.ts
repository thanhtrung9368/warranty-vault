import { prisma } from '@/lib/prisma';
import {
  WISHLIST_ACTIVE_STATUSES,
  WISHLIST_PRIORITIES,
  WISHLIST_PRIORITY_RANK,
  WISHLIST_STATUSES,
  type WishlistPriority,
  type WishlistStatus,
} from '@/lib/wishlist-types';

export type WishlistFilter = {
  q?: string;
  category?: string;
  status?: string; // 'ACTIVE' (= WATCHING+DECIDED, default), 'ALL', or specific status
  priority?: string;
  sort?: 'target' | 'priority' | 'recent' | 'price';
  dir?: 'asc' | 'desc';
};

export async function listWishlist(userId: string, filter: WishlistFilter = {}) {
  const {
    q,
    category,
    status = 'ACTIVE',
    priority,
    sort = 'priority',
    dir = 'asc',
  } = filter;

  const where: Record<string, unknown> = { userId };
  if (q?.trim()) {
    const term = q.trim();
    where.OR = [
      { name: { contains: term } },
      { brand: { contains: term } },
      { notes: { contains: term } },
    ];
  }
  if (category) where.category = category;
  if (status === 'ALL') {
    // no status filter
  } else if (status === 'ACTIVE') {
    where.status = { in: WISHLIST_ACTIVE_STATUSES };
  } else if ((WISHLIST_STATUSES as readonly string[]).includes(status)) {
    where.status = status;
  }
  if (priority && (WISHLIST_PRIORITIES as readonly string[]).includes(priority)) {
    where.priority = priority;
  }

  const items = await prisma.wishlistItem.findMany({
    where,
    orderBy:
      sort === 'recent'
        ? { createdAt: dir }
        : sort === 'price'
          ? { currentPrice: dir }
          : sort === 'target'
            ? { targetDate: dir }
            // priority sort happens client-side (priority is a free-form
            // string column, not an enum); fall back to createdAt for the
            // DB-side ordering.
            : { createdAt: 'desc' },
    include: {
      _count: { select: { prices: true } },
      purchasedDevice: { select: { id: true, name: true } },
    },
  });

  if (sort === 'priority') {
    items.sort((a, b) => {
      const ra = WISHLIST_PRIORITY_RANK[a.priority as WishlistPriority] ?? 99;
      const rb = WISHLIST_PRIORITY_RANK[b.priority as WishlistPriority] ?? 99;
      if (ra !== rb) return dir === 'asc' ? ra - rb : rb - ra;
      // secondary: target date asc (sooner first)
      const ta = a.targetDate ? a.targetDate.getTime() : Number.POSITIVE_INFINITY;
      const tb = b.targetDate ? b.targetDate.getTime() : Number.POSITIVE_INFINITY;
      return ta - tb;
    });
  }

  return items;
}

export async function getWishlistItem(userId: string, id: string) {
  return prisma.wishlistItem.findFirst({
    where: { id, userId },
    include: {
      prices: { orderBy: { recordedAt: 'asc' } },
      purchasedDevice: { select: { id: true, name: true } },
    },
  });
}

export async function wishlistTotals(userId: string) {
  const items = await prisma.wishlistItem.findMany({
    where: { userId, status: { in: WISHLIST_ACTIVE_STATUSES } },
    select: {
      id: true,
      name: true,
      currentPrice: true,
      initialPrice: true,
      targetDate: true,
      priority: true,
      status: true,
    },
  });
  const totalPrice = items.reduce(
    (sum, i) => sum + (i.currentPrice ?? i.initialPrice ?? 0),
    0,
  );
  const sorted = items
    .filter((i) => i.targetDate)
    .sort(
      (a, b) =>
        (a.targetDate?.getTime() ?? 0) - (b.targetDate?.getTime() ?? 0),
    );
  return {
    count: items.length,
    totalPrice,
    upcoming: sorted.slice(0, 3),
    items,
  };
}

export type WishlistStatusKey = WishlistStatus;
