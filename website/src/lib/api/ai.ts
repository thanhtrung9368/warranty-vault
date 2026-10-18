// Typed wrapper around the Go AI extraction endpoint.
//
// Wire shape matches `DraftDevice` in api/internal/services/ai_extract.go and
// the `DraftDevice` schema in openapi.yaml. The endpoint returns a DRAFT only —
// the user always confirms before the device is created.
//
// There are two request branches. The web always uses the `attachmentId` one
// (the file is uploaded to the inbox first) because that is the only branch
// that persists the OCR transcript for `GET /v1/search`:
//
//   * `{ attachmentId }` → draft + `extractedTextStored: true`;
//   * multipart `file`   → draft only, nothing to store the text on.
//
// `buildExtractReceiptBody` in `lib/receipt-scan.ts` owns the body shape.

import { apiFetch, type ApiResult } from './client';
import { normalizeDeviceWarnings } from '@/lib/device-warnings';
import type { ExtractReceiptBody } from '@/lib/receipt-scan';
import type { DeviceWarning } from './devices';

export type DraftDevice = {
  name: string | null;
  category: string | null;
  brand: string | null;
  brandId: string | null;
  model: string | null;
  serialNumber: string | null;
  purchaseDate: string | null;
  purchasePrice: number | null;
  purchasePlace: string | null;
  storeId: string | null;
  warrantyMonths: number | null;
  warrantyProviderId: string | null;
  confidence: 'high' | 'medium' | 'low';
  // Fields the user must check themselves: free text that could not be mapped to
  // the catalog, or a value that was DROPPED as unusable (e.g. a 400-character
  // OCR serial). "We could not use this."
  unmatched: string[];
  // Non-blocking serial advisories about a value that WAS kept (IMEI checksum,
  // odd IMEI length, a serial already used on another device). "We used it, but
  // it looks wrong." Always present on the wire; `[]` when there is nothing.
  warnings: DeviceWarning[];
  // The OCR transcript the model read. Not a Device field — shown/handled
  // separately. `null` when this scan read no text.
  extractedText: string | null;
  // True only when the transcript was written to the attachment (the
  // `attachmentId` branch). A best-effort DB failure still returns 200 with the
  // draft, so the UI must not claim search will find it unless this is true.
  extractedTextStored: boolean;
};

// extractReceipt sends the id of an attachment that was already uploaded to the
// inbox (`POST /v1/attachments` with no deviceId). The Go side decrypts it,
// runs OCR, stores the transcript on that attachment, fuzzy-maps the catalog,
// and still never persists a Device.
export async function extractReceipt(body: ExtractReceiptBody): Promise<ApiResult<DraftDevice>> {
  const res = await apiFetch<{ draft: DraftDevice }>(
    'POST',
    '/v1/ai/extract-receipt',
    body,
  );
  if (!res.ok) return res;
  // Normalised rather than trusted so a draft missing `warnings` (older server,
  // truncated body) renders as "no advisories" instead of crashing the form.
  // `extractedTextStored` is normalised to `false` when absent: "not stored" is
  // the honest default and the one that keeps the notice from overclaiming.
  return {
    ok: true,
    data: {
      ...res.data.draft,
      warnings: normalizeDeviceWarnings(res.data.draft?.warnings),
      extractedTextStored: res.data.draft?.extractedTextStored === true,
    },
  };
}

// Toggle the per-user AI opt-in. Sending a receipt image to a third-party AI
// provider requires explicit consent (default OFF).
export async function setOptIn(enabled: boolean): Promise<ApiResult<{ aiOptIn: boolean }>> {
  return apiFetch<{ aiOptIn: boolean }>('PUT', '/v1/ai/opt-in', { enabled });
}
