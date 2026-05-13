'use server';

// TODO(Phase F): port to Go API once /v1/backup exists.
//
// This action is the LAST remaining direct Prisma consumer in the website
// after Phase E.2. The Go service does not yet expose import/export
// endpoints, and rebuilding them in Go is non-trivial because:
//   - export needs to read across Device + Warranty + Reminder + Attachment
//     + WishlistItem + WishlistPrice + Subscription + SubscriptionPayment
//     in one consistent snapshot,
//   - import needs to be transactional with optional 'replace' mode that
//     deletes the user's existing rows before inserting,
//   - attachment payloads carry pre-encrypted bytes (`iv`, `wrappedKey`)
//     that round-trip through the API, so the Go endpoint must validate
//     the wrapped-key length before commit.
//
// The Phase F orchestrator should: (a) implement POST /v1/backup/export
// + POST /v1/backup/import on Go and rewrite this file as a thin proxy,
// or (b) drop the feature if mobile parity is not needed.

import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';

const SAFE_ID = /^[a-z0-9_-]+$/i;
// storagePath shape: "<deviceId>/<uuid>.enc" — only ASCII safe segments.
const SAFE_STORAGE_PATH = /^[a-z0-9_-]+\/[a-z0-9-]+\.enc$/i;

function isValidStoragePath(p: string, deviceId: string): boolean {
  if (typeof p !== 'string') return false;
  if (!SAFE_STORAGE_PATH.test(p)) return false;
  return p.startsWith(`${deviceId}/`);
}

// v5 export: v4 + `subscriptions` array (with payment history).
export type BackupExport = {
  version: 5;
  exportedAt: string;
  subscriptions: Array<{
    id: string;
    name: string;
    category: string | null;
    brand: string | null;
    plan: string | null;
    billingCycle: string;
    intervalDays: number | null;
    price: number;
    currency: string;
    startedAt: string;
    renewalDate: string;
    autoRenew: boolean;
    status: string;
    accountEmail: string | null;
    paymentMethod: string | null;
    manageUrl: string | null;
    cancelUrl: string | null;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
    payments: Array<{
      id: string;
      amount: number;
      paidAt: string;
      note: string | null;
    }>;
  }>;
  wishlist: Array<{
    id: string;
    name: string;
    category: string | null;
    brand: string | null;
    initialPrice: number | null;
    currentPrice: number | null;
    buyUrl: string | null;
    imageUrl: string | null;
    targetDate: string | null;
    priority: string;
    status: string;
    notes: string | null;
    reminderIntervalDays: number | null;
    lastNotifiedAt: string | null;
    purchasedDeviceId: string | null;
    createdAt: string;
    updatedAt: string;
    prices: Array<{
      id: string;
      price: number;
      note: string | null;
      recordedAt: string;
    }>;
  }>;
  devices: Array<{
    id: string;
    name: string;
    category: string;
    brand: string | null;
    model: string | null;
    serialNumber: string | null;
    purchaseDate: string;
    purchasePrice: number;
    purchasePlace: string | null;
    status: string;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
    warranties: Array<{
      id: string;
      type: string;
      provider: string | null;
      startDate: string;
      endDate: string;
      months: number;
      cost: number | null;
      address: string | null;
      phone: string | null;
      notes: string | null;
      createdAt: string;
      updatedAt: string;
      reminders: Array<{
        id: string;
        isDismissed: boolean;
        createdAt: string;
      }>;
    }>;
    attachments: Array<{
      id: string;
      fileName: string;
      storagePath: string;
      fileType: string;
      fileSize: number;
      iv: string; // base64
      wrappedKey: string; // base64
      description: string | null;
      uploadedAt: string;
    }>;
  }>;
};

// v4 export — v5 minus subscriptions.
type BackupExportV4 = {
  version: 4;
  exportedAt: string;
  wishlist: BackupExport['wishlist'];
  devices: BackupExport['devices'];
};

// v3 export — minus wishlist + subscriptions.
type BackupExportV3 = {
  version: 3;
  exportedAt: string;
  devices: BackupExport['devices'];
};

// Pre-v3 imports: attachments are dropped because they referenced public
// plaintext paths which no longer exist on disk.
type BackupExportV2 = {
  version: 2;
  exportedAt: string;
  devices: Array<
    Omit<BackupExport['devices'][number], 'attachments'> & {
      attachments?: Array<{
        id: string;
        fileName: string;
        filePath?: string;
        fileType: string;
        description: string | null;
        uploadedAt: string;
      }>;
    }
  >;
};

type BackupExportV1 = {
  version: 1;
  exportedAt: string;
  devices: Array<{
    id: string;
    name: string;
    category: string;
    brand: string | null;
    model: string | null;
    serialNumber: string | null;
    purchaseDate: string;
    purchasePrice: number;
    purchasePlace: string | null;
    warrantyMonths: number;
    warrantyEndDate: string;
    warrantyProvider: string | null;
    warrantyAddress: string | null;
    warrantyPhone: string | null;
    warrantyNotes: string | null;
    status: string;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
    reminders?: Array<{
      id: string;
      isDismissed: boolean;
      createdAt: string;
    }>;
  }>;
};

export async function exportAllJson(): Promise<BackupExport> {
  const user = await requireUser();
  const [devices, wishlist, subs] = await Promise.all([
    prisma.device.findMany({
      where: { userId: user.id },
      include: {
        attachments: true,
        warranties: { include: { reminders: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.wishlistItem.findMany({
      where: { userId: user.id },
      include: { prices: { orderBy: { recordedAt: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.subscription.findMany({
      where: { userId: user.id },
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

function upgradeV1(v1: BackupExportV1): BackupExport {
  return {
    version: 5,
    exportedAt: v1.exportedAt,
    subscriptions: [],
    wishlist: [],
    devices: v1.devices.map((d) => {
      const hasWarranty = d.warrantyMonths > 0;
      return {
        id: d.id,
        name: d.name,
        category: d.category,
        brand: d.brand,
        model: d.model,
        serialNumber: d.serialNumber,
        purchaseDate: d.purchaseDate,
        purchasePrice: d.purchasePrice,
        purchasePlace: d.purchasePlace,
        status: d.status,
        notes: d.notes,
        createdAt: d.createdAt,
        updatedAt: d.updatedAt,
        warranties: hasWarranty
          ? [
              {
                id: `${d.id}-std`,
                type: 'STANDARD',
                provider: d.warrantyProvider,
                startDate: d.purchaseDate,
                endDate: d.warrantyEndDate,
                months: d.warrantyMonths,
                cost: null,
                address: d.warrantyAddress,
                phone: d.warrantyPhone,
                notes: d.warrantyNotes,
                createdAt: d.createdAt,
                updatedAt: d.updatedAt,
                reminders: (d.reminders ?? []).map((r) => ({
                  id: r.id,
                  isDismissed: r.isDismissed,
                  createdAt: r.createdAt,
                })),
              },
            ]
          : [],
        attachments: [],
      };
    }),
  };
}

function upgradeV2(v2: BackupExportV2): BackupExport {
  return {
    version: 5,
    exportedAt: v2.exportedAt,
    subscriptions: [],
    wishlist: [],
    devices: v2.devices.map((d) => ({
      id: d.id,
      name: d.name,
      category: d.category,
      brand: d.brand,
      model: d.model,
      serialNumber: d.serialNumber,
      purchaseDate: d.purchaseDate,
      purchasePrice: d.purchasePrice,
      purchasePlace: d.purchasePlace,
      status: d.status,
      notes: d.notes,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      warranties: d.warranties,
      // v2 attachments referenced plaintext public paths — drop them. The
      // user can re-upload after import.
      attachments: [],
    })),
  };
}

function upgradeV3(v3: BackupExportV3): BackupExport {
  return {
    version: 5,
    exportedAt: v3.exportedAt,
    subscriptions: [],
    wishlist: [],
    devices: v3.devices,
  };
}

function upgradeV4(v4: BackupExportV4): BackupExport {
  return {
    version: 5,
    exportedAt: v4.exportedAt,
    subscriptions: [],
    wishlist: v4.wishlist,
    devices: v4.devices,
  };
}

export async function importJson(payload: unknown, mode: 'merge' | 'replace' = 'merge') {
  const user = await requireUser();
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: 'File JSON không hợp lệ' };
  }
  const raw = payload as { version?: unknown; devices?: unknown };
  let data: BackupExport;
  let droppedAttachments = 0;
  if (raw.version === 5 && Array.isArray(raw.devices)) {
    data = raw as BackupExport;
  } else if (raw.version === 4 && Array.isArray(raw.devices)) {
    data = upgradeV4(raw as BackupExportV4);
  } else if (raw.version === 3 && Array.isArray(raw.devices)) {
    data = upgradeV3(raw as BackupExportV3);
  } else if (raw.version === 2 && Array.isArray(raw.devices)) {
    droppedAttachments = (raw.devices as BackupExportV2['devices']).reduce(
      (sum, d) => sum + (d.attachments?.length ?? 0),
      0,
    );
    data = upgradeV2(raw as BackupExportV2);
  } else if (raw.version === 1 && Array.isArray(raw.devices)) {
    data = upgradeV1(raw as BackupExportV1);
  } else {
    return { ok: false, message: 'Định dạng backup không được hỗ trợ' };
  }

  // Pre-validate device IDs and attachment paths before touching the DB so
  // a malicious JSON cannot half-wipe the user's data in `replace` mode.
  for (const d of data.devices) {
    if (typeof d.id !== 'string' || !SAFE_ID.test(d.id)) {
      return { ok: false, message: `ID thiết bị không hợp lệ: ${String(d.id)}` };
    }
    for (const a of d.attachments ?? []) {
      if (!isValidStoragePath(a.storagePath, d.id)) {
        return {
          ok: false,
          message: `Đường dẫn file không hợp lệ trong "${d.name}". File backup có thể đã bị sửa.`,
        };
      }
      try {
        const iv = Buffer.from(a.iv, 'base64');
        const wk = Buffer.from(a.wrappedKey, 'base64');
        if (iv.length !== 12 || wk.length < 28) {
          return { ok: false, message: `Khoá file hỏng trong "${d.name}".` };
        }
      } catch {
        return { ok: false, message: `Khoá file hỏng trong "${d.name}".` };
      }
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    if (mode === 'replace') {
      await tx.attachment.deleteMany({ where: { device: { userId: user.id } } });
      await tx.reminder.deleteMany({ where: { warranty: { device: { userId: user.id } } } });
      await tx.warranty.deleteMany({ where: { device: { userId: user.id } } });
      await tx.wishlistPrice.deleteMany({ where: { item: { userId: user.id } } });
      await tx.wishlistItem.deleteMany({ where: { userId: user.id } });
      await tx.subscriptionPayment.deleteMany({
        where: { subscription: { userId: user.id } },
      });
      await tx.subscription.deleteMany({ where: { userId: user.id } });
      await tx.device.deleteMany({ where: { userId: user.id } });
    }

    let imported = 0;
    let skipped = 0;
    let wishlistImported = 0;
    let wishlistSkipped = 0;
    let subImported = 0;
    let subSkipped = 0;
    for (const d of data.devices) {
      const existing = await tx.device.findFirst({
        where: { id: d.id, userId: user.id },
      });
      if (existing && mode === 'merge') {
        skipped++;
        continue;
      }
      await tx.device.create({
        data: {
          id: d.id,
          userId: user.id,
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

    for (const w of data.wishlist ?? []) {
      if (typeof w.id !== 'string' || !SAFE_ID.test(w.id)) continue;
      // If purchasedDeviceId references a device this user does not own,
      // strip the link rather than failing the whole import.
      let purchasedDeviceId: string | null = w.purchasedDeviceId ?? null;
      if (purchasedDeviceId) {
        const ok = await tx.device.findFirst({
          where: { id: purchasedDeviceId, userId: user.id },
          select: { id: true },
        });
        if (!ok) purchasedDeviceId = null;
      }
      const existing = await tx.wishlistItem.findFirst({
        where: { id: w.id, userId: user.id },
      });
      if (existing && mode === 'merge') {
        wishlistSkipped++;
        continue;
      }
      await tx.wishlistItem.create({
        data: {
          id: w.id,
          userId: user.id,
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
          purchasedDeviceId,
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
      wishlistImported++;
    }

    for (const s of data.subscriptions ?? []) {
      if (typeof s.id !== 'string' || !SAFE_ID.test(s.id)) continue;
      const existing = await tx.subscription.findFirst({
        where: { id: s.id, userId: user.id },
      });
      if (existing && mode === 'merge') {
        subSkipped++;
        continue;
      }
      await tx.subscription.create({
        data: {
          id: s.id,
          userId: user.id,
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
    return {
      imported,
      skipped,
      wishlistImported,
      wishlistSkipped,
      subImported,
      subSkipped,
    };
  });

  revalidatePath('/dashboard');
  revalidatePath('/devices');
  revalidatePath('/reminders');
  revalidatePath('/wishlist');
  revalidatePath('/subscriptions');
  const parts: string[] = [`Đã import ${result.imported} thiết bị`];
  if (result.skipped) parts.push(`bỏ qua ${result.skipped} thiết bị đã tồn tại`);
  if (result.wishlistImported)
    parts.push(`${result.wishlistImported} món wishlist`);
  if (result.wishlistSkipped)
    parts.push(`bỏ qua ${result.wishlistSkipped} món wishlist đã tồn tại`);
  if (result.subImported)
    parts.push(`${result.subImported} gói đăng ký`);
  if (result.subSkipped)
    parts.push(`bỏ qua ${result.subSkipped} gói đã tồn tại`);
  if (droppedAttachments)
    parts.push(`bỏ ${droppedAttachments} file đính kèm cũ (v2 không có khoá để khôi phục)`);
  return { ok: true, message: `${parts.join(', ')}.` };
}
