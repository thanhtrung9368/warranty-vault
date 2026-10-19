// "Đối chiếu với hãng" inside the device form (step 3 — Bảo hành).
//
// The device form is ONE `<form>`, so this cannot own a nested record form.
// Instead the four editable values are ordinary fields of the parent form (plus
// the always-mounted `brandCheckedAt` hidden input), which means a normal "Lưu
// thiết bị" writes them through `updateDevice`. That is deliberate: no second
// submit button, no nested form, and the same full-payload PATCH discipline as
// every other field on the page.
//
// `brandCheckedAt` is stamped in THIS component the moment the owner changes any
// of the brand fields. A save that only edits the device name therefore keeps
// the stored timestamp instead of pretending the brand was re-checked.
//
// The lookup link is resolved server-side for the device's current brand and
// passed in (`initialLookupUrl`, which may be null = "we have no page"). When the
// owner changes the brand, the link is resolved on demand through
// `lookupBrandWarranty` — an explicit button, not on every keystroke. A null URL
// always renders the plain "we do not have this brand's lookup page" sentence;
// this component never builds a URL.

'use client';

import * as React from 'react';
import { ExternalLink, Loader2, Search, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLocale, useT } from '@/lib/i18n/client';
import {
  BRAND_WARRANTY_STATUSES,
  brandLookupState,
  brandWarrantyDatesLine,
  brandWarrantyStatusLabel,
  type BrandWarrantyValues,
} from '@/lib/brand-warranty';
import { dayToInputValue } from '@/lib/api-day';
import { lookupBrandWarranty } from '@/app/actions/brands';

const STATUS_NONE = 'unset';

function dateInputValue(value: string | null): string {
  // `brandWarrantyStart` / `brandWarrantyEnd` are calendar days. A Date
  // round-trip is UTC midnight and would fill the input with the previous day
  // west of UTC (and then save it back).
  return dayToInputValue(value);
}

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-xs font-medium text-destructive">{errors[0]}</p>;
}

export function BrandWarrantyFormSection({
  brandName,
  initial,
  initialLookupUrl,
  errors,
}: {
  /** The parent form's controlled `brand` value (free text, may be empty). */
  brandName: string;
  /** The five saved values, as the server returned them. */
  initial: BrandWarrantyValues;
  /** Server-resolved lookup URL for the initial brand; null is a real answer. */
  initialLookupUrl: string | null;
  /** `fieldErrors` from the device form's action, keyed by field name. */
  errors?: Record<string, string[]>;
}) {
  const t = useT();
  const locale = useLocale();

  const [open, setOpen] = React.useState(Boolean(initial.status));
  const [status, setStatus] = React.useState<string>(initial.status ?? STATUS_NONE);
  const [start, setStart] = React.useState(dateInputValue(initial.start));
  const [end, setEnd] = React.useState(dateInputValue(initial.end));
  const [url, setUrl] = React.useState(initial.url ?? initialLookupUrl ?? '');
  const [checkedAt, setCheckedAt] = React.useState(initial.checkedAt ?? '');

  // The lookup answer belongs to ONE brand. Changing the brand invalidates it;
  // the owner then asks again with the button. The initial server resolution is
  // seeded here so an edit shows the link without an extra round-trip.
  const [lookup, setLookup] = React.useState<{
    brandName: string;
    url: string | null;
  } | null>(brandName.trim() ? { brandName, url: initialLookupUrl } : null);
  const [lookupPending, setLookupPending] = React.useState(false);
  const [lookupError, setLookupError] = React.useState<string | null>(null);
  const lastBrand = React.useRef(brandName);

  React.useEffect(() => {
    if (lastBrand.current === brandName) return;
    lastBrand.current = brandName;
    setLookup(null);
    setLookupError(null);
  }, [brandName]);

  const name = brandName.trim();
  const resolved = lookup !== null && lookup.brandName === brandName;
  const lookupView = resolved
    ? brandLookupState({ brandName, lookupUrl: lookup.url }, locale)
    : brandLookupState({ brandName }, locale);
  const clearing = status === STATUS_NONE;
  // A server field error must be visible even if the section was collapsed, so
  // the fields are revealed rather than silently hidden behind the toggle.
  const hasBrandError = Boolean(
    errors?.brandWarrantyStatus ||
      errors?.brandWarrantyStart ||
      errors?.brandWarrantyEnd ||
      errors?.brandLookupUrl,
  );
  const showFields = open || hasBrandError;

  // A brand answer was just recorded/edited: stamp "now". The action reads this
  // hidden value; a save that does not touch the section keeps the old stamp.
  const stampCheckedAt = React.useCallback(() => {
    if (status !== STATUS_NONE) setCheckedAt(new Date().toISOString());
  }, [status]);

  const handleStatusChange = (next: string) => {
    setStatus(next);
    // Clearing the status erases the whole answer; blank the rest so a stale
    // date cannot trip the status-required rule on the request.
    if (next === STATUS_NONE) {
      setStart('');
      setEnd('');
      setUrl('');
      setCheckedAt('');
      return;
    }
    setCheckedAt(new Date().toISOString());
  };

  const handleLookup = async () => {
    if (!name || lookupPending) return;
    setLookupPending(true);
    setLookupError(null);
    try {
      const res = await lookupBrandWarranty(name);
      setLookup({ brandName, url: res.lookupUrl });
      // Prefill the "link that was opened" field when we actually have one. It
      // stays editable and optional — a phone/in-person answer is still valid.
      if (res.lookupUrl) {
        setUrl((prev) => (prev.trim() === '' ? res.lookupUrl! : prev));
      }
    } catch {
      setLookupError(t('Không tra được trang tra cứu của hãng — thử lại sau.'));
    } finally {
      setLookupPending(false);
    }
  };

  const datesLine = initial.status
    ? brandWarrantyDatesLine(
        {
          brandWarrantyStatus: initial.status,
          brandWarrantyStart: initial.start,
          brandWarrantyEnd: initial.end,
        },
        locale,
      )
    : null;

  return (
    <div className="space-y-4 rounded-2xl border-[1.5px] border-border bg-surface-2 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="icon-badge icon-badge-sm tint-sky mt-0.5">
            <ShieldCheck className="h-4 w-4" />
          </span>
          <div className="space-y-0.5">
            <p className="text-sm font-semibold text-ink">{t('Đối chiếu với hãng')}</p>
            <p className="text-xs text-muted-foreground">
              {initial.status
                ? t('Kết quả hãng ghi đã lưu:')
                : t(
                    'Ngày bảo hành hãng ghi có thể khác ngày trên hoá đơn. Tra trang của hãng rồi ghi lại kết quả.',
                  )}
            </p>
            {initial.status && (
              <p className="text-xs text-ink-2">
                <span className="font-semibold">
                  {brandWarrantyStatusLabel(initial.status, locale)}
                </span>
                {datesLine ? <> · {datesLine}</> : null}
              </p>
            )}
          </div>
        </div>
        <Button
          type="button"
          size="sm"
          variant={open ? 'outline' : 'default'}
          className="shrink-0 rounded-pill"
          onClick={() => setOpen((v) => !v)}
        >
          {initial.status ? t('Cập nhật kết quả') : t('Ghi kết quả')}
        </Button>
      </div>

      {/* Brand lookup link — or the honest "no page for this brand" answer. */}
      <div className="rounded-xl border-[1.5px] border-dashed border-border bg-surface p-3.5">
        {!name ? (
          <>
            <p className="text-sm font-semibold text-ink">{lookupView.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {lookupView.detail}
            </p>
          </>
        ) : resolved ? (
          <>
            <p className="text-sm font-semibold text-ink">{lookupView.title}</p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {lookupView.detail}
            </p>
            {lookupView.kind === 'url' ? (
              <a
                href={lookupView.url}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => {
                  // The link "that was opened" is the one we ship, so prefill it
                  // once (never overwrite something the owner typed).
                  setUrl((prev) => (prev.trim() === '' ? lookupView.url : prev));
                }}
                className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
              >
                <ExternalLink className="h-4 w-4" />
                {lookupView.linkLabel}
              </a>
            ) : null}
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-ink">
              {t('Tra trang tra cứu bảo hành của hãng {brand}', { brand: name })}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {t(
                'App chỉ dẫn link khi biết chắc đó là trang chính thức của hãng; nếu không có, app sẽ nói thẳng là không có.',
              )}
            </p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 rounded-pill"
              disabled={lookupPending}
              onClick={handleLookup}
            >
              {lookupPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Search className="mr-1.5 h-4 w-4" />
              )}
              {t('Đối chiếu với hãng')}
            </Button>
          </>
        )}
        {lookupError && (
          <p className="mt-2 text-xs font-medium text-destructive">{lookupError}</p>
        )}
      </div>

      {/* CSS-hidden, never unmounted: the five fields must submit on every save,
          even when this sub-section is collapsed — otherwise PATCH would erase a
          recorded answer. */}
      <div className={showFields ? 'space-y-4' : 'hidden'}>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="brandWarrantyStatus">
              {t('Trạng thái hãng ghi')} <span className="text-destructive">*</span>
            </Label>
            <Select
              name="brandWarrantyStatus"
              value={status}
              onValueChange={handleStatusChange}
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
            <FieldError errors={errors?.brandWarrantyStatus} />
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
              onChange={(e) => {
                setUrl(e.target.value);
                stampCheckedAt();
              }}
            />
            <p className="text-[11px] text-muted-foreground">
              {t('Dán link bạn đã mở (không bắt buộc)')}
            </p>
            <FieldError errors={errors?.brandLookupUrl} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="brandWarrantyStart">{t('Ngày bắt đầu hãng ghi')}</Label>
            <Input
              id="brandWarrantyStart"
              name="brandWarrantyStart"
              type="date"
              value={start}
              disabled={clearing}
              onChange={(e) => {
                setStart(e.target.value);
                stampCheckedAt();
              }}
            />
            <FieldError errors={errors?.brandWarrantyStart} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="brandWarrantyEnd">{t('Ngày kết thúc hãng ghi')}</Label>
            <Input
              id="brandWarrantyEnd"
              name="brandWarrantyEnd"
              type="date"
              value={end}
              disabled={clearing}
              onChange={(e) => {
                setEnd(e.target.value);
                stampCheckedAt();
              }}
            />
            <FieldError errors={errors?.brandWarrantyEnd} />
          </div>
        </div>

        <p className="text-xs text-muted-foreground">
          {t(
            'Chọn “Chưa đối chiếu” để xoá kết quả đã ghi. Thời điểm ghi được lưu tự động.',
          )}
        </p>
      </div>

      {/* Always submitted, even while the fields are collapsed or cleared. */}
      <input type="hidden" name="brandCheckedAt" value={checkedAt} />
    </div>
  );
}
