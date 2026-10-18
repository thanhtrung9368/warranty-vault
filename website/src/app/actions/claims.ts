'use server';

// Server actions for repair / warranty cases.
//
// Thin proxies in the same shape as `actions/warranties.ts`: hand-rolled
// FormData parsing here, every business rule (one open claim per device, cost
// bounds, warranty ownership, status vocabulary) in Go. The one client-side
// pre-flight is `cost`, because the form cannot express a fractional/negative
// amount and a tampered payload should not reach the server as `NaN`.
//
// `closedAt` is deliberately absent from the parsed input: the server sets it
// when a status closes. Nothing on the web can disagree with it.
//
// The 409 `limit_reached` is the interesting failure. Go's generic message says
// "you reached a limit"; this feature can say exactly WHICH case is in the way,
// so the action re-reads the device's claims, finds the open one and returns its
// id. `ClaimForm` turns that into a link to the row. A 409 whose follow-up read
// fails, or that turns out to be another limit, keeps the server's own message.

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { api, toFormState, type ApiError, type FormState } from '@/lib/api';
import type { ClaimInput } from '@/lib/api/claims';
import {
  coveredByWarrantyFromInput,
  findOpenClaimForDevice,
  isClaimLimitReached,
  parseClaimCost,
  type ClaimStatus,
} from '@/lib/claims';
import { getI18n } from '@/lib/i18n/server';

export type ClaimFormState = FormState & {
  /** True only when a 409 was confirmed to be the device's open case. */
  limitReached?: boolean;
  /** The claim that is already open, when the follow-up read found it. */
  openClaimId?: string | null;
};

// Same helpers as `actions/devices.ts` / `actions/warranties.ts`: a blank or
// non-string entry becomes undefined so the server's blank-to-null rule applies.
function str(formData: FormData, key: string): string | undefined {
  const v = formData.get(key);
  if (typeof v !== 'string' || v === '') return undefined;
  return v;
}

function buildClaimInput(
  deviceId: string,
  formData: FormData,
  cost: number | null,
): ClaimInput {
  // The select uses `none` as its sentinel because Radix `SelectItem` cannot
  // hold an empty string; both `none` and a missing key mean "not linked".
  const warrantyId = str(formData, 'warrantyId');
  const status = str(formData, 'status') as ClaimStatus | undefined;
  return {
    deviceId,
    warrantyId: warrantyId && warrantyId !== 'none' ? warrantyId : null,
    status: status ?? 'OPEN',
    // A date input's `YYYY-MM-DD` is explicitly accepted by the contract. An
    // empty value is sent as '' so Go reports the missing field rather than the
    // web inventing today's date.
    openedAt: str(formData, 'openedAt') ?? '',
    expectedReturnAt: str(formData, 'expectedReturnAt') ?? null,
    // Every nullable text field is always present in the payload (blank ⇒
    // null). PATCH is treated as a full replacement, so an omitted key would be
    // an accidental "leave unchanged" at best and a clear at worst.
    ticketNumber: str(formData, 'ticketNumber') ?? null,
    serviceCenter: str(formData, 'serviceCenter') ?? null,
    diagnosis: str(formData, 'diagnosis') ?? null,
    outcome: str(formData, 'outcome') ?? null,
    issue: str(formData, 'issue') ?? '',
    cost,
    // Tri-state: `'unset'` must travel as null, not as false.
    coveredByWarranty: coveredByWarrantyFromInput(
      formData.get('coveredByWarranty'),
    ),
  };
}

type ParsedClaim = { input: ClaimInput } | { state: ClaimFormState };

async function parseClaim(deviceId: string, formData: FormData): Promise<ParsedClaim> {
  const parsedCost = parseClaimCost(formData.get('cost'));
  if (!parsedCost.ok) {
    const { t } = await getI18n();
    return {
      state: {
        ok: false,
        errors: { cost: [t(parsedCost.messageKey)] },
      },
    };
  }
  return { input: buildClaimInput(deviceId, formData, parsedCost.cost) };
}

/**
 * Turn an API failure into form state, giving the single-open 409 its own shape.
 *
 * `isClaimLimitReached` compares the code case-insensitively and requires a
 * 409, so a 400 VALIDATION mentioning "limit" cannot be misreported. The code is
 * also used by the per-user claim ceiling, so the extra
 * `GET /v1/claims?deviceId=` is what proves WHICH limit was hit: only a device
 * that actually has an OPEN/IN_REPAIR case gets the "open case" copy and link.
 * Any other 409 keeps the server's own message (already translated) instead of
 * claiming a cause it did not verify.
 */
async function claimFailureState(
  res: ApiError,
  deviceId: string,
): Promise<ClaimFormState> {
  if (!isClaimLimitReached(res)) return toFormState(res);

  const openRes = await api.claims.list({ deviceId });
  if (!openRes.ok) return toFormState(res);
  const open = findOpenClaimForDevice(openRes.data, deviceId);
  if (!open) return toFormState(res);

  const { t } = await getI18n();
  return {
    ok: false,
    limitReached: true,
    openClaimId: open.id,
    // The generic server message does not say which case is in the way. This
    // one names the cause and the way out. It is a catalog key, so it follows
    // the page's language like every other client-side sentence.
    message: t(
      'Thiết bị này đang có một phiếu sửa chữa chưa đóng. Cập nhật phiếu đó thay vì tạo thêm.',
    ),
  };
}

export async function createClaim(
  deviceId: string,
  _prev: ClaimFormState,
  formData: FormData,
): Promise<ClaimFormState> {
  const id = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (!id) {
    const { t } = await getI18n();
    return { ok: false, message: t('Thiếu id thiết bị') };
  }

  const parsed = await parseClaim(id, formData);
  if ('state' in parsed) return parsed.state;

  const res = await api.claims.create(parsed.input);
  if (!res.ok) return claimFailureState(res, id);

  // The device page is `force-dynamic`; these calls keep the "revalidate every
  // page that reads the changed data" rule true in case that ever changes.
  revalidatePath(`/devices/${id}`);
  revalidatePath('/claims');
  redirect(`/devices/${id}#claims`);
}

export async function updateClaim(
  claimId: string,
  deviceId: string,
  _prev: ClaimFormState,
  formData: FormData,
): Promise<ClaimFormState> {
  const claim = typeof claimId === 'string' ? claimId.trim() : '';
  const device = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (!claim) {
    const { t } = await getI18n();
    return { ok: false, message: t('Thiếu id phiếu sửa chữa') };
  }
  if (!device) {
    const { t } = await getI18n();
    return { ok: false, message: t('Thiếu id thiết bị') };
  }

  const parsed = await parseClaim(device, formData);
  if ('state' in parsed) return parsed.state;

  const res = await api.claims.update(claim, parsed.input);
  if (!res.ok) return claimFailureState(res, device);

  const savedDevice = res.data.deviceId || device;
  revalidatePath(`/devices/${savedDevice}`);
  revalidatePath('/claims');
  redirect(`/devices/${savedDevice}#claims`);
}

export type DeleteClaimResult = { ok: boolean; message?: string };

/**
 * Best-effort delete. A 404 (already gone / not owned) is surfaced as a failure
 * with Go's own message; the client shows a toast and refreshes either way.
 */
export async function deleteClaim(
  claimId: string,
  deviceId?: string,
): Promise<DeleteClaimResult> {
  const id = typeof claimId === 'string' ? claimId.trim() : '';
  if (!id) {
    const { t } = await getI18n();
    return { ok: false, message: t('Thiếu id phiếu sửa chữa') };
  }

  const res = await api.claims.remove(id);
  if (!res.ok) return { ok: false, message: res.message };

  const device = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (device) revalidatePath(`/devices/${device}`);
  revalidatePath('/claims');
  return { ok: true };
}
