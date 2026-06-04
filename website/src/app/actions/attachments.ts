'use server';

import { api } from '@/lib/api';

// Upload an attachment for a device. Auth + ownership + MIME magic-byte
// verification + image downscale + AES-256-GCM encryption all happen on
// the Go side. We just forward the multipart body; the caller component on
// /devices/[id] (a `force-dynamic` page) picks up the change via
// router.refresh(), so no revalidatePath is needed.
export async function uploadAttachment(formData: FormData) {
  const deviceId = String(formData.get('deviceId') ?? '');
  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, message: 'Thiếu file' };
  if (!deviceId) return { ok: false, message: 'Thiếu deviceId' };

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
  if (!res.ok) return { ok: false, message: res.message ?? 'Tải lên thất bại' };

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
