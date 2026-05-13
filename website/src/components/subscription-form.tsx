'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { format, addDays, addMonths, addYears } from 'date-fns';
import { toast } from 'sonner';
import { Loader2, Save } from 'lucide-react';
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
  BILLING_CYCLES,
  BILLING_CYCLE_LABELS,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABELS,
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

const FIELD_META: Record<string, { label: string; focusId: string }> = {
  name: { label: 'Tên gói', focusId: 'name' },
  billingCycle: { label: 'Chu kỳ', focusId: 'billingCycle' },
  intervalDays: { label: 'Số ngày', focusId: 'intervalDays' },
  price: { label: 'Giá', focusId: 'price' },
  startedAt: { label: 'Ngày bắt đầu', focusId: 'startedAt' },
  renewalDate: { label: 'Ngày gia hạn', focusId: 'renewalDate' },
  manageUrl: { label: 'Link quản lý', focusId: 'manageUrl' },
  cancelUrl: { label: 'Link huỷ', focusId: 'cancelUrl' },
};

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
    <Button type="submit" disabled={pending}>
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
        placeholder="0"
        className="pr-10"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
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
  const action = isEdit
    ? updateSubscription.bind(null, initial!.id!)
    : createSubscription;

  const [state, formAction] = useActionState<SubscriptionFormState, FormData>(action, {});
  const errors = state?.errors ?? {};

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
      focusField(keys[0]);
    } else if (state?.ok === false && state.message) {
      toast.error(state.message);
    }
  }, [state]);

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
    initial?.price ? formatNumber(initial.price) : '',
  );
  const [startedAt, setStartedAt] = React.useState<string>(
    initial?.startedAt
      ? format(new Date(initial.startedAt), 'yyyy-MM-dd')
      : format(new Date(), 'yyyy-MM-dd'),
  );
  // If user hasn't typed a value, the field shows an auto-derived date
  // (startedAt + cycle). Once they type, `renewalOverride` holds their value
  // and we stop deriving — same UX, but without setState-in-effect.
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
      ...others.map((b) => ({ value: b.name, label: b.name, hint: 'khác loại' })),
    ];
  }, [catalog.brands, category]);

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    const fd = new FormData(e.currentTarget);
    const missing: string[] = [];
    if (!String(fd.get('name') ?? '').trim()) missing.push('name');
    if (!String(fd.get('startedAt') ?? '').trim()) missing.push('startedAt');
    if (Number(fd.get('price') ?? 0) <= 0) missing.push('price');
    if (billingCycle === 'CUSTOM' && !intervalDays) missing.push('intervalDays');
    if (missing.length > 0) {
      e.preventDefault();
      const labels = missing.map((k) => FIELD_META[k]?.label ?? k);
      toast.error('Vui lòng nhập: ' + labels.join(', '));
      focusField(missing[0]);
    }
  };

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate className="space-y-6">
      {fromWishlistId ? (
        <input type="hidden" name="fromWishlistId" value={fromWishlistId} />
      ) : null}

      <div className="rounded-xl border bg-card p-6">
        <h3 className="mb-4 text-base font-semibold">Thông tin gói</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="name">
              Tên gói <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="vd: Apple One Family, ChatGPT Plus"
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
            <Label htmlFor="brand">Hãng / Nhà cung cấp</Label>
            <Combobox
              triggerId="brand"
              options={brandOptions}
              value={brand}
              onValueChange={setBrand}
              placeholder="Apple, OpenAI, Google..."
              searchPlaceholder="Tìm hãng..."
              allowCustom
              customLabel={(v) => `Dùng hãng "${v}"`}
            />
            <input type="hidden" name="brand" value={brand} />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="plan">Plan / Gói</Label>
            <Input
              id="plan"
              name="plan"
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              placeholder="vd: Family, Pro, 200GB, Team-5 seats"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">Trạng thái</Label>
            <Select
              name="status"
              value={status}
              onValueChange={(v) => setStatus(v as SubscriptionStatus)}
            >
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUBSCRIPTION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SUBSCRIPTION_STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="autoRenew">Tự động gia hạn</Label>
            <div className="flex h-10 items-center gap-2 rounded-md border border-input bg-background px-3">
              <input
                id="autoRenew"
                name="autoRenew"
                type="checkbox"
                checked={autoRenew}
                onChange={(e) => setAutoRenew(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-sm text-muted-foreground">
                {autoRenew
                  ? 'Có — sẽ tự log payment + nhắc trước'
                  : 'Không — chỉ nhắc, không tự gia hạn'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <h3 className="mb-4 text-base font-semibold">Chu kỳ & Giá</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="billingCycle">
              Chu kỳ <span className="text-destructive">*</span>
            </Label>
            <Select
              name="billingCycle"
              value={billingCycle}
              onValueChange={(v) => setBillingCycle(v as BillingCycle)}
            >
              <SelectTrigger id="billingCycle">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BILLING_CYCLES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {BILLING_CYCLE_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="intervalDays">Số ngày (chỉ khi Tuỳ chỉnh)</Label>
            <Input
              id="intervalDays"
              name="intervalDays"
              type="number"
              min={1}
              max={3650}
              value={intervalDays}
              onChange={(e) => setIntervalDays(e.target.value)}
              disabled={billingCycle !== 'CUSTOM'}
              placeholder="vd: 14, 90"
            />
            <FieldError errors={errors.intervalDays} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="price">
              Giá / chu kỳ (VND) <span className="text-destructive">*</span>
            </Label>
            <MoneyInput
              id="price"
              value={price}
              onChange={setPrice}
              name="price"
            />
            <FieldError errors={errors.price} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="startedAt">
              Ngày bắt đầu <span className="text-destructive">*</span>
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
            <Label htmlFor="renewalDate">Ngày gia hạn / charge tiếp theo</Label>
            <Input
              id="renewalDate"
              name="renewalDate"
              type="date"
              value={renewalDate}
              onChange={(e) => setRenewalOverride(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Tự tính từ Ngày bắt đầu + Chu kỳ. Sửa nếu billing date của mày khác.
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <h3 className="mb-4 text-base font-semibold">Account & Liên kết</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="accountEmail">Email tài khoản</Label>
            <Input
              id="accountEmail"
              name="accountEmail"
              type="email"
              value={accountEmail}
              onChange={(e) => setAccountEmail(e.target.value)}
              placeholder="vd: thanhtrung@..."
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="paymentMethod">Phương thức thanh toán</Label>
            <Input
              id="paymentMethod"
              name="paymentMethod"
              value={paymentMethod}
              onChange={(e) => setPaymentMethod(e.target.value)}
              placeholder="vd: Visa **4242, Apple ID, Momo"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="manageUrl">Link quản lý gói</Label>
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
            <Label htmlFor="cancelUrl">Link huỷ gói</Label>
            <Input
              id="cancelUrl"
              name="cancelUrl"
              type="url"
              value={cancelUrl}
              onChange={(e) => setCancelUrl(e.target.value)}
              placeholder="https://... (1-click cancel nếu có)"
            />
            <FieldError errors={errors.cancelUrl} />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="notes">Ghi chú</Label>
            <Textarea
              id="notes"
              name="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Lưu ý billing, mã coupon, người dùng chung gia đình..."
              rows={3}
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="outline" asChild>
          <Link href={isEdit ? `/subscriptions/${initial!.id}` : '/subscriptions'}>Hủy</Link>
        </Button>
        <SubmitButton label={isEdit ? 'Lưu thay đổi' : 'Thêm gói'} />
      </div>
    </form>
  );
}
