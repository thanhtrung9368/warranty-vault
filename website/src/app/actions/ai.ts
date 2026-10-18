'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { getI18n } from '@/lib/i18n/server';
import { buildExtractReceiptBody } from '@/lib/receipt-scan';
import type { AttachmentMeta } from '@/lib/api/devices';
import type { DraftDevice } from '@/lib/api/ai';

export type ExtractReceiptResult =
  | {
      ok: true;
      draft: DraftDevice;
      /** The inbox item that now owns the draft's OCR transcript. */
      attachment: AttachmentMeta;
    }
  | {
      ok: false;
      message: string;
      /**
       * Present when the upload succeeded but extraction did not. The file is
       * intentionally KEPT in the inbox (see below), so the UI must say so.
       */
      attachment?: AttachmentMeta;
    };

// Extract device fields from a receipt / warranty-card photo.
//
// UPLOAD FIRST, THEN EXTRACT. The multipart branch of the AI endpoint has no
// Attachment row, so it cannot persist the OCR transcript — only the
// `attachmentId` branch writes `Attachment.extractedText`, which is what
// `GET /v1/search` matches on. So:
//
//   1. POST /v1/attachments with NO deviceId → the file becomes an inbox item
//      (capture-first inbox; it consumes no device slot and needs no device id
//      before the device exists);
//   2. POST /v1/ai/extract-receipt { attachmentId } → draft + stored transcript.
//
// ── Orphan policy ────────────────────────────────────────────────────────
//
// If step 2 fails the file is NOT deleted. It stays in the inbox, which is a
// first-class visible place with a nav entry and a count, and the failure copy
// links there. Deleting would destroy the user's chosen file on a transient
// failure (network/rate limit/AI disabled), and the API's contract explicitly
// preserves earlier text when a re-scan reads nothing — the client must not
// "clean up" by clearing or replacing an existing attachment either.
//
// Each scan uploads a NEW attachment. Identity is enforced here (requireUser);
// all OCR, decryption, catalog mapping and rate limiting happen on the Go side.
// Returns a DRAFT only — the client pre-fills the device form and the user
// confirms before saving. The upload changes the inbox badge/list, so /inbox is
// invalidated even when extraction fails.
export async function extractReceipt(formData: FormData): Promise<ExtractReceiptResult> {
  await requireUser();
  const { t } = await getI18n();

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: t('Thiếu ảnh hoá đơn') };
  }

  // Step 1 — no `deviceId` on purpose: an inbox item, not a device attachment.
  const uploaded = await api.attachments.upload({ file });
  if (!uploaded.ok) {
    return { ok: false, message: uploaded.message ?? t('Tải lên thất bại') };
  }
  const attachment = uploaded.data;
  // The inbox page and the sidebar badge both derive from GET /v1/inbox.
  revalidatePath('/inbox');

  // Step 2 — the branch that persists and indexes the transcript.
  //
  // The `attachment ?` guard is defensive: a 2xx upload response without the
  // metadata envelope would otherwise throw here and lose the fact that the
  // file may already be in the inbox. We only link the inbox when we actually
  // have the row we would be linking to.
  const body = attachment ? buildExtractReceiptBody(attachment.id) : null;
  if (!body) {
    return {
      ok: false,
      message: t('Không quét được hoá đơn, thử lại nhé'),
      attachment: attachment || undefined,
    };
  }

  const res = await api.ai.extractReceipt(body);
  if (!res.ok) {
    return {
      ok: false,
      // The server's message is already in this request's language.
      message: res.message ?? t('Không quét được hoá đơn, thử lại nhé'),
      attachment,
    };
  }
  return { ok: true, draft: res.data, attachment };
}

// Toggle the AI receipt-scan opt-in for the current user.
export async function setAIOptIn(enabled: boolean): Promise<{ ok: boolean; message?: string }> {
  await requireUser();
  const { t } = await getI18n();
  const res = await api.ai.setOptIn(enabled);
  if (!res.ok) {
    return { ok: false, message: res.message ?? t('Không cập nhật được cài đặt') };
  }
  // /me (and thus requireUser) reflects the new flag — refresh settings + the
  // add-device form so the scan button appears/disappears.
  revalidatePath('/settings');
  revalidatePath('/devices/new');
  return { ok: true };
}
