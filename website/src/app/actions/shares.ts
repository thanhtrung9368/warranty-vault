'use server';

// Server actions for handover-certificate share links (FEATURE_IDEAS #2).
//
// Identity is enforced here (`requireUser`), the payload is parsed here, and
// everything else — minting the token, hashing it, the 10-live-link cap, expiry
// bounds, ownership — stays in Go. The token is returned to the caller exactly
// once, in the result of `createDeviceShare`, because showing it is the whole
// point of the feature; nothing on the server keeps a readable copy.

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { CreatedDeviceShare } from '@/lib/api/shares';
import { getI18n } from '@/lib/i18n/server';
import { normalizeShareExpiryDays, shareCertificateUrl } from '@/lib/share-links';

// Same env the API client uses. `sharePath` is a path on the API origin
// (`/api/v1/public/shares/<token>`), the certificate page is served by Go, and
// the web app only ever links to it — no Next route, no CSP change.
const API_BASE_URL = process.env.GO_API_URL ?? 'http://localhost:4000';

export type CreateShareActionResult =
  | {
      ok: true;
      // Absolute URL to hand to the buyer. Built server-side so the browser
      // never needs to know the API host.
      url: string;
      // Carries the one-time token. Display it, then it is gone for good.
      share: CreatedDeviceShare;
    }
  | { ok: false; message: string };

export type RevokeShareActionResult = { ok: boolean; message: string };

export type CreateShareRequest = {
  // 1..90; an unusable value falls back to the 30-day server default.
  expiresInDays?: number | string | null;
  includeSerial?: boolean | null;
};

export async function createDeviceShare(
  deviceId: string,
  input?: CreateShareRequest,
): Promise<CreateShareActionResult> {
  await requireUser();

  const { t } = await getI18n();
  const id = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (!id) return { ok: false, message: t('Thiếu id thiết bị') };

  // Runtime parsing: a server action argument is untrusted input, whatever the
  // TypeScript signature says.
  const raw: { expiresInDays?: unknown; includeSerial?: unknown } = input ?? {};

  const res = await api.shares.create(id, {
    expiresInDays: normalizeShareExpiryDays(raw.expiresInDays),
    includeSerial: raw.includeSerial === true,
  });
  if (!res.ok) {
    // `res.message` comes from Go in the request's language (`?lang=`), so it is
    // passed through untouched; the fallback is ours and is translated here.
    return { ok: false, message: res.message ?? t('Không tạo được link chia sẻ') };
  }

  // The device page is `force-dynamic`, so the caller also refreshes; this keeps
  // the rule "every mutation revalidates the path that reads it" true even if
  // that ever changes.
  revalidatePath(`/devices/${id}`);

  const url = shareCertificateUrl(API_BASE_URL, res.data.sharePath);
  return { ok: true, url: url || res.data.sharePath, share: res.data };
}

export async function revokeDeviceShare(
  shareId: string,
  deviceId: string,
): Promise<RevokeShareActionResult> {
  await requireUser();

  const { t } = await getI18n();
  const id = typeof shareId === 'string' ? shareId.trim() : '';
  if (!id) return { ok: false, message: t('Thiếu id link chia sẻ') };

  const res = await api.shares.revoke(id);
  if (!res.ok) {
    return { ok: false, message: res.message ?? t('Không thu hồi được link chia sẻ') };
  }

  const device = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (device) revalidatePath(`/devices/${device}`);

  return { ok: true, message: t('Đã thu hồi link chia sẻ') };
}
