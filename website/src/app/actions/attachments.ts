'use server';

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import { attachmentFileError, type FileAttachmentErrorCode } from '@/lib/inbox';
import { getI18n } from '@/lib/i18n/server';

// Upload an attachment. `deviceId` is optional by contract: with one the file
// is attached to that device, without one it becomes an inbox item (capture
// first, decide the device later). Auth + ownership + MIME magic-byte
// verification + image downscale + AES-256-GCM encryption and the per-device
// five-file cap all happen on the Go side; we only forward the multipart body.
//
// Two shapes for two callers:
//   * `uploadAttachment(formData)` — the device-detail uploader already has a
//     FormData; it keeps calling this directly.
//   * `uploadAttachmentForm(prev, formData)` — the inbox form uses
//     `useActionState`, whose action signature carries the previous state first.
export type AttachmentUploadState = {
  ok?: boolean;
  message?: string;
  /**
   * Epoch ms, present only on success. A `useActionState` caller keys its
   * reset + `router.refresh()` effect on this so two identical uploads still
   * each produce a new state object.
   */
  uploadedAt?: number;
};

export async function uploadAttachment(formData: FormData): Promise<AttachmentUploadState> {
  const { t } = await getI18n();
  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, message: t('Thiếu file') };

  const rawDeviceId = formData.get('deviceId');
  const deviceId =
    typeof rawDeviceId === 'string' && rawDeviceId.trim() !== ''
      ? rawDeviceId.trim()
      : null;

  const rawDescription = formData.get('description');
  const description = typeof rawDescription === 'string' ? rawDescription : null;

  const res = await api.attachments.upload({ file, deviceId, description });
  if (!res.ok) return { ok: false, message: res.message ?? t('Tải lên thất bại') };

  // An inbox upload changes both /inbox and the sidebar badge derived from it
  // in `(app)/layout.tsx`; a device upload changes that device's detail gallery.
  // The device uploader also calls router.refresh(), but the inbox has no
  // client-side copy of the list, so invalidating the routes is what keeps the
  // next render honest.
  revalidatePath('/inbox');
  revalidatePath('/devices');
  if (deviceId) revalidatePath(`/devices/${deviceId}`);

  return { ok: true, uploadedAt: Date.now() };
}

export async function uploadAttachmentForm(
  _prevState: AttachmentUploadState,
  formData: FormData,
): Promise<AttachmentUploadState> {
  return uploadAttachment(formData);
}

export type FileAttachmentState = {
  ok?: boolean;
  code?: FileAttachmentErrorCode;
  message?: string;
};

// File an inbox item under a device, or return it to the inbox with
// `deviceId: null`. The server's 409 `LIMIT_REACHED` means the target already
// has five attachments; `attachmentFileError` turns that into copy that names
// both ways out instead of a generic failure. A 404 means the row is gone or
// belongs to someone else (never 403 — same "confirm nothing" policy as
// `GET /api/files/{id}`).
export async function fileAttachment(
  id: string,
  deviceId: string | null,
): Promise<FileAttachmentState> {
  const { t } = await getI18n();
  if (!id) return { ok: false, code: 'GENERIC', message: t('Thiếu id file đính kèm') };

  const target = deviceId && deviceId.trim() !== '' ? deviceId : null;
  const res = await api.attachments.fileAttachment(id, target);
  if (!res.ok) {
    const failure = attachmentFileError(res);
    // 409/404 get our copy because they need a way out / a reload, not just a
    // restatement. Any other failure keeps the server's own message when it
    // sent one (validation, rate limit), which is already in this request's
    // language.
    const message =
      failure.code === 'GENERIC' ? res.message ?? t(failure.key) : t(failure.key);
    return { ok: false, code: failure.code, message };
  }

  revalidatePath('/inbox');
  revalidatePath('/devices');
  if (target) revalidatePath(`/devices/${target}`);
  return { ok: true };
}

export async function deleteAttachment(id: string) {
  // We don't have the deviceId after the row is gone. The Go endpoint
  // returns 200 on delete or 404 if not-owned/missing — we treat 404 as a
  // successful no-op. Callers refresh the page themselves; invalidating
  // /inbox also keeps the sidebar badge from counting a deleted row.
  const res = await api.attachments.remove(id);
  if (!res.ok && res.status !== 404) {
    return { ok: false };
  }
  revalidatePath('/inbox');
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
