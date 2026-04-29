'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Loader2, Save, RotateCcw, Info } from 'lucide-react';
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
import {
  STATUSES,
  STATUS_LABELS,
  type Status,
} from '@/lib/types';
import { formatNumber, parseVNDInput } from '@/lib/format';
import {
  createDevice,
  updateDevice,
  type DeviceFormState,
} from '@/app/actions/devices';
import type {
  CategoryOption,
  BrandOption,
  StoreOption,
  WarrantyProviderOption,
} from '@/app/actions/catalog';

type Initial = {
  id?: string;
  name?: string;
  category?: string;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  purchaseDate?: Date | string;
  purchasePrice?: number;
  purchasePlace?: string | null;
  warrantyMonths?: number;
  warrantyProvider?: string | null;
  warrantyAddress?: string | null;
  warrantyPhone?: string | null;
  warrantyNotes?: string | null;
  status?: Status;
  notes?: string | null;
};

type Catalog = {
  categories: CategoryOption[];
  brands: BrandOption[];
  stores: StoreOption[];
  warrantyProviders: WarrantyProviderOption[];
};

// Maps a server-side field key (from Zod errors) to its UI label and
// the DOM id to focus. The Combobox triggers carry these ids too.
const FIELD_META: Record<string, { label: string; focusId: string }> = {
  name: { label: 'Tên thiết bị', focusId: 'name' },
  category: { label: 'Loại thiết bị', focusId: 'category' },
  purchaseDate: { label: 'Ngày mua', focusId: 'purchaseDate' },
  warrantyMonths: { label: 'Số tháng bảo hành', focusId: 'warrantyMonths' },
};

function focusField(key: string) {
  const meta = FIELD_META[key];
  const id = meta?.focusId ?? key;
  const el = document.getElementById(id);
  if (!el) return;
  el.focus({ preventScroll: false });
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    try {
      el.select();
    } catch {
      // ignore
    }
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
  name = 'purchasePrice',
}: {
  defaultValue?: number;
  name?: string;
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

export function DeviceForm({
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
    ? updateDevice.bind(null, initial!.id!)
    : createDevice;

  const [state, formAction] = useActionState<DeviceFormState, FormData>(action, {});
  const errors = state?.errors ?? {};

  // Toast + focus when the server action returns errors (skip the initial mount).
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

  // ─── Controlled state for the catalog-backed fields ─────────────────────
  const [category, setCategory] = React.useState<string>(
    initial?.category ?? catalog.categories[0]?.code ?? 'OTHER',
  );
  const [brand, setBrand] = React.useState<string>(initial?.brand ?? '');
  const [purchasePlace, setPurchasePlace] = React.useState<string>(
    initial?.purchasePlace ?? '',
  );

  // Warranty fields are controlled so the provider picker can autofill them.
  const [warrantyProvider, setWarrantyProvider] = React.useState<string>(
    initial?.warrantyProvider ?? '',
  );
  const [warrantyPhone, setWarrantyPhone] = React.useState<string>(
    initial?.warrantyPhone ?? '',
  );
  const [warrantyAddress, setWarrantyAddress] = React.useState<string>(
    initial?.warrantyAddress ?? '',
  );
  const [warrantyNotes, setWarrantyNotes] = React.useState<string>(
    initial?.warrantyNotes ?? '',
  );

  // ─── Brand list filtered by category ────────────────────────────────────
  const brandOptions: ComboboxOption[] = React.useMemo(() => {
    const inCat = catalog.brands.filter(
      (b) => b.categoryCodes.length === 0 || b.categoryCodes.includes(category),
    );
    const seen = new Set(inCat.map((b) => b.name));
    const others = catalog.brands.filter((b) => !seen.has(b.name));
    const toOpt = (b: BrandOption): ComboboxOption => ({
      value: b.name,
      label: b.name,
    });
    return [
      ...inCat.map(toOpt),
      // Brands not in this category are still selectable, just sorted to the end.
      ...others.map((b) => ({ value: b.name, label: b.name, hint: 'khác loại' })),
    ];
  }, [catalog.brands, category]);

  const categoryOptions: ComboboxOption[] = catalog.categories.map((c) => ({
    value: c.code,
    label: c.name,
  }));

  const storeOptions: ComboboxOption[] = catalog.stores.map((s) => ({
    value: s.name,
    label: s.name,
    hint:
      s.type === 'ONLINE' ? 'online' : s.type === 'OFFLINE' ? 'cửa hàng' : undefined,
  }));

  const providerOptions: ComboboxOption[] = catalog.warrantyProviders.map((p) => ({
    value: p.name,
    label: p.name,
    hint: p.phone ?? undefined,
  }));

  // ─── Warranty provider autofill ─────────────────────────────────────────
  // When user picks a provider from the catalog: copy phone/address/notes
  // into the editable inputs IF they're empty (don't clobber user edits).
  // The "↺ Khôi phục từ template" button does a full overwrite.
  const applyProviderTemplate = React.useCallback(
    (providerName: string, force: boolean) => {
      const tpl = catalog.warrantyProviders.find((p) => p.name === providerName);
      if (!tpl) return;
      if (force || !warrantyPhone) setWarrantyPhone(tpl.phone ?? '');
      if (force || !warrantyAddress) setWarrantyAddress(tpl.address ?? '');
      if (force || !warrantyNotes) setWarrantyNotes(tpl.notes ?? '');
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [catalog.warrantyProviders],
  );

  const handleProviderChange = (next: string) => {
    setWarrantyProvider(next);
    if (next) applyProviderTemplate(next, false);
  };

  const purchaseDateDefault = initial?.purchaseDate
    ? format(new Date(initial.purchaseDate), 'yyyy-MM-dd')
    : format(new Date(), 'yyyy-MM-dd');

  const selectedTemplate = catalog.warrantyProviders.find(
    (p) => p.name === warrantyProvider,
  );

  // Client-side guard before the server action runs. Replaces the native HTML5
  // popup with a sonner toast and focuses the first missing field.
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    const fd = new FormData(e.currentTarget);
    const missing: string[] = [];
    if (!String(fd.get('name') ?? '').trim()) missing.push('name');
    if (!category) missing.push('category');
    if (!String(fd.get('purchaseDate') ?? '').trim()) missing.push('purchaseDate');
    if (missing.length > 0) {
      e.preventDefault();
      const labels = missing.map((k) => FIELD_META[k]?.label ?? k);
      toast.error('Vui lòng nhập: ' + labels.join(', '));
      focusField(missing[0]);
    }
  };

  return (
    <form
      action={formAction}
      onSubmit={handleSubmit}
      noValidate
      className="space-y-6"
    >
      {fromWishlistId ? (
        <input type="hidden" name="fromWishlistId" value={fromWishlistId} />
      ) : null}
      <div className="rounded-xl border bg-card p-6">
        <h3 className="mb-4 text-base font-semibold">Thông tin thiết bị</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="name">
              Tên thiết bị <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              name="name"
              defaultValue={initial?.name}
              placeholder="vd: MacBook Pro M3"
              required
            />
            <FieldError errors={errors.name} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">
              Loại <span className="text-destructive">*</span>
            </Label>
            <Combobox
              triggerId="category"
              options={categoryOptions}
              value={category}
              onValueChange={(v) => {
                setCategory(v || catalog.categories[0]?.code || 'OTHER');
              }}
              placeholder="Chọn loại"
              searchPlaceholder="Tìm loại..."
              clearable={false}
            />
            <input type="hidden" name="category" value={category} />
            <FieldError errors={errors.category} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="status">Trạng thái</Label>
            <Select name="status" defaultValue={initial?.status ?? 'ACTIVE'}>
              <SelectTrigger id="status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <Label htmlFor="model">Model</Label>
            <Input
              id="model"
              name="model"
              defaultValue={initial?.model ?? ''}
              placeholder="vd: MBP 14 inch 2024"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="serialNumber">Serial / IMEI</Label>
            <Input
              id="serialNumber"
              name="serialNumber"
              defaultValue={initial?.serialNumber ?? ''}
              placeholder="Không bắt buộc"
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <h3 className="mb-4 text-base font-semibold">Mua hàng</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="purchaseDate">
              Ngày mua <span className="text-destructive">*</span>
            </Label>
            <Input
              id="purchaseDate"
              name="purchaseDate"
              type="date"
              defaultValue={purchaseDateDefault}
              required
            />
            <FieldError errors={errors.purchaseDate} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="purchasePrice">Giá mua (VND)</Label>
            <MoneyInput defaultValue={initial?.purchasePrice} />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="purchasePlace">Nơi mua</Label>
            <Combobox
              triggerId="purchasePlace"
              options={storeOptions}
              value={purchasePlace}
              onValueChange={setPurchasePlace}
              placeholder="vd: FPT Shop, Tiki, ..."
              searchPlaceholder="Tìm cửa hàng..."
              allowCustom
              customLabel={(v) => `Dùng nơi mua "${v}"`}
            />
            <input type="hidden" name="purchasePlace" value={purchasePlace} />
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <div className="mb-4 flex items-baseline justify-between gap-2">
          <h3 className="text-base font-semibold">Bảo hành tiêu chuẩn</h3>
          <span className="text-xs text-muted-foreground">
            Có thể thêm gói mở rộng (AppleCare+, ...) sau khi tạo
          </span>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="warrantyMonths">Số tháng bảo hành</Label>
            <Input
              id="warrantyMonths"
              name="warrantyMonths"
              type="number"
              min={0}
              defaultValue={initial?.warrantyMonths ?? 12}
            />
            <FieldError errors={errors.warrantyMonths} />
            <p className="text-xs text-muted-foreground">
              Ngày hết = ngày mua + số tháng. Để 0 nếu không có bảo hành.
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor="warrantyProvider">Đơn vị bảo hành</Label>
              {selectedTemplate ? (
                <button
                  type="button"
                  onClick={() => applyProviderTemplate(warrantyProvider, true)}
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                  title="Ghi đè SĐT/địa chỉ/ghi chú từ template"
                >
                  <RotateCcw className="h-3 w-3" />
                  Khôi phục từ template
                </button>
              ) : null}
            </div>
            <Combobox
              triggerId="warrantyProvider"
              options={providerOptions}
              value={warrantyProvider}
              onValueChange={handleProviderChange}
              placeholder="vd: Apple Việt Nam"
              searchPlaceholder="Tìm đơn vị bảo hành..."
              allowCustom
              customLabel={(v) => `Dùng đơn vị "${v}"`}
            />
            <input type="hidden" name="warrantyProvider" value={warrantyProvider} />
            {selectedTemplate?.websiteUrl ? (
              <p className="text-xs text-muted-foreground">
                Website:{' '}
                <a
                  href={selectedTemplate.websiteUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  {selectedTemplate.websiteUrl}
                </a>
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="warrantyPhone">SĐT bảo hành</Label>
            <Input
              id="warrantyPhone"
              name="warrantyPhone"
              type="tel"
              value={warrantyPhone}
              onChange={(e) => setWarrantyPhone(e.target.value)}
              placeholder="vd: 1800 1234"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="warrantyAddress">Địa chỉ trung tâm BH</Label>
            <Input
              id="warrantyAddress"
              name="warrantyAddress"
              value={warrantyAddress}
              onChange={(e) => setWarrantyAddress(e.target.value)}
              placeholder="vd: 123 Nguyễn Trãi, Q.1"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="warrantyNotes">Ghi chú bảo hành</Label>
            <Textarea
              id="warrantyNotes"
              name="warrantyNotes"
              value={warrantyNotes}
              onChange={(e) => setWarrantyNotes(e.target.value)}
              placeholder="Điều kiện, lưu ý khi đi bảo hành..."
              rows={3}
            />
          </div>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-6">
        <h3 className="mb-4 text-base font-semibold">Ghi chú</h3>
        <Textarea
          id="notes"
          name="notes"
          defaultValue={initial?.notes ?? ''}
          placeholder="Ghi chú tự do về thiết bị..."
          rows={4}
        />
      </div>

      {!isEdit ? (
        <div className="flex gap-3 rounded-xl border border-dashed bg-muted/30 p-4 text-sm">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <p className="font-medium">Có thể thêm sau khi tạo (ở trang chi tiết):</p>
            <ul className="ml-4 list-disc space-y-0.5 text-muted-foreground">
              <li>Ảnh, hoá đơn, PDF đính kèm — tối đa 5 file, mỗi file 5MB.</li>
              <li>Gói bảo hành mở rộng (AppleCare+, Samsung Care+, FPT Care...).</li>
              <li>Gói bảo hành bên thứ ba (bảo hiểm thẻ tín dụng, gói cửa hàng...).</li>
            </ul>
          </div>
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="outline" asChild>
          <Link href={isEdit ? `/devices/${initial!.id}` : '/devices'}>Hủy</Link>
        </Button>
        <SubmitButton label={isEdit ? 'Lưu thay đổi' : 'Thêm thiết bị'} />
      </div>
    </form>
  );
}
