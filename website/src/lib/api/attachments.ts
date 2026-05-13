// Typed wrappers around the Go service's attachment endpoints.
//
// Wire shapes match `attachmentDTO` in api/internal/handlers/attachments.go
// for upload, and `store.Attachment` for the list/detail (Go re-uses the
// store row directly there). The web UI only ever needs the metadata shape,
// so we expose just `AttachmentMeta` re-exported from `./devices.ts`.

import { apiFetch, type ApiResult } from './client';
import type { AttachmentMeta } from './devices';

export type { AttachmentMeta };

export async function listForDevice(deviceId: string): Promise<ApiResult<AttachmentMeta[]>> {
  const res = await apiFetch<{ attachments: AttachmentMeta[] }>(
    'GET',
    `/v1/devices/${encodeURIComponent(deviceId)}/attachments`,
  );
  if (!res.ok) return res;
  return { ok: true, data: res.data.attachments ?? [] };
}

// Upload uses multipart/form-data. Caller builds the FormData themselves
// (`file`, optional `description`). The Go server enforces MIME magic-byte
// verification, downscales oversize images, and encrypts at rest before
// returning the metadata.
export async function upload(
  deviceId: string,
  formData: FormData,
): Promise<ApiResult<AttachmentMeta>> {
  const res = await apiFetch<{ attachment: AttachmentMeta }>(
    'POST',
    `/v1/devices/${encodeURIComponent(deviceId)}/attachments`,
    formData,
    { multipart: true },
  );
  if (!res.ok) return res;
  return { ok: true, data: res.data.attachment };
}

export async function remove(id: string): Promise<ApiResult<{ ok: true }>> {
  return apiFetch<{ ok: true }>('DELETE', `/v1/attachments/${encodeURIComponent(id)}`);
}
