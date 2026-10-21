// The device-detail "Đối chiếu với hãng" card.
//
// This is the whole point of the feature, so the layout reads top-down:
//
//   1. `BrandWarrantyNote` — the mismatch sentence (or the agreement, or
//      "brand has no record"), unmissable but information-toned;
//   2. the brand's own lookup page as an external link — or a plain statement
//      that we do not have one for this brand, with no guessed URL;
//   3. the recorded answer (status, the brand's dates, the span in days, when it
//      was checked);
//   4. the small record form: status, start/end the brand showed, the URL that
//      was opened. `brandCheckedAt` is stamped by the server action to NOW.
//
// No form library: plain `useActionState` + `useFormStatus` in a submit button,
// matching `warranty-form.tsx` / `claim-form.tsx`. The action does a full-device
// PATCH (read-then-merge) because the contract has no brand-specific endpoint.
//
// A client component because it is an interactive form and uses the language
// provider. Its only shared logic is the pure module — every sentence and every
// state decision is testable without React.

'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { ExternalLink, Loader2, PencilLine, Save, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { BrandWarrantyNote } from '@/components/brand-warranty-note';
import { useLocale, useT } from '@/lib/i18n/client';
import {
  BRAND_WARRANTY_STATUSES,
  brandCheckedAtLabel,
  brandLookupState,
  brandWarrantyDatesLine,
  brandWarrantySpanLabel,
  brandWarrantyStatusHint,
  brandWarrantyStatusLabel,
  type BrandWarrantyAnswerSource,
  type BrandWarrantyValues,
} from '@/lib/brand-warranty';
import { dayToInputValue } from '@/lib/api-day';
import { saveBrandWarrantyCheck, type DeviceFormState } from '@/app/actions/devices';

/** Sentinel because Radix Select forbids an empty-string item value. */
const STATUS_NONE = 'unset';

function dateInputValue(value: string | null): string {
  // Calendar days — sliced, never UTC-midnight round-tripped.
  return dayToInputValue(value);
}

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-xs font-medium text-destructive">{errors[0]}</p>;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending} className="rounded-pill">
      {pending ? (
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
      ) : (
        <Save className="mr-1.5 h-4 w-4" />
      )}
      {label}
    </Button>
  );
}

export function BrandWarrantyCard({
  deviceId,
  brandName,
  lookupUrl,
  values,
  mismatch,
}: {
  deviceId: string;
  /** Free-text `Device.brand` (null when unknown). */
  brandName: string | null;
  /** Resolved server-side from the brand service-info endpoint; may be null. */
  lookupUrl: string | null;
  /** The five nullable fields as the server returned them. */
  values: BrandWarrantyValues;
  /** Raw `Device.warrantyMismatch`; normalised before rendering. */
  mismatch: unknown;
}) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = React.useState(false);
  const [status, setStatus] = React.useState<string>(values.status ?? STATUS_NONE);
  const [start, setStart] = React.useState<string>(dateInputValue(values.start));
  const [end, setEnd] = React.useState<string>(dateInputValue(values.end));
  const [url, setUrl] = React.useState<string>(values.url ?? lookupUrl ?? '');

  const [state, formAction] = useActionState<DeviceFormState, FormData>(
    saveBrandWarrantyCheck.bind(null, deviceId),
    {},
  );
  const errors = state?.errors ?? {};

  // No effect closes the form: a successful save shows the server's message in
  // place (the RSC refresh replaces the recorded answer above it). Closing from
  // an effect would call setState during render-adjacent work — the lint rule is
  // right, and a success message that stays visible is clearer anyway.

  const lookup = brandLookupState({ brandName, lookupUrl }, locale);
  const source: BrandWarrantyAnswerSource = {
    brandWarrantyStatus: values.status,
    brandWarrantyStart: values.start,
    brandWarrantyEnd: values.end,
    brandCheckedAt: values.checkedAt,
    brandLookupUrl: values.url,
    // Present even when undefined, so `brandAgreementLine` can distinguish
    // "computed null" from "this server does not compute it yet".
    warrantyMismatch: mismatch,
  };
  const statusLabel = brandWarrantyStatusLabel(values.status, locale);
  const statusHint = brandWarrantyStatusHint(values.status, locale);
  const datesLine = brandWarrantyDatesLine(source, locale);
  const spanLine = brandWarrantySpanLabel(values.start, values.end, locale);
  const checkedLine = brandCheckedAtLabel(values.checkedAt, locale);

  const clearing = status === STATUS_NONE;

  return (
    <Card id="brand-warranty" className="scroll-mt-24">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-sky-ink" />
            {t('Đối chiếu với hãng')}
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(
              'Ngày bắt đầu bảo hành bạn ghi là đoán từ hoá đơn. Hãng có hệ thống riêng — đối chiếu để biết mình còn bảo hành thật hay không.',
            )}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={open ? 'outline' : 'default'}
          className="shrink-0 rounded-pill"
          onClick={() => {
            // Re-seed from the latest server values every time the form is
            // opened. Without this, a successful save (especially an erase) would
            // leave the form showing the values it was mounted with.
            if (!open) {
              setStatus(values.status ?? STATUS_NONE);
              setStart(dateInputValue(values.start));
              setEnd(dateInputValue(values.end));
              setUrl(values.url ?? lookupUrl ?? '');
            }
            setOpen((v) => !v);
          }}
        >
          <PencilLine className="mr-1.5 h-4 w-4" />
          {values.status ? t('Cập nhật kết quả') : t('Ghi kết quả')}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        <BrandWarrantyNote device={source} />

        {/* Recorded answer. Shown above the lookup link so the owner sees what is
            already known before opening another tab. */}
        {values.status && (
          <div className="rounded-xl border-[1.5px] border-border p-3.5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-pill bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink">
                {statusLabel}
              </span>
              <span className="text-xs text-muted-foreground">{checkedLine}</span>
            </div>
            {statusHint && (
              <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                {statusHint}
              </p>
            )}
            {datesLine && <p className="mt-2 text-sm text-ink-2">{datesLine}</p>}
            {spanLine && (
              <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">{spanLine}</p>
            )}
          </div>
        )}

        {/* The brand's own page, or the honest no-link answer. */}
        <div className="rounded-xl border-[1.5px] border-dashed border-border bg-surface-2 p-3.5">
          <p className="text-sm font-semibold text-ink">{lookup.title}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {lookup.detail}
          </p>
          {lookup.kind === 'url' && (
            <a
              href={lookup.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
            >
              <ExternalLink className="h-4 w-4" />
              {lookup.linkLabel}
            </a>
          )}
        </div>

        {open && (
          <form action={formAction} className="space-y-4 border-t border-dashed border-border pt-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="brandWarrantyStatus">
                  {t('Trạng thái hãng ghi')}{' '}
                  <span className="text-destructive">*</span>
                </Label>
                <Select
                  name="brandWarrantyStatus"
                  value={status}
                  onValueChange={(next) => {
                    setStatus(next);
                    // Clearing the status is the explicit "erase the recorded
                    // answer" signal. Clear the other values too, so an
                    // accidental date cannot make the request fail the
                    // status-required rule.
                    if (next === STATUS_NONE) {
                      setStart('');
                      setEnd('');
                      setUrl('');
                    }
                  }}
                >
                  <SelectTrigger id="brandWarrantyStatus">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={STATUS_NONE}>{t('Chưa đối chiếu')}</SelectItem>
                    {BRAND_WARRANTY_STATUSES.map((code) => (
                      <SelectItem key={code} value={code}>
                        {brandWarrantyStatusLabel(code, locale)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldError errors={errors.brandWarrantyStatus} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="brandLookupUrl">{t('Link đã mở')}</Label>
                <Input
                  id="brandLookupUrl"
                  name="brandLookupUrl"
                  type="url"
                  inputMode="url"
                  placeholder="https://..."
                  value={url}
                  disabled={clearing}
                  onChange={(e) => setUrl(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  {t('Dán link bạn đã mở (không bắt buộc)')}
                </p>
                <FieldError errors={errors.brandLookupUrl} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="brandWarrantyStart">{t('Ngày bắt đầu hãng ghi')}</Label>
                <Input
                  id="brandWarrantyStart"
                  name="brandWarrantyStart"
                  type="date"
                  value={start}
                  disabled={clearing}
                  onChange={(e) => setStart(e.target.value)}
                />
                <FieldError errors={errors.brandWarrantyStart} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="brandWarrantyEnd">{t('Ngày kết thúc hãng ghi')}</Label>
                <Input
                  id="brandWarrantyEnd"
                  name="brandWarrantyEnd"
                  type="date"
                  value={end}
                  disabled={clearing}
                  onChange={(e) => setEnd(e.target.value)}
                />
                <FieldError errors={errors.brandWarrantyEnd} />
              </div>
            </div>

            {state.message && (
              <p
                className={
                  state.ok
                    ? 'text-sm font-medium text-emerald-ink'
                    : 'text-sm font-medium text-destructive'
                }
              >
                {state.message}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton label={t('Lưu kết quả')} />
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="rounded-pill"
                onClick={() => setOpen(false)}
              >
                {t('Huỷ')}
              </Button>
              <p className="text-xs text-muted-foreground">
                {t('Thời điểm ghi kết quả được lưu tự động.')}
              </p>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
