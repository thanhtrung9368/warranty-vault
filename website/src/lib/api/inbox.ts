// Typed wrappers around the Go service's capture-first inbox.
//
// An inbox item is "an attachment with no device yet": uploaded with no
// `deviceId`, it waits here until `POST /v1/attachments/{id}/file` files it
// under a device. It does NOT consume one of that device's five attachment
// slots until it is filed, which is what makes "photograph the receipt now,
// pick the device later" safe — the user is never blocked at the counter.
//
// The payload is the same `AttachmentMeta` shape the device attachment list
// uses, newest first (the server owns the order; this module does not re-sort).

import { apiFetch, type ApiResult } from './client';
import type { AttachmentMeta } from './devices';

export type InboxItem = AttachmentMeta;

// `GET /v1/inbox` → `{ attachments: [...] }`. Also accept an `inbox` key: the
// endpoint's name makes that envelope plausible, and having the client read
// either spelling cannot mis-file anything — it only avoids an empty inbox if
// the server chooses the other key.
type InboxBody = {
  attachments?: AttachmentMeta[];
  inbox?: AttachmentMeta[];
};

export async function getInbox(): Promise<ApiResult<InboxItem[]>> {
  const res = await apiFetch<InboxBody>('GET', '/v1/inbox');
  if (!res.ok) return res;
  const rows = res.data?.attachments ?? res.data?.inbox ?? [];
  return { ok: true, data: rows };
}
