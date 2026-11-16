'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { format } from 'date-fns';
import { ChevronDown, Loader2, Save } from 'lucide-react';
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
import { WARRANTY_TYPES, type WarrantyType } from '@/lib/types';
import { formatNumber, parseVNDInput } from '@/lib/format';
import { dayToInputValue } from '@/lib/api-day';
import { currencySuffix } from '@/lib/currency';
import { warrantyTypeLabel } from '@/lib/i18n/labels';
import { useLocale, useT } from '@/lib/i18n/client';
import { WarrantyCardScan } from '@/components/warranty-card-scan';
import type {
  WarrantyCardField,
  WarrantyCardMismatch,
  WarrantyCardValues,
} from '@/lib/warranty-card-scan';
import {
  hasWarrantyTermErrors,
  termsExpandedByDefault,
} from '@/lib/warranty-terms';
import {
  createWarranty,
  updateWarranty,
  type WarrantyFormState,
} from '@/app/actions/warranties';

type Initial = {
  id?: string;
  type?: WarrantyType;
  provider?: string | null;
  startDate?: Date | string;
  months?: number;
  cost?: number | null;
  address?: string | null;
  phone?: string | null;
  notes?: string | null;
  // Contract terms (see `lib/warranty-terms.ts`). `claimsUsed` is non-null on
  // the wire (server default 0); the rest are nullable, where null means "not
  // recorded".
  component?: string | null;
  scope?: string | null;
  cap?: number | null;
  deductible?: number | null;
  exclusions?: string | null;
  region?: string | null;
  transferable?: boolean | null;
  claimsAllowed?: number | null;
  claimsUsed?: number | null;
};

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-xs text-destructive">{errors[0]}</p>;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="rounded-pill">
      {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
      {label}
    </Button>
  );
}

function MoneyInput({
  defaultValue,
  name,
  id,
  currency = 'VND',
}: {
  defaultValue?: number | null;
  name: string;
  id?: string;
  currency?: string;
}) {
  // `formatNumber` needs the locale (1.200.000 / 1,200,000), so the input reads
  // it from the provider rather than taking a prop.
  const locale = useLocale();
  // `!= null` (not truthiness): a recorded `0` is a real amount and must not
  // come back as an empty field.
  const [value, setValue] = React.useState<string>(
    defaultValue != null ? formatNumber(defaultValue, locale) : '',
  );
  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          // Blank stays blank; `formatNumber` re-formats anything with digits.
          // The old `n ? … : ''` cleared a typed "0" and submitted 0 for an
          // empty field — harmless while the only money field was `cost`, but
          // wrong for a nullable cap/deductible, where "not recorded" must
          // travel as `null`, not as a recorded zero.
          const raw = e.target.value;
          if (raw.trim() === '') {
            setValue('');
            return;
          }
          setValue(formatNumber(parseVNDInput(raw), locale));
        }}
        placeholder="0"
        className="pr-10"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        {currencySuffix(currency)}
      </span>
      {/* Blank (not 0) when nothing was entered, so the action's `num()`
          returns undefined and the wire value is null. */}
      <input
        type="hidden"
        name={name}
        value={value.trim() === '' ? '' : parseVNDInput(value)}
      />
    </div>
  );
}

export function WarrantyForm({
  deviceId,
  currency = 'VND',
  initial,
  onCancel,
}: {
  deviceId: string;
  /** Device currency: `Warranty.cost` is denominated in it, not đồng. */
  currency?: string;
  initial?: Initial;
  onCancel?: () => void;
}) {
  const isEdit = Boolean(initial?.id);
  const action = isEdit
    ? updateWarranty.bind(null, initial!.id!)
    : createWarranty.bind(null, deviceId);

  const t = useT();
  const locale = useLocale();
  const [state, formAction] = useActionState<WarrantyFormState, FormData>(action, {});
  const errors = state?.errors ?? {};

  // The design decision this form is built around: the nine contract fields
  // live under one collapsible section, closed unless the row already has a
  // term recorded (or a failed submit left an error inside it). Someone who
  // does not care about caps/deductibles sees one extra line; someone editing
  // a contract sees their data without having to look for it. The rule itself
  // is pure and tested in `lib/__tests__/warranty-terms.test.ts` — this is just
  // the wiring.
  const termsOpen =
    termsExpandedByDefault(initial) || hasWarrantyTermErrors(errors);

  // Tri-state: `null` (not recorded) is a distinct answer from false, so the
  // select carries a sentinel rather than a checkbox. `actions/warranties.ts`
  // maps anything other than 'true'/'false' back to null.
  const transferableDefault =
    initial?.transferable === true
      ? 'true'
      : initial?.transferable === false
        ? 'false'
        : 'unset';

  const startDateDefault = initial?.startDate
    ? // Calendar day: sliced, so editing never shows (or saves) the previous
      // day west of UTC.
      dayToInputValue(initial.startDate)
    : format(new Date(), 'yyyy-MM-dd');

  // ─── Warranty-card scan state (§6.3) ──────────────────────────────────
  //
  // The nine term inputs are uncontrolled, and that is deliberate: this form is
  // a plain `useActionState` form with `defaultValue`, and lifting nine more
  // fields into state would only add re-render surface. The card scan fills
  // ONLY fields that were empty, so the safe way to show a filled value is to
  // remount that one input (`key`) with a new `defaultValue` — a user-typed
  // field has no override, keeps its key, and is never touched.
  const formRef = React.useRef<HTMLFormElement>(null);
  const [scanOverrides, setScanOverrides] = React.useState<WarrantyCardValues>({});
  const [scanNonces, setScanNonces] = React.useState<
    Partial<Record<WarrantyCardField, number>>
  >({});
  const [cardMismatches, setCardMismatches] = React.useState<WarrantyCardMismatch[]>([]);
  // A scan fills fields inside the collapsible terms block; open it so the
  // values are visible instead of silently landing in a closed section.
  const [openTermsAfterScan, setOpenTermsAfterScan] = React.useState(false);

  /** Read the nine current values straight from the form. `claimsUsed`'s
   *  default of 0 is the wire default ("not recorded"), so it counts as empty —
   *  otherwise the field would never accept a value from the card. */
  const currentTermValues = React.useCallback((): WarrantyCardValues => {
    const form = formRef.current;
    if (!form) return {};
    const fd = new FormData(form);
    const str = (key: string): string | undefined => {
      const value = fd.get(key);
      if (typeof value !== 'string') return undefined;
      const trimmed = value.trim();
      return trimmed === '' ? undefined : trimmed;
    };
    const num = (key: string): number | undefined => {
      const value = fd.get(key);
      if (typeof value !== 'string' || value.trim() === '') return undefined;
      const n = Number(value);
      return Number.isFinite(n) ? n : undefined;
    };
    const transferable = fd.get('transferable');
    const used = num('claimsUsed');
    return {
      component: str('component'),
      scope: str('scope'),
      cap: num('cap'),
      deductible: num('deductible'),
      exclusions: str('exclusions'),
      region: str('region'),
      transferable:
        transferable === 'true' ? true : transferable === 'false' ? false : undefined,
      claimsAllowed: num('claimsAllowed'),
      claimsUsed: used === 0 ? undefined : used,
    };
  }, []);

  const applyScanMerge = React.useCallback(
    (merge: { filled: WarrantyCardValues; mismatches: WarrantyCardMismatch[] }) => {
      setScanOverrides((prev) => ({ ...prev, ...merge.filled }));
      setScanNonces((prev) => {
        const next = { ...prev };
        for (const field of Object.keys(merge.filled)) {
          const key = field as WarrantyCardField;
          next[key] = (prev[key] ?? 0) + 1;
        }
        return next;
      });
      setCardMismatches(merge.mismatches);
      if (Object.keys(merge.filled).length > 0 || merge.mismatches.length > 0) {
        setOpenTermsAfterScan(true);
      }
    },
    [],
  );

  const textDefault = (field: 'component' | 'scope' | 'exclusions' | 'region'): string =>
    scanOverrides[field] ?? initial?.[field] ?? '';

  const numberDefault = (
    field: 'cap' | 'deductible' | 'claimsAllowed' | 'claimsUsed',
    fallback: number | null | undefined,
  ): number | null | undefined => scanOverrides[field] ?? fallback;

  const termKey = (field: WarrantyCardField): string =>
    `${field}-${scanNonces[field] ?? 0}`;

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="type">
            {t('Loại gói')} <span className="text-destructive">*</span>
          </Label>
          <Select name="type" defaultValue={initial?.type ?? 'EXTENDED'}>
            <SelectTrigger id="type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WARRANTY_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {warrantyTypeLabel(type, locale)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError errors={errors.type} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="provider">{t('Đơn vị bảo hành')}</Label>
          <Input
            id="provider"
            name="provider"
            defaultValue={initial?.provider ?? ''}
            placeholder={t('vd: AppleCare+, FPT, ...')}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="startDate">
            {t('Ngày bắt đầu')} <span className="text-destructive">*</span>
          </Label>
          <Input
            id="startDate"
            name="startDate"
            type="date"
            defaultValue={startDateDefault}
            required
          />
          <FieldError errors={errors.startDate} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="months">
            {t('Số tháng')} <span className="text-destructive">*</span>
          </Label>
          <Input
            id="months"
            name="months"
            type="number"
            min={1}
            defaultValue={initial?.months ?? 12}
            required
          />
          <FieldError errors={errors.months} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="cost">
            {t('Giá gói ({currency})', { currency })}
          </Label>
          <MoneyInput
            id="cost"
            defaultValue={initial?.cost}
            name="cost"
            currency={currency}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">{t('SĐT bảo hành')}</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={initial?.phone ?? ''}
            placeholder={t('vd: 1800 1234')}
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="address">{t('Địa chỉ trung tâm BH')}</Label>
          <Input
            id="address"
            name="address"
            defaultValue={initial?.address ?? ''}
            placeholder={t('vd: 123 Nguyễn Trãi, Q.1')}
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="notes">{t('Ghi chú')}</Label>
          <Textarea
            id="notes"
            name="notes"
            defaultValue={initial?.notes ?? ''}
            placeholder={t('Điều kiện gói, ngày kích hoạt...')}
            rows={3}
          />
        </div>
      </div>

      {/* Warranty-card scan. Upload-first: the card lands in the inbox, the
          Go endpoint returns a DRAFT of the nine contract terms, and the merge
          below fills only empty fields. Nothing is saved by the scan. */}
      <WarrantyCardScan getCurrent={currentTermValues} onMerged={applyScanMerge} />

      {cardMismatches.length > 0 && (
        <div className="rounded-xl border-[1.5px] border-amber-200 bg-amber-soft px-3 py-2 text-xs text-amber-ink dark:border-amber-900">
          <p className="font-semibold">
            {t('Các ô bạn đã nhập được giữ nguyên — “Trên thẻ” là giá trị đọc được:')}
          </p>
          <ul className="mt-1 space-y-0.5">
            {cardMismatches.map((mismatch) => (
              <li key={mismatch.field}>
                <span className="font-medium">{mismatch.label}: </span>
                {t('Trên thẻ: {value}', { value: mismatch.cardValue })}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Contract terms — collapsed unless the row already carries one. The
          native <details> is deliberate: no extra state, keyboard-operable and
          it still works if this form is rendered without hydration. A scan
          that fills a term opens it once (`openTermsAfterScan`). */}
      <details
        className="group rounded-xl border-[1.5px] border-dashed border-border px-3.5 py-3"
        open={termsOpen || openTermsAfterScan}
      >
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 text-sm font-semibold text-ink [&::-webkit-details-marker]:hidden">
          <span>{t('Điều khoản hợp đồng')}</span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('Không bắt buộc — mở mục này nếu gói bảo hành có điều khoản riêng.')}
        </p>

        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="component">{t('Bộ phận được bảo hành')}</Label>
            <Input
              key={termKey('component')}
              id="component"
              name="component"
              defaultValue={textDefault('component')}
              placeholder={t('vd: Màn hình (bỏ trống = toàn bộ máy)')}
            />
            <FieldError errors={errors.component} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="region">{t('Khu vực áp dụng')}</Label>
            <Input
              key={termKey('region')}
              id="region"
              name="region"
              defaultValue={textDefault('region')}
              placeholder={t('vd: Toàn quốc')}
            />
            <FieldError errors={errors.region} />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="scope">{t('Phạm vi bảo hành')}</Label>
            <Textarea
              key={termKey('scope')}
              id="scope"
              name="scope"
              defaultValue={textDefault('scope')}
              placeholder={t('vd: lỗi phần cứng, cháy nổ do điện')}
              rows={2}
            />
            <FieldError errors={errors.scope} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="cap">{t('Mức chi trả tối đa (VND)')}</Label>
            <MoneyInput
              key={termKey('cap')}
              id="cap"
              defaultValue={numberDefault('cap', initial?.cap)}
              name="cap"
            />
            <FieldError errors={errors.cap} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="deductible">{t('Khấu trừ mỗi lần (VND)')}</Label>
            <MoneyInput
              key={termKey('deductible')}
              id="deductible"
              defaultValue={numberDefault('deductible', initial?.deductible)}
              name="deductible"
            />
            <FieldError errors={errors.deductible} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="claimsAllowed">{t('Số lượt yêu cầu tối đa')}</Label>
            <Input
              key={termKey('claimsAllowed')}
              id="claimsAllowed"
              name="claimsAllowed"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              defaultValue={numberDefault('claimsAllowed', initial?.claimsAllowed) ?? ''}
              placeholder="0"
            />
            <FieldError errors={errors.claimsAllowed} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="claimsUsed">{t('Số lượt đã dùng')}</Label>
            <Input
              key={termKey('claimsUsed')}
              id="claimsUsed"
              name="claimsUsed"
              type="number"
              min={0}
              step={1}
              inputMode="numeric"
              defaultValue={numberDefault('claimsUsed', initial?.claimsUsed) ?? 0}
            />
            {/* The server's own rule is `claimsUsed > claimsAllowed` → 400 on
                this key; showing its error here is the whole point of
                forwarding the field untouched. */}
            <FieldError errors={errors.claimsUsed} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="transferable">{t('Chuyển nhượng được')}</Label>
            <Select
              key={termKey('transferable')}
              name="transferable"
              defaultValue={
                scanOverrides.transferable != null
                  ? String(scanOverrides.transferable)
                  : transferableDefault
              }
            >
              <SelectTrigger id="transferable">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unset">{t('Chưa rõ')}</SelectItem>
                <SelectItem value="true">{t('Có')}</SelectItem>
                <SelectItem value="false">{t('Không')}</SelectItem>
              </SelectContent>
            </Select>
            <FieldError errors={errors.transferable} />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="exclusions">{t('Loại trừ')}</Label>
            <Textarea
              key={termKey('exclusions')}
              id="exclusions"
              name="exclusions"
              defaultValue={textDefault('exclusions')}
              placeholder={t('vd: rơi vỡ, vào nước, hao mòn tự nhiên')}
              rows={2}
            />
            <FieldError errors={errors.exclusions} />
          </div>
        </div>
      </details>

      {state?.message && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <Button
            type="button"
            variant="outline"
            className="rounded-pill"
            onClick={onCancel}
          >
            {t('Hủy')}
          </Button>
        )}
        <SubmitButton label={isEdit ? t('Lưu thay đổi') : t('Thêm gói')} />
      </div>
    </form>
  );
}
