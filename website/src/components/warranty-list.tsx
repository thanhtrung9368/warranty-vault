'use client';

import * as React from 'react';
import { toast } from 'sonner';
import {
  Plus,
  Pencil,
  Trash2,
  Phone as PhoneIcon,
  MapPin,
  StickyNote,
  Wallet,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { WarrantyTimeline } from '@/components/warranty-timeline';
import { WarrantyPill } from '@/components/warranty-pill';
import { WarrantyForm } from '@/components/warranty-form';
import { deleteWarranty } from '@/app/actions/warranties';
import {
  WARRANTY_TYPE_LABELS,
  WARRANTY_TYPE_COLORS,
  type WarrantyType,
} from '@/lib/types';
import { formatDate, formatVND } from '@/lib/format';
import { cn } from '@/lib/utils';

type WarrantyItem = {
  id: string;
  type: string;
  provider: string | null;
  startDate: Date | string;
  endDate: Date | string;
  months: number;
  cost: number | null;
  address: string | null;
  phone: string | null;
  notes: string | null;
};

function InfoLine({
  icon: Icon,
  label,
  value,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: React.ReactNode;
  href?: string;
}) {
  if (!value) return null;
  const inner = (
    <div className="flex items-start gap-2">
      <Icon className="mt-0.5 h-3.5 w-3.5 text-muted-foreground" />
      <div className="min-w-0">
        <span className="text-xs text-muted-foreground">{label}: </span>
        <span className="text-sm break-words">{value}</span>
      </div>
    </div>
  );
  return href ? (
    <a href={href} className="block hover:underline">
      {inner}
    </a>
  ) : (
    inner
  );
}

function WarrantyCard({
  w,
  onEdit,
}: {
  w: WarrantyItem;
  onEdit: () => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const type = w.type as WarrantyType;
  const mapsHref = w.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(w.address)}`
    : undefined;

  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge
            variant="outline"
            className={cn('border-transparent', WARRANTY_TYPE_COLORS[type] ?? '')}
          >
            {WARRANTY_TYPE_LABELS[type] ?? w.type}
          </Badge>
          {w.provider && <span className="font-medium">{w.provider}</span>}
        </div>
        <div className="flex items-center gap-1.5">
          <WarrantyPill warrantyEnd={w.endDate} variant="badge" />
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-destructive hover:text-destructive"
            disabled={pending}
            onClick={() => {
              if (!confirm(`Xoá gói bảo hành "${WARRANTY_TYPE_LABELS[type] ?? w.type}"?`)) return;
              startTransition(async () => {
                const res = await deleteWarranty(w.id);
                if (res?.ok) toast.success('Đã xoá gói bảo hành');
                else toast.error('Không xoá được');
              });
            }}
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      <div className="mt-3">
        <WarrantyTimeline purchaseDate={w.startDate} warrantyEndDate={w.endDate} />
        <p className="mt-2 text-xs text-muted-foreground">
          {w.months} tháng • {formatDate(w.startDate)} → {formatDate(w.endDate)}
        </p>
      </div>

      <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {w.cost != null && (
          <InfoLine icon={Wallet} label="Giá gói" value={formatVND(w.cost)} />
        )}
        <InfoLine
          icon={PhoneIcon}
          label="SĐT"
          value={w.phone}
          href={w.phone ? `tel:${w.phone}` : undefined}
        />
        <InfoLine icon={MapPin} label="Địa chỉ" value={w.address} href={mapsHref} />
        {w.notes && (
          <div className="sm:col-span-2">
            <InfoLine icon={StickyNote} label="Ghi chú" value={w.notes} />
          </div>
        )}
      </div>
    </div>
  );
}

export function WarrantyList({
  deviceId,
  warranties,
  maxPerDevice = 5,
}: {
  deviceId: string;
  warranties: WarrantyItem[];
  maxPerDevice?: number;
}) {
  const [adding, setAdding] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const editing = warranties.find((w) => w.id === editingId);
  const canAdd = warranties.length < maxPerDevice;

  return (
    <div className="space-y-3">
      {warranties.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">
          Chưa có gói bảo hành nào. Bấm “Thêm gói” để tạo.
        </p>
      )}

      {warranties.map((w) =>
        editingId === w.id ? (
          <div key={w.id} className="rounded-lg border bg-card p-4">
            <h4 className="mb-3 text-sm font-semibold">Sửa gói bảo hành</h4>
            <WarrantyForm
              deviceId={deviceId}
              initial={{
                id: w.id,
                type: w.type as WarrantyType,
                provider: w.provider,
                startDate: w.startDate,
                months: w.months,
                cost: w.cost,
                address: w.address,
                phone: w.phone,
                notes: w.notes,
              }}
              onCancel={() => setEditingId(null)}
            />
          </div>
        ) : (
          <WarrantyCard
            key={w.id}
            w={w}
            onEdit={() => setEditingId(w.id)}
          />
        ),
      )}

      {adding && (
        <div className="rounded-lg border bg-card p-4">
          <h4 className="mb-3 text-sm font-semibold">Thêm gói bảo hành</h4>
          <WarrantyForm deviceId={deviceId} onCancel={() => setAdding(false)} />
        </div>
      )}

      {!adding && canAdd && editingId === null && (
        <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Thêm gói
        </Button>
      )}
      {!canAdd && (
        <p className="text-xs text-muted-foreground">
          Đã đạt giới hạn {maxPerDevice} gói cho thiết bị này.
        </p>
      )}
    </div>
  );
}
