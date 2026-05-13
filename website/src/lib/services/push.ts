import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { DomainError } from '@/lib/services/errors';

// Web (W3C Push API) shape — the browser provides endpoint URL + crypto.
export const webPushInputSchema = z.object({
  platform: z.literal('web').optional().default('web'),
  endpoint: z.string().url(),
  p256dh: z.string().min(1),
  auth: z.string().min(1),
  userAgent: z.string().max(500).optional().nullable(),
});

// Native (APNs / FCM) shape — the OS provides a device token. We synthesize
// a unique endpoint string so the same upsert path works.
export const nativePushInputSchema = z.object({
  platform: z.enum(['apns', 'fcm']),
  token: z.string().min(8).max(4096),
  userAgent: z.string().max(500).optional().nullable(),
});

export const pushInputSchema = z.union([webPushInputSchema, nativePushInputSchema]);
export type PushInput = z.infer<typeof pushInputSchema>;

function endpointFor(input: PushInput): string {
  if (input.platform === 'web') return input.endpoint;
  return `${input.platform}://${input.token}`;
}

export async function subscribePush(userId: string, input: PushInput) {
  const endpoint = endpointFor(input);
  const isWeb = input.platform === 'web';
  await prisma.pushSubscription.upsert({
    where: { endpoint },
    update: {
      userId,
      platform: input.platform,
      p256dh: isWeb ? input.p256dh : null,
      auth: isWeb ? input.auth : null,
      userAgent: input.userAgent ?? null,
    },
    create: {
      userId,
      endpoint,
      platform: input.platform,
      p256dh: isWeb ? input.p256dh : null,
      auth: isWeb ? input.auth : null,
      userAgent: input.userAgent ?? null,
    },
  });
}

export async function unsubscribePush(userId: string, endpoint: string) {
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });
}

export async function unsubscribePushByToken(
  userId: string,
  platform: 'apns' | 'fcm',
  token: string,
) {
  await prisma.pushSubscription.deleteMany({
    where: { userId, endpoint: `${platform}://${token}` },
  });
}

export async function listMySubscriptions(userId: string) {
  return prisma.pushSubscription.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    select: { id: true, endpoint: true, platform: true, userAgent: true, createdAt: true },
  });
}

export async function deleteSubscriptionById(userId: string, id: string) {
  const owned = await prisma.pushSubscription.findFirst({
    where: { id, userId },
    select: { id: true },
  });
  if (!owned) throw new DomainError('NOT_FOUND', 'Không tìm thấy đăng ký');
  await prisma.pushSubscription.delete({ where: { id } });
}
