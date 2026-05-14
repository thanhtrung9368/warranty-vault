// Typed client for the Go service's backup endpoints. The export endpoint
// streams a JSON file (Content-Disposition: attachment); we surface it as a
// raw text blob so the server action can parse it back into the typed
// `BackupExport` for callers that want to inspect it or re-serialise.

import { apiFetch, type ApiResult } from './client';
import { bearerHeader } from '@/lib/auth-cookie';

const BASE_URL = (process.env.GO_API_URL ?? 'http://localhost:4000').replace(/\/+$/, '');

// Shape mirrors api/internal/services/backup.go::BackupExport (version 5).
export type BackupExport = {
  version: 5;
  exportedAt: string;
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

export type ImportResult = {
  imported: number;
  skipped: number;
  wishlistImported: number;
  wishlistSkipped: number;
  subImported: number;
  subSkipped: number;
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
    return {
      ok: false,
      status: 0,
      error: 'network_error',
      message:
        err instanceof Error
          ? `Không kết nối được tới máy chủ: ${err.message}`
          : 'Không kết nối được tới máy chủ',
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
  const disposition = res.headers.get('Content-Disposition');
  let filename: string | null = null;
  if (disposition) {
    const m = disposition.match(/filename="?([^";]+)"?/i);
    if (m) filename = m[1];
  }
  return { ok: true, body, filename };
}

// Imports a payload object. The Go service expects raw JSON; pass the parsed
// object and it will be re-serialized. Mode is encoded as a query parameter
// (?mode=merge|replace) to match the handler.
export async function importJson(
  payload: unknown,
  mode: 'merge' | 'replace' = 'merge',
): Promise<ApiResult<{ ok: boolean; result: ImportResult }>> {
  return apiFetch<{ ok: boolean; result: ImportResult }>(
    'POST',
    `/v1/backup/import?mode=${encodeURIComponent(mode)}`,
    payload,
  );
}
