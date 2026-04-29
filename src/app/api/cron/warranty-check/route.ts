import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { sendPush } from '@/lib/push';
import { WARRANTY_TYPE_LABELS, type WarrantyType } from '@/lib/types';
import { WISHLIST_ACTIVE_STATUSES } from '@/lib/wishlist-types';
import {
  nextRenewalDate,
  type BillingCycle,
} from '@/lib/subscription-types';
import { formatVND } from '@/lib/format';

export const dynamic = 'force-dynamic';

const WARRANTY_BUCKETS = [
  { days: 7, tag: 'wv-7' },
  { days: 30, tag: 'wv-30' },
] as const;

const WISHLIST_BUCKETS = [
  { days: 0, tag: 'wl-d0' },   // hôm nay
  { days: 7, tag: 'wl-d7' },   // 1 tuần nữa
  { days: 30, tag: 'wl-d30' }, // 1 tháng nữa
] as const;

function dayWindow(daysFromNow: number) {
  const start = new Date();
  start.setDate(start.getDate() + daysFromNow);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return { start, end };
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET chưa set' }, { status: 500 });
  }

  // Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`. Also accept `?secret=` for local curl.
  const auth = req.headers.get('authorization');
  const queryToken = req.nextUrl.searchParams.get('secret');
  const authorized = auth === `Bearer ${secret}` || queryToken === secret;
  if (!authorized) {
    return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  let warrantySent = 0;
  let wishlistSent = 0;
  let totalGone = 0;
  const perUser: Record<string, number> = {};

  // ─── Warranty buckets ──────────────────────────────────────────────────
  for (const bucket of WARRANTY_BUCKETS) {
    const { start, end } = dayWindow(bucket.days - 1);

    const warranties = await prisma.warranty.findMany({
      where: {
        device: { status: 'ACTIVE' },
        endDate: { gte: start, lt: end },
      },
      include: {
        device: { include: { user: { include: { subscriptions: true } } } },
        reminders: { where: { isDismissed: true } },
      },
    });

    for (const w of warranties) {
      if (w.reminders.length > 0) continue; // user dismissed
      const subs = w.device.user.subscriptions;
      if (subs.length === 0) continue;

      const typeLabel = WARRANTY_TYPE_LABELS[w.type as WarrantyType] ?? w.type;
      const payload = {
        title: `BH ${typeLabel} của "${w.device.name}" sắp hết trong ${bucket.days} ngày`,
        body: `Hết hạn: ${w.endDate.toLocaleDateString('vi-VN')}${w.provider ? ` • ${w.provider}` : ''}`,
        url: `/devices/${w.deviceId}`,
        tag: `${bucket.tag}-${w.id}`,
      };

      for (const s of subs) {
        const res = await sendPush(s, payload);
        if (res.ok) {
          warrantySent++;
          perUser[w.device.userId] = (perUser[w.device.userId] ?? 0) + 1;
        }
        if (res.gone) {
          await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => void 0);
          totalGone++;
        }
      }
    }
  }

  // ─── Wishlist target-date buckets ─────────────────────────────────────
  for (const bucket of WISHLIST_BUCKETS) {
    const { start, end } = dayWindow(bucket.days);

    const items = await prisma.wishlistItem.findMany({
      where: {
        status: { in: WISHLIST_ACTIVE_STATUSES },
        targetDate: { gte: start, lt: end },
      },
      include: { user: { include: { subscriptions: true } } },
    });

    for (const it of items) {
      const subs = it.user.subscriptions;
      if (subs.length === 0) continue;

      const priceText = it.currentPrice
        ? ` • ${formatVND(it.currentPrice)}`
        : it.initialPrice
          ? ` • ~${formatVND(it.initialPrice)}`
          : '';
      const headline =
        bucket.days === 0
          ? `🛍️ Hôm nay là ngày dự kiến mua "${it.name}"`
          : `🛍️ Còn ${bucket.days} ngày tới ngày mua "${it.name}"`;

      const payload = {
        title: headline,
        body: `Check lại giá nhé${priceText}`,
        url: `/wishlist/${it.id}`,
        tag: `${bucket.tag}-${it.id}`,
      };

      for (const s of subs) {
        const res = await sendPush(s, payload);
        if (res.ok) {
          wishlistSent++;
          perUser[it.userId] = (perUser[it.userId] ?? 0) + 1;
        }
        if (res.gone) {
          await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => void 0);
          totalGone++;
        }
      }
      await prisma.wishlistItem.update({
        where: { id: it.id },
        data: { lastNotifiedAt: now },
      });
    }
  }

  // ─── Wishlist periodic price-check pings ───────────────────────────────
  // Pull active items with reminderIntervalDays set; SQLite lacks date
  // arithmetic in WHERE, so filter the elapsed days client-side. Item count
  // is small (≤200/user) so this is cheap.
  const dueCandidates = await prisma.wishlistItem.findMany({
    where: {
      status: { in: WISHLIST_ACTIVE_STATUSES },
      reminderIntervalDays: { not: null },
    },
    include: { user: { include: { subscriptions: true } } },
  });

  for (const it of dueCandidates) {
    const interval = it.reminderIntervalDays!;
    const last = it.lastNotifiedAt ?? it.createdAt;
    const elapsedMs = now.getTime() - last.getTime();
    if (elapsedMs < interval * 86_400_000) continue;

    const subs = it.user.subscriptions;
    if (subs.length === 0) continue;

    const priceText = it.currentPrice
      ? ` • giá hiện tại ${formatVND(it.currentPrice)}`
      : '';

    const payload = {
      title: `🔔 Đã ${interval} ngày chưa update giá "${it.name}"`,
      body: `Còn thèm không? Check lại giá nhé${priceText}.`,
      url: `/wishlist/${it.id}`,
      tag: `wl-int-${it.id}`,
    };

    for (const s of subs) {
      const res = await sendPush(s, payload);
      if (res.ok) {
        wishlistSent++;
        perUser[it.userId] = (perUser[it.userId] ?? 0) + 1;
      }
      if (res.gone) {
        await prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => void 0);
        totalGone++;
      }
    }
    await prisma.wishlistItem.update({
      where: { id: it.id },
      data: { lastNotifiedAt: now },
    });
  }

  // ─── Subscription renewal warnings (3 / 1 / 0 days) ───────────────────
  let subSent = 0;
  const SUB_BUCKETS = [
    { days: 3, tag: 'sub-d3' },
    { days: 1, tag: 'sub-d1' },
    { days: 0, tag: 'sub-d0' },
  ] as const;
  for (const bucket of SUB_BUCKETS) {
    const { start, end } = dayWindow(bucket.days);
    const subs = await prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        renewalDate: { gte: start, lt: end },
        billingCycle: { not: 'LIFETIME' },
      },
      include: { user: { include: { subscriptions: true } } },
    });
    for (const s of subs) {
      const pushSubs = s.user.subscriptions;
      if (pushSubs.length === 0) continue;

      const verb = s.autoRenew ? 'sẽ tự gia hạn' : 'sẽ hết hạn';
      const head =
        bucket.days === 0
          ? `💸 Hôm nay ${verb}: "${s.name}"`
          : `💸 Còn ${bucket.days} ngày ${verb}: "${s.name}"`;
      const payload = {
        title: head,
        body: `${formatVND(s.price)} • ${s.brand ?? ''}${s.cancelUrl ? ' • có link huỷ' : ''}`,
        url: `/subscriptions/${s.id}`,
        tag: `${bucket.tag}-${s.id}`,
      };
      for (const ps of pushSubs) {
        const res = await sendPush(ps, payload);
        if (res.ok) {
          subSent++;
          perUser[s.userId] = (perUser[s.userId] ?? 0) + 1;
        }
        if (res.gone) {
          await prisma.pushSubscription.delete({ where: { id: ps.id } }).catch(() => void 0);
          totalGone++;
        }
      }
    }
  }

  // ─── Subscription auto-bill: renewalDate < today ──────────────────────
  // For ACTIVE + autoRenew + non-LIFETIME subs whose renewalDate has passed,
  // append a payment + bump renewalDate forward. For autoRenew=false we just
  // flip status to EXPIRED.
  const overdue = await prisma.subscription.findMany({
    where: {
      status: 'ACTIVE',
      renewalDate: { lt: dayWindow(0).start },
      billingCycle: { not: 'LIFETIME' },
    },
    include: { user: { include: { subscriptions: true } } },
  });
  for (const s of overdue) {
    if (s.autoRenew) {
      const next = nextRenewalDate(
        s.renewalDate,
        s.billingCycle as BillingCycle,
        s.intervalDays,
      );
      await prisma.$transaction([
        prisma.subscriptionPayment.create({
          data: {
            subscriptionId: s.id,
            amount: s.price,
            paidAt: s.renewalDate,
            note: 'Auto-renew',
          },
        }),
        prisma.subscription.update({
          where: { id: s.id },
          data: { renewalDate: next, lastNotifiedRenewalAt: now },
        }),
      ]);
      const pushSubs = s.user.subscriptions;
      const payload = {
        title: `✅ Đã gia hạn "${s.name}"`,
        body: `Tự động charge ${formatVND(s.price)}. Kỳ tới: ${next.toLocaleDateString('vi-VN')}`,
        url: `/subscriptions/${s.id}`,
        tag: `sub-billed-${s.id}-${s.renewalDate.getTime()}`,
      };
      for (const ps of pushSubs) {
        const res = await sendPush(ps, payload);
        if (res.ok) {
          subSent++;
          perUser[s.userId] = (perUser[s.userId] ?? 0) + 1;
        }
        if (res.gone) {
          await prisma.pushSubscription.delete({ where: { id: ps.id } }).catch(() => void 0);
          totalGone++;
        }
      }
    } else {
      await prisma.subscription.update({
        where: { id: s.id },
        data: { status: 'EXPIRED' },
      });
      const pushSubs = s.user.subscriptions;
      const payload = {
        title: `⌛️ Gói "${s.name}" đã hết hạn`,
        body: `Không tự gia hạn — đăng ký lại hoặc đánh dấu huỷ.`,
        url: `/subscriptions/${s.id}`,
        tag: `sub-expired-${s.id}`,
      };
      for (const ps of pushSubs) {
        const res = await sendPush(ps, payload);
        if (res.ok) {
          subSent++;
          perUser[s.userId] = (perUser[s.userId] ?? 0) + 1;
        }
        if (res.gone) {
          await prisma.pushSubscription.delete({ where: { id: ps.id } }).catch(() => void 0);
          totalGone++;
        }
      }
    }
  }

  return NextResponse.json({
    ok: true,
    checkedAt: now.toISOString(),
    warrantySent,
    wishlistSent,
    subscriptionSent: subSent,
    sent: warrantySent + wishlistSent + subSent,
    removedSubscriptions: totalGone,
    perUser,
  });
}
