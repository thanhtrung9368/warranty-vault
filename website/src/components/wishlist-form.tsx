'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { format } from 'date-fns';
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
import {
  WISHLIST_PRIORITIES,
  WISHLIST_PRIORITY_LABELS,
  WISHLIST_STATUSES,
  WISHLIST_STATUS_LABELS,
  type WishlistPriority,
  type WishlistStatus,
} from '@/lib/wishlist-types';
import {
  createWishlistItem,
  updateWishlistItem,
  type WishlistFormState,
} from '@/app/actions/wishlist';
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
  initialPrice?: number | null;
  currentPrice?: number | null;
  buyUrl?: string | null;
  imageUrl?: string | null;
  targetDate?: Date | string | null;
  priority?: WishlistPriority;
  status?: WishlistStatus;
  notes?: string | null;
  reminderIntervalDays?: number | null;
};

type Catalog = {
  categories: CategoryOption[];
  brands: BrandOption[];
};

const FIELD_META: Record<string, { label: string; focusId: string; step: number }> = {
  name: { label: 'Tên sản phẩm', focusId: 'name', step: 0 },
  category: { label: 'Loại', focusId: 'category', step: 0 },
  brand: { label: 'Hãng', focusId: 'brand', step: 0 },
  priority: { label: 'Mức độ thèm', focusId: 'priority', step: 0 },
  status: { label: 'Trạng thái', focusId: 'status', step: 0 },
  initialPrice: { label: 'Giá ban đầu', focusId: 'initialPrice', step: 0 },
  currentPrice: { label: 'Giá hiện tại', focusId: 'currentPrice', step: 0 },
  buyUrl: { label: 'Link mua', focusId: 'buyUrl', step: 1 },
  imageUrl: { label: 'Link ảnh', focusId: 'imageUrl', step: 1 },
  targetDate: { label: 'Ngày dự kiến mua', focusId: 'targetDate', step: 1 },
  reminderIntervalDays: { label: 'Nhắc lại sau (ngày)', focusId: 'reminderIntervalDays', step: 1 },
  notes: { label: 'Ghi chú', focusId: 'notes', step: 2 },
};

const STEPS = ['Cơ bản', 'Mục tiêu', 'Xác nhận'] as const;

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
  return (
    <div className="relative">
      <Input
        id={id}
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const n = parseVNDInput(e.target.value);
          onChange(n ? formatNumber(n) : '');
        }}
        placeholder="Cân nhắc / 0"
        className="pr-10"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm font-semibold text-muted-foreground">
        ₫
      </span>
      <input type="hidden" name={name} value={parseVNDInput(value)} />
    </div>
  );
}

function Stepper({
  current,
  onStepClick,
}: {
  current: number;
  onStepClick?: (i: number) => void;
}) {
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
              <span className="stepper-label">{label}</span>
            </button>
            {i < STEPS.length - 1 && <span className="stepper-line" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function WishlistForm({
  initial,
  catalog,
}: {
  initial?: Initial;
  catalog: Catalog;
}) {
  const isEdit = Boolean(initial?.id);
  const action = isEdit
    ? updateWishlistItem.bind(null, initial!.id!)
    : createWishlistItem;

  const [state, formAction] = useActionState<WishlistFormState, FormData>(action, {});
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
      const labels = keys.map((k) => FIELD_META[k]?.label ?? k);
      toast.error('Vui lòng kiểm tra: ' + labels.join(', '));
      const stepOf = FIELD_META[keys[0]]?.step ?? 0;
      // See subscription-form for why this is deferred.
      setTimeout(() => {
        setStep(stepOf);
        setTimeout(() => focusField(keys[0]), 30);
      }, 0);
    } else if (state?.ok === false && state.message) {
      toast.error(state.message);
    }
  }, [state]);

  const [category, setCategory] = React.useState<string>(initial?.category ?? '');
  const [brand, setBrand] = React.useState<string>(initial?.brand ?? '');
  const [name, setName] = React.useState<string>(initial?.name ?? '');
  const [buyUrl, setBuyUrl] = React.useState<string>(initial?.buyUrl ?? '');
  const [imageUrl, setImageUrl] = React.useState<string>(initial?.imageUrl ?? '');
  const [targetDate, setTargetDate] = React.useState<string>(
    initial?.targetDate ? format(new Date(initial.targetDate), 'yyyy-MM-dd') : '',
  );
  const [reminderIntervalDays, setReminderIntervalDays] = React.useState<string>(
    initial?.reminderIntervalDays != null ? String(initial.reminderIntervalDays) : '',
  );
  const [notes, setNotes] = React.useState<string>(initial?.notes ?? '');
  const [priority, setPriority] = React.useState<string>(initial?.priority ?? 'WANT');
  const [status, setStatus] = React.useState<string>(initial?.status ?? 'WATCHING');
  const [initialPrice, setInitialPrice] = React.useState<string>(
    initial?.initialPrice ? formatNumber(initial.initialPrice) : '',
  );
  const [currentPrice, setCurrentPrice] = React.useState<string>(
    initial?.currentPrice ? formatNumber(initial.currentPrice) : '',
  );

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
      ...others.map((b) => ({ value: b.name, label: b.name, hint: 'khác loại' })),
    ];
  }, [catalog.brands, category]);

  const validateStep = (s: number): { ok: boolean; firstMissing?: string } => {
    if (s === 0) {
      if (!name.trim()) return { ok: false, firstMissing: 'name' };
    }
    return { ok: true };
  };

  const goNext = () => {
    const v = validateStep(step);
    if (!v.ok) {
      const k = v.firstMissing!;
      toast.error('Vui lòng nhập: ' + (FIELD_META[k]?.label ?? k));
      focusField(k);
      return;
    }
    setStep((s) => Math.min(STEPS.length - 1, s + 1));
  };
  const goPrev = () => setStep((s) => Math.max(0, s - 1));

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    for (let i = 0; i < STEPS.length; i++) {
      const v = validateStep(i);
      if (!v.ok) {
        e.preventDefault();
        setStep(i);
        const k = v.firstMissing!;
        toast.error('Vui lòng nhập: ' + (FIELD_META[k]?.label ?? k));
        setTimeout(() => focusField(k), 50);
        return;
      }
    }
  };

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate className="space-y-6">
      {/* Hidden mirrors keep FormData stable regardless of which step renders. */}
      <input type="hidden" name="priority" value={priority} />
      <input type="hidden" name="status" value={status} />

      <div className="rounded-2xl border-[1.5px] border-border bg-card p-6 shadow-soft md:p-8">
        <Stepper current={step} onStepClick={(i) => i < step && setStep(i)} />
        <div className="my-6 h-px bg-border" />

        {/* === STEP 0 — Cơ bản === */}
        <div className={cn('space-y-4', step !== 0 && 'hidden')}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="name">
                Tên sản phẩm <span className="text-destructive">*</span>
              </Label>
              <Input
                id="name"
                name="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="vd: Mac Studio M5 Max"
                required
              />
              <FieldError errors={errors.name} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="category">Loại</Label>
              <Combobox
                triggerId="category"
                options={categoryOptions}
                value={category}
                onValueChange={setCategory}
                placeholder="Chọn loại (tuỳ chọn)"
                searchPlaceholder="Tìm loại..."
              />
              <input type="hidden" name="category" value={category} />
              <FieldError errors={errors.category} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="brand">Hãng</Label>
              <Combobox
                triggerId="brand"
                options={brandOptions}
                value={brand}
                onValueChange={setBrand}
                placeholder="Apple, Samsung, ..."
                searchPlaceholder="Tìm hãng..."
                allowCustom
                customLabel={(v) => `Dùng hãng "${v}"`}
              />
              <input type="hidden" name="brand" value={brand} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="priorityVisible">Mức độ thèm</Label>
              <Select value={priority} onValueChange={setPriority}>
                <SelectTrigger id="priorityVisible">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WISHLIST_PRIORITIES.map((p) => (
                    <SelectItem key={p} value={p}>
                      {WISHLIST_PRIORITY_LABELS[p]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="statusVisible">Trạng thái</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="statusVisible">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WISHLIST_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {WISHLIST_STATUS_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="initialPrice">Giá ban đầu (VND)</Label>
              <MoneyInput
                id="initialPrice"
                value={initialPrice}
                onChange={setInitialPrice}
                name="initialPrice"
              />
              <p className="text-xs text-muted-foreground">
                Lúc bắt đầu để ý. Để trống nếu chưa biết.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="currentPrice">Giá hiện tại (VND)</Label>
              <MoneyInput
                id="currentPrice"
                value={currentPrice}
                onChange={setCurrentPrice}
                name="currentPrice"
              />
              <p className="text-xs text-muted-foreground">
                Đổi giá ở đây sẽ tự log vào lịch sử.
              </p>
            </div>
          </div>
        </div>

        {/* === STEP 1 — Mục tiêu === */}
        <div className={cn('space-y-4', step !== 1 && 'hidden')}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="buyUrl">Link mua</Label>
              <Input
                id="buyUrl"
                name="buyUrl"
                type="url"
                value={buyUrl}
                onChange={(e) => setBuyUrl(e.target.value)}
                placeholder="https://www.apple.com/vn-edu/..."
              />
              <FieldError errors={errors.buyUrl} />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="imageUrl">Link ảnh sản phẩm</Label>
              <Input
                id="imageUrl"
                name="imageUrl"
                type="url"
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                placeholder="https://... (tuỳ chọn)"
              />
              <FieldError errors={errors.imageUrl} />
            </div>

            <div className="space-y-2">
              <Label htmlFor="targetDate">Ngày dự kiến mua</Label>
              <Input
                id="targetDate"
                name="targetDate"
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Có ngày này → sẽ bị nhắc trước 30 / 7 / 0 ngày.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="reminderIntervalDays">Nhắc lại check giá (ngày)</Label>
              <Input
                id="reminderIntervalDays"
                name="reminderIntervalDays"
                type="number"
                min={1}
                max={365}
                value={reminderIntervalDays}
                onChange={(e) => setReminderIntervalDays(e.target.value)}
                placeholder="vd: 30"
              />
              <FieldError errors={errors.reminderIntervalDays} />
              <p className="text-xs text-muted-foreground">
                Để trống nếu không cần. vd: 30 = mỗi 30 ngày ping check.
              </p>
            </div>
          </div>
        </div>

        {/* === STEP 2 — Ghi chú + xác nhận === */}
        <div className={cn('space-y-4', step !== 2 && 'hidden')}>
          <div className="space-y-2">
            <Label htmlFor="notes">Ghi chú</Label>
            <Textarea
              id="notes"
              name="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Điều kiện mua, lý do thèm, deal cần chờ..."
              rows={4}
            />
          </div>

          <div className="rounded-2xl border-[1.5px] border-dashed border-border-strong bg-surface-2 p-4">
            <p className="eyebrow">Xác nhận món thèm</p>
            <p className="mt-1 text-sm text-ink-2">
              <span className="font-semibold text-ink">{name || '—'}</span>
              {brand && (
                <>
                  {' '}
                  · <span>{brand}</span>
                </>
              )}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {WISHLIST_PRIORITY_LABELS[priority as WishlistPriority] ?? priority} ·{' '}
              {WISHLIST_STATUS_LABELS[status as WishlistStatus] ?? status}
              {currentPrice ? ` · Hiện tại ${currentPrice} ₫` : ''}
              {targetDate ? ` · Target ${targetDate}` : ''}
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
                Quay lại
              </Button>
            )}
            <Button type="button" variant="ghost" className="rounded-pill" asChild>
              <Link href={isEdit ? `/wishlist/${initial!.id}` : '/wishlist'}>Hủy</Link>
            </Button>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {step + 1}/{STEPS.length}
            </span>
            {step < STEPS.length - 1 ? (
              <Button type="button" className="rounded-pill" onClick={goNext}>
                Tiếp tục
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <SubmitButton label={isEdit ? 'Lưu thay đổi' : 'Thêm vào wishlist'} />
            )}
          </div>
        </div>
      </div>
    </form>
  );
}
