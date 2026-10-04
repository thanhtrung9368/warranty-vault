// Typed client for the Go service's backup endpoints. The export endpoint
// streams a file (Content-Disposition: attachment); we surface the JSON one as
// a raw text blob so the server action can parse it back into the typed
// `BackupExport` for callers that want to inspect it or re-serialise.
//
// The blob-carrying export (`?includeBlobs=true`, a real .zip) does NOT go
// through this module: it is streamed by `src/app/api/backup/export/route.ts`,
// and imports — JSON or zip, the server sniffs — are streamed by
// `src/app/api/backup/import/route.ts`. Server actions cap their request body at
// 10 MB, which an archive with invoice images blows past.

import { bearerHeader } from '@/lib/auth-cookie';
import { translate } from '@/lib/i18n/catalog';
import { getLocale } from '@/lib/i18n/server';
import { filenameFromDisposition } from '@/lib/backup-media';

const BASE_URL = (process.env.GO_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

// Shape mirrors api/internal/services/backup.go::BackupExport.
// Version 5 = the JSON export (metadata only); version 6 = the `data.json`
// inside the .zip (`includesAttachmentBytes: true`, blobs beside it under
// `attachments/<storagePath>`).
export type BackupExport = {
  version: 5 | 6;
  exportedAt: string;
  // Self-describing honesty fields. `attachmentBytesNote` is the server's own
  // Vietnamese warning and is what the UI surfaces — see `@/lib/backup-media`
  // for the mirrored constants used before a download.
  includesAttachmentBytes?: boolean;
  attachmentBytesNote?: string;
  // Only in the .zip export, and only when a blob was absent from disk.
  missingAttachmentIds?: string[];
  subscriptions: Array<{
    id: string;
    name: string;
    category: string | null;
    brand: string | null;
    plan: string | null;
    billingCycle: string;
    intervalDays: number | null;
    price: number;
    currency: string;
    startedAt: string;
    renewalDate: string;
    autoRenew: boolean;
    status: string;
    accountEmail: string | null;
    paymentMethod: string | null;
    manageUrl: string | null;
    cancelUrl: string | null;
    notes: string | null;
    createdAt: string;
    updatedAt: string;
    payments: Array<{ id: string; amount: number; paidAt: string; note: string | null }>;
  }>;
  wishlist: Array<{
    id: string;
    name: string;
    category: string | null;
    brand: string | null;
    initialPrice: number | null;
    currentPrice: number | null;
    buyUrl: string | null;
    imageUrl: string | null;
    targetDate: string | null;
    priority: string;
    status: string;
    notes: string | null;
    reminderIntervalDays: number | null;
    lastNotifiedAt: string | null;
    purchasedDeviceId: string | null;
    createdAt: string;
    updatedAt: string;
    prices: Array<{ id: string; price: number; note: string | null; recordedAt: string }>;
  }>;
  devices: Array<{
    id: string;
    name: string;
    category: string;
    brand: string | null;
    model: string | null;
    serialNumber: string | null;
    purchaseDate: string;
    purchasePrice: number;
    purchasePlace: string | null;
    status: string;
    notes: string | null;
    // Resale pair (migration 0006). Format differs from `/v1/devices`: the
    // backup JSON uses RFC3339 *with* the `Z` suffix. An export older than
    // schema v5 simply has no keys here → "not sold" on import. The web only
    // re-serialises the parsed payload, so these round-trip untouched.
    soldAt?: string | null;
    soldPrice?: number | null;
    createdAt: string;
    updatedAt: string;
    warranties: Array<{
      id: string;
      type: string;
      provider: string | null;
      startDate: string;
      endDate: string;
      months: number;
      cost: number | null;
      address: string | null;
      phone: string | null;
      notes: string | null;
      createdAt: string;
      updatedAt: string;
      reminders: Array<{ id: string; isDismissed: boolean; createdAt: string }>;
    }>;
    attachments: Array<{
      id: string;
      fileName: string;
      storagePath: string;
      fileType: string;
      fileSize: number;
      iv: string;
      wrappedKey: string;
      description: string | null;
      uploadedAt: string;
    }>;
  }>;
};

// Mirrors services.ImportResult (openapi `ImportResult`). The three attachment
// counters are only non-zero for a .zip import: `attachmentsImported` counts
// blobs written to PRIVATE_UPLOAD_ROOT, `attachmentsSkipped` counts blobs
// skipped together with an already-existing device (merge mode), and
// `attachmentsUnreadable` counts blobs that were restored but cannot be
// decrypted with this server's FILE_MASTER_KEY (or were already missing when
// the archive was written). The last one must be shown to the user.
export type ImportResult = {
  imported: number;
  skipped: number;
  wishlistImported: number;
  wishlistSkipped: number;
  subImported: number;
  subSkipped: number;
  attachmentsImported: number;
  attachmentsSkipped: number;
  attachmentsUnreadable: number;
};

// Streams the raw JSON file (preserves Content-Disposition / filename). The
// server action either re-streams it to the browser or parses + redisplays.
export async function exportRaw(): Promise<
  | { ok: true; body: string; filename: string | null }
  | { ok: false; status: number; error: string; message?: string }
> {
  const headers: Record<string, string> = {};
  Object.assign(headers, await bearerHeader());
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/v1/backup/export`, {
      method: 'GET',
      headers,
      cache: 'no-store',
    });
  } catch (err) {
    console.error('[api] backup export failed:', err);
    return {
      ok: false,
      status: 0,
      error: 'network_error',
      // Our own sentence (Go never saw the request), so it is rendered in the
      // request's language here.
      message: translate(await getLocale(), 'Mất kết nối tới máy chủ, thử lại sau nhé.'),
    };
  }
  if (!res.ok) {
    let parsed: { error?: string; message?: string } = {};
    try {
      parsed = await res.json();
    } catch {
      // ignore
    }
    return {
      ok: false,
      status: res.status,
      error: parsed.error ?? `http_${res.status}`,
      message: parsed.message,
    };
  }
  const body = await res.text();
  const filename = filenameFromDisposition(res.headers.get('Content-Disposition'));
  return { ok: true, body, filename };
}
