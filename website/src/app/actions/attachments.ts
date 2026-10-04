'use server';

import { api } from '@/lib/api';
import { getI18n } from '@/lib/i18n/server';

// Upload an attachment for a device. Auth + ownership + MIME magic-byte
// verification + image downscale + AES-256-GCM encryption all happen on
// the Go side. We just forward the multipart body; the caller component on
// /devices/[id] (a `force-dynamic` page) picks up the change via
// router.refresh(), so no revalidatePath is needed.
export async function uploadAttachment(formData: FormData) {
  const { t } = await getI18n();
  const deviceId = String(formData.get('deviceId') ?? '');
  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, message: t('Thiếu file') };
  if (!deviceId) return { ok: false, message: t('Thiếu deviceId') };

  // Build a fresh FormData with only the fields the Go endpoint expects
  // (`file`, optional `description`). The original FormData also carries
  // deviceId in the path, not the body.
  const upstream = new FormData();
  upstream.append('file', file, file.name);
  const description = formData.get('description');
  if (typeof description === 'string' && description !== '') {
    upstream.append('description', description);
  }

  const res = await api.attachments.upload(deviceId, upstream);
  if (!res.ok) return { ok: false, message: res.message ?? t('Tải lên thất bại') };

  return { ok: true };
}

export async function deleteAttachment(id: string) {
  // We don't have the deviceId after the row is gone. The Go endpoint
  // returns 200 on delete or 404 if not-owned/missing — we treat 404 as a
  // successful no-op. Caller is on the device-detail page, so router.refresh()
  // / the broad revalidate below will pick up the change.
  const res = await api.attachments.remove(id);
  if (!res.ok && res.status !== 404) {
    return { ok: false };
  }
  // The caller component lives on /devices/[id] (a `force-dynamic` page) and
  // refetches via router.refresh(); no revalidatePath needed.
  return { ok: true };
}

// Rename an attachment's description — the only mutable field (edit the row
// that already exists, so unlike upload we DO have its id).
//
// `description` is the whole body: an empty/whitespace value clears it, which
// is why callers pass `''` rather than omitting the key. Ownership lives in Go
// (the query joins through the owning Device with `userId = :currentUser`), so
// someone else's id is a 404 — never a 403 — and we surface that as a plain
// not-found instead of hinting the row exists.
//
// The gallery is on /devices/[id] (a `force-dynamic` page) and applies the new
// value optimistically, then calls router.refresh(); no revalidatePath needed.
export async function updateAttachmentDescription(
  id: string,
  description: string,
): Promise<{ ok: boolean; description?: string | null; message?: string }> {
  const { t } = await getI18n();
  if (!id) return { ok: false, message: t('Thiếu id file đính kèm') };

  const res = await api.attachments.updateDescription(id, description);
  if (!res.ok) {
    if (res.status === 404) {
      return { ok: false, message: t('Không tìm thấy file đính kèm') };
    }
    return { ok: false, message: res.message ?? t('Không lưu được mô tả') };
  }

  // Return the server's normalized value (trimmed, or null when cleared) so
  // the caller can replace its optimistic guess with the real one.
  return { ok: true, description: res.data.description };
}
