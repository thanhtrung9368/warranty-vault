// Pure display/error logic for the capture-first inbox.
//
// Kept free of React, Next and the API client so it can be unit-tested without
// a backend. The server owns the list order (newest first) and the quota — this
// module only counts the rows and turns the frozen 409 into copy the UI can
// act on.
//
// The contract this encodes:
//
//   * `POST /api/v1/attachments` with no `deviceId` creates an inbox item.
//   * `GET /api/v1/inbox` lists the caller's unassigned attachments.
//   * `POST /api/v1/attachments/{id}/file` files one under a device; a target
//     that already holds 5 attachments answers **409 `LIMIT_REACHED`** and the
//     item stays in the inbox.
//   * An inbox item does NOT occupy a device slot, so the count in the nav and
//     the count on the device row are two different numbers on purpose.

import type { AttachmentMeta } from '@/lib/api/devices';

// Mirrors `services.MAX_ATTACHMENTS_PER_DEVICE` in the Go service. The web does
// not pre-validate the quota (the server is the source of truth); this constant
// only lets the picker mark a device as full so the 409 is rarely a surprise.
export const MAX_ATTACHMENTS_PER_DEVICE = 5;

export type InboxItem = AttachmentMeta;

/** The slice of a device row the picker needs. */
export type InboxDevice = {
  id: string;
  name: string;
  // `GET /v1/devices` rows carry this; absent on older fixtures, treated as 0.
  attachmentCount?: number | null;
};

/**
 * How many items are waiting. Null/undefined (a failed inbox read) is 0 rather
 * than an exception: the nav badge is allowed to be quiet when the list cannot
 * be loaded, exactly like the reminders/actions badges in `(app)/layout.tsx`.
 */
export function inboxCount(items: readonly unknown[] | null | undefined): number {
  return items?.length ?? 0;
}

/**
 * True when the device already holds its five attachments, so filing into it
 * will answer 409 `LIMIT_REACHED`. Used only to LABEL the option — the option
 * stays selectable, because the server is the quota authority and the
 * requirement is to show that 409 clearly, not to hide the choice.
 */
export function deviceIsFull(
  device: Pick<InboxDevice, 'attachmentCount'> | null | undefined,
): boolean {
  return (device?.attachmentCount ?? 0) >= MAX_ATTACHMENTS_PER_DEVICE;
}

export type FileAttachmentErrorCode = 'LIMIT_REACHED' | 'NOT_FOUND' | 'GENERIC';

export type FileAttachmentFailure = {
  code: FileAttachmentErrorCode;
  /**
   * Vietnamese catalog key (the web dictionary's key is the Vietnamese
   * sentence). The caller translates it with the request's locale; a pure
   * module must not resolve a locale itself.
   */
  key: string;
};

/**
 * Map a failed `POST /v1/attachments/{id}/file` onto the UI's three cases.
 *
 * `LIMIT_REACHED` is the one that needs a real way out, so it gets its own copy
 * naming both exits. The error CODE is pinned, not just the status: a future 409
 * for a different conflict must not claim the device is full. 404 (not
 * owned / already gone) is distinct so the row can offer a reload instead of a
 * pointless retry.
 *
 * Casing: the contract names the domain constant `LIMIT_REACHED`, while the Go
 * error envelope lower-cases every service code on the wire. Both spellings are
 * the same refusal, so both are accepted; any other 409 stays generic.
 */
export function attachmentFileError(result: {
  status: number;
  error: string;
}): FileAttachmentFailure {
  const limitReached =
    result.error === 'LIMIT_REACHED' || result.error === 'limit_reached';
  if (result.status === 409 && limitReached) {
    return {
      code: 'LIMIT_REACHED',
      key: 'Thiết bị này đã đủ 5 file. Chọn thiết bị khác hoặc xoá file này.',
    };
  }
  if (result.status === 404) {
    return { code: 'NOT_FOUND', key: 'Không tìm thấy file đính kèm' };
  }
  return { code: 'GENERIC', key: 'Không gán được file vào thiết bị' };
}
