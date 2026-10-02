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

// `PATCH /v1/attachments/{id}` — `description` is the only mutable field (the
// bytes themselves cannot be edited; delete + re-upload instead). The key is
// required by the contract; `null` / `""` / whitespace-only clears the
// description server-side, mirroring the upload-time normalization. There is
// no length cap beyond the request-body size.
//
// An id belonging to another user matches no row and comes back 404 (never
// 403) — same "confirm nothing" policy as `GET /api/files/{id}`; callers must
// not imply the file exists when they report a failure.
export async function updateDescription(
  id: string,
  description: string | null,
): Promise<ApiResult<AttachmentMeta>> {
  const res = await apiFetch<{ attachment: AttachmentMeta }>(
    'PATCH',
    `/v1/attachments/${encodeURIComponent(id)}`,
    { description },
  );
  if (!res.ok) return res;
  return { ok: true, data: res.data.attachment };
}
