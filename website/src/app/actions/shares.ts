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
import { publicApiBaseUrl, validatePublicApiBaseUrl } from '@/lib/api/base-url';
import type { CreatedDeviceShare } from '@/lib/api/shares';
import { getI18n } from '@/lib/i18n/server';
import { normalizeShareExpiryDays, shareCertificateUrl } from '@/lib/share-links';

// ── Which origin the buyer URL is built from ───────────────────────────────
//
// `sharePath` is a path on the API origin (`/api/v1/public/shares/<token>`),
// and the certificate page is served by Go — the web app only ever links to it
// (no Next route, no CSP change). The buyer opens that link on their own phone,
// outside our network, so the host must come from `PUBLIC_API_URL`, NOT from
// `GO_API_URL`: in the compose stack the latter is `http://api:4000/api`, which
// nobody outside `warranty-net` can resolve — the link would be dead and would
// leak an internal hostname to whoever the seller forwards it to.
//
// Go stores only the token hash, so a share created without a displayable URL
// would burn one of the 10 live-link slots and lose its only copy of the
// token. That is why an unusable `PUBLIC_API_URL` is refused BEFORE the POST,
// with a translated error, and never falls back to the internal address.

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

  // One sentence for every unusable-`PUBLIC_API_URL` case (missing, invalid,
  // insecure, private): the precise reason goes to the server log for the
  // operator, while the dialog gets the same fix-it sentence either way.
  const refuseNoPublicOrigin = (reason: string, context: string) => {
    console.error(
      `[shares] ${context} — PUBLIC_API_URL is ${reason}. Set it to the API's public ` +
        'origin (https, public host, `/api` prefix), e.g. https://api.warrly.com/api.',
    );
    return {
      ok: false as const,
      message: t('Chưa có địa chỉ công khai hợp lệ cho API nên chưa tạo được link chia sẻ. Nhờ quản trị viên đặt PUBLIC_API_URL thành một địa chỉ https công khai, ví dụ https://api.warrly.com/api.'),
    };
  };

  // Refuse before calling Go: a share minted without a usable buyer URL has no
  // value and cannot be repaired (the token is shown once, by this response).
  const publicOrigin = publicApiBaseUrl();
  if (!publicOrigin.ok) {
    return refuseNoPublicOrigin(publicOrigin.reason, 'refusing to create a share link');
  }

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

  // Join the path onto the validated public origin, then validate the RESULT as
  // well: `shareCertificateUrl` passes an already-absolute `sharePath` through
  // untouched, so re-checking is what makes "never an internal host" true of
  // the link itself, not just of the base. Go returns a path today
  // (`/api/v1/public/shares/<token>`), so this is a fail-closed guard against a
  // future server that starts returning one.
  const certificate = validatePublicApiBaseUrl(
    shareCertificateUrl(publicOrigin.url, res.data.sharePath),
  );
  if (!certificate.ok) {
    return refuseNoPublicOrigin(
      certificate.reason,
      `built buyer URL for share ${res.data.id} rejected; the share exists but its link is not returned`,
    );
  }

  return { ok: true, url: certificate.url, share: res.data };
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
