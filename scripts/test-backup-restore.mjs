import 'dotenv/config';
import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

// Always use an isolated test DB. Never touch dev.db.
const TEST_DB_URL = 'file:./prisma/test.db';
process.env.DATABASE_URL = TEST_DB_URL;

execSync('npx prisma db push --schema=prisma/schema.prisma --accept-data-loss', {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: TEST_DB_URL },
});

const adapter = new PrismaBetterSqlite3({ url: TEST_DB_URL });
const prisma = new PrismaClient({ adapter });

const TEST_EMAIL = '__backup_test__@local.test';

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT FAIL: ${msg}`);
  console.log(`  ✓ ${msg}`);
}

async function exportForUser(userId) {
  const devices = await prisma.device.findMany({
    where: { userId },
    include: { attachments: true, reminders: true },
    orderBy: { createdAt: 'asc' },
  });
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
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
      warrantyMonths: d.warrantyMonths,
      warrantyEndDate: d.warrantyEndDate.toISOString(),
      warrantyProvider: d.warrantyProvider,
      warrantyAddress: d.warrantyAddress,
      warrantyPhone: d.warrantyPhone,
      warrantyNotes: d.warrantyNotes,
      status: d.status,
      notes: d.notes,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      attachments: d.attachments.map((a) => ({
        id: a.id, fileName: a.fileName, filePath: a.filePath,
        fileType: a.fileType, description: a.description,
        uploadedAt: a.uploadedAt.toISOString(),
      })),
      reminders: d.reminders.map((r) => ({
        id: r.id, isDismissed: r.isDismissed,
        createdAt: r.createdAt.toISOString(),
      })),
    })),
  };
}

async function importForUser(userId, payload, mode) {
  if (mode === 'replace') {
    await prisma.attachment.deleteMany({ where: { device: { userId } } });
    await prisma.reminder.deleteMany({ where: { device: { userId } } });
    await prisma.device.deleteMany({ where: { userId } });
  }
  let imported = 0, skipped = 0;
  for (const d of payload.devices) {
    const existing = await prisma.device.findFirst({ where: { id: d.id, userId } });
    if (existing && mode === 'merge') { skipped++; continue; }
    await prisma.device.create({
      data: {
        id: d.id, userId,
        name: d.name, category: d.category, brand: d.brand, model: d.model,
        serialNumber: d.serialNumber,
        purchaseDate: new Date(d.purchaseDate),
        purchasePrice: d.purchasePrice, purchasePlace: d.purchasePlace,
        warrantyMonths: d.warrantyMonths,
        warrantyEndDate: new Date(d.warrantyEndDate),
        warrantyProvider: d.warrantyProvider, warrantyAddress: d.warrantyAddress,
        warrantyPhone: d.warrantyPhone, warrantyNotes: d.warrantyNotes,
        status: d.status, notes: d.notes,
        createdAt: new Date(d.createdAt), updatedAt: new Date(d.updatedAt),
        attachments: {
          create: (d.attachments ?? []).map((a) => ({
            id: a.id, fileName: a.fileName, filePath: a.filePath,
            fileType: a.fileType, description: a.description,
            uploadedAt: new Date(a.uploadedAt),
          })),
        },
        reminders: {
          create: (d.reminders ?? []).map((r) => ({
            id: r.id, isDismissed: r.isDismissed, createdAt: new Date(r.createdAt),
          })),
        },
      },
    });
    imported++;
  }
  return { imported, skipped };
}

async function cleanup() {
  const u = await prisma.user.findUnique({ where: { email: TEST_EMAIL } });
  if (u) await prisma.user.delete({ where: { id: u.id } });
}

async function main() {
  console.log('→ Cleanup any prior test data');
  await cleanup();

  console.log('→ Seed test user + 2 devices');
  const user = await prisma.user.create({
    data: { email: TEST_EMAIL, passwordHash: 'x', name: 'Backup Test' },
  });
  const d1 = await prisma.device.create({
    data: {
      userId: user.id, name: 'Laptop Dell XPS', category: 'LAPTOP',
      brand: 'Dell', model: 'XPS 13',
      purchaseDate: new Date('2025-01-15'), purchasePrice: 32000000,
      warrantyMonths: 24, warrantyEndDate: new Date('2027-01-15'),
      attachments: { create: { fileName: 'invoice.pdf', filePath: '/uploads/x/invoice.pdf', fileType: 'application/pdf' } },
      reminders: { create: { isDismissed: false } },
    },
  });
  const d2 = await prisma.device.create({
    data: {
      userId: user.id, name: 'iPhone 15', category: 'PHONE',
      purchaseDate: new Date('2025-03-01'), purchasePrice: 25000000,
      warrantyMonths: 12, warrantyEndDate: new Date('2026-03-01'),
    },
  });

  console.log('\n→ Test EXPORT');
  const dump = await exportForUser(user.id);
  assert(dump.version === 1, 'version = 1');
  assert(dump.devices.length === 2, 'export 2 devices');
  assert(dump.devices[0].attachments.length === 1, 'device 1 has 1 attachment');
  assert(dump.devices[0].reminders.length === 1, 'device 1 has 1 reminder');
  assert(JSON.parse(JSON.stringify(dump)).devices[0].id === d1.id, 'JSON round-trip keeps ID');

  console.log('\n→ Test IMPORT merge (should skip both, already exist)');
  const m = await importForUser(user.id, dump, 'merge');
  assert(m.imported === 0 && m.skipped === 2, 'merge skips duplicates');

  console.log('\n→ Test IMPORT replace');
  const r = await importForUser(user.id, dump, 'replace');
  assert(r.imported === 2 && r.skipped === 0, 'replace reinserts 2 devices');
  const afterCount = await prisma.device.count({ where: { userId: user.id } });
  assert(afterCount === 2, 'DB has 2 devices after replace');
  const attAfter = await prisma.attachment.count({ where: { device: { userId: user.id } } });
  assert(attAfter === 1, 'attachment restored after replace');

  console.log('\n→ Test IMPORT merge on empty same-user (after wipe)');
  await prisma.attachment.deleteMany({ where: { device: { userId: user.id } } });
  await prisma.reminder.deleteMany({ where: { device: { userId: user.id } } });
  await prisma.device.deleteMany({ where: { userId: user.id } });
  const m3 = await importForUser(user.id, dump, 'merge');
  assert(m3.imported === 2 && m3.skipped === 0, 'merge into empty imports all');

  console.log('\n→ Cleanup');
  await cleanup();
  console.log('\n✅ ALL TESTS PASSED');
}

main()
  .catch((e) => { console.error('\n❌ FAIL:', e.message); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
