'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { format } from 'date-fns';
import { Loader2, Save } from 'lucide-react';
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
import {
  WARRANTY_TYPES,
  WARRANTY_TYPE_LABELS,
  type WarrantyType,
} from '@/lib/types';
import { formatNumber, parseVNDInput } from '@/lib/format';
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
};

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

function MoneyInput({ defaultValue, name }: { defaultValue?: number | null; name: string }) {
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

export function WarrantyForm({
  deviceId,
  initial,
  onCancel,
}: {
  deviceId: string;
  initial?: Initial;
  onCancel?: () => void;
}) {
  const isEdit = Boolean(initial?.id);
  const action = isEdit
    ? updateWarranty.bind(null, initial!.id!)
    : createWarranty.bind(null, deviceId);

  const [state, formAction] = useActionState<WarrantyFormState, FormData>(action, {});
  const errors = state?.errors ?? {};

  const startDateDefault = initial?.startDate
    ? format(new Date(initial.startDate), 'yyyy-MM-dd')
    : format(new Date(), 'yyyy-MM-dd');

  return (
    <form action={formAction} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="type">
            Loại gói <span className="text-destructive">*</span>
          </Label>
          <Select name="type" defaultValue={initial?.type ?? 'EXTENDED'}>
            <SelectTrigger id="type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {WARRANTY_TYPES.map((t) => (
                <SelectItem key={t} value={t}>
                  {WARRANTY_TYPE_LABELS[t]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError errors={errors.type} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="provider">Đơn vị bảo hành</Label>
          <Input
            id="provider"
            name="provider"
            defaultValue={initial?.provider ?? ''}
            placeholder="vd: AppleCare+, FPT, ..."
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="startDate">
            Ngày bắt đầu <span className="text-destructive">*</span>
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
            Số tháng <span className="text-destructive">*</span>
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
          <Label htmlFor="cost">Giá gói (VND)</Label>
          <MoneyInput defaultValue={initial?.cost} name="cost" />
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">SĐT bảo hành</Label>
          <Input
            id="phone"
            name="phone"
            type="tel"
            defaultValue={initial?.phone ?? ''}
            placeholder="vd: 1800 1234"
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="address">Địa chỉ trung tâm BH</Label>
          <Input
            id="address"
            name="address"
            defaultValue={initial?.address ?? ''}
            placeholder="vd: 123 Nguyễn Trãi, Q.1"
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label htmlFor="notes">Ghi chú</Label>
          <Textarea
            id="notes"
            name="notes"
            defaultValue={initial?.notes ?? ''}
            placeholder="Điều kiện gói, ngày kích hoạt..."
            rows={3}
          />
        </div>
      </div>

      {state?.message && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {state.message}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            Hủy
          </Button>
        )}
        <SubmitButton label={isEdit ? 'Lưu thay đổi' : 'Thêm gói'} />
      </div>
    </form>
  );
}
