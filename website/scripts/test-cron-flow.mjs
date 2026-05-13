// Regression test for the cron flow: subscription auto-bill + EXPIRED transition,
// wishlist target-date pings, wishlist periodic pings.
//
// Mirrors the queries + transformations in src/app/api/cron/warranty-check/route.ts.
// If the route's logic drifts, update both. Run with:
//   node scripts/test-cron-flow.mjs
//
// Uses an isolated postgres DB (warranty_vault_test by default). Override with
// TEST_DATABASE_URL. Each run cleans up its scoped test user via cleanup() —
// schema push is idempotent so we don't need --force-reset.
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL?.replace(/\/[^/]+(\?|$)/, '/warranty_vault_test$1') ??
  'postgresql://localhost:5432/warranty_vault_test';
process.env.DATABASE_URL = TEST_DB_URL;

execSync('npx prisma db push --schema=prisma/schema.prisma --accept-data-loss', {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: TEST_DB_URL },
});

const adapter = new PrismaPg({ connectionString: TEST_DB_URL });
const prisma = new PrismaClient({ adapter });

const TEST_EMAIL = '__cron_test__@local.test';

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

// Mirror of nextRenewalDate() in src/lib/subscription-types.ts.
function nextRenewalDate(from, cycle, intervalDays) {
  const next = new Date(from);
  if (cycle === 'MONTHLY') next.setMonth(next.getMonth() + 1);
  else if (cycle === 'QUARTERLY') next.setMonth(next.getMonth() + 3);
  else if (cycle === 'YEARLY') next.setFullYear(next.getFullYear() + 1);
  else if (cycle === 'CUSTOM' && intervalDays && intervalDays > 0) {
    next.setDate(next.getDate() + intervalDays);
  } else if (cycle === 'LIFETIME') {
    next.setFullYear(next.getFullYear() + 100);
  }
  return next;
}

function dayWindow(daysFromNow) {
  const start = new Date();
  start.setDate(start.getDate() + daysFromNow);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 1);
  return { start, end };
}

const WISHLIST_ACTIVE_STATUSES = ['WATCHING', 'DECIDED'];

async function cleanup() {
  const u = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
  if (u) await prisma.user.delete({ where: { id: u.id } });
}

async function main() {
  console.log('→ Cleanup any prior test data');
  await cleanup();

  console.log('→ Seed test user + fixtures');
  const user = await prisma.user.create({
    data: { email: TEST_EMAIL, passwordHash: 'x', name: 'Cron Test' },
  });

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  yesterday.setHours(12, 0, 0, 0);

  const subAuto = await prisma.subscription.create({
    data: {
      userId: user.id,
      name: 'ChatGPT Plus',
      billingCycle: 'MONTHLY',
      price: 480000,
      startedAt: new Date('2026-01-01'),
      renewalDate: yesterday,
      autoRenew: true,
      status: 'ACTIVE',
    },
  });

  const subManual = await prisma.subscription.create({
    data: {
      userId: user.id,
      name: 'Old Hosting Plan',
      billingCycle: 'YEARLY',
      price: 1200000,
      startedAt: new Date('2025-04-29'),
      renewalDate: yesterday,
      autoRenew: false,
      status: 'ACTIVE',
    },
  });

  const subLifetime = await prisma.subscription.create({
    data: {
      userId: user.id,
      name: 'Lifetime Deal',
      billingCycle: 'LIFETIME',
      price: 5000000,
      startedAt: new Date('2025-01-01'),
      renewalDate: new Date('2125-01-01'),
      autoRenew: true,
      status: 'ACTIVE',
    },
  });

  const todayMid = new Date();
  todayMid.setHours(12, 0, 0, 0);

  const wlToday = await prisma.wishlistItem.create({
    data: {
      userId: user.id,
      name: 'Sony WH-1000XM6',
      currentPrice: 8500000,
      targetDate: todayMid,
      status: 'WATCHING',
      priority: 'WANT',
    },
  });

  const eightDaysAgo = new Date();
  eightDaysAgo.setDate(eightDaysAgo.getDate() - 8);
  const wlInterval = await prisma.wishlistItem.create({
    data: {
      userId: user.id,
      name: 'iPad mini 7',
      currentPrice: 14500000,
      reminderIntervalDays: 7,
      lastNotifiedAt: eightDaysAgo,
      status: 'WATCHING',
      priority: 'MAYBE',
    },
  });

  // ─── Replicate the cron's auto-bill loop ────────────────────────────────
  console.log('\n→ Run subscription overdue/auto-bill flow');
  const overdue = await prisma.subscription.findMany({
    where: {
      status: 'ACTIVE',
      renewalDate: { lt: dayWindow(0).start },
      billingCycle: { not: 'LIFETIME' },
    },
  });
  assert(overdue.length === 2, 'cron sees 2 overdue subs (auto + manual), skips LIFETIME');
  assert(overdue.find((s) => s.id === subLifetime.id) === undefined, 'LIFETIME excluded');

  const now = new Date();
  for (const s of overdue) {
    if (s.autoRenew) {
      const next = nextRenewalDate(s.renewalDate, s.billingCycle, s.intervalDays);
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
    } else {
      await prisma.subscription.update({
        where: { id: s.id },
        data: { status: 'EXPIRED' },
      });
    }
  }

  console.log('\n→ Verify subscription side-effects');
  const subAutoAfter = await prisma.subscription.findUnique({ where: { id: subAuto.id } });
  const payments = await prisma.subscriptionPayment.findMany({
    where: { subscriptionId: subAuto.id },
  });
  assert(payments.length === 1, 'auto-renew sub has 1 payment row');
  assert(payments[0].amount === 480000, 'payment amount matches sub price');
  assert(payments[0].note === 'Auto-renew', 'payment note tagged Auto-renew');
  assert(
    subAutoAfter.renewalDate.getTime() > yesterday.getTime(),
    'auto-renew sub renewalDate advanced past old yesterday',
  );
  // Monthly cycle from yesterday → ~28-31 days forward.
  const advancedDays = Math.round(
    (subAutoAfter.renewalDate.getTime() - yesterday.getTime()) / 86_400_000,
  );
  assert(advancedDays >= 28 && advancedDays <= 31, `advanced ~1 month (got ${advancedDays}d)`);

  const subManualAfter = await prisma.subscription.findUnique({ where: { id: subManual.id } });
  assert(subManualAfter.status === 'EXPIRED', 'autoRenew=false flips to EXPIRED');
  const subLifetimeAfter = await prisma.subscription.findUnique({ where: { id: subLifetime.id } });
  assert(subLifetimeAfter.status === 'ACTIVE', 'LIFETIME stays ACTIVE');

  // ─── Wishlist target-date pings ────────────────────────────────────────
  console.log('\n→ Run wishlist target-date scan (today bucket)');
  const todayWindow = dayWindow(0);
  const wlDueToday = await prisma.wishlistItem.findMany({
    where: {
      status: { in: WISHLIST_ACTIVE_STATUSES },
      targetDate: { gte: todayWindow.start, lt: todayWindow.end },
    },
  });
  assert(wlDueToday.length === 1, 'one wishlist item due today');
  assert(wlDueToday[0].id === wlToday.id, 'matches expected item');
  await prisma.wishlistItem.update({
    where: { id: wlToday.id },
    data: { lastNotifiedAt: now },
  });
  const wlTodayAfter = await prisma.wishlistItem.findUnique({ where: { id: wlToday.id } });
  assert(wlTodayAfter.lastNotifiedAt !== null, 'lastNotifiedAt stamped after target ping');

  // ─── Wishlist periodic interval pings ──────────────────────────────────
  console.log('\n→ Run wishlist periodic-interval scan');
  const dueCandidates = await prisma.wishlistItem.findMany({
    where: {
      status: { in: WISHLIST_ACTIVE_STATUSES },
      reminderIntervalDays: { not: null },
    },
  });
  let pinged = 0;
  for (const it of dueCandidates) {
    const last = it.lastNotifiedAt ?? it.createdAt;
    const elapsed = now.getTime() - last.getTime();
    if (elapsed < it.reminderIntervalDays * 86_400_000) continue;
    await prisma.wishlistItem.update({
      where: { id: it.id },
      data: { lastNotifiedAt: now },
    });
    pinged++;
  }
  assert(pinged === 1, 'periodic ping fires for 8-days-stale item');
  const wlIntervalAfter = await prisma.wishlistItem.findUnique({ where: { id: wlInterval.id } });
  assert(
    wlIntervalAfter.lastNotifiedAt.getTime() > eightDaysAgo.getTime(),
    'lastNotifiedAt bumped forward',
  );

  // ─── Re-running the periodic scan should NOT re-fire (just stamped) ────
  console.log('\n→ Re-run periodic scan (idempotent within one window)');
  const dueAgain = await prisma.wishlistItem.findMany({
    where: {
      status: { in: WISHLIST_ACTIVE_STATUSES },
      reminderIntervalDays: { not: null },
    },
  });
  let pingedAgain = 0;
  const now2 = new Date();
  for (const it of dueAgain) {
    const last = it.lastNotifiedAt ?? it.createdAt;
    if (now2.getTime() - last.getTime() < it.reminderIntervalDays * 86_400_000) continue;
    pingedAgain++;
  }
  assert(pingedAgain === 0, 'second run finds nothing due (within interval)');

  console.log('\n→ Cleanup');
  await cleanup();
  console.log('\n✅ ALL CRON-FLOW TESTS PASSED');
}

main()
  .catch((e) => {
    console.error('\n❌ FAIL:', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
