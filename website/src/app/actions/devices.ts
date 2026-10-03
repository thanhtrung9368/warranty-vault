'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { api, toFormState, type ApiResult, type FormState } from '@/lib/api';
import type { DeviceInput } from '@/lib/api/devices';
import { returnWindowFieldsFromFormData } from '@/lib/device-return-window';
import {
  clearDeviceWarningsFlash,
  setDeviceWarningsFlash,
} from '@/lib/device-warnings-flash';
import { requireUser } from '@/lib/auth';
import { getDeviceFormCatalog } from '@/app/actions/catalog';
import {
  parsePasteImport,
  pasteDraftToInput,
  type PasteHeaderMode,
} from '@/lib/device-paste';

export type DeviceFormState = FormState;

// Pull a string FormData entry, converting empty / non-string to undefined so
// the Go Zod-equivalent validator's blank-to-null preprocess kicks in.
function str(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  if (typeof v !== 'string' || v === '') return undefined;
  return v;
}

function num(formData: FormData, key: string): number | undefined {
  const v = formData.get(key);
  if (typeof v !== 'string' || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function buildDeviceInput(formData: FormData): DeviceInput {
  // Required fields are surfaced as empty strings — server returns 400 with
  // Vietnamese fieldErrors which are passed through as-is.
  const status = str(formData, 'status');
  // Resale pair: both keys are ALWAYS sent, so "no sale" is an explicit
  // `{soldAt: null, soldPrice: null}` (the server's clear signal) rather than
  // one key silently going missing and tripping the pair rule. `num()` keeps a
  // legitimate `0` (cho tặng) — only a blank/!finite value becomes null.
  return {
    name: str(formData, 'name') ?? '',
    category: str(formData, 'category') ?? '',
    brand: str(formData, 'brand') ?? null,
    model: str(formData, 'model') ?? null,
    serialNumber: str(formData, 'serialNumber') ?? null,
    purchaseDate: str(formData, 'purchaseDate') ?? '',
    purchasePrice: num(formData, 'purchasePrice') ?? 0,
    purchasePlace: str(formData, 'purchasePlace') ?? null,
    status: status as DeviceInput['status'],
    notes: str(formData, 'notes') ?? null,
    soldAt: str(formData, 'soldAt') ?? null,
    soldPrice: num(formData, 'soldPrice') ?? null,
    // Return window (migration 0010). PATCH is a full replacement, so these two
    // keys are ALWAYS sent — the form keeps them in always-mounted hidden inputs
    // and this spreads the parsed pair through. A device edited from the web
    // therefore cannot silently erase a window recorded on another client:
    // `{returnWindowDays: null, receivedAt: null}` only ever means "there is no
    // window to preserve". See `lib/device-return-window.ts`.
    ...returnWindowFieldsFromFormData(formData),
    warrantyMonths: num(formData, 'warrantyMonths') ?? 0,
    warrantyProvider: str(formData, 'warrantyProvider') ?? null,
    warrantyAddress: str(formData, 'warrantyAddress') ?? null,
    warrantyPhone: str(formData, 'warrantyPhone') ?? null,
    warrantyNotes: str(formData, 'warrantyNotes') ?? null,
  };
}

export async function createDevice(
  _prev: DeviceFormState,
  formData: FormData,
): Promise<DeviceFormState> {
  const input = buildDeviceInput(formData);
  const fromWishlistId = str(formData, 'fromWishlistId') ?? null;

  const res = await api.devices.create({ ...input, fromWishlistId });
  if (!res.ok) return toFormState(res);

  // The device WAS created — `warnings` are advisory findings about the serial
  // (wrong IMEI checksum, odd length, a serial already used on another device).
  // They cannot ride on the redirect, so they are flashed to the device page,
  // which renders them above the saved values. Empty list → no cookie at all.
  await setDeviceWarningsFlash(res.data.device.id, res.data.warnings);

  // No revalidatePath: every page that reads this data (/dashboard, /devices,
  // /reminders, /wishlist[/id]) is `export const dynamic = 'force-dynamic'`,
  // so a path revalidation would be a no-op anyway.
  redirect(`/devices/${res.data.device.id}`);
}

export async function updateDevice(
  id: string,
  _prev: DeviceFormState,
  formData: FormData,
): Promise<DeviceFormState> {
  const input = buildDeviceInput(formData);
  const res = await api.devices.update(id, input);
  if (!res.ok) return toFormState(res);

  // Same advisory channel as create, keyed to the device being edited so the
  // banner cannot surface on another device's page. Go excludes the device being
  // edited from the duplicate check, so re-saving the same serial warns about
  // nothing.
  await setDeviceWarningsFlash(res.data.device.id || id, res.data.warnings);

  // No revalidatePath — the affected pages are all `force-dynamic` (see createDevice).
  redirect(`/devices/${id}`);
}

// Called by `DeviceWarningsBanner` once the flash has been displayed, so a saved
// serial that looks wrong is reported exactly once (not on every later render).
export async function dismissDeviceWarnings(): Promise<void> {
  await clearDeviceWarningsFlash();
}

export async function deleteDevice(id: string) {
  // Best-effort delete; either way redirect back to the list. The Go service
  // 404s for not-found / not-owned, which we treat as a successful no-op.
  await api.devices.remove(id);
  // No revalidatePath — the affected pages are all `force-dynamic`.
  redirect('/devices');
}

// ── Paste a table → many devices (FEATURE_IDEAS #13) ────────────────────────
//
// The client sends only the RAW PASTED TEXT. Parsing happens again here with the
// same pure function the preview used (`@/lib/device-paste`), so what the user
// saw is exactly what is created and no client-supplied draft is trusted.
//
// Each row goes through the SAME write path the single-device form uses
// (`api.devices.create` → `POST /api/v1/devices`): no new endpoint, no new
// validation, and the server's Vietnamese `fieldErrors`/`message` are surfaced
// per row. Rows are created SEQUENTIALLY on purpose — a clear per-row report of
// a partial import matters more here than speed.

export type PasteImportRowStatus = 'created' | 'skipped' | 'failed' | 'not_attempted';

export type PasteImportRowResult = {
  /** 1-based line number in the pasted text. */
  line: number;
  name: string;
  status: PasteImportRowStatus;
  deviceId?: string;
  /** Vietnamese: the server's own message, or the parser's reasons. */
  message?: string;
  /** Advisory serial findings on a row that WAS created (already Vietnamese). */
  warnings?: string[];
};

export type PasteImportState = FormState & {
  results?: PasteImportRowResult[];
  createdCount?: number;
  failedCount?: number;
  skippedCount?: number;
  notAttemptedCount?: number;
  /**
   * Why the run stopped before the last row: `limit` = the per-user device cap
   * (409), `rate` = quá nhanh (429). The remaining rows are reported as
   * `not_attempted` instead of firing requests that would fail identically.
   */
  stopReason?: 'limit' | 'rate';
  /** The server's own Vietnamese message for the row that stopped the run. */
  stopMessage?: string;
};

function pasteHeaderMode(value: unknown): PasteHeaderMode {
  return value === 'yes' || value === 'no' ? value : 'auto';
}

// Per-row failure copy. Go answers a rejected create with `message` (Vietnamese)
// and/or `fieldErrors`; the field-level strings are the precise ones ("Ngày mua
// không hợp lệ"), so they win when present.
function pasteRowError(res: ApiResult<unknown>): string {
  const state = toFormState(res);
  const fieldMessages = Object.values(state.errors ?? {}).flat();
  if (fieldMessages.length > 0) return fieldMessages.join(' · ');
  return state.message ?? 'Không tạo được thiết bị';
}

export async function importDevicesFromPaste(
  _prev: PasteImportState,
  formData: FormData,
): Promise<PasteImportState> {
  // Identity first (the API would 401 anyway, but the page this action serves is
  // behind `requireUser()` and the action must not be usable without it).
  await requireUser();

  const text = str(formData, 'text') ?? '';
  const headerMode = pasteHeaderMode(formData.get('headerMode'));

  if (text.trim() === '') {
    return { ok: false, message: 'Chưa có dữ liệu để nhập — dán bảng vào ô bên trên nhé.' };
  }

  const catalog = await getDeviceFormCatalog();
  const preview = parsePasteImport(text, { categories: catalog.categories, headerMode });

  const results: PasteImportRowResult[] = [];
  if (preview.empty || preview.rows.length === 0) {
    return {
      ok: false,
      message:
        'Không đọc được dòng dữ liệu nào từ nội dung đã dán. Kiểm tra lại tiêu đề cột hoặc chọn "Dòng đầu là dữ liệu".',
    };
  }

  let createdCount = 0;
  let failedCount = 0;
  let skippedCount = 0;
  let notAttemptedCount = 0;
  let stopMessage: string | undefined;
  // Set once a row hits the per-user device limit (409) or the write rate limit
  // (429): every remaining row would fail identically, so they are reported as
  // "chưa tạo" instead of firing doomed requests. THE DEVICE LIMIT IS NEVER
  // NAMED HERE — the Vietnamese copy shown to the user is the server's own
  // message, which keeps this correct while the quota policy changes (sold
  // devices may stop counting).
  let stopReason: 'limit' | 'rate' | undefined;

  for (const row of preview.rows) {
    if (row.draft == null) {
      skippedCount += 1;
      results.push({
        line: row.line,
        name: row.name,
        status: 'skipped',
        message: row.errors.join(' · '),
      });
      continue;
    }
    if (stopReason) {
      notAttemptedCount += 1;
      results.push({
        line: row.line,
        name: row.name,
        status: 'not_attempted',
        message:
          stopReason === 'limit'
            ? 'Chưa tạo — đã dừng vì chạm giới hạn thiết bị.'
            : 'Chưa tạo — đã dừng vì thao tác quá nhanh.',
      });
      continue;
    }

    const res = await api.devices.create(pasteDraftToInput(row.draft));
    if (res.ok) {
      createdCount += 1;
      results.push({
        line: row.line,
        name: row.name,
        status: 'created',
        deviceId: res.data.device.id,
        warnings: res.data.warnings.map((w) => w.message),
      });
      continue;
    }

    failedCount += 1;
    const message = pasteRowError(res);
    results.push({ line: row.line, name: row.name, status: 'failed', message });
    if (res.status === 409 || res.status === 429) {
      // The server's Vietnamese message explains the limit and is shown as-is.
      stopReason = res.status === 409 ? 'limit' : 'rate';
      stopMessage = message;
    }
  }

  // Every page that reads devices is `force-dynamic`, so this is defensive
  // rather than required (same reasoning as `createDevice` above) — kept because
  // a bulk write is the one case where a stale client-side view is most likely.
  revalidatePath('/devices');

  const attempted = createdCount + failedCount;
  let message: string;
  if (createdCount > 0) {
    message = `Đã tạo ${createdCount} thiết bị.`;
    if (skippedCount > 0) message += ` Bỏ qua ${skippedCount} dòng lỗi.`;
    if (failedCount > 0) message += ` ${failedCount} dòng máy chủ từ chối.`;
    if (notAttemptedCount > 0) message += ` ${notAttemptedCount} dòng chưa tạo.`;
  } else if (attempted === 0) {
    message = `Không có dòng nào hợp lệ để tạo (${skippedCount} dòng lỗi).`;
  } else {
    message = 'Không tạo được thiết bị nào — xem lý do ở từng dòng bên dưới.';
  }

  return {
    ok: createdCount > 0,
    message,
    results,
    createdCount,
    failedCount,
    skippedCount,
    notAttemptedCount,
    stopReason,
    stopMessage,
  };
}
