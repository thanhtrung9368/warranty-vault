'use server';

import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { requireUser } from '@/lib/auth';
import { sendPush } from '@/lib/push';

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  userAgent: z.string().max(500).optional().nullable(),
});

export async function subscribePush(raw: unknown) {
  const user = await requireUser();
  const parsed = subscribeSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, message: 'Payload không hợp lệ' };
  const data = parsed.data;

  await prisma.pushSubscription.upsert({
    where: { endpoint: data.endpoint },
    update: {
      userId: user.id,
      p256dh: data.p256dh,
      auth: data.auth,
      userAgent: data.userAgent ?? null,
    },
    create: {
      userId: user.id,
      endpoint: data.endpoint,
      p256dh: data.p256dh,
      auth: data.auth,
      userAgent: data.userAgent ?? null,
    },
  });
  return { ok: true };
}

export async function unsubscribePush(endpoint: string) {
  const user = await requireUser();
  await prisma.pushSubscription.deleteMany({
    where: { endpoint, userId: user.id },
  });
  return { ok: true };
}

export async function sendTestPush() {
  const user = await requireUser();
  const subs = await prisma.pushSubscription.findMany({
    where: { userId: user.id },
  });
  if (subs.length === 0) {
    return { ok: false, message: 'Bạn chưa đăng ký nhận thông báo trên thiết bị nào' };
  }
  let sent = 0;
  let gone = 0;
  for (const s of subs) {
    const res = await sendPush(s, {
      title: 'AssetVault — Thử nghiệm',
      body: 'Chúc mừng! Thông báo đã hoạt động 🎉',
      url: '/dashboard',
      tag: 'test',
    });
    if (res.ok) sent++;
    if (res.gone) {
      await prisma.pushSubscription.delete({ where: { id: s.id } });
      gone++;
    }
  }
  return {
    ok: sent > 0,
    message:
      sent > 0
        ? `Đã gửi tới ${sent} thiết bị${gone ? `, xóa ${gone} subscription hết hạn` : ''}`
        : 'Không gửi được — kiểm tra lại quyền thông báo',
  };
}

export async function listMySubscriptions() {
  const user = await requireUser();
  return prisma.pushSubscription.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    select: { id: true, endpoint: true, userAgent: true, createdAt: true },
  });
}
