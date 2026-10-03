// Typed wrapper around the Go AI extraction endpoint.
//
// Wire shape matches `DraftDevice` in api/internal/services/ai_extract.go and
// the `DraftDevice` schema in openapi.yaml. The endpoint returns a DRAFT only —
// the user always confirms before the device is created.

import { apiFetch, type ApiResult } from './client';
import { normalizeDeviceWarnings } from '@/lib/device-warnings';
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
};

// extractReceipt sends a receipt / warranty-card image (multipart `file`) to
// the Go OCR endpoint and returns the extracted draft. The Go side decrypts /
// validates, calls the model, fuzzy-maps the catalog, and never persists.
export async function extractReceipt(formData: FormData): Promise<ApiResult<DraftDevice>> {
  const res = await apiFetch<{ draft: DraftDevice }>(
    'POST',
    '/v1/ai/extract-receipt',
    formData,
    { multipart: true },
  );
  if (!res.ok) return res;
  // Normalised rather than trusted so a draft missing `warnings` (older server,
  // truncated body) renders as "no advisories" instead of crashing the form.
  return {
    ok: true,
    data: { ...res.data.draft, warnings: normalizeDeviceWarnings(res.data.draft?.warnings) },
  };
}

// Toggle the per-user AI opt-in. Sending a receipt image to a third-party AI
// provider requires explicit consent (default OFF).
export async function setOptIn(enabled: boolean): Promise<ApiResult<{ aiOptIn: boolean }>> {
  return apiFetch<{ aiOptIn: boolean }>('PUT', '/v1/ai/opt-in', { enabled });
}
