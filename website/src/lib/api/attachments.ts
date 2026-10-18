// Typed wrappers around the Go service's attachment endpoints.
//
// Wire shapes match `attachmentDTO` in api/internal/handlers/attachments.go
// for upload, and `store.Attachment` for the list/detail (Go re-uses the
// store row directly there). The web UI only ever needs the metadata shape,
// so we expose just `AttachmentMeta` re-exported from `./devices.ts`.

import { apiFetch, type ApiResult } from './client';
import type { AttachmentMeta } from './devices';

export type { AttachmentMeta };

// What an upload call needs. `deviceId` is OPTIONAL by contract (capture-first
// inbox): omit it and the file lands in `GET /v1/inbox` instead of on a device,
// with the same MIME/size/encryption rules. A device upload passes the id and
// keeps using the device-scoped route it has always used.
export type AttachmentUploadInput = {
  file: File;
  /** Omit / null for an inbox item. */
  deviceId?: string | null;
  /** Optional, same normalization as before: blank is not sent at all. */
  description?: string | null;
};

export async function listForDevice(deviceId: string): Promise<ApiResult<AttachmentMeta[]>> {
  const res = await apiFetch<{ attachments: AttachmentMeta[] }>(
    'GET',
    `/v1/devices/${encodeURIComponent(deviceId)}/attachments`,
  );
  if (!res.ok) return res;
  return { ok: true, data: res.data.attachments ?? [] };
}

// Upload uses multipart/form-data through the device-optional endpoint:
//
//   * with a `deviceId` form field → the file is attached to that device;
//   * without it → the file becomes an inbox item (capture-first inbox), which
//     is exactly the contract's "omitted creates an inbox item".
//
// The Go server enforces MIME magic-byte verification, the 5 MB cap and the
// 5-files-per-device limit, downscales oversize images, and encrypts at rest
// before returning the metadata. An inbox item does NOT consume a device slot.
export async function upload(input: AttachmentUploadInput): Promise<ApiResult<AttachmentMeta>> {
  const formData = new FormData();
  formData.append('file', input.file, input.file.name);
  // Absent — not an empty string — for an inbox upload: the contract makes the
  // field optional, and the server treats an empty/null value as "no device".
  if (input.deviceId) formData.append('deviceId', input.deviceId);
  const description = input.description?.trim();
  if (description) formData.append('description', description);

  const res = await apiFetch<{ attachment: AttachmentMeta }>(
    'POST',
    '/v1/attachments',
    formData,
    { multipart: true },
  );
  if (!res.ok) return res;
  return { ok: true, data: res.data.attachment };
}

// `POST /v1/attachments/{id}/file` — file an inbox item under a device, or
// return a filed attachment to the inbox with `deviceId: null`.
//
// The call is idempotent in shape but NOT in quota: 409 `LIMIT_REACHED` means
// the target device already holds its five attachments and the item stays in
// the inbox. The caller maps that code through `lib/inbox.ts` so the UI can
// offer the way out ("pick another device or delete it") instead of a generic
// error. PATCH remains description-only; filing never goes through it.
export async function fileAttachment(
  id: string,
  deviceId: string | null,
): Promise<ApiResult<AttachmentMeta | null>> {
  const res = await apiFetch<{ attachment?: AttachmentMeta }>(
    'POST',
    `/v1/attachments/${encodeURIComponent(id)}/file`,
    { deviceId },
  );
  if (!res.ok) return res;
  // The endpoint returns the updated metadata; tolerate an empty 200 rather
  // than inventing a row. Nothing downstream needs the body to be present.
  return { ok: true, data: res.data?.attachment ?? null };
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
