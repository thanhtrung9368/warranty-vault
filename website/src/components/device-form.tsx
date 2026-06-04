'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { format } from 'date-fns';
import { toast } from 'sonner';
import {
  Loader2,
  Save,
  RotateCcw,
  ArrowLeft,
  ArrowRight,
  Check,
  ScanLine,
  Sparkles,
} from 'lucide-react';
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
  CATEGORY_LABELS,
  STATUSES,
  STATUS_LABELS,
  type Status,
} from '@/lib/types';
import { formatNumber, parseVNDInput, formatVND, formatDate } from '@/lib/format';
import {
  createDevice,
  updateDevice,
  type DeviceFormState,
} from '@/app/actions/devices';
import { extractReceipt } from '@/app/actions/ai';
import type {
  CategoryOption,
  BrandOption,
  StoreOption,
  WarrantyProviderOption,
} from '@/app/actions/catalog';
import { cn } from '@/lib/utils';

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

// Maps a server-side field key (from Zod errors) to label, focus id, and step.
const FIELD_META: Record<string, { label: string; focusId: string; step: number }> = {
  name: { label: 'Tên thiết bị', focusId: 'name', step: 0 },
  category: { label: 'Loại thiết bị', focusId: 'category', step: 0 },
  purchaseDate: { label: 'Ngày mua', focusId: 'purchaseDate', step: 1 },
  warrantyMonths: { label: 'Số tháng bảo hành', focusId: 'warrantyMonths', step: 2 },
};

// Vietnamese labels for draft fields the OCR could not map to the catalog.
const UNMATCHED_LABELS: Record<string, string> = {
  brand: 'Hãng',
  purchasePlace: 'Nơi mua',
  category: 'Loại thiết bị',
};

const STEPS = [
  { label: 'Cơ bản', hint: 'Tên, hãng, model' },
  { label: 'Mua hàng', hint: 'Ngày mua, giá, nơi mua' },
  { label: 'Bảo hành', hint: 'Gói tiêu chuẩn' },
  { label: 'Xác nhận', hint: 'Ghi chú & kiểm tra' },
];

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
  return <p className="text-xs font-medium text-destructive">{errors[0]}</p>;
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="rounded-pill">
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Save className="mr-2 h-4 w-4" />
      )}
      {label}
    </Button>
  );
}

function MoneyInput({
  value,
  onChange,
  name = 'purchasePrice',
}: {
  value: string;
  onChange: (v: string) => void;
  name?: string;
}) {
  return (
    <div className="relative">
      <Input
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

function Stepper({ current }: { current: number }) {
  return (
    <div className="stepper w-full">
      {STEPS.map((s, i) => {
        const state =
          i < current ? 'done' : i === current ? 'active' : 'pending';
        return (
          <React.Fragment key={s.label}>
            <div className="stepper-step min-w-0" data-state={state}>
              <span className="stepper-bubble">
                {state === 'done' ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className="stepper-label hidden truncate sm:inline">
                {s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && <span className="stepper-line" />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

export function DeviceForm({
  initial,
  catalog,
  fromWishlistId,
  aiEnabled = false,
}: {
  initial?: Initial;
  catalog: Catalog;
  fromWishlistId?: string;
  aiEnabled?: boolean;
}) {
  const isEdit = Boolean(initial?.id);
  const action = isEdit ? updateDevice.bind(null, initial!.id!) : createDevice;

  const [state, formAction] = useActionState<DeviceFormState, FormData>(action, {});
  const errors = state?.errors ?? {};

  // ─── Field state — fully controlled so we can split across steps ────────
  const [step, setStep] = React.useState(0);
  const [name, setName] = React.useState(initial?.name ?? '');
  const [category, setCategory] = React.useState<string>(
    initial?.category ?? catalog.categories[0]?.code ?? 'OTHER',
  );
  const [brand, setBrand] = React.useState<string>(initial?.brand ?? '');
  const [model, setModel] = React.useState<string>(initial?.model ?? '');
  const [serialNumber, setSerialNumber] = React.useState<string>(
    initial?.serialNumber ?? '',
  );
  const [status, setStatus] = React.useState<Status>(initial?.status ?? 'ACTIVE');

  const [purchaseDate, setPurchaseDate] = React.useState<string>(
    initial?.purchaseDate
      ? format(new Date(initial.purchaseDate), 'yyyy-MM-dd')
      : format(new Date(), 'yyyy-MM-dd'),
  );
  const [purchasePriceDisplay, setPurchasePriceDisplay] = React.useState<string>(
    initial?.purchasePrice ? formatNumber(initial.purchasePrice) : '',
  );
  const [purchasePlace, setPurchasePlace] = React.useState<string>(
    initial?.purchasePlace ?? '',
  );

  const [warrantyMonths, setWarrantyMonths] = React.useState<number>(
    initial?.warrantyMonths ?? 12,
  );
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

  const [notes, setNotes] = React.useState<string>(initial?.notes ?? '');

  // ─── OCR receipt scan (create flow only) ────────────────────────────────
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = React.useState(false);
  const [scanInfo, setScanInfo] = React.useState<
    { confidence: 'high' | 'medium' | 'low'; unmatched: string[] } | null
  >(null);

  // applyDraft seeds the controlled fields from an extracted draft. Catalog
  // codes (category) are only applied when they exist in the loaded catalog;
  // free-text brand / place is set verbatim (the comboboxes allowCustom).
  const applyDraft = React.useCallback(
    (d: import('@/lib/api/ai').DraftDevice) => {
      if (d.name) setName(d.name);
      if (d.category && catalog.categories.some((c) => c.code === d.category)) {
        setCategory(d.category);
      }
      if (d.brand) setBrand(d.brand);
      if (d.model) setModel(d.model);
      if (d.serialNumber) setSerialNumber(d.serialNumber);
      if (d.purchaseDate) setPurchaseDate(d.purchaseDate);
      if (typeof d.purchasePrice === 'number') {
        setPurchasePriceDisplay(formatNumber(d.purchasePrice));
      }
      if (d.purchasePlace) setPurchasePlace(d.purchasePlace);
      if (typeof d.warrantyMonths === 'number') setWarrantyMonths(d.warrantyMonths);
    },
    [catalog.categories],
  );

  const handleScanFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file
    if (!file) return;
    setScanning(true);
    setScanInfo(null);
    try {
      const fd = new FormData();
      fd.append('file', file, file.name);
      const res = await extractReceipt(fd);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      applyDraft(res.draft);
      setScanInfo({ confidence: res.draft.confidence, unmatched: res.draft.unmatched });
      setStep(0);
      toast.success('Đã điền nháp từ hoá đơn — kiểm tra lại trước khi lưu nhé');
    } catch {
      toast.error('Không quét được hoá đơn, thử lại sau');
    } finally {
      setScanning(false);
    }
  };

  // Toast + focus when the server returns errors (skip the initial mount).
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
      // Jump to the step that owns the first failing field, then focus it.
      // The setState here syncs UI to a server-action result, not local state.
      const firstStep = FIELD_META[keys[0]]?.step ?? 0;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStep(firstStep);
      setTimeout(() => focusField(keys[0]), 0);
    } else if (state?.ok === false && state.message) {
      toast.error(state.message);
    }
  }, [state]);

  // ─── Catalog-driven options ─────────────────────────────────────────────
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

  const selectedTemplate = catalog.warrantyProviders.find(
    (p) => p.name === warrantyProvider,
  );

  // ─── Step navigation w/ per-step validation ─────────────────────────────
  const validateStep = (s: number): string | null => {
    if (s === 0) {
      if (!name.trim()) return 'name';
      if (!category) return 'category';
    }
    if (s === 1) {
      if (!purchaseDate) return 'purchaseDate';
    }
    if (s === 2) {
      if (warrantyMonths < 0) return 'warrantyMonths';
    }
    return null;
  };

  const goNext = () => {
    const bad = validateStep(step);
    if (bad) {
      toast.error('Vui lòng nhập: ' + (FIELD_META[bad]?.label ?? bad));
      focusField(bad);
      return;
    }
    setStep((s) => Math.min(s + 1, STEPS.length - 1));
  };

  const goPrev = () => setStep((s) => Math.max(s - 1, 0));

  const resetAll = () => {
    setName('');
    setCategory(catalog.categories[0]?.code ?? 'OTHER');
    setBrand('');
    setModel('');
    setSerialNumber('');
    setStatus('ACTIVE');
    setPurchaseDate(format(new Date(), 'yyyy-MM-dd'));
    setPurchasePriceDisplay('');
    setPurchasePlace('');
    setWarrantyMonths(12);
    setWarrantyProvider('');
    setWarrantyPhone('');
    setWarrantyAddress('');
    setWarrantyNotes('');
    setNotes('');
    setStep(0);
  };

  // Pre-submit guard — runs all step validations before the server action.
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    for (let i = 0; i < STEPS.length; i++) {
      const bad = validateStep(i);
      if (bad) {
        e.preventDefault();
        setStep(i);
        toast.error('Vui lòng nhập: ' + (FIELD_META[bad]?.label ?? bad));
        setTimeout(() => focusField(bad), 0);
        return;
      }
    }
  };

  // ─── Render helpers ─────────────────────────────────────────────────────
  const categoryLabel =
    CATEGORY_LABELS[category as keyof typeof CATEGORY_LABELS] ?? category;

  // All steps share the same form, just toggle visibility per step.
  // This keeps every field mounted so its hidden input ships with submit.
  const stepCls = (i: number) => (step === i ? 'block' : 'hidden');

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

      <div className="rounded-2xl border-[1.5px] border-border bg-card p-6 md:p-8">
        <Stepper current={step} />
        <p className="mt-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Bước {step + 1}/{STEPS.length} · {STEPS[step].hint}
        </p>
        <hr className="my-6 border-border" />

        {/* ───── Step 1 — Cơ bản ───── */}
        <div className={cn('grid gap-4 md:grid-cols-2', stepCls(0))}>
          {!isEdit && aiEnabled && (
            <div className="md:col-span-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                className="hidden"
                onChange={handleScanFile}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={scanning}
                className="flex w-full items-center gap-3 rounded-2xl border-[1.5px] border-dashed border-primary/40 bg-primary/5 px-4 py-3 text-left transition hover:bg-primary/10 disabled:opacity-60"
              >
                {scanning ? (
                  <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
                ) : (
                  <ScanLine className="h-5 w-5 shrink-0 text-primary" />
                )}
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-foreground">
                    {scanning ? 'Đang quét hoá đơn…' : 'Quét hoá đơn / phiếu bảo hành'}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Chụp hoặc chọn ảnh để tự điền thông tin — bạn vẫn kiểm tra lại trước khi lưu
                  </span>
                </span>
              </button>

              {scanInfo && (
                <div className="mt-3 flex items-start gap-2 rounded-xl bg-surface-2 px-3 py-2 text-xs">
                  <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                  <div className="space-y-0.5">
                    <p className="font-medium text-foreground">
                      Đã điền nháp từ hoá đơn
                      {scanInfo.confidence !== 'high' && ' (độ tin cậy chưa cao — kiểm tra kỹ)'}
                    </p>
                    {scanInfo.unmatched.length > 0 && (
                      <p className="text-muted-foreground">
                        Cần xem lại:{' '}
                        {scanInfo.unmatched
                          .map((k) => UNMATCHED_LABELS[k] ?? k)
                          .join(', ')}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="name">
              Tên thiết bị <span className="text-destructive">*</span>
            </Label>
            <Input
              id="name"
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
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
              onValueChange={(v) =>
                setCategory(v || catalog.categories[0]?.code || 'OTHER')
              }
              placeholder="Chọn loại"
              searchPlaceholder="Tìm loại..."
              clearable={false}
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
            <Label htmlFor="model">Model</Label>
            <Input
              id="model"
              name="model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="vd: MBP 14 inch 2024"
            />
          </div>

          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="serialNumber">Serial / IMEI</Label>
            <Input
              id="serialNumber"
              name="serialNumber"
              value={serialNumber}
              onChange={(e) => setSerialNumber(e.target.value)}
              placeholder="Không bắt buộc"
            />
          </div>
        </div>

        {/* ───── Step 2 — Mua hàng ───── */}
        <div className={cn('grid gap-4 md:grid-cols-2', stepCls(1))}>
          <div className="space-y-2">
            <Label htmlFor="purchaseDate">
              Ngày mua <span className="text-destructive">*</span>
            </Label>
            <Input
              id="purchaseDate"
              name="purchaseDate"
              type="date"
              value={purchaseDate}
              onChange={(e) => setPurchaseDate(e.target.value)}
              required
            />
            <FieldError errors={errors.purchaseDate} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="purchasePrice">Giá mua (VND)</Label>
            <MoneyInput
              value={purchasePriceDisplay}
              onChange={setPurchasePriceDisplay}
            />
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

        {/* ───── Step 3 — Bảo hành ───── */}
        <div className={cn('space-y-4', stepCls(2))}>
          <p className="text-sm text-muted-foreground">
            Đây là gói bảo hành tiêu chuẩn khi tạo thiết bị. Có thể thêm gói khác
            (AppleCare+, FPT Care...) sau khi tạo.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="warrantyMonths">Số tháng bảo hành</Label>
              <Input
                id="warrantyMonths"
                name="warrantyMonths"
                type="number"
                min={0}
                value={warrantyMonths}
                onChange={(e) => setWarrantyMonths(Number(e.target.value))}
              />
              <FieldError errors={errors.warrantyMonths} />
              <p className="text-xs text-muted-foreground">
                Ngày hết = ngày mua + số tháng. Để 0 nếu không có.
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="warrantyProvider">Đơn vị bảo hành</Label>
                {selectedTemplate ? (
                  <button
                    type="button"
                    onClick={() => applyProviderTemplate(warrantyProvider, true)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
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
              <input
                type="hidden"
                name="warrantyProvider"
                value={warrantyProvider}
              />
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

        {/* ───── Step 4 — Xác nhận ───── */}
        <div className={cn('space-y-5', stepCls(3))}>
          {isEdit && (
            <div className="space-y-2 md:max-w-xs">
              <Label htmlFor="status">Trạng thái</Label>
              <Select
                name="status"
                value={status}
                onValueChange={(v) => setStatus(v as Status)}
              >
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
          )}

          <div className="space-y-2">
            <Label htmlFor="notes">Ghi chú</Label>
            <Textarea
              id="notes"
              name="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ghi chú tự do về thiết bị..."
              rows={4}
            />
          </div>

          {/* Summary card — quick review before saving */}
          <div className="rounded-2xl border-[1.5px] border-border bg-surface-2 p-5">
            <p className="eyebrow mb-3">Kiểm tra lại</p>
            <div className="grid gap-x-6 sm:grid-cols-2">
              <div className="info-row">
                <div className="min-w-0 flex-1">
                  <p className="info-row-label">Tên</p>
                  <p className="info-row-value text-sm">{name || '—'}</p>
                </div>
              </div>
              <div className="info-row">
                <div className="min-w-0 flex-1">
                  <p className="info-row-label">Loại</p>
                  <p className="info-row-value text-sm">{categoryLabel}</p>
                </div>
              </div>
              <div className="info-row">
                <div className="min-w-0 flex-1">
                  <p className="info-row-label">Hãng / Model</p>
                  <p className="info-row-value text-sm">
                    {[brand, model].filter(Boolean).join(' • ') || '—'}
                  </p>
                </div>
              </div>
              <div className="info-row">
                <div className="min-w-0 flex-1">
                  <p className="info-row-label">Ngày mua</p>
                  <p className="info-row-value text-sm">
                    {purchaseDate ? formatDate(purchaseDate) : '—'}
                  </p>
                </div>
              </div>
              <div className="info-row">
                <div className="min-w-0 flex-1">
                  <p className="info-row-label">Giá</p>
                  <p className="info-row-value text-sm tabular-nums">
                    {purchasePriceDisplay
                      ? formatVND(parseVNDInput(purchasePriceDisplay) || 0)
                      : '—'}
                  </p>
                </div>
              </div>
              <div className="info-row">
                <div className="min-w-0 flex-1">
                  <p className="info-row-label">Bảo hành</p>
                  <p className="info-row-value text-sm">
                    {warrantyMonths > 0
                      ? `${warrantyMonths} tháng${warrantyProvider ? ' · ' + warrantyProvider : ''}`
                      : 'Không'}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <hr className="mt-7 border-border" />
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            {step > 0 && (
              <Button
                type="button"
                variant="ghost"
                className="rounded-pill"
                onClick={goPrev}
              >
                <ArrowLeft className="mr-1 h-4 w-4" />
                Quay lại
              </Button>
            )}
            {!isEdit && (
              <Button
                type="button"
                variant="ghost"
                className="rounded-pill"
                onClick={resetAll}
              >
                <RotateCcw className="mr-1 h-4 w-4" />
                Đặt lại
              </Button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs font-medium text-muted-foreground">
              {step + 1}/{STEPS.length}
            </span>
            {step < STEPS.length - 1 ? (
              <Button
                type="button"
                className="rounded-pill"
                onClick={goNext}
              >
                Tiếp tục
                <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            ) : (
              <>
                <Button type="button" variant="outline" asChild className="rounded-pill">
                  <Link href={isEdit ? `/devices/${initial!.id}` : '/devices'}>
                    Huỷ
                  </Link>
                </Button>
                <SubmitButton label={isEdit ? 'Lưu thay đổi' : 'Lưu thiết bị'} />
              </>
            )}
          </div>
        </div>
      </div>

      {/* Always-mounted fields that don't belong to a visible step on the create flow.
          When editing, status lives on step 4; otherwise it gets a default. */}
      {!isEdit && <input type="hidden" name="status" value={status} />}
    </form>
  );
}
