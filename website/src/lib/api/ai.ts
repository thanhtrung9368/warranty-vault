// Typed wrapper around the Go AI extraction endpoint.
//
// Wire shape matches `DraftDevice` in api/internal/services/ai_extract.go and
// the `DraftDevice` schema in openapi.yaml. The endpoint returns a DRAFT only —
// the user always confirms before the device is created.

import { apiFetch, type ApiResult } from './client';

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
  unmatched: string[];
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
  return { ok: true, data: res.data.draft };
}

// Toggle the per-user AI opt-in. Sending a receipt image to a third-party AI
// provider requires explicit consent (default OFF).
export async function setOptIn(enabled: boolean): Promise<ApiResult<{ aiOptIn: boolean }>> {
  return apiFetch<{ aiOptIn: boolean }>('PUT', '/v1/ai/opt-in', { enabled });
}
