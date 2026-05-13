// Round-trip test for backup export/import (v5 format).
// Mirrors logic in src/app/actions/backup.ts. Update both when schema drifts.
//
//   node scripts/test-backup-restore.mjs
//
// Uses an isolated postgres DB (warranty_vault_test by default). Override with
// TEST_DATABASE_URL. Each run cleans up its scoped test user via cleanup() —
// schema push is idempotent so we don't need --force-reset.
import 'dotenv/config';
import { execSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

// Reset the dedicated test DB. Override TEST_DATABASE_URL for non-default
// hosts/users (e.g. CI). Default assumes a local postgres listening on 5432
// with a `warranty_vault_test` database the current OS user can write to.
const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  process.env.DATABASE_URL?.replace(/\/[^/]+(\?|$)/, '/warranty_vault_test$1') ??
  'postgresql://localhost:5432/warranty_vault_test';
process.env.DATABASE_URL = TEST_DB_URL;

// Sync schema (idempotent — first run creates tables, later runs are no-ops).
// Cleanup() deletes the scoped test user, which cascades through all owned rows.
execSync('npx prisma db push --schema=prisma/schema.prisma --accept-data-loss', {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: TEST_DB_URL },
});

const adapter = new PrismaPg({ connectionString: TEST_DB_URL });
const prisma = new PrismaClient({ adapter });

const TEST_EMAIL = '__backup_test__@local.test';

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

const SAFE_ID = /^[a-z0-9_-]+$/i;
const SAFE_STORAGE_PATH = /^[a-z0-9_-]+\/[a-z0-9-]+\.enc$/i;

async function exportForUser(userId) {
  const [devices, wishlist, subs] = await Promise.all([
    prisma.device.findMany({
      where: { userId },
      include: {
        attachments: true,
        warranties: { include: { reminders: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.wishlistItem.findMany({
      where: { userId },
      include: { prices: { orderBy: { recordedAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.subscription.findMany({
      where: { userId },
      include: { payments: { orderBy: { paidAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  return {
    version: 5,
    exportedAt: new Date().toISOString(),
    subscriptions: subs.map((s) => ({
      id: s.id,
      name: s.name,
      category: s.category,
      brand: s.brand,
      plan: s.plan,
      billingCycle: s.billingCycle,
      intervalDays: s.intervalDays,
      price: s.price,
      currency: s.currency,
      startedAt: s.startedAt.toISOString(),
      renewalDate: s.renewalDate.toISOString(),
      autoRenew: s.autoRenew,
      status: s.status,
      accountEmail: s.accountEmail,
      paymentMethod: s.paymentMethod,
      manageUrl: s.manageUrl,
      cancelUrl: s.cancelUrl,
      notes: s.notes,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      payments: s.payments.map((p) => ({
        id: p.id,
        amount: p.amount,
        paidAt: p.paidAt.toISOString(),
        note: p.note,
      })),
    })),
    wishlist: wishlist.map((w) => ({
      id: w.id,
      name: w.name,
      category: w.category,
      brand: w.brand,
      initialPrice: w.initialPrice,
      currentPrice: w.currentPrice,
      buyUrl: w.buyUrl,
      imageUrl: w.imageUrl,
      targetDate: w.targetDate?.toISOString() ?? null,
      priority: w.priority,
      status: w.status,
      notes: w.notes,
      reminderIntervalDays: w.reminderIntervalDays,
      lastNotifiedAt: w.lastNotifiedAt?.toISOString() ?? null,
      purchasedDeviceId: w.purchasedDeviceId,
      createdAt: w.createdAt.toISOString(),
      updatedAt: w.updatedAt.toISOString(),
      prices: w.prices.map((p) => ({
        id: p.id,
        price: p.price,
        note: p.note,
        recordedAt: p.recordedAt.toISOString(),
      })),
    })),
    devices: devices.map((d) => ({
      id: d.id,
      name: d.name,
      category: d.category,
      brand: d.brand,
      model: d.model,
      serialNumber: d.serialNumber,
      purchaseDate: d.purchaseDate.toISOString(),
      purchasePrice: d.purchasePrice,
      purchasePlace: d.purchasePlace,
      status: d.status,
      notes: d.notes,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      warranties: d.warranties.map((w) => ({
        id: w.id,
        type: w.type,
        provider: w.provider,
        startDate: w.startDate.toISOString(),
        endDate: w.endDate.toISOString(),
        months: w.months,
        cost: w.cost,
        address: w.address,
        phone: w.phone,
        notes: w.notes,
        createdAt: w.createdAt.toISOString(),
        updatedAt: w.updatedAt.toISOString(),
        reminders: w.reminders.map((r) => ({
          id: r.id,
          isDismissed: r.isDismissed,
          createdAt: r.createdAt.toISOString(),
        })),
      })),
      attachments: d.attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        storagePath: a.storagePath,
        fileType: a.fileType,
        fileSize: a.fileSize,
        iv: Buffer.from(a.iv).toString('base64'),
        wrappedKey: Buffer.from(a.wrappedKey).toString('base64'),
        description: a.description,
        uploadedAt: a.uploadedAt.toISOString(),
      })),
    })),
  };
}

function isValidStoragePath(p, deviceId) {
  if (typeof p !== 'string') return false;
  if (!SAFE_STORAGE_PATH.test(p)) return false;
  return p.startsWith(`${deviceId}/`);
}

async function importForUser(userId, payload, mode) {
  // Pre-validate so a bad payload can't half-wipe in replace mode.
  for (const d of payload.devices ?? []) {
    if (typeof d.id !== 'string' || !SAFE_ID.test(d.id)) {
      return { ok: false, message: `bad device id ${d.id}` };
    }
    for (const a of d.attachments ?? []) {
      if (!isValidStoragePath(a.storagePath, d.id)) {
        return { ok: false, message: `bad storagePath in ${d.name}` };
      }
      const iv = Buffer.from(a.iv, 'base64');
      const wk = Buffer.from(a.wrappedKey, 'base64');
      if (iv.length !== 12 || wk.length < 28) {
        return { ok: false, message: `bad key in ${d.name}` };
      }
    }
  }

  return await prisma.$transaction(async (tx) => {
    if (mode === 'replace') {
      await tx.attachment.deleteMany({ where: { device: { userId } } });
      await tx.reminder.deleteMany({ where: { warranty: { device: { userId } } } });
      await tx.warranty.deleteMany({ where: { device: { userId } } });
      await tx.wishlistPrice.deleteMany({ where: { item: { userId } } });
      await tx.wishlistItem.deleteMany({ where: { userId } });
      await tx.subscriptionPayment.deleteMany({
        where: { subscription: { userId } },
      });
      await tx.subscription.deleteMany({ where: { userId } });
      await tx.device.deleteMany({ where: { userId } });
    }

    let imported = 0,
      skipped = 0,
      wlImported = 0,
      wlSkipped = 0,
      subImported = 0,
      subSkipped = 0;

    for (const d of payload.devices ?? []) {
      const existing = await tx.device.findFirst({ where: { id: d.id, userId } });
      if (existing && mode === 'merge') {
        skipped++;
        continue;
      }
      await tx.device.create({
        data: {
          id: d.id,
          userId,
          name: d.name,
          category: d.category,
          brand: d.brand,
          model: d.model,
          serialNumber: d.serialNumber,
          purchaseDate: new Date(d.purchaseDate),
          purchasePrice: d.purchasePrice,
          purchasePlace: d.purchasePlace,
          status: d.status,
          notes: d.notes,
          createdAt: new Date(d.createdAt),
          updatedAt: new Date(d.updatedAt),
          attachments: {
            create: (d.attachments ?? []).map((a) => ({
              id: a.id,
              fileName: a.fileName,
              storagePath: a.storagePath,
              fileType: a.fileType,
              fileSize: a.fileSize,
              iv: Buffer.from(a.iv, 'base64'),
              wrappedKey: Buffer.from(a.wrappedKey, 'base64'),
              description: a.description,
              uploadedAt: new Date(a.uploadedAt),
            })),
          },
          warranties: {
            create: (d.warranties ?? []).map((w) => ({
              id: w.id,
              type: w.type,
              provider: w.provider,
              startDate: new Date(w.startDate),
              endDate: new Date(w.endDate),
              months: w.months,
              cost: w.cost,
              address: w.address,
              phone: w.phone,
              notes: w.notes,
              createdAt: new Date(w.createdAt),
              updatedAt: new Date(w.updatedAt),
              reminders: {
                create: (w.reminders ?? []).map((r) => ({
                  id: r.id,
                  isDismissed: r.isDismissed,
                  createdAt: new Date(r.createdAt),
                })),
              },
            })),
          },
        },
      });
      imported++;
    }

    for (const w of payload.wishlist ?? []) {
      const existing = await tx.wishlistItem.findFirst({ where: { id: w.id, userId } });
      if (existing && mode === 'merge') {
        wlSkipped++;
        continue;
      }
      await tx.wishlistItem.create({
        data: {
          id: w.id,
          userId,
          name: w.name,
          category: w.category,
          brand: w.brand,
          initialPrice: w.initialPrice,
          currentPrice: w.currentPrice,
          buyUrl: w.buyUrl,
          imageUrl: w.imageUrl,
          targetDate: w.targetDate ? new Date(w.targetDate) : null,
          priority: w.priority,
          status: w.status,
          notes: w.notes,
          reminderIntervalDays: w.reminderIntervalDays,
          lastNotifiedAt: w.lastNotifiedAt ? new Date(w.lastNotifiedAt) : null,
          purchasedDeviceId: w.purchasedDeviceId ?? null,
          createdAt: new Date(w.createdAt),
          updatedAt: new Date(w.updatedAt),
          prices: {
            create: (w.prices ?? []).map((p) => ({
              id: p.id,
              price: p.price,
              note: p.note,
              recordedAt: new Date(p.recordedAt),
            })),
          },
        },
      });
      wlImported++;
    }

    for (const s of payload.subscriptions ?? []) {
      const existing = await tx.subscription.findFirst({ where: { id: s.id, userId } });
      if (existing && mode === 'merge') {
        subSkipped++;
        continue;
      }
      await tx.subscription.create({
        data: {
          id: s.id,
          userId,
          name: s.name,
          category: s.category,
          brand: s.brand,
          plan: s.plan,
          billingCycle: s.billingCycle,
          intervalDays: s.intervalDays,
          price: s.price,
          currency: s.currency ?? 'VND',
          startedAt: new Date(s.startedAt),
          renewalDate: new Date(s.renewalDate),
          autoRenew: s.autoRenew,
          status: s.status,
          accountEmail: s.accountEmail,
          paymentMethod: s.paymentMethod,
          manageUrl: s.manageUrl,
          cancelUrl: s.cancelUrl,
          notes: s.notes,
          createdAt: new Date(s.createdAt),
          updatedAt: new Date(s.updatedAt),
          payments: {
            create: (s.payments ?? []).map((p) => ({
              id: p.id,
              amount: p.amount,
              paidAt: new Date(p.paidAt),
              note: p.note,
            })),
          },
        },
      });
      subImported++;
    }

    return { imported, skipped, wlImported, wlSkipped, subImported, subSkipped };
  });
}

async function cleanup() {
  const u = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
  if (u) await prisma.user.delete({ where: { id: u.id } });
}

async function main() {
  console.log('→ Cleanup any prior test data');
  await cleanup();

  console.log('→ Seed test user + 2 devices (with warranty + attachment + reminder), 1 sub, 1 wishlist');
  const user = await prisma.user.create({
    data: { email: TEST_EMAIL, passwordHash: 'x', name: 'Backup Test' },
  });

  const fakeIv = randomBytes(12);
  const fakeWrappedKey = randomBytes(60); // ≥28

  const d1 = await prisma.device.create({
    data: {
      id: 'devone',
      userId: user.id,
      name: 'Laptop Dell XPS',
      category: 'LAPTOP',
      brand: 'Dell',
      model: 'XPS 13',
      purchaseDate: new Date('2025-01-15'),
      purchasePrice: 32_000_000,
      warranties: {
        create: {
          id: 'wone',
          type: 'STANDARD',
          provider: 'Dell VN',
          startDate: new Date('2025-01-15'),
          endDate: new Date('2027-01-15'),
          months: 24,
          reminders: { create: { id: 'rone', isDismissed: false } },
        },
      },
      attachments: {
        create: {
          id: 'attone',
          fileName: 'invoice.pdf',
          storagePath: 'devone/abc-123.enc',
          fileType: 'application/pdf',
          fileSize: 12345,
          iv: fakeIv,
          wrappedKey: fakeWrappedKey,
        },
      },
    },
  });

  const d2 = await prisma.device.create({
    data: {
      id: 'devtwo',
      userId: user.id,
      name: 'iPhone 15',
      category: 'PHONE',
      purchaseDate: new Date('2025-03-01'),
      purchasePrice: 25_000_000,
    },
  });

  const sub1 = await prisma.subscription.create({
    data: {
      id: 'subone',
      userId: user.id,
      name: 'ChatGPT Plus',
      billingCycle: 'MONTHLY',
      price: 480_000,
      startedAt: new Date('2026-01-01'),
      renewalDate: new Date('2026-05-01'),
      autoRenew: true,
      payments: {
        create: { id: 'payone', amount: 480_000, paidAt: new Date('2026-04-01'), note: 'Auto-renew' },
      },
    },
  });

  const wl1 = await prisma.wishlistItem.create({
    data: {
      id: 'wlone',
      userId: user.id,
      name: 'Sony WH-1000XM6',
      currentPrice: 8_500_000,
      status: 'WATCHING',
      priority: 'WANT',
      prices: { create: { id: 'wpone', price: 8_500_000 } },
    },
  });

  console.log('\n→ Test EXPORT (v5 shape)');
  const dump = await exportForUser(user.id);
  assert(dump.version === 5, 'version === 5');
  assert(dump.devices.length === 2, '2 devices exported');
  assert(dump.devices[0].warranties.length === 1, 'device 1 has 1 warranty');
  assert(dump.devices[0].warranties[0].reminders.length === 1, 'warranty has 1 reminder');
  assert(dump.devices[0].attachments.length === 1, 'device 1 has 1 attachment');
  assert(dump.devices[0].attachments[0].iv.length === 16, 'iv base64-encoded (12B → 16 chars)');
  assert(dump.subscriptions.length === 1, '1 subscription exported');
  assert(dump.subscriptions[0].payments.length === 1, 'sub has 1 payment');
  assert(dump.wishlist.length === 1, '1 wishlist item exported');
  assert(dump.wishlist[0].prices.length === 1, 'wishlist has 1 price row');

  console.log('\n→ Test JSON round-trip preserves IDs');
  const json = JSON.parse(JSON.stringify(dump));
  assert(json.devices[0].id === d1.id, 'device id survives JSON');
  assert(json.subscriptions[0].id === sub1.id, 'sub id survives JSON');
  assert(json.wishlist[0].id === wl1.id, 'wishlist id survives JSON');

  console.log('\n→ Test IMPORT merge (everything already exists → all skipped)');
  const m = await importForUser(user.id, dump, 'merge');
  assert(m.imported === 0 && m.skipped === 2, 'merge skips both devices');
  assert(m.subImported === 0 && m.subSkipped === 1, 'merge skips existing sub');
  assert(m.wlImported === 0 && m.wlSkipped === 1, 'merge skips existing wishlist');

  console.log('\n→ Test IMPORT replace (wipes + reinserts)');
  const r = await importForUser(user.id, dump, 'replace');
  assert(r.imported === 2, 'replace reinserts 2 devices');
  assert(r.subImported === 1, 'replace reinserts sub');
  assert(r.wlImported === 1, 'replace reinserts wishlist');
  assert(
    (await prisma.device.count({ where: { userId: user.id } })) === 2,
    'DB still has 2 devices',
  );
  assert(
    (await prisma.warranty.count({ where: { device: { userId: user.id } } })) === 1,
    'warranty restored',
  );
  assert(
    (await prisma.attachment.count({ where: { device: { userId: user.id } } })) === 1,
    'attachment restored',
  );
  assert(
    (await prisma.subscriptionPayment.count({ where: { subscription: { userId: user.id } } })) === 1,
    'sub payment restored',
  );
  assert(
    (await prisma.wishlistPrice.count({ where: { item: { userId: user.id } } })) === 1,
    'wishlist price restored',
  );

  console.log('\n→ Test IMPORT validation: bad storagePath rejected (no DB mutation)');
  const bad = JSON.parse(JSON.stringify(dump));
  bad.devices[0].attachments[0].storagePath = '../escape/x.enc';
  const badRes = await importForUser(user.id, bad, 'replace');
  assert(badRes.ok === false, 'returns { ok: false } on traversal attempt');
  assert(
    (await prisma.device.count({ where: { userId: user.id } })) === 2,
    'DB still has 2 devices (replace did NOT run)',
  );

  console.log('\n→ Test IMPORT validation: bad iv length rejected');
  const bad2 = JSON.parse(JSON.stringify(dump));
  bad2.devices[0].attachments[0].iv = Buffer.from('short').toString('base64');
  const bad2Res = await importForUser(user.id, bad2, 'replace');
  assert(bad2Res.ok === false, 'returns { ok: false } on short iv');

  console.log('\n→ Test IMPORT merge into empty user (post-wipe)');
  await prisma.$transaction([
    prisma.attachment.deleteMany({ where: { device: { userId: user.id } } }),
    prisma.reminder.deleteMany({ where: { warranty: { device: { userId: user.id } } } }),
    prisma.warranty.deleteMany({ where: { device: { userId: user.id } } }),
    prisma.wishlistPrice.deleteMany({ where: { item: { userId: user.id } } }),
    prisma.wishlistItem.deleteMany({ where: { userId: user.id } }),
    prisma.subscriptionPayment.deleteMany({ where: { subscription: { userId: user.id } } }),
    prisma.subscription.deleteMany({ where: { userId: user.id } }),
    prisma.device.deleteMany({ where: { userId: user.id } }),
  ]);
  const m2 = await importForUser(user.id, dump, 'merge');
  assert(m2.imported === 2, 'merge into empty imports both devices');
  assert(m2.subImported === 1, 'merge into empty imports sub');
  assert(m2.wlImported === 1, 'merge into empty imports wishlist');

  console.log('\n→ Cleanup');
  await cleanup();
  console.log('\n✅ ALL BACKUP-RESTORE TESTS PASSED');
}

main()
  .catch((e) => {
    console.error('\n❌ FAIL:', e.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
