'use client';

// Per-user reminder lead days: the control shared by the device form and the
// subscription form. The same array (`leadDays`) is on both entities, so one
// component keeps the wording, ordering and keyboard behaviour identical.
//
// Shape chosen to match the forms around it rather than invent a new pattern:
//   * a `pill-group` of presets (the app's existing segmented-control style,
//     e.g. `appearance-tweaks.tsx`, `csv-export.tsx`),
//   * the chosen days as removable chips, always sorted DESCENDING,
//   * a plain number input + "Thêm mốc" for a custom value,
//   * always-mounted hidden inputs so the form submits the array no matter
//     which step is visible.
//
// Go is still the authority for validation. This control mirrors the two rules
// a user can see — at most five entries, at least one entry — and
// `lib/lead-days.ts` clamps the rest before the request.

import * as React from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  LEAD_DAY_MAX,
  LEAD_DAY_MIN,
  LEAD_DAY_PRESETS,
  LEAD_DAYS_MAX_ENTRIES,
  LEAD_DAYS_REQUIRED_MESSAGE,
  normalizeLeadDays,
} from '@/lib/lead-days';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

type LeadDaysFieldProps = {
  /** Current days (any order; the control normalises for display). */
  value: number[];
  /** Called with the normalised (descending, deduped, clamped) array. */
  onChange: (next: number[]) => void;
  /** Server field errors for `leadDays`, already translated. */
  errors?: string[];
  /** Hidden-input name; defaults to the wire field. */
  name?: string;
  /**
   * Id used by the label and by `focusField('leadDays')` when Go returns
   * `fieldErrors.leadDays`. Put it on the custom number input because it is
   * the only focusable text field in the group.
   */
  id?: string;
};

export function LeadDaysField({
  value,
  onChange,
  errors,
  name = 'leadDays',
  id = 'leadDays',
}: LeadDaysFieldProps) {
  const t = useT();
  const [custom, setCustom] = React.useState('');
  const days = normalizeLeadDays(value);
  const full = days.length >= LEAD_DAYS_MAX_ENTRIES;

  const toggle = (day: number) => {
    if (days.includes(day)) {
      onChange(days.filter((current) => current !== day));
      return;
    }
    if (full) return;
    onChange(normalizeLeadDays([...days, day]));
  };

  const addCustom = () => {
    if (full || custom.trim() === '') return;
    const parsed = Number(custom);
    if (!Number.isFinite(parsed)) return;
    onChange(normalizeLeadDays([...days, parsed]));
    setCustom('');
  };

  const dayLabel = (day: number) =>
    day === 0
      ? t('Đúng ngày')
      : t('{days} ngày', { days: day, count: day });

  const errorText =
    errors && errors.length > 0
      ? errors[0]
      : days.length === 0
        ? t(LEAD_DAYS_REQUIRED_MESSAGE)
        : null;

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label htmlFor={id}>
          {t('Mốc nhắc trước')} <span className="text-destructive">*</span>
        </Label>
        <p className="text-xs text-muted-foreground">
          {t(
            'Chọn từ 1 đến 5 mốc — mỗi mốc là số ngày trước khi đến hạn, từ 0 đến 365 (0 = đúng ngày).',
          )}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-ink-2">{t('Mốc gợi ý')}</span>
        <div
          className="pill-group flex-wrap"
          role="group"
          aria-label={t('Mốc gợi ý')}
        >
          {LEAD_DAY_PRESETS.map((day) => {
            const active = days.includes(day);
            return (
              <button
                key={day}
                type="button"
                data-active={active}
                aria-pressed={active}
                disabled={!active && full}
                onClick={() => toggle(day)}
                className={cn(!active && full && 'opacity-50 disabled:cursor-not-allowed')}
              >
                {dayLabel(day)}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <span className="text-xs font-semibold text-ink-2">{t('Đã chọn')}</span>
        <div className="flex min-h-8 flex-wrap items-center gap-1.5">
          {days.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => toggle(day)}
              aria-label={t('Bỏ mốc {days} ngày', { days: day, count: day })}
              className="inline-flex items-center gap-1 rounded-pill border-[1.5px] border-primary/40 bg-primary-soft px-2.5 py-1 text-xs font-semibold text-primary-ink transition-colors hover:bg-primary/15"
            >
              {dayLabel(day)}
              <X className="h-3 w-3" />
            </button>
          ))}
          {days.length === 0 && (
            <span className="text-xs text-muted-foreground">
              {t('Chưa đặt mốc nhắc')}
            </span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <span className="text-xs font-semibold text-ink-2">
            {t('Số ngày tuỳ chọn')}
          </span>
          <Input
            id={id}
            type="number"
            inputMode="numeric"
            min={LEAD_DAY_MIN}
            max={LEAD_DAY_MAX}
            step={1}
            value={custom}
            disabled={full}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter') return;
              // Enter in a text field must add the day, not submit the whole
              // multi-step form.
              e.preventDefault();
              addCustom();
            }}
            placeholder="0"
            className="h-10 w-28 tabular-nums"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addCustom}
          disabled={full || custom.trim() === ''}
          className="h-10 rounded-pill"
        >
          {t('Thêm mốc')}
        </Button>
        <span className="pb-2 text-xs text-muted-foreground">
          {t('Tối đa 5 mốc')}
        </span>
      </div>

      {errorText && (
        <p className="text-xs font-medium text-destructive">{errorText}</p>
      )}

      {/* Always-mounted marker: `leadDays` is PRESENT even when the user removed
          every chip, so the action rejects the empty array instead of treating
          it as "this form never had the field" (absent ⇒ server default or
          unchanged). The day entries follow; `leadDaysFromFormData` skips the
          empty marker and normalises the rest. */}
      <input type="hidden" name={name} value="" />
      {days.map((day) => (
        <input key={day} type="hidden" name={name} value={String(day)} />
      ))}
    </div>
  );
}
