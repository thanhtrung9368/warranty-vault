'use server';

import { revalidatePath } from 'next/cache';
import { requireUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { getI18n } from '@/lib/i18n/server';
import type { DraftDevice } from '@/lib/api/ai';

export type ExtractReceiptResult =
  | { ok: true; draft: DraftDevice }
  | { ok: false; message: string };

// Extract device fields from a receipt / warranty-card photo. Identity is
// enforced here (requireUser); all OCR, decryption, catalog mapping and rate
// limiting happen on the Go side. Returns a DRAFT only — the client pre-fills
// the device form and the user confirms before saving. Read-only, so no
// revalidatePath.
export async function extractReceipt(formData: FormData): Promise<ExtractReceiptResult> {
  await requireUser();
  const { t } = await getI18n();

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: t('Thiếu ảnh hoá đơn') };
  }

  const upstream = new FormData();
  upstream.append('file', file, file.name);

  const res = await api.ai.extractReceipt(upstream);
  if (!res.ok) {
    return { ok: false, message: res.message ?? t('Không quét được hoá đơn, thử lại nhé') };
  }
  return { ok: true, draft: res.data };
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
