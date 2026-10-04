'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { format, addDays, addMonths, addYears } from 'date-fns';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Check, Loader2, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { formatNumber, parseVNDInput } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { billingCycleLabel, subscriptionStatusLabel } from '@/lib/i18n/labels';
import {
  BILLING_CYCLES,
  SUBSCRIPTION_STATUSES,
  type BillingCycle,
  type SubscriptionStatus,
} from '@/lib/subscription-types';
import {
  createSubscription,
  updateSubscription,
  type SubscriptionFormState,
} from '@/app/actions/subscriptions';
import type {
  CategoryOption,
  BrandOption,
} from '@/app/actions/catalog';
import { cn } from '@/lib/utils';

type Initial = {
  id?: string;
  name?: string;
  category?: string | null;
  brand?: string | null;
  plan?: string | null;
  billingCycle?: BillingCycle;
  intervalDays?: number | null;
  price?: number;
  startedAt?: Date | string;
  renewalDate?: Date | string | null;
  autoRenew?: boolean;
  status?: SubscriptionStatus;
  accountEmail?: string | null;
  paymentMethod?: string | null;
  manageUrl?: string | null;
  cancelUrl?: string | null;
  notes?: string | null;
};

type Catalog = {
  categories: CategoryOption[];
  brands: BrandOption[];
};

// Maps each field to (a) its server-validation key for error focus and
// (b) which step contains it. Lets us auto-jump back when Go returns
// fieldErrors for a step the user has already moved past.
const FIELD_META: Record<string, { label: string; focusId: string; step: number }> = {
  name: { label: 'Tên gói', focusId: 'name', step: 0 },
  category: { label: 'Loại', focusId: 'category', step: 0 },
  brand: { label: 'Hãng', focusId: 'brand', step: 0 },
  plan: { label: 'Plan', focusId: 'plan', step: 0 },
  status: { label: 'Trạng thái', focusId: 'status', step: 0 },
  autoRenew: { label: 'Tự gia hạn', focusId: 'autoRenew', step: 0 },
  billingCycle: { label: 'Chu kỳ', focusId: 'billingCycle', step: 1 },
  intervalDays: { label: 'Số ngày', focusId: 'intervalDays', step: 1 },
  price: { label: 'Giá', focusId: 'price', step: 1 },
  startedAt: { label: 'Ngày bắt đầu', focusId: 'startedAt', step: 1 },
  renewalDate: { label: 'Ngày gia hạn', focusId: 'renewalDate', step: 1 },
  accountEmail: { label: 'Email tài khoản', focusId: 'accountEmail', step: 2 },
  paymentMethod: { label: 'Thanh toán', focusId: 'paymentMethod', step: 2 },
  manageUrl: { label: 'Link quản lý', focusId: 'manageUrl', step: 2 },
  cancelUrl: { label: 'Link huỷ', focusId: 'cancelUrl', step: 2 },
  notes: { label: 'Ghi chú', focusId: 'notes', step: 2 },
};

const STEPS = ['Cơ bản', 'Chu kỳ & giá', 'Xác nhận'] as const;

function focusField(key: string) {
  const meta = FIELD_META[key];
  const id = meta?.focusId ?? key;
  const el = document.getElementById(id);
  if (!el) return;
  el.focus({ preventScroll: false });
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    try { el.select(); } catch { /* ignore */ }
  }
}

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-xs text-destructive">{errors[0]}</p>;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" className="rounded-pill" disabled={pending}>
      {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
      {label}
    </Button>
  );
}

function MoneyInput({
  value,
  onChange,
  name,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  name: string;
  id?: string;
}) {
  const locale = useLocale();
  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const n = parseVNDInput(e.target.value);
          onChange(n ? formatNumber(n, locale) : '');
        }}
        placeholder="0"
        className="pr-10"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
        ₫
      </span>
      <input type="hidden" name={name} value={parseVNDInput(value)} />
    </div>
  );
}

function autoRenewalDate(
  startedAt: string,
  cycle: BillingCycle,
  intervalDays: string,
): string {
  if (!startedAt) return '';
  const start = new Date(startedAt);
  let next: Date;
  if (cycle === 'MONTHLY') next = addMonths(start, 1);
  else if (cycle === 'QUARTERLY') next = addMonths(start, 3);
  else if (cycle === 'YEARLY') next = addYears(start, 1);
  else if (cycle === 'CUSTOM') {
    const n = parseInt(intervalDays, 10);
    if (!n || n <= 0) return '';
    next = addDays(start, n);
  } else if (cycle === 'LIFETIME') {
    next = addYears(start, 100);
  } else {
    return '';
  }
  return format(next, 'yyyy-MM-dd');
}

function Stepper({
  current,
  onStepClick,
}: {
  current: number;
  onStepClick?: (i: number) => void;
}) {
  const t = useT();
  return (
    <div className="stepper">
      {STEPS.map((label, i) => {
        const state = i < current ? 'done' : i === current ? 'active' : 'todo';
        return (
          <React.Fragment key={label}>
            <button
              type="button"
              className="stepper-step"
              data-state={state}
              onClick={() => onStepClick?.(i)}
              aria-current={state === 'active' ? 'step' : undefined}
            >
              <span className="stepper-bubble">
                {state === 'done' ? <Check className="h-3 w-3" strokeWidth={3} /> : i + 1}
              </span>
              <span className="stepper-label">{t(label)}</span>
            </button>
            {i < STEPS.length - 1 && <span className="stepper-line" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function SubscriptionForm({
  initial,
  catalog,
  fromWishlistId,
}: {
  initial?: Initial;
  catalog: Catalog;
  fromWishlistId?: string;
}) {
  const isEdit = Boolean(initial?.id);
  const t = useT();
  const locale = useLocale();
  const action = isEdit
    ? updateSubscription.bind(null, initial!.id!)
    : createSubscription;

  const [state, formAction] = useActionState<SubscriptionFormState, FormData>(action, {});
  const errors = state?.errors ?? {};
  const [step, setStep] = React.useState<number>(0);

  const initialMount = React.useRef(true);
  React.useEffect(() => {
    if (initialMount.current) {
      initialMount.current = false;
      return;
    }
    const errs = state?.errors;
    if (errs && Object.keys(errs).length > 0) {
      const keys = Object.keys(errs);
      const labels = keys.map((k) => t(FIELD_META[k]?.label ?? k));
      toast.error(t('Vui lòng kiểm tra: {fields}', { fields: labels.join(', ') }));
      const stepOf = FIELD_META[keys[0]]?.step ?? 0;
      // Defer the step jump out of the effect body — lint flags synchronous
      // setState inside effects. We also need to wait a tick before focusing
      // so the target step's inputs are mounted in the DOM.
      setTimeout(() => {
        setStep(stepOf);
        setTimeout(() => focusField(keys[0]), 30);
      }, 0);
    } else if (state?.ok === false && state.message) {
      toast.error(state.message);
    }
  }, [state, t]);

  const [name, setName] = React.useState<string>(initial?.name ?? '');
  const [category, setCategory] = React.useState<string>(initial?.category ?? '');
  const [brand, setBrand] = React.useState<string>(initial?.brand ?? '');
  const [plan, setPlan] = React.useState<string>(initial?.plan ?? '');
  const [billingCycle, setBillingCycle] = React.useState<BillingCycle>(
    initial?.billingCycle ?? 'MONTHLY',
  );
  const [intervalDays, setIntervalDays] = React.useState<string>(
    initial?.intervalDays != null ? String(initial.intervalDays) : '',
  );
  const [price, setPrice] = React.useState<string>(
    initial?.price ? formatNumber(initial.price, locale) : '',
  );
  const [startedAt, setStartedAt] = React.useState<string>(
    initial?.startedAt
      ? format(new Date(initial.startedAt), 'yyyy-MM-dd')
      : format(new Date(), 'yyyy-MM-dd'),
  );
  const [renewalOverride, setRenewalOverride] = React.useState<string | null>(
    initial?.renewalDate ? format(new Date(initial.renewalDate), 'yyyy-MM-dd') : null,
  );
  const renewalDate =
    renewalOverride ?? autoRenewalDate(startedAt, billingCycle, intervalDays);

  const [autoRenew, setAutoRenew] = React.useState<boolean>(initial?.autoRenew ?? true);
  const [status, setStatus] = React.useState<SubscriptionStatus>(initial?.status ?? 'ACTIVE');
  const [accountEmail, setAccountEmail] = React.useState<string>(initial?.accountEmail ?? '');
  const [paymentMethod, setPaymentMethod] = React.useState<string>(initial?.paymentMethod ?? '');
  const [manageUrl, setManageUrl] = React.useState<string>(initial?.manageUrl ?? '');
  const [cancelUrl, setCancelUrl] = React.useState<string>(initial?.cancelUrl ?? '');
  const [notes, setNotes] = React.useState<string>(initial?.notes ?? '');

  const categoryOptions: ComboboxOption[] = catalog.categories.map((c) => ({
    value: c.code,
    label: c.name,
  }));

  const brandOptions: ComboboxOption[] = React.useMemo(() => {
    const inCat = catalog.brands.filter(
      (b) => !category || b.categoryCodes.length === 0 || b.categoryCodes.includes(category),
    );
    const seen = new Set(inCat.map((b) => b.name));
    const others = catalog.brands.filter((b) => !seen.has(b.name));
    return [
      ...inCat.map((b) => ({ value: b.name, label: b.name })),
      ...others.map((b) => ({ value: b.name, label: b.name, hint: t('khác loại') })),
    ];
  }, [catalog.brands, category, t]);

  // Step gate: validate locally before advancing. The server is still the
  // final authority — these are just friendly fast-fail checks per step.
  const validateStep = (s: number): { ok: boolean; firstMissing?: string } => {
    if (s === 0) {
      if (!name.trim()) return { ok: false, firstMissing: 'name' };
    }
    if (s === 1) {
      if (!price || parseVNDInput(price) <= 0)
        return { ok: false, firstMissing: 'price' };
      if (!startedAt) return { ok: false, firstMissing: 'startedAt' };
      if (billingCycle === 'CUSTOM' && !intervalDays)
        return { ok: false, firstMissing: 'intervalDays' };
    }
    return { ok: true };
  };

  const goNext = () => {
    const v = validateStep(step);
    if (!v.ok) {
      const k = v.firstMissing!;
      toast.error(t('Vui lòng nhập: {field}', { field: t(FIELD_META[k]?.label ?? k) }));
      focusField(k);
      return;
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };
  const goPrev = () => setStep((s) => Math.max(0, s - 1));

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    // Re-validate every step before letting the form action fire.
    for (let i = 0; i < STEPS.length; i++) {
      const v = validateStep(i);
      if (!v.ok) {
        e.preventDefault();
        setStep(i);
        const k = v.firstMissing!;
        toast.error(t('Vui lòng nhập: {field}', { field: t(FIELD_META[k]?.label ?? k) }));
        setTimeout(() => focusField(k), 50);
        return;
      }
    }
  };

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate className="space-y-6">
      {fromWishlistId ? (
        <input type="hidden" name="fromWishlistId" value={fromWishlistId} />
      ) : null}

      {/* Hidden mirrors keep FormData contract intact regardless of which
          step the user is on. We render real inputs visually per step but
          let unmounted ones still submit through these hidden copies. */}
      <input type="hidden" name="status" value={status} />
      <input type="hidden" name="billingCycle" value={billingCycle} />

      <div className="rounded-2xl border-[1.5px] border-border bg-card p-6 shadow-soft md:p-8">
        <Stepper current={step} onStepClick={(i) => i < step && setStep(i)} />
        <div className="my-6 h-px bg-border" />

        {/* === STEP 0 — Cơ bản === */}
        <div className={cn('grid gap-4 md:grid-cols-2', step !== 0 && 'hidden')}>
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="name">
              {t('Tên gói')} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('vd: Apple One Family, ChatGPT Plus')}
              required
            />
            <FieldError errors={errors.name} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">{t('Loại')}</Label>
            <Combobox
              triggerId="category"
              options={categoryOptions}
              value={category}
              onValueChange={setCategory}
              placeholder={t('Chọn loại (tuỳ chọn)')}
              searchPlaceholder={t('Tìm loại...')}
            />
            <input type="hidden" name="category" value={category} />
            <FieldError errors={errors.category} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="brand">{t('Hãng / Nhà cung cấp')}</Label>
            <Combobox
              triggerId="brand"
              options={brandOptions}
              value={brand}
              onValueChange={setBrand}
              placeholder="Apple, OpenAI, Google..."
              searchPlaceholder={t('Tìm hãng...')}
              allowCustom
              customLabel={(v) => t('Dùng hãng "{name}"', { name: v })}
            />
            <input type="hidden" name="brand" value={brand} />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="plan">{t('Plan / Gói')}</Label>
            <Input
              id="plan"
              name="plan"
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              placeholder={t('vd: Family, Pro, 200GB, Team-5 seats')}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="statusVisible">{t('Trạng thái')}</Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as SubscriptionStatus)}
            >
              <SelectTrigger id="statusVisible">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUBSCRIPTION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {subscriptionStatusLabel(s, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="autoRenew">{t('Tự động gia hạn')}</Label>
            <div className="flex h-10 items-center gap-2 rounded-md border-[1.5px] border-border bg-surface px-3">
              <input
                id="autoRenew"
                name="autoRenew"
                type="checkbox"
                checked={autoRenew}
                onChange={(e) => setAutoRenew(e.target.checked)}
                className="h-4 w-4 accent-primary"
              />
              <span className="text-sm text-muted-foreground">
                {autoRenew
                  ? t('Có — sẽ tự log payment + nhắc trước')
                  : t('Không — chỉ nhắc, không tự gia hạn')}
              </span>
            </div>
          </div>
        </div>

        {/* === STEP 1 — Chu kỳ & giá === */}
        <div className={cn('grid gap-4 md:grid-cols-2', step !== 1 && 'hidden')}>
          <div className="space-y-2">
            <Label htmlFor="billingCycle">
              {t('Chu kỳ')} <span className="text-destructive">*</span>
            </Label>
            <Select
              value={billingCycle}
              onValueChange={(v) => setBillingCycle(v as BillingCycle)}
            >
              <SelectTrigger id="billingCycle">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BILLING_CYCLES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {billingCycleLabel(c, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="intervalDays">{t('Số ngày (chỉ khi Tuỳ chỉnh)')}</Label>
            <Input
              id="intervalDays"
              name="intervalDays"
              type="number"
              min={1}
              max={3650}
              value={intervalDays}
              onChange={(e) => setIntervalDays(e.target.value)}
              disabled={billingCycle !== 'CUSTOM'}
              placeholder={t('vd: 14, 90')}
            />
            <FieldError errors={errors.intervalDays} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="price">
              {t('Giá / chu kỳ (VND)')} <span className="text-destructive">*</span>
            </Label>
            <MoneyInput id="price" value={price} onChange={setPrice} name="price" />
            <FieldError errors={errors.price} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="startedAt">
              {t('Ngày bắt đầu')} <span className="text-destructive">*</span>
            </Label>
            <Input
              id="startedAt"
              name="startedAt"
              type="date"
              value={startedAt}
              onChange={(e) => setStartedAt(e.target.value)}
              required
            />
            <FieldError errors={errors.startedAt} />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="renewalDate">{t('Ngày gia hạn / charge tiếp theo')}</Label>
            <Input
              id="renewalDate"
              name="renewalDate"
              type="date"
              value={renewalDate}
              onChange={(e) => setRenewalOverride(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              {t('Tự tính từ Ngày bắt đầu + Chu kỳ. Sửa nếu billing date của mày khác.')}
            </p>
          </div>
        </div>

        {/* === STEP 2 — Account, link, ghi chú, xác nhận === */}
        <div className={cn('space-y-6', step !== 2 && 'hidden')}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="accountEmail">{t('Email tài khoản')}</Label>
              <Input
                id="accountEmail"
                name="accountEmail"
                type="email"
                value={accountEmail}
                onChange={(e) => setAccountEmail(e.target.value)}
                placeholder={t('vd: thanhtrung@...')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="paymentMethod">{t('Phương thức thanh toán')}</Label>
              <Input
                id="paymentMethod"
                name="paymentMethod"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                placeholder={t('vd: Visa **4242, Apple ID, Momo')}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="manageUrl">{t('Link quản lý gói')}</Label>
              <Input
                id="manageUrl"
                name="manageUrl"
                type="url"
                value={manageUrl}
                onChange={(e) => setManageUrl(e.target.value)}
                placeholder="https://..."
              />
              <FieldError errors={errors.manageUrl} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="cancelUrl">{t('Link huỷ gói')}</Label>
              <Input
                id="cancelUrl"
                name="cancelUrl"
                type="url"
                value={cancelUrl}
                onChange={(e) => setCancelUrl(e.target.value)}
                placeholder={t('https://... (1-click cancel nếu có)')}
              />
              <FieldError errors={errors.cancelUrl} />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="notes">{t('Ghi chú')}</Label>
              <Textarea
                id="notes"
                name="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={t('Lưu ý billing, mã coupon, người dùng chung gia đình...')}
                rows={3}
              />
            </div>
          </div>

          {/* Mini recap card to make the confirm step feel intentional. */}
          <div className="rounded-2xl border-[1.5px] border-dashed border-border-strong bg-surface-2 p-4">
            <p className="eyebrow">{t('Xác nhận')}</p>
            <p className="mt-1 text-sm text-ink-2">
              <span className="font-semibold text-ink">{name || '—'}</span>
              {brand && (
                <>
                  {' '}
                  · <span>{brand}</span>
                </>
              )}
              {plan && (
                <>
                  {' '}
                  · <span>{plan}</span>
                </>
              )}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {price ? `${price} ₫` : '—'} ·{' '}
              {billingCycleLabel(billingCycle, locale)}
              {billingCycle === 'CUSTOM' && intervalDays
                ? ' ' +
                  t('({days} ngày)', {
                    days: intervalDays,
                    count: Number(intervalDays),
                  })
                : ''}{' '}
              · {t('Bắt đầu {date}', { date: startedAt || '—' })}
              {billingCycle !== 'LIFETIME' && renewalDate
                ? ' · ' + t('Gia hạn tới {date}', { date: renewalDate })
                : ''}
            </p>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-6">
          <div className="flex gap-2">
            {step > 0 && (
              <Button
                type="button"
                variant="outline"
                className="rounded-pill border-border-strong"
                onClick={goPrev}
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                {t('Quay lại')}
              </Button>
            )}
            <Button
              type="button"
              variant="ghost"
              className="rounded-pill"
              asChild
            >
              <Link href={isEdit ? `/subscriptions/${initial!.id}` : '/subscriptions'}>
                {t('Hủy')}
              </Link>
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {step + 1}/{STEPS.length}
            </span>
            {step < STEPS.length - 1 ? (
              <Button
                type="button"
                className="rounded-pill"
                onClick={goNext}
              >
                {t('Tiếp tục')}
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <SubmitButton label={isEdit ? t('Lưu thay đổi') : t('Thêm gói')} />
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
