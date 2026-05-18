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
import { WarrantyTimeline } from '@/components/warranty-timeline';
import { WarrantyPill } from '@/components/warranty-pill';
import { WarrantyForm } from '@/components/warranty-form';
import { deleteWarranty } from '@/app/actions/warranties';
import {
  WARRANTY_TYPE_LABELS,
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

// Coral-palette badge backgrounds by warranty type, mirrors design.
const TYPE_BADGE: Record<WarrantyType, string> = {
  STANDARD: 'bg-primary-soft text-primary-ink',
  EXTENDED: 'bg-violet-soft text-violet-ink',
  THIRD_PARTY: 'bg-sky-soft text-sky-ink',
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
    <div className="info-row">
      <Icon className="info-row-icon h-4 w-4" />
      <div className="min-w-0 flex-1">
        <p className="info-row-label">{label}</p>
        <p className="info-row-value text-sm break-words">{value}</p>
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
    <div className="rounded-2xl border-[1.5px] border-border bg-surface-2 p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'inline-flex items-center rounded-pill px-2.5 py-1 text-xs font-bold',
              TYPE_BADGE[type] ?? 'bg-zinc-soft text-ink-2',
            )}
          >
            {WARRANTY_TYPE_LABELS[type] ?? w.type}
          </span>
          {w.provider && (
            <span className="text-sm font-semibold text-ink">{w.provider}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <WarrantyPill warrantyEnd={w.endDate} variant="badge" />
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded-full"
            onClick={onEdit}
            aria-label="Sửa gói"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded-full text-destructive hover:text-destructive"
            disabled={pending}
            aria-label="Xoá gói"
            onClick={() => {
              if (
                !confirm(
                  `Xoá gói bảo hành "${WARRANTY_TYPE_LABELS[type] ?? w.type}"?`,
                )
              )
                return;
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

      <div className="mt-4">
        <WarrantyTimeline purchaseDate={w.startDate} warrantyEndDate={w.endDate} />
        <p className="mt-2 text-xs text-muted-foreground">
          {w.months} tháng • {formatDate(w.startDate)} → {formatDate(w.endDate)}
        </p>
      </div>

      <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
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
          <div
            key={w.id}
            className="rounded-2xl border-[1.5px] border-primary bg-primary-soft p-5"
          >
            <h4 className="mb-3 text-sm font-bold text-primary-ink">
              Sửa gói bảo hành
            </h4>
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
        <div className="rounded-2xl border-[1.5px] border-primary bg-primary-soft p-5">
          <h4 className="mb-3 text-sm font-bold text-primary-ink">
            Thêm gói bảo hành
          </h4>
          <WarrantyForm deviceId={deviceId} onCancel={() => setAdding(false)} />
        </div>
      )}

      {!adding && canAdd && editingId === null && (
        <Button
          variant="outline"
          size="sm"
          className="rounded-pill"
          onClick={() => setAdding(true)}
        >
          <Plus className="mr-1 h-4 w-4" />
          Thêm gói bảo hành
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
