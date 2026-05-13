// Quick smoke test for the Warranty refactor: exercises lib/devices, lib/queries,
// lib/reminders, lib/stats by mirroring the same Prisma queries directly.
// Run after seeding: `node scripts/test-warranty-refactor.mjs`.
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString =
  process.env.DATABASE_URL ?? 'postgresql://localhost:5432/warranty_vault_dev';
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const user = await prisma.user.findUnique({ where: { email: 'test@local.test' } });
if (!user) {
  console.error('Không tìm thấy test user');
  process.exit(1);
}

function effectiveEnd(warranties) {
  if (!warranties.length) return null;
  return warranties.reduce((m, w) => (m && m > w.endDate ? m : w.endDate), null);
}

// 1. listDevices
const list = await prisma.device.findMany({
  where: { userId: user.id },
  include: {
    _count: { select: { attachments: true } },
    warranties: { select: { endDate: true } },
  },
});
console.log(`listDevices: ${list.length} rows`);
console.log(`  với warranty: ${list.filter((d) => d.warranties.length > 0).length}`);
console.log(`  không warranty: ${list.filter((d) => d.warranties.length === 0).length}`);

// 2. dashboardStats logic
const now = new Date();
const in30 = new Date();
in30.setDate(now.getDate() + 30);

let active = 0;
let soon = 0;
let expired = 0;
const soonItems = [];
for (const d of list) {
  const end = effectiveEnd(d.warranties);
  if (!end) continue;
  if (d.status === 'ACTIVE' && end > now) active++;
  if (end < now) expired++;
  if (d.status === 'ACTIVE' && end > now && end <= in30) {
    soon++;
    soonItems.push({ name: d.name, end });
  }
}
console.log(`dashboardStats: active=${active}, soon=${soon}, expired=${expired}`);
console.log(`  soonList:`, soonItems.map((x) => `${x.name} (${x.end.toISOString().slice(0, 10)})`).join(', '));

// 3. getReminders
const recentlyExpired = new Date();
recentlyExpired.setDate(now.getDate() - 30);
const in90 = new Date();
in90.setDate(now.getDate() + 90);
const reminders = await prisma.warranty.findMany({
  where: {
    device: { userId: user.id, status: 'ACTIVE' },
    endDate: { gte: recentlyExpired, lte: in90 },
  },
  orderBy: { endDate: 'asc' },
  include: { device: { select: { name: true } } },
});
console.log(`getReminders: ${reminders.length} warranties trong window 90d`);
for (const w of reminders) {
  const days = Math.round((w.endDate.getTime() - now.getTime()) / 86400000);
  console.log(`  ${w.device.name} (${w.type}, ${w.provider ?? '—'}): ${days >= 0 ? '+' : ''}${days}d`);
}

// 4. countActiveReminders (≤30d window)
const r30 = await prisma.warranty.findMany({
  where: {
    device: { userId: user.id, status: 'ACTIVE' },
    endDate: { gte: now, lte: in30 },
  },
  select: { id: true, reminders: { where: { isDismissed: true }, select: { id: true } } },
});
const undismissedSoon = r30.filter((w) => w.reminders.length === 0).length;
console.log(`countActiveReminders (≤30d, chưa dismiss): ${undismissedSoon}`);

// 5. activeAssetValue
const assetDevices = await prisma.device.findMany({
  where: { userId: user.id, status: 'ACTIVE', warranties: { some: { endDate: { gt: now } } } },
  select: { purchasePrice: true },
});
const assetTotal = assetDevices.reduce((s, d) => s + d.purchasePrice, 0);
console.log(`activeAssetValue: ${assetDevices.length} devices, total=${assetTotal.toLocaleString('vi-VN')}đ`);

await prisma.$disconnect();
