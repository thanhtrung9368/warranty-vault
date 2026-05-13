// Regression test for GET /api/v1/stats.
//
// Usage (assumes `npm run dev` or `npm run start` is already running on
// http://localhost:3000):
//
//   node scripts/test-stats.mjs
//
// Equivalent curl flow this exercises:
//   1) curl -X POST :3000/api/v1/auth/login -d '{...}'  → accessToken
//   2) curl :3000/api/v1/stats -H "authorization: Bearer $TOKEN"
//      → {
//          devices: { total, byStatus, totalPurchasePrice },
//          subscriptions: { total, byStatus, totalMonthlyVnd },
//          wishlist: { total, byStatus, totalCurrentPriceWatching }
//        }
//
// Talks to the dev DB. Cleans up via cascade delete of the scoped test user
// (`__statstest__@local.test`) so it's safe to re-run.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { hash } from 'bcrypt-ts';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) {
  console.error('DATABASE_URL not set — copy .env.example to .env first.');
  process.exit(1);
}

const BASE = process.env.WV_BASE_URL ?? 'http://localhost:3000';
const TEST_EMAIL = '__statstest__@local.test';
const TEST_PW = 'stats-test-pw-12345';

const adapter = new PrismaPg({ connectionString: DB_URL });
const prisma = new PrismaClient({ adapter });

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function cleanup() {
  const u = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
  if (u) await prisma.user.delete({ where: { id: u.id } });
}

async function login() {
  const res = await fetch(`${BASE}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PW, platform: 'web' }),
  });
  if (res.status !== 200) {
    const body = await res.text();
    throw new Error(`login failed: ${res.status} — ${body}`);
  }
  const body = await res.json();
  return body.accessToken;
}

async function getStats(token) {
  const res = await fetch(`${BASE}/api/v1/stats`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

async function pingServer() {
  try {
    const res = await fetch(`${BASE}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    return res.status >= 200 && res.status < 600;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`→ Server check: ${BASE}`);
  if (!(await pingServer())) {
    throw new Error(
      `Server not reachable at ${BASE}. Start it with \`npm run dev\` (or \`npm run start\`) first.`,
    );
  }
  console.log('  ✓ server is up');

  console.log('→ Cleanup any prior test data');
  await cleanup();

  console.log('→ Seed test user + fixtures');
  const passwordHash = await hash(TEST_PW, 12);
  const user = await prisma.user.create({
    data: { email: TEST_EMAIL, passwordHash, name: 'Stats Test' },
  });

  // 3 devices: 2 ACTIVE + 1 SOLD. totalPurchasePrice = 30M + 20M + 10M = 60M
  await prisma.device.createMany({
    data: [
      {
        userId: user.id,
        name: 'MBP M4',
        category: 'LAPTOP',
        purchaseDate: new Date('2025-06-01'),
        purchasePrice: 30_000_000,
        status: 'ACTIVE',
      },
      {
        userId: user.id,
        name: 'iPhone 16',
        category: 'PHONE',
        purchaseDate: new Date('2025-09-15'),
        purchasePrice: 20_000_000,
        status: 'ACTIVE',
      },
      {
        userId: user.id,
        name: 'Old iPad',
        category: 'TABLET',
        purchaseDate: new Date('2022-01-01'),
        purchasePrice: 10_000_000,
        status: 'SOLD',
      },
    ],
  });

  // Subscriptions: 1 monthly active (480k), 1 yearly active (1.2M → 100k/mo),
  // 1 LIFETIME active (excluded from monthly), 1 paused (excluded from monthly).
  // totalMonthlyVnd = 480_000 + floor(1_200_000 / 12) = 480_000 + 100_000 = 580_000.
  await prisma.subscription.createMany({
    data: [
      {
        userId: user.id,
        name: 'ChatGPT Plus',
        billingCycle: 'MONTHLY',
        price: 480_000,
        startedAt: new Date('2026-01-01'),
        renewalDate: new Date('2026-06-01'),
        status: 'ACTIVE',
      },
      {
        userId: user.id,
        name: 'Hosting',
        billingCycle: 'YEARLY',
        price: 1_200_000,
        startedAt: new Date('2026-01-01'),
        renewalDate: new Date('2027-01-01'),
        status: 'ACTIVE',
      },
      {
        userId: user.id,
        name: 'Lifetime Tool',
        billingCycle: 'LIFETIME',
        price: 5_000_000,
        startedAt: new Date('2025-01-01'),
        renewalDate: new Date('2125-01-01'),
        status: 'ACTIVE',
      },
      {
        userId: user.id,
        name: 'Paused Spotify',
        billingCycle: 'MONTHLY',
        price: 59_000,
        startedAt: new Date('2025-01-01'),
        renewalDate: new Date('2026-06-01'),
        status: 'PAUSED',
      },
    ],
  });

  // Wishlist: 2 WATCHING + 1 DECIDED + 1 SKIPPED.
  // totalCurrentPriceWatching aggregates WATCHING+DECIDED only:
  //   8_500_000 + 14_500_000 + 25_000_000 = 48_000_000.
  await prisma.wishlistItem.createMany({
    data: [
      {
        userId: user.id,
        name: 'Sony WH-1000XM6',
        currentPrice: 8_500_000,
        status: 'WATCHING',
        priority: 'WANT',
      },
      {
        userId: user.id,
        name: 'iPad mini 7',
        currentPrice: 14_500_000,
        status: 'WATCHING',
        priority: 'MAYBE',
      },
      {
        userId: user.id,
        name: 'New iMac',
        currentPrice: 25_000_000,
        status: 'DECIDED',
        priority: 'MUST',
      },
      {
        userId: user.id,
        name: 'AirPods Max',
        currentPrice: 12_000_000,
        status: 'SKIPPED',
        priority: 'MAYBE',
      },
    ],
  });

  console.log('\n→ Login → bearer token');
  const token = await login();
  assert(typeof token === 'string' && token.length > 0, 'got accessToken');

  console.log('\n→ GET /api/v1/stats');
  const { status, body } = await getStats(token);
  assert(status === 200, `stats returns 200 (got ${status})`);

  console.log('\n→ Devices totals');
  assert(body.devices.total === 3, `devices.total = 3 (got ${body.devices.total})`);
  assert(body.devices.byStatus.ACTIVE === 2, 'devices.byStatus.ACTIVE = 2');
  assert(body.devices.byStatus.SOLD === 1, 'devices.byStatus.SOLD = 1');
  assert(body.devices.byStatus.EXPIRED === 0, 'devices.byStatus.EXPIRED = 0');
  assert(
    body.devices.totalPurchasePrice === 60_000_000,
    `devices.totalPurchasePrice = 60M (got ${body.devices.totalPurchasePrice})`,
  );

  console.log('\n→ Subscriptions totals');
  assert(body.subscriptions.total === 4, `subscriptions.total = 4 (got ${body.subscriptions.total})`);
  assert(body.subscriptions.byStatus.ACTIVE === 3, 'subscriptions.byStatus.ACTIVE = 3');
  assert(body.subscriptions.byStatus.PAUSED === 1, 'subscriptions.byStatus.PAUSED = 1');
  assert(
    body.subscriptions.totalMonthlyVnd === 580_000,
    `subscriptions.totalMonthlyVnd = 580k (got ${body.subscriptions.totalMonthlyVnd})`,
  );

  console.log('\n→ Wishlist totals');
  assert(body.wishlist.total === 4, `wishlist.total = 4 (got ${body.wishlist.total})`);
  assert(body.wishlist.byStatus.WATCHING === 2, 'wishlist.byStatus.WATCHING = 2');
  assert(body.wishlist.byStatus.DECIDED === 1, 'wishlist.byStatus.DECIDED = 1');
  assert(body.wishlist.byStatus.SKIPPED === 1, 'wishlist.byStatus.SKIPPED = 1');
  assert(body.wishlist.byStatus.PURCHASED === 0, 'wishlist.byStatus.PURCHASED = 0');
  assert(
    body.wishlist.totalCurrentPriceWatching === 48_000_000,
    `wishlist.totalCurrentPriceWatching = 48M (got ${body.wishlist.totalCurrentPriceWatching})`,
  );

  console.log('\n→ Unauthenticated request → 401');
  const noAuth = await fetch(`${BASE}/api/v1/stats`);
  assert(noAuth.status === 401, `unauthenticated returns 401 (got ${noAuth.status})`);

  console.log('\n→ Cleanup');
  await cleanup();
  console.log('\n✅ ALL STATS TESTS PASSED');
}

main()
  .catch((e) => {
    console.error('\n❌ FAIL:', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
