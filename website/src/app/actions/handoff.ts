'use server';

// Server actions for the 2.0 resale handoff.
//
// Identity is enforced here for the seller paths (`requireUser`) and checked
// explicitly for the buyer path (`getCurrentUser`), because the claim page is
// PUBLIC: redirecting a signed-out visitor to /login from inside the action
// would lose the `?next=` destination and the "sign in first" explanation. The
// claim action therefore returns `reason: 'auth'` and the client renders the
// sign-in CTA.
//
// Everything security-relevant stays in Go: minting and hashing the 6-character
// code, the single-use rule, the 14-day TTL, the 30-day per-device cooldown,
// the "same buyer retry is 200 / different buyer is 409 / seller is 403" rule,
// and the safe public projection (no userId/email/price/notes/full serial). The
// web never sees a private device and redacts it client-side.

import { revalidatePath } from 'next/cache';
import { requireUser, getCurrentUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { getI18n } from '@/lib/i18n/server';
import { absoluteUrl } from '@/lib/metadata';
import {
  handoffFailureBody,
  handoffFailureReason,
  handoffPath,
  normalizeHandoffCode,
  type HandoffFailureReason,
} from '@/lib/handoff';

export type CreateHandoffActionResult =
  | {
      ok: true;
      handoffId: string;
      code: string;
      /** Absolute claim URL (falls back to the path when APP_URL is unusable). */
      url: string;
      claimPath: string;
      expiresAt: string;
    }
  | { ok: false; message: string };

export type CancelHandoffResult = { ok: boolean; message: string };

export type ClaimHandoffResult =
  | {
      ok: true;
      deviceId: string;
      deviceName: string;
      sellerName: string | null;
      receivedAt: string | null;
    }
  | { ok: false; reason: HandoffFailureReason; message: string };

/** Create the one code this device is allowed for the next 30 days. */
export async function createHandoff(
  deviceId: string,
  attachmentIds: unknown,
): Promise<CreateHandoffActionResult> {
  await requireUser();
  const { t } = await getI18n();

  const id = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (!id) return { ok: false, message: t('Thiếu id thiết bị') };

  // Runtime parsing: a server action argument is untrusted input, whatever the
  // TypeScript signature says. Omitted / empty = NO documents travel.
  const ids = Array.isArray(attachmentIds)
    ? [
        ...new Set(
          attachmentIds
            .filter((value): value is string => typeof value === 'string')
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ]
    : [];

  const res = await api.handoff.create(id, { attachmentIds: ids });
  if (!res.ok) {
    // Go's `message` is already in the request's language; the fallback is ours.
    return {
      ok: false,
      message: res.message ?? t('Không tạo được mã chuyển chủ'),
    };
  }

  revalidatePath(`/devices/${id}`);

  // The server documents `claimPath` as `/handoff/<code>`. Trust it only when it
  // really is that shape; otherwise rebuild from the code we just received, so a
  // malformed path can never turn the share link into an open redirect on
  // another origin.
  const claimPath =
    typeof res.data.claimPath === 'string' && res.data.claimPath.startsWith('/handoff/')
      ? res.data.claimPath
      : handoffPath(res.data.code);

  let url = claimPath;
  try {
    url = absoluteUrl(claimPath);
  } catch {
    // `APP_URL` is missing in a local/dev environment. A path is still usable in
    // the UI, and the server is the one that decides whether the deployment is
    // configured correctly.
  }

  return {
    ok: true,
    handoffId: res.data.id,
    code: res.data.code,
    url,
    claimPath,
    expiresAt: res.data.expiresAt,
  };
}

/** Withdraw a pending code so it cannot be claimed. */
export async function cancelHandoff(deviceId: string): Promise<CancelHandoffResult> {
  await requireUser();
  const { t } = await getI18n();

  const id = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (!id) return { ok: false, message: t('Thiếu id thiết bị') };

  const res = await api.handoff.cancel(id);
  if (!res.ok) {
    return {
      ok: false,
      message: res.message ?? t('Không huỷ được mã chuyển chủ'),
    };
  }

  revalidatePath(`/devices/${id}`);
  return { ok: true, message: t('Đã huỷ mã chuyển chủ') };
}

/**
 * Claim the device described by a public code.
 *
 * Success is also the answer for the SAME buyer retrying (the server is
 * idempotent): the UI shows the same "device claimed" card with the link, not a
 * 409. A 409 therefore really means "a different buyer already owns it".
 */
export async function claimHandoff(code: unknown): Promise<ClaimHandoffResult> {
  const user = await getCurrentUser();
  const { locale, t } = await getI18n();

  if (!user) {
    return {
      ok: false,
      reason: 'auth',
      message: t('Bạn cần đăng nhập để nhận thiết bị.'),
    };
  }

  const normalized = normalizeHandoffCode(code);
  if (!normalized) {
    return {
      ok: false,
      reason: 'unavailable',
      message: handoffFailureBody('unavailable', locale),
    };
  }

  const res = await api.handoff.claim(normalized);
  if (!res.ok) {
    const reason = handoffFailureReason(res.status);
    return {
      ok: false,
      reason,
      message: res.message ?? handoffFailureBody(reason, locale),
    };
  }

  // The buyer's device list and dashboard read this new row. Both pages are
  // `force-dynamic`, but revalidating keeps the rule "every mutation refreshes
  // the pages that read it" true if that ever changes.
  revalidatePath('/devices');
  revalidatePath('/dashboard');

  const device = res.data.device;
  return {
    ok: true,
    deviceId: device.id,
    deviceName: device.name,
    sellerName: device.handoffSellerName ?? null,
    receivedAt: device.handoffReceivedAt ?? null,
  };
}
