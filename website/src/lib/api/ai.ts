// Typed wrappers around the Go AI endpoints: receipt extraction and warranty
// claim assessment.
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
import { normalizeClaimAssessment, type ClaimAssessment } from '@/lib/claim-assessment';
import type { ExtractReceiptBody } from '@/lib/receipt-scan';
import type { DeviceWarning } from './devices';

// The assessment wire types are owned by `lib/claim-assessment.ts` (the pure
// half) and re-exported here so callers keep finding AI wire shapes in one
// module. Keeping the definition in the pure module is what lets its label /
// gate / letter rules be unit-tested without importing the API client.
export type {
  ClaimAssessment,
  ClaimAssessmentConfidence,
  ClaimAssessmentCoverage,
} from '@/lib/claim-assessment';

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

// Assess ONE claim against the contract terms the account already recorded.
//
// Frozen contract: `POST /v1/ai/assess-claim { claimId }` → the assessment
// object directly (not wrapped in an envelope). It WRITES NOTHING — no status
// change, no stored result — so callers must not `revalidatePath` after it and
// the UI must treat it as advice, never as a claim outcome. Gates are 503
// `feature_disabled` and 403 `ai_optin_required`; `lib/claim-assessment.ts`
// maps those to normal UI states.
//
// The response is normalised rather than trusted for the same reason the
// receipt draft is: an unknown coverage must degrade to UNCLEAR (not a guess)
// and an unknown confidence to LOW (not HIGH), so a malformed or newer-server
// body can never look more certain than it is.
export async function assessClaim(
  claimId: string,
): Promise<ApiResult<ClaimAssessment>> {
  const res = await apiFetch<unknown>('POST', '/v1/ai/assess-claim', {
    claimId,
  });
  if (!res.ok) return res;
  return { ok: true, data: normalizeClaimAssessment(res.data, claimId) };
}
