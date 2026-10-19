'use client';

// Create/edit form for one repair / warranty case.
//
// The device is fixed by the page this form is mounted on (it is rendered
// inside the "Sửa chữa & bảo hành" card on a device), so it is shown read-only
// rather than as a picker. The warranty picker only ever offers that device's
// own plans — the server still validates ownership, this just avoids putting an
// impossible option in front of the user.
//
// Two fields carry deliberate complexity:
//   * `coveredByWarranty` is TRI-STATE. `null` ("chưa xác định") is a real
//     answer and is NOT `false`; the select submits 'true'/'false'/'unset' and
//     the action maps the last one back to null.
//   * `closedAt` has no input at all. The server sets it when the status
//     closes; the form only explains that when the user picks a closed status.
//
// A 409 `limit_reached` is rendered as its own alert with a link to the open
// case, because the generic "you reached a limit" sentence is useless here.

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { format } from 'date-fns';
import { AlertTriangle, ArrowRight, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  CLAIM_STATUSES,
  claimStatusLabel,
  claimStatusTransition,
  isClosedClaimStatus,
  openClaimHref,
  type ClaimStatus,
} from '@/lib/claims';
import type { Claim } from '@/lib/api/claims';
import type { WarrantyType } from '@/lib/types';
import { warrantyTypeLabel } from '@/lib/i18n/labels';
import { formatDate, formatNumber, parseVNDInput } from '@/lib/format';
import { dayToInputValue } from '@/lib/api-day';
import { useLocale, useT } from '@/lib/i18n/client';
import {
  createClaim,
  updateClaim,
  type ClaimFormState,
} from '@/app/actions/claims';

/** The only warranty fields the picker needs. */
export type ClaimWarrantyOption = {
  id: string;
  type: WarrantyType;
  provider: string | null;
  endDate: string;
};

/** The editable projection of a `Claim` (server-owned keys omitted). */
export type ClaimInitial = Pick<
  Claim,
  | 'id'
  | 'warrantyId'
  | 'status'
  | 'openedAt'
  | 'expectedReturnAt'
  | 'ticketNumber'
  | 'serviceCenter'
  | 'diagnosis'
  | 'outcome'
  | 'issue'
  | 'cost'
  | 'coveredByWarranty'
>;

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-xs font-medium text-destructive">{errors[0]}</p>;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="rounded-pill">
      {pending ? (
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
      ) : (
        <Save className="mr-1.5 h-4 w-4" />
      )}
      {label}
    </Button>
  );
}

/**
 * `yyyy-MM-dd` for a date input holding an INSTANT (`claimedAt`): the reader's
 * local day is the right one. Day fields (`expectedReturnAt`) use
 * `dayToInputValue` instead — a `new Date(day)` round-trip is UTC midnight and
 * shifts the value a day west of UTC.
 */
function instantInputValue(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return format(date, 'yyyy-MM-dd');
}

/**
 * Cost with a formatted display and a raw numeric hidden field.
 *
 * Blank stays blank so the action sends `null` ("not recorded"); a typed `0` is
 * a real free repair and must survive. The action re-parses the hidden value,
 * so tampering is caught before the request.
 */
function CostInput({ defaultValue }: { defaultValue?: number | null }) {
  const locale = useLocale();
  const [value, setValue] = React.useState<string>(
    defaultValue != null ? formatNumber(defaultValue, locale) : '',
  );
  return (
    <div className="relative">
      <Input
        id="cost"
        inputMode="numeric"
        value={value}
        onChange={(event) => {
          const raw = event.target.value;
          if (raw.trim() === '') {
            setValue('');
            return;
          }
          setValue(formatNumber(parseVNDInput(raw), locale));
        }}
        placeholder="0"
        className="pr-10"
        aria-describedby="cost-hint"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        ₫
      </span>
      <input
        type="hidden"
        name="cost"
        value={value.trim() === '' ? '' : parseVNDInput(value)}
      />
    </div>
  );
}

export function ClaimForm({
  deviceId,
  deviceName,
  warranties,
  initial,
  onCancel,
}: {
  deviceId: string;
  deviceName: string;
  warranties: ClaimWarrantyOption[];
  initial?: ClaimInitial;
  onCancel?: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const isEdit = Boolean(initial?.id);
  const action = isEdit
    ? updateClaim.bind(null, initial!.id, deviceId)
    : createClaim.bind(null, deviceId);
  const [state, formAction] = useActionState<ClaimFormState, FormData>(action, {});
  const errors = state?.errors ?? {};

  const statusDefault: ClaimStatus =
    initial?.status && CLAIM_STATUSES.includes(initial.status)
      ? initial.status
      : 'OPEN';
  // Controlled only so the "server owns closedAt" hint can follow the choice;
  // the submitted value still comes from the select itself.
  const [status, setStatus] = React.useState<ClaimStatus>(statusDefault);

  const warrantyIds = new Set(warranties.map((warranty) => warranty.id));
  const warrantyDefault =
    initial?.warrantyId && warrantyIds.has(initial.warrantyId)
      ? initial.warrantyId
      : 'none';

  const coverageDefault =
    initial?.coveredByWarranty === true
      ? 'true'
      : initial?.coveredByWarranty === false
        ? 'false'
        : 'unset';

  const openedDefault =
    instantInputValue(initial?.openedAt) || format(new Date(), 'yyyy-MM-dd');
  // `expectedReturnAt` is a calendar day (`format: date`).
  const expectedDefault = dayToInputValue(initial?.expectedReturnAt);

  // Only explain the server-owned close date when this save actually closes an
  // OPEN/IN_REPAIR case; re-saving an already-closed case has nothing to say.
  const closesOnSave =
    isClosedClaimStatus(status) &&
    (initial?.status
      ? claimStatusTransition(initial.status, status) === 'close'
      : true);

  return (
    <form action={formAction} className="space-y-4">
      <div className="rounded-xl border border-border bg-surface px-4 py-3 text-sm">
        <span className="text-muted-foreground">{t('Thiết bị của phiếu')}: </span>
        <span className="font-semibold text-ink">{deviceName}</span>
      </div>

      {/* The actionable failure: this device already has an open case. The
          link jumps to that row (or to the card when the follow-up read could
          not identify it), so the user is never left with a dead end. */}
      {state?.limitReached && (
        <div
          role="alert"
          className="rounded-xl border border-amber-ink/25 bg-amber-soft px-4 py-3 text-sm text-amber-ink"
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="space-y-1">
              <p className="font-semibold">
                {state.message ??
                  t('Thiết bị này đang có một phiếu sửa chữa chưa đóng.')}
              </p>
              <Link
                href={openClaimHref(deviceId, state.openClaimId)}
                className="inline-flex items-center gap-1 font-semibold underline underline-offset-2"
              >
                {t('Mở phiếu đang mở')}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      )}

      {state?.message && !state.limitReached && (
        <p
          role="alert"
          className="rounded-xl border border-rose-ink/20 bg-rose-soft px-4 py-3 text-sm font-semibold text-rose-ink"
        >
          {state.message}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="status">
            {t('Trạng thái')} <span className="text-destructive">*</span>
          </Label>
          <Select
            name="status"
            value={status}
            onValueChange={(value) => setStatus(value as ClaimStatus)}
          >
            <SelectTrigger id="status">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CLAIM_STATUSES.map((value) => (
                <SelectItem key={value} value={value}>
                  {claimStatusLabel(value, locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {closesOnSave && (
            <p className="text-xs text-muted-foreground">
              {t('Máy chủ sẽ tự đặt ngày đóng khi lưu.')}
            </p>
          )}
          <FieldError errors={errors.status} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="warrantyId">{t('Gói bảo hành')}</Label>
          <Select name="warrantyId" defaultValue={warrantyDefault}>
            <SelectTrigger id="warrantyId">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t('Không gắn gói nào')}</SelectItem>
              {warranties.map((warranty) => (
                <SelectItem key={warranty.id} value={warranty.id}>
                  {warrantyTypeLabel(warranty.type, locale)}
                  {warranty.provider ? ` · ${warranty.provider}` : ''}
                  {` · ${formatDate(warranty.endDate, locale)}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError errors={errors.warrantyId} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="openedAt">
            {t('Ngày mở phiếu')} <span className="text-destructive">*</span>
          </Label>
          <Input
            id="openedAt"
            name="openedAt"
            type="date"
            defaultValue={openedDefault}
            required
          />
          <FieldError errors={errors.openedAt} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="expectedReturnAt">{t('Ngày dự kiến trả')}</Label>
          <Input
            id="expectedReturnAt"
            name="expectedReturnAt"
            type="date"
            defaultValue={expectedDefault}
          />
          <FieldError errors={errors.expectedReturnAt} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="ticketNumber">{t('Số phiếu')}</Label>
          <Input
            id="ticketNumber"
            name="ticketNumber"
            defaultValue={initial?.ticketNumber ?? ''}
            placeholder={t('vd: 2026-0912')}
          />
          <FieldError errors={errors.ticketNumber} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="serviceCenter">{t('Trung tâm sửa chữa')}</Label>
          <Input
            id="serviceCenter"
            name="serviceCenter"
            defaultValue={initial?.serviceCenter ?? ''}
            placeholder={t('vd: FPT Shop Nguyễn Trãi')}
          />
          <FieldError errors={errors.serviceCenter} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="issue">
          {t('Mô tả lỗi')} <span className="text-destructive">*</span>
        </Label>
        <Textarea
          id="issue"
          name="issue"
          defaultValue={initial?.issue ?? ''}
          placeholder={t('Mô tả ngắn gọn lỗi')}
          required
          rows={3}
        />
        <FieldError errors={errors.issue} />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="diagnosis">{t('Chẩn đoán')}</Label>
          <Textarea
            id="diagnosis"
            name="diagnosis"
            defaultValue={initial?.diagnosis ?? ''}
            placeholder={t('Trung tâm nói gì?')}
            rows={3}
          />
          <FieldError errors={errors.diagnosis} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="outcome">{t('Kết quả')}</Label>
          <Textarea
            id="outcome"
            name="outcome"
            defaultValue={initial?.outcome ?? ''}
            placeholder={t('Đã sửa xong, đổi mới, hoàn tiền...')}
            rows={3}
          />
          <FieldError errors={errors.outcome} />
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="cost">{t('Chi phí (VND)')}</Label>
          <CostInput defaultValue={initial?.cost} />
          <p id="cost-hint" className="text-xs text-muted-foreground">
            {t('Để trống nếu chưa biết. 0 ₫ nghĩa là sửa miễn phí.')}
          </p>
          <FieldError errors={errors.cost} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="coveredByWarranty">{t('Có được bảo hành không?')}</Label>
          <Select name="coveredByWarranty" defaultValue={coverageDefault}>
            <SelectTrigger id="coveredByWarranty">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="true">{t('Có bảo hành')}</SelectItem>
              <SelectItem value="false">{t('Không được bảo hành')}</SelectItem>
              <SelectItem value="unset">{t('Chưa xác định')}</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t('“Chưa xác định” khác với “Không được bảo hành”.')}
          </p>
          <FieldError errors={errors.coveredByWarranty} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-1">
        <SubmitButton
          label={isEdit ? t('Lưu thay đổi') : t('Tạo phiếu sửa chữa')}
        />
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            className="rounded-pill"
            onClick={onCancel}
          >
            {t('Huỷ')}
          </Button>
        )}
      </div>
    </form>
  );
}
