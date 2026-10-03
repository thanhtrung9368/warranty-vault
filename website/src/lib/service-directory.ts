// Pure helpers for the warranty service directory (FEATURE_IDEAS #15, openapi
// `ServiceDirectory` / `BrandServiceInfo` / `WarrantyCentre`).
//
// The endpoint answers one very concrete question — "giờ tôi mang máy đi đâu" —
// and its whole design is about NOT pretending to know things:
//
//   * `brand: null` means the app has no verified entry for that brand, or the
//     free-text match was ambiguous. It never means "no brand".
//   * `phoneSource ∈ {user, none}` says the app is never the source of a phone
//     number. `none` must never be rendered as if a hotline existed.
//   * every `null` is explained by the server's own Vietnamese `disclaimer`.
//
// Every decision above is a pure function here so the UI cannot drift from it,
// and the copy lives next to the logic that selects it.
//
// Nothing here touches the network or cookies: importable from RSC, client
// components and unit tests alike.

import { WARRANTY_TYPE_LABELS, type WarrantyType } from '@/lib/types';

// ---- Wire shapes (structural; `@/lib/api/directory` re-exports these) --------

export type BrandServiceInfo = {
  brandId: string;
  name: string;
  serviceLocatorUrl: string | null;
  supportUrl: string | null;
  notes: string | null;
};

export type DirectoryProviderRef = {
  id: string;
  name: string;
  phone: string | null;
  address: string | null;
  websiteUrl: string | null;
  notes: string | null;
};

export type PhoneSource = 'user' | 'none';

/**
 * What the API sends (`user | none`) plus one value it never promised:
 * `unknown`. Normalisation produces it for a payload with a number but no
 * usable source, and the UI has a branch for it — a phone is never silently
 * promoted to "the user typed this".
 */
export type PhoneSourceValue = PhoneSource | 'unknown';

export type WarrantyCentre = {
  warrantyId: string;
  warrantyType: string;
  endDate: string | null;
  isActive: boolean;
  providerInput: string | null;
  provider: DirectoryProviderRef | null;
  address: string | null;
  phone: string | null;
  phoneSource: PhoneSourceValue;
};

export type ServiceDirectory = {
  deviceId: string;
  deviceName: string;
  category: string;
  brandInput: string | null;
  brand: BrandServiceInfo | null;
  centres: WarrantyCentre[];
  disclaimer: string;
};

// ---- Copy --------------------------------------------------------------------

export const DIRECTORY_NO_BRAND_INPUT_TITLE = 'Thiết bị chưa ghi hãng';
export const DIRECTORY_NO_BRAND_INPUT_DETAIL =
  'Thêm hãng cho thiết bị (nút “Sửa” ở đầu trang) để app tra danh bạ trung tâm bảo hành uỷ quyền của hãng đó.';

export const DIRECTORY_NO_ENTRY_TITLE = 'App không có thông tin đã kiểm chứng cho hãng này';
export const DIRECTORY_NO_ENTRY_DETAIL =
  'App chỉ có danh bạ cho một số hãng, và khi chuỗi khớp bị mơ hồ (nhiều hãng cùng khớp) thì app không đoán. Bạn tra trang hỗ trợ chính thức của hãng để tìm trung tâm uỷ quyền gần nhất.';

export const DIRECTORY_NO_VERIFIED_LINK = 'App không có link nào đã kiểm chứng cho hãng này.';

export const DIRECTORY_LINK_SERVICE_LOCATOR_LABEL = 'Tra cứu trung tâm bảo hành uỷ quyền';
export const DIRECTORY_LINK_SUPPORT_LABEL = 'Trang hỗ trợ của hãng';

/** The honesty line rendered wherever a phone number appears (or does not). */
export const DIRECTORY_PHONE_HONESTY =
  'App không phải nguồn của số điện thoại nào: số hiện ra là do bạn tự ghi cho gói bảo hành, còn “chưa có số” nghĩa là app không biết — không phải hotline.';

export const DIRECTORY_PHONE_USER_LABEL = 'Do bạn tự ghi';
export const DIRECTORY_PHONE_USER_HINT = 'Số này bạn tự nhập cho gói bảo hành; app không kiểm chứng.';

export const DIRECTORY_PHONE_NONE_LABEL = 'Chưa có số điện thoại';
export const DIRECTORY_PHONE_NONE_HINT =
  'App không lưu hotline của hãng hay trung tâm nên không có số nào để hiện.';

export const DIRECTORY_PHONE_UNVERIFIED_LABEL = 'Nguồn số chưa rõ';
export const DIRECTORY_PHONE_UNVERIFIED_HINT =
  'Máy chủ không nói số này từ đâu tới, nên app không coi nó là số đã kiểm chứng.';

export const DIRECTORY_ADDRESS_USER_LABEL = 'Địa chỉ do bạn tự ghi';
export const DIRECTORY_ADDRESS_NONE = 'Chưa ghi địa chỉ cho gói này.';

export const DIRECTORY_PROVIDER_UNMATCHED =
  'Chưa khớp danh bạ nhà bảo hành — app hiện đúng chữ bạn đã ghi và không đoán.';

export const DIRECTORY_NO_CENTRES =
  'Thiết bị chưa có gói bảo hành nào nên chưa có nơi bảo hành nào để hiện. Thêm gói bảo hành rồi ghi nơi bạn sẽ mang máy tới.';

/** Section-level line: the app ships no hotline and no address of its own. */
export const DIRECTORY_SECTION_HINT =
  'App không lưu sẵn hotline hay địa chỉ trung tâm bảo hành — một hotline sai còn tệ hơn không có. Link của hãng bên dưới là nguồn duy nhất app dám chỉ; số điện thoại và địa chỉ còn lại là do bạn tự ghi.';

// ---- Normalisation -----------------------------------------------------------

function str(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const v = value.trim();
  return v === '' ? null : v;
}

function obj(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * `phoneSource` is the honesty mechanism, so it is the one field we refuse to
 * guess: `user` only when the server says so, `none` when there is no number,
 * and "unknown" (rendered as unverified) for anything else — including a phone
 * with no source at all, which must never be presented as the user's own word
 * nor as something the app checked.
 */
export function normalizePhoneSource(value: unknown, phone: string | null): PhoneSourceValue {
  if (value === 'user' || value === 'none') return value;
  return phone === null ? 'none' : 'unknown';
}

/**
 * Only http(s) ever reaches an `href`. The catalog is admin-curated, but a
 * catalog row is DATA, not code: a `javascript:` / `data:` value must not
 * become a clickable link in the card. Returns the original string (not the
 * parsed one) so what the admin typed is what is shown.
 */
export function safeExternalUrl(value: string | null | undefined): string | null {
  const raw = str(value);
  if (raw === null) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return raw;
  } catch {
    return null;
  }
}

function normalizeBrand(value: unknown): BrandServiceInfo | null {
  const o = obj(value);
  if (!o) return null;
  const brandId = str(o.brandId);
  const name = str(o.name);
  if (!brandId || !name) return null;
  return {
    brandId,
    name,
    serviceLocatorUrl: safeExternalUrl(str(o.serviceLocatorUrl)),
    supportUrl: safeExternalUrl(str(o.supportUrl)),
    notes: str(o.notes),
  };
}

function normalizeProvider(value: unknown): DirectoryProviderRef | null {
  const o = obj(value);
  if (!o) return null;
  const id = str(o.id);
  const name = str(o.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    phone: str(o.phone),
    address: str(o.address),
    websiteUrl: safeExternalUrl(str(o.websiteUrl)),
    notes: str(o.notes),
  };
}

function normalizeCentre(value: unknown): WarrantyCentre | null {
  const o = obj(value);
  if (!o) return null;
  const warrantyId = str(o.warrantyId);
  if (!warrantyId) return null;
  const providerInput = str(o.providerInput);
  const phone = str(o.phone);
  return {
    warrantyId,
    warrantyType: str(o.warrantyType) ?? '',
    endDate: str(o.endDate),
    isActive: o.isActive === true,
    providerInput,
    provider: normalizeProvider(o.provider),
    address: str(o.address),
    phone,
    phoneSource: normalizePhoneSource(o.phoneSource, phone),
  };
}

/**
 * Defensive read of `GET /v1/devices/{id}/service-directory`. Returns `null`
 * when the payload is not a directory at all, so the page can say "không tải
 * được" instead of rendering an empty card that looks like "no data exists".
 *
 * Unknown `phoneSource` values are folded onto `none`/`user` only when the
 * phone agrees; otherwise the caller sees the unverified branch (see
 * `phoneDisclosure`). `centres` is always an array.
 */
export function normalizeServiceDirectory(raw: unknown): ServiceDirectory | null {
  const o = obj(raw);
  if (!o) return null;
  const deviceId = str(o.deviceId);
  if (!deviceId) return null;
  const centres: WarrantyCentre[] = [];
  if (Array.isArray(o.centres)) {
    for (const c of o.centres) {
      const centre = normalizeCentre(c);
      if (centre) centres.push(centre);
    }
  }
  return {
    deviceId,
    deviceName: str(o.deviceName) ?? '',
    category: str(o.category) ?? '',
    brandInput: str(o.brandInput),
    brand: normalizeBrand(o.brand),
    centres,
    disclaimer: typeof o.disclaimer === 'string' ? o.disclaimer.trim() : '',
  };
}

/**
 * Defensive read of the `brandServiceInfo` array that `GET /v1/catalog` now
 * carries next to the four pickers. The field is ADDITIVE: an older server
 * omits it, which has to mean "no entries", never a crash — and an entry
 * without an id/name is dropped rather than rendered as half a row.
 *
 * (The device card does NOT match free text against this list. That rule,
 * including "hoà thì không khớp", lives in Go behind the service-directory
 * endpoint; see the openapi description of the catalog field.)
 */
export function normalizeBrandServiceInfoList(value: unknown): BrandServiceInfo[] {
  if (!Array.isArray(value)) return [];
  const out: BrandServiceInfo[] = [];
  for (const item of value) {
    const entry = normalizeBrand(item);
    if (entry) out.push(entry);
  }
  return out;
}

// ---- Brand entry -------------------------------------------------------------

export type BrandEntryState =
  | { kind: 'no-input'; title: string; detail: string }
  | { kind: 'no-entry'; title: string; detail: string; brandInput: string }
  | {
      kind: 'entry';
      title: string;
      detail: string;
      brand: BrandServiceInfo;
      serviceLocatorUrl: string | null;
      supportUrl: string | null;
      notes: string | null;
      hasVerifiedLink: boolean;
    };

/**
 * Decide what the brand half of the card shows. `brand === null` is a valid
 * answer from the API and must be explained, never rendered as an empty box —
 * and when the device has no brand text either, the answer is "add one", not a
 * fake directory row.
 */
export function brandEntryState(
  directory: Pick<ServiceDirectory, 'brand' | 'brandInput'>,
): BrandEntryState {
  const input = str(directory.brandInput);
  const brand = directory.brand;
  if (brand) {
    const hasVerifiedLink = brand.serviceLocatorUrl !== null || brand.supportUrl !== null;
    return {
      kind: 'entry',
      title: brand.name,
      detail: hasVerifiedLink
        ? 'Link dưới đây do chính hãng duy trì — app chỉ dẫn lại, không chép hotline.'
        : DIRECTORY_NO_VERIFIED_LINK,
      brand,
      serviceLocatorUrl: brand.serviceLocatorUrl,
      supportUrl: brand.supportUrl,
      notes: brand.notes,
      hasVerifiedLink,
    };
  }
  if (!input) {
    return {
      kind: 'no-input',
      title: DIRECTORY_NO_BRAND_INPUT_TITLE,
      detail: DIRECTORY_NO_BRAND_INPUT_DETAIL,
    };
  }
  return {
    kind: 'no-entry',
    title: DIRECTORY_NO_ENTRY_TITLE,
    detail: DIRECTORY_NO_ENTRY_DETAIL,
    brandInput: input,
  };
}

// ---- Phone disclosure --------------------------------------------------------

export type PhoneDisclosure =
  | { kind: 'user'; phone: string; label: string; hint: string; tone: 'zinc' }
  | { kind: 'none'; phone: null; label: string; hint: string; tone: 'zinc' }
  | { kind: 'unverified'; phone: string; label: string; hint: string; tone: 'amber' };

/**
 * Turn `phone` + `phoneSource` into something renderable without ever letting a
 * number look app-verified. A phone whose source we do not recognise is shown
 * but flagged; `none` says there is nothing, in words that cannot be read as
 * "call this hotline".
 */
export function phoneDisclosure(
  centre: Pick<WarrantyCentre, 'phone' | 'phoneSource'>,
): PhoneDisclosure {
  const phone = str(centre.phone);
  if (phone === null) {
    return {
      kind: 'none',
      phone: null,
      label: DIRECTORY_PHONE_NONE_LABEL,
      hint: DIRECTORY_PHONE_NONE_HINT,
      tone: 'zinc',
    };
  }
  if (centre.phoneSource === 'user') {
    return {
      kind: 'user',
      phone,
      label: DIRECTORY_PHONE_USER_LABEL,
      hint: DIRECTORY_PHONE_USER_HINT,
      tone: 'zinc',
    };
  }
  return {
    kind: 'unverified',
    phone,
    label: DIRECTORY_PHONE_UNVERIFIED_LABEL,
    hint: DIRECTORY_PHONE_UNVERIFIED_HINT,
    tone: 'amber',
  };
}

// ---- Centre state ------------------------------------------------------------

export function warrantyTypeLabel(type: string): string {
  return WARRANTY_TYPE_LABELS[type as WarrantyType] ?? (type || 'Không rõ loại');
}

export type CentreStatus = { kind: 'active' | 'expired' | 'undated'; label: string };

/**
 * Whether this package's coverage is still running. The server already computes
 * `isActive`; when it is absent (older payload) we fall back to the end date,
 * and "no end date" is its own answer rather than a default of "expired".
 */
export function centreStatus(
  centre: Pick<WarrantyCentre, 'isActive' | 'endDate'>,
  now: Date = new Date(),
): CentreStatus {
  const end = str(centre.endDate);
  const endTime = end ? new Date(end).getTime() : Number.NaN;
  const active =
    typeof centre.isActive === 'boolean'
      ? centre.isActive
      : Number.isFinite(endTime) && endTime > now.getTime();
  if (active) return { kind: 'active', label: 'Còn hạn' };
  if (!end || !Number.isFinite(endTime)) return { kind: 'undated', label: 'Chưa ghi hạn' };
  return { kind: 'expired', label: 'Đã hết hạn' };
}

export type CentreProviderState =
  | { kind: 'matched'; name: string; input: string | null; note: string }
  | { kind: 'unmatched'; name: null; input: string; note: string }
  | { kind: 'no-input'; name: null; input: null; note: string };

/**
 * `provider` is the catalog row the free text matched, and it is legitimately
 * `null`. The user's own `providerInput` is ALWAYS rendered next to it (the
 * openapi description requires it), so the row can never look empty.
 */
export function centreProviderState(
  centre: Pick<WarrantyCentre, 'provider' | 'providerInput'>,
): CentreProviderState {
  const input = str(centre.providerInput);
  if (centre.provider) {
    return {
      kind: 'matched',
      name: centre.provider.name,
      input,
      note: 'Khớp danh bạ nhà bảo hành.',
    };
  }
  if (!input) {
    return {
      kind: 'no-input',
      name: null,
      input: null,
      note: 'Chưa ghi nhà bảo hành cho gói này.',
    };
  }
  return { kind: 'unmatched', name: null, input, note: DIRECTORY_PROVIDER_UNMATCHED };
}

// ---- Rollup ------------------------------------------------------------------

export type DirectoryContactSummary = {
  centres: number;
  withUserPhone: number;
  withoutPhone: number;
  withUserAddress: number;
  matchedProviders: number;
  unmatchedProviders: number;
};

/** Counts for the honest one-line summary above the centre list. */
export function directoryContactSummary(
  directory: Pick<ServiceDirectory, 'centres'>,
): DirectoryContactSummary {
  let withUserPhone = 0;
  let withUserAddress = 0;
  let matchedProviders = 0;
  let unmatchedProviders = 0;
  for (const c of directory.centres) {
    if (phoneDisclosure(c).kind === 'user') withUserPhone += 1;
    if (str(c.address) !== null) withUserAddress += 1;
    const provider = centreProviderState(c);
    if (provider.kind === 'matched') matchedProviders += 1;
    else if (provider.kind === 'unmatched') unmatchedProviders += 1;
  }
  return {
    centres: directory.centres.length,
    withUserPhone,
    withoutPhone: directory.centres.length - withUserPhone,
    withUserAddress,
    matchedProviders,
    unmatchedProviders,
  };
}

/** The summary sentence. `centres: 0` gets its own wording (see the card). */
export function directorySummaryLine(summary: DirectoryContactSummary): string {
  if (summary.centres === 0) return DIRECTORY_NO_CENTRES;
  const parts = [
    `${summary.withUserPhone}/${summary.centres} gói có số điện thoại do bạn tự ghi`,
  ];
  if (summary.unmatchedProviders > 0) {
    parts.push(`${summary.unmatchedProviders} gói chưa khớp danh bạ nhà bảo hành`);
  }
  return `${parts.join(' · ')}. App không có hotline nào trong hai con số đó.`;
}
