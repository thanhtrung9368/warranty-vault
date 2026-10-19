'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { api, toFormState, type ApiResult, type FormState } from '@/lib/api';
import type { DeviceDetail, DeviceInput } from '@/lib/api/devices';
import { returnWindowFieldsFromFormData } from '@/lib/device-return-window';
import { leadDaysError, leadDaysFromFormData } from '@/lib/lead-days';
import {
  brandWarrantyIssueList,
  brandWarrantyTimestamp,
  brandWarrantyValues,
  brandWarrantyWriteFields,
  normalizeBrandWarrantyStatus,
} from '@/lib/brand-warranty';
import {
  fxRateForCurrency,
  fxRateProblem,
  normalizeCurrency,
  type FxRateProblem,
} from '@/lib/currency';
import {
  clearDeviceWarningsFlash,
  setDeviceWarningsFlash,
} from '@/lib/device-warnings-flash';
import { requireUser } from '@/lib/auth';
import type { Translator } from '@/lib/i18n/catalog';
import { getI18n } from '@/lib/i18n/server';
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

// Booleans are always shipped by the form as the literal `'true'`/`'false'`
// (the checkbox is controlled and a hidden input carries its state), so
// anything else — including a missing key from an older form — is false, which
// is also the server's default.
function bool(formData: FormData, key: string): boolean {
  return formData.get(key) === 'true';
}

function buildDeviceInput(formData: FormData): DeviceInput {
  // Required fields are surfaced as empty strings — server returns 400 with
  // Vietnamese fieldErrors which are passed through as-is.
  const status = str(formData, 'status');
  // Multi-currency: `currency` defaults to VND (the server default) and a VND
  // device NEVER carries a rate — a stale hidden field is dropped here, not
  // forwarded. A non-VND device keeps the parsed integer; the pre-flight check
  // below rejects a missing/invalid one before any request is made.
  const currency = normalizeCurrency(str(formData, 'currency'));
  const fxRate = fxRateForCurrency(currency, num(formData, 'fxRate') ?? null);
  // Repeated `leadDays` entries (the chip control) need their own parser:
  // `str()`/`num()` only see one scalar value. Absent stays absent so Go
  // applies its [30, 7] create default or keeps the stored list on update.
  const leadDays = leadDaysFromFormData(formData);
  // The brand-warranty section's "not checked" option is a UI sentinel, not a
  // wire value: map it to null here, but leave any OTHER unrecognised code as-is
  // so the pre-flight below rejects it instead of silently erasing an answer.
  const brandStatusRaw = str(formData, 'brandWarrantyStatus') ?? null;
  const brandStatus = brandStatusRaw === 'unset' ? null : brandStatusRaw;
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
    // Both are ALWAYS sent: PATCH replaces the whole device, so omitting them
    // would let an edit silently reset a foreign-currency device to VND.
    currency,
    fxRate,
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
    // Warranty activation (Feature A). All three keys are ALWAYS sent, because
    // PATCH replaces the whole device: an omitted key would silently erase an
    // activation recorded on another client (same trap as the resale pair).
    // `activatedAt` is passed through verbatim — a day string is what the date
    // input gives us and what the server accepts — and is deliberately NOT
    // compared with `purchaseDate`: pre-activation by the shop is legal.
    activationRequired: bool(formData, 'activationRequired'),
    activatedAt: str(formData, 'activatedAt') ?? null,
    extendedCoverBuyBy: str(formData, 'extendedCoverBuyBy') ?? null,
    // ── Brand warranty answer (frozen five) ────────────────────────────────
    // ALWAYS sent for the same full-replacement reason as the activation and
    // return-window fields: the form carries the stored values in hidden inputs,
    // so editing the device name cannot erase a check recorded on this or another
    // client. The two dates go through verbatim (`YYYY-MM-DD` from the date
    // inputs, or a stored Z-less timestamp); `brandCheckedAt` is preserved unless
    // the form's brand-warranty section stamped a new one. Go remains the
    // authority for the three rules — the pre-flight below only saves a round-trip.
    brandWarrantyStatus: brandStatus as DeviceInput['brandWarrantyStatus'],
    brandWarrantyStart: str(formData, 'brandWarrantyStart') ?? null,
    brandWarrantyEnd: str(formData, 'brandWarrantyEnd') ?? null,
    // Normalised to a shape Go's date parser accepts: the value read back from
    // the API is Z-less and can carry fractional seconds, which its parser
    // rejects on the way back in. The wall-clock time is preserved (only the
    // fraction is dropped), so a device save that does not touch the brand answer
    // keeps its timestamp exactly.
    brandCheckedAt: brandWarrantyTimestamp(str(formData, 'brandCheckedAt')),
    brandLookupUrl: str(formData, 'brandLookupUrl') ?? null,
    ...(leadDays === undefined ? {} : { leadDays }),
  };
}

// Client-side pre-flight for the rules the form already knows:
//
//   - at least one reminder day (Go's 400 remains the authority for the rest);
//   - a non-VND device needs a positive integer fxRate, and a VND device must
//     not carry one (the latter is normalized away in `buildDeviceInput`, so it
//     can never reach the wire);
//   - the brand-warranty triple: status required with any other value, end not
//     before start, absolute http(s) lookup URL.
//
// The messages are catalog keys, so a rejection before the round-trip reads in
// the active language exactly like the server's own `fieldErrors`.
function fxRateMessage(problem: FxRateProblem, t: Translator): string {
  return problem === 'required'
    ? t('Vui lòng nhập tỷ giá.')
    : t('Tỷ giá phải là số nguyên lớn hơn 0.');
}

async function preflightFormState(input: DeviceInput): Promise<DeviceFormState | null> {
  const leadKey = leadDaysError(input.leadDays);
  const fxProblem = fxRateProblem(input.currency, input.fxRate);
  // `brandWarrantyIssueList` returns Vietnamese catalog keys, not rendered
  // sentences, so the pre-flight reads like the server's own Vietnamese errors
  // in both languages.
  const brandIssues = brandWarrantyIssueList({
    status: input.brandWarrantyStatus ?? null,
    start: input.brandWarrantyStart ?? null,
    end: input.brandWarrantyEnd ?? null,
    url: input.brandLookupUrl ?? null,
  });
  if (!leadKey && !fxProblem && brandIssues.length === 0) return null;
  const { t } = await getI18n();
  const errors: Record<string, string[]> = {};
  if (leadKey) errors.leadDays = [t(leadKey)];
  if (fxProblem) errors.fxRate = [fxRateMessage(fxProblem, t)];
  for (const issue of brandIssues) {
    errors[issue.field] = [...(errors[issue.field] ?? []), t(issue.key)];
  }
  return { ok: false, errors };
}

export async function createDevice(
  _prev: DeviceFormState,
  formData: FormData,
): Promise<DeviceFormState> {
  const input = buildDeviceInput(formData);
  const invalid = await preflightFormState(input);
  if (invalid) return invalid;
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
  const invalid = await preflightFormState(input);
  if (invalid) return invalid;
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

// ── Brand warranty check (the five frozen fields) ────────────────────────────
//
// The detail page records what the brand's own system said. There is no
// dedicated endpoint: the contract puts the five nullable fields on Device and
// every client writes them through the existing `PATCH /v1/devices/{id}`.
//
// `PATCH` replaces the whole device, so this action cannot send "just the five".
// It reads the device first and rebuilds the complete `DeviceInput` from it,
// then overlays the answer (and `brandCheckedAt = now`). That is the same
// full-payload discipline `DeviceForm` uses for resale/activation/return-window;
// omitting the read would risk clearing unrelated fields on a partial update.

/** Rebuild the complete PATCH payload from the device as the server sent it. */
function deviceToInput(device: DeviceDetail): DeviceInput {
  // The edit form uses the OLDEST standard warranty (see the edit page), so
  // re-saving a device here must resolve to the same row. `warrantyMonths` etc.
  // are therefore idempotent, not a second copy.
  const standard = device.warranties
    .filter((w) => w.type === 'STANDARD')
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))[0];

  return {
    name: device.name,
    category: device.category,
    brand: device.brand,
    model: device.model,
    serialNumber: device.serialNumber,
    purchaseDate: device.purchaseDate,
    purchasePrice: device.purchasePrice,
    currency: device.currency,
    fxRate: device.fxRate,
    purchasePlace: device.purchasePlace,
    status: device.status as DeviceInput['status'],
    notes: device.notes,
    soldAt: device.soldAt,
    soldPrice: device.soldPrice,
    returnWindowDays: device.returnWindowDays,
    receivedAt: device.receivedAt,
    warrantyMonths: standard?.months ?? 0,
    warrantyProvider: standard?.provider ?? null,
    warrantyAddress: standard?.address ?? null,
    warrantyPhone: standard?.phone ?? null,
    warrantyNotes: standard?.notes ?? null,
    leadDays: device.leadDays,
    activationRequired: device.activationRequired,
    activatedAt: device.activatedAt,
    extendedCoverBuyBy: device.extendedCoverBuyBy,
    ...brandWarrantyWriteFields(brandWarrantyValues(device), device.brandCheckedAt),
  };
}

/**
 * Record (or erase) the brand's answer.
 *
 * Field order and errors follow the other actions: a local check returns
 * translated `fieldErrors` without a round-trip, and anything Go rejects is
 * passed through by `toFormState` untouched.
 *
 * A completely blank draft is the explicit "erase" signal: all five fields are
 * sent as null and `brandCheckedAt` is cleared too. A blank status WITH a date or
 * URL is rejected locally (`brandWarrantyStatus`), because silently discarding
 * the other values would be worse than asking which status the brand showed.
 */
export async function saveBrandWarrantyCheck(
  deviceId: string,
  _prev: DeviceFormState,
  formData: FormData,
): Promise<DeviceFormState> {
  // Kept RAW for validation so an unrecognised status is rejected instead of
  // being normalised to null and silently treated as "erase". Only the UI's
  // "not checked" sentinel is mapped to null here.
  const rawStatus = str(formData, 'brandWarrantyStatus') ?? null;
  const values = {
    status: rawStatus === 'unset' ? null : rawStatus,
    start: str(formData, 'brandWarrantyStart') ?? null,
    end: str(formData, 'brandWarrantyEnd') ?? null,
    // The URL input is prefilled from the lookup link the owner opened, but it
    // stays optional: the brand answered in person / by phone often enough.
    url: str(formData, 'brandLookupUrl') ?? null,
  };

  const issues = brandWarrantyIssueList(values);
  if (issues.length > 0) {
    const { t } = await getI18n();
    const errors: Record<string, string[]> = {};
    for (const issue of issues) {
      errors[issue.field] = [...(errors[issue.field] ?? []), t(issue.key)];
    }
    return { ok: false, errors };
  }

  const current = await api.devices.get(deviceId);
  if (!current.ok) return toFormState(current);

  const status = normalizeBrandWarrantyStatus(values.status);
  // `brandCheckedAt` is set to NOW by the server action (item 4 of the brief):
  // the moment the owner recorded the answer, not a client clock the browser
  // happened to send. A clear sends null through `brandWarrantyWriteFields`.
  const checkedAt = status ? new Date().toISOString() : null;
  const input = {
    ...deviceToInput(current.data),
    ...brandWarrantyWriteFields(
      {
        status,
        start: values.start,
        end: values.end,
        checkedAt,
        url: values.url,
      },
      checkedAt,
    ),
  };

  const res = await api.devices.update(deviceId, input);
  if (!res.ok) return toFormState(res);

  // The detail page is `force-dynamic`, but a server action needs this to make
  // the RSC refresh on the SAME navigation; it also keeps the list pages honest
  // if they ever start showing the recorded status.
  revalidatePath(`/devices/${deviceId}`);
  const { t } = await getI18n();
  return { ok: true, message: t('Đã ghi kết quả đối chiếu với hãng.') };
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

// Per-row failure copy. Go answers a rejected create with `message` (already in
// the request's language) and/or `fieldErrors`; the field-level strings are the
// precise ones ("Ngày mua không hợp lệ"), so they win when present.
async function pasteRowError(res: ApiResult<unknown>, t: Translator): Promise<string> {
  const state = await toFormState(res);
  const fieldMessages = Object.values(state.errors ?? {}).flat();
  if (fieldMessages.length > 0) return fieldMessages.join(' · ');
  return state.message ?? t('Không tạo được thiết bị');
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
  const { locale, t } = await getI18n();

  if (text.trim() === '') {
    return {
      ok: false,
      message: t('Chưa có dữ liệu để nhập — dán bảng vào ô bên trên nhé.'),
    };
  }

  const catalog = await getDeviceFormCatalog();
  const preview = parsePasteImport(text, {
    categories: catalog.categories,
    headerMode,
    locale,
  });

  const results: PasteImportRowResult[] = [];
  if (preview.empty || preview.rows.length === 0) {
    return {
      ok: false,
      message: t(
        'Không đọc được dòng dữ liệu nào từ nội dung đã dán. Kiểm tra lại tiêu đề cột hoặc chọn "Dòng đầu là dữ liệu".',
      ),
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
            ? t('Chưa tạo — đã dừng vì chạm giới hạn thiết bị.')
            : t('Chưa tạo — đã dừng vì thao tác quá nhanh.'),
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
    const message = await pasteRowError(res, t);
    results.push({ line: row.line, name: row.name, status: 'failed', message });
    if (res.status === 409 || res.status === 429) {
      // The server's own message explains the limit and is shown as-is.
      stopReason = res.status === 409 ? 'limit' : 'rate';
      stopMessage = message;
    }
  }

  // Every page that reads devices is `force-dynamic`, so this is defensive
  // rather than required (same reasoning as `createDevice` above) — kept because
  // a bulk write is the one case where a stale client-side view is most likely.
  revalidatePath('/devices');

  const attempted = createdCount + failedCount;
  const parts: string[] = [];
  if (createdCount > 0) {
    parts.push(t('Đã tạo {created} thiết bị.', { created: createdCount, count: createdCount }));
    if (skippedCount > 0) {
      parts.push(t('Bỏ qua {skipped} dòng lỗi.', { skipped: skippedCount, count: skippedCount }));
    }
    if (failedCount > 0) {
      parts.push(
        t('{failed} dòng máy chủ từ chối.', { failed: failedCount, count: failedCount }),
      );
    }
    if (notAttemptedCount > 0) {
      parts.push(
        t('{missing} dòng chưa tạo.', { missing: notAttemptedCount, count: notAttemptedCount }),
      );
    }
  } else if (attempted === 0) {
    parts.push(
      t('Không có dòng nào hợp lệ để tạo ({count} dòng lỗi).', {
        count: skippedCount,
      }),
    );
  } else {
    parts.push(t('Không tạo được thiết bị nào — xem lý do ở từng dòng bên dưới.'));
  }
  const message = parts.join(' ');

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
