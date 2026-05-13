'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { format } from 'date-fns';
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

const FIELD_META: Record<string, { label: string; focusId: string }> = {
  name: { label: 'Tên sản phẩm', focusId: 'name' },
  buyUrl: { label: 'Link mua', focusId: 'buyUrl' },
  imageUrl: { label: 'Link ảnh', focusId: 'imageUrl' },
  targetDate: { label: 'Ngày dự kiến mua', focusId: 'targetDate' },
  reminderIntervalDays: { label: 'Nhắc lại sau (ngày)', focusId: 'reminderIntervalDays' },
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
  defaultValue,
  name,
}: {
  defaultValue?: number | null;
  name: string;
}) {
  const [value, setValue] = React.useState<string>(
    defaultValue ? formatNumber(defaultValue) : '',
  );
  return (
    <div className="relative">
      <Input
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          const n = parseVNDInput(e.target.value);
          setValue(n ? formatNumber(n) : '');
        }}
        placeholder="Cân nhắc / 0"
        className="pr-10"
      />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
        ₫
      </span>
      <input type="hidden" name={name} value={parseVNDInput(value)} />
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

  const [category, setCategory] = React.useState<string>(initial?.category ?? '');
  const [brand, setBrand] = React.useState<string>(initial?.brand ?? '');
  // React 19 resets uncontrolled inputs after a form action returns. Mirror
  // the text/number/date fields into state so user input survives validation
  // round-trips.
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
    if (missing.length > 0) {
      e.preventDefault();
      const labels = missing.map((k) => FIELD_META[k]?.label ?? k);
      toast.error('Vui lòng nhập: ' + labels.join(', '));
      focusField(missing[0]);
    }
  };

  return (
    <form action={formAction} onSubmit={handleSubmit} noValidate className="space-y-6">
      <div className="rounded-xl border bg-card p-6">
        <h3 className="mb-4 text-base font-semibold">Thông tin sản phẩm</h3>
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
            <Label htmlFor="priority">Mức độ thèm</Label>
            <Select name="priority" value={priority} onValueChange={setPriority}>
              <SelectTrigger id="priority">
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
            <Label htmlFor="status">Trạng thái</Label>
            <Select name="status" value={status} onValueChange={setStatus}>
              <SelectTrigger id="status">
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
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <h3 className="mb-4 text-base font-semibold">Giá & Link</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="initialPrice">Giá ban đầu (VND)</Label>
            <MoneyInput
              defaultValue={initial?.initialPrice ?? null}
              name="initialPrice"
            />
            <p className="text-xs text-muted-foreground">
              Giá lúc đầu mày bắt đầu để ý. Để trống nếu chưa biết.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="currentPrice">Giá hiện tại (VND)</Label>
            <MoneyInput
              defaultValue={initial?.currentPrice ?? null}
              name="currentPrice"
            />
            <p className="text-xs text-muted-foreground">
              Đổi giá ở đây sẽ tự log vào lịch sử giá.
            </p>
          </div>

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
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <h3 className="mb-4 text-base font-semibold">Kế hoạch mua</h3>
        <div className="grid gap-4 md:grid-cols-2">
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
              Để trống nếu không cần. vd: 30 = mỗi 30 ngày sẽ ping check giá.
            </p>
          </div>

          <div className="space-y-2 md:col-span-2">
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
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="outline" asChild>
          <Link href={isEdit ? `/wishlist/${initial!.id}` : '/wishlist'}>Hủy</Link>
        </Button>
        <SubmitButton label={isEdit ? 'Lưu thay đổi' : 'Thêm vào wishlist'} />
      </div>
    </form>
  );
}
