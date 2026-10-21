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
import { type WarrantyType } from '@/lib/types';
import { formatDate } from '@/lib/format';
import { formatMoney } from '@/lib/currency';
import { warrantyTypeLabel } from '@/lib/i18n/labels';
import { useLocale, useT } from '@/lib/i18n/client';
import {
  claimsUsedLabel,
  hasWarrantyTerms,
  warrantyAmountLabel,
  warrantyComponentLabel,
  warrantyTransferableLabel,
} from '@/lib/warranty-terms';
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
  // Contract terms — all optional/nullable; `null` means "not recorded".
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

function TermLine({
  label,
  value,
  wide,
}: {
  label?: string;
  value: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <p className={cn('min-w-0 break-words', wide && 'sm:col-span-2')}>
      {label && <span className="text-muted-foreground">{label}: </span>}
      <span className="text-ink">{value}</span>
    </p>
  );
}

function WarrantyCard({
  w,
  currency,
  onEdit,
}: {
  w: WarrantyItem;
  currency: string;
  onEdit: () => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const t = useT();
  const locale = useLocale();
  const type = w.type as WarrantyType;
  const mapsHref = w.address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(w.address)}`
    : undefined;
  // Contract terms (`lib/warranty-terms.ts`). A row with none renders exactly
  // the card it rendered before this feature: the block below is the only
  // addition and it is gated on `hasWarrantyTerms`.
  const component = warrantyComponentLabel(w.component);
  const capLabel = warrantyAmountLabel(w.cap, locale);
  const deductibleLabel = warrantyAmountLabel(w.deductible, locale);
  const claims = claimsUsedLabel(w, locale);
  const transferable = warrantyTransferableLabel(w.transferable, locale);

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
            {warrantyTypeLabel(type, locale)}
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
            aria-label={t('Sửa gói')}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded-full text-destructive hover:text-destructive"
            disabled={pending}
            aria-label={t('Xoá gói')}
            onClick={() => {
              if (
                !confirm(
                  t('Xoá gói bảo hành "{name}"?', {
                    name: warrantyTypeLabel(type, locale),
                  }),
                )
              )
                return;
              startTransition(async () => {
                const res = await deleteWarranty(w.id);
                if (res?.ok) toast.success(t('Đã xoá gói bảo hành'));
                else toast.error(t('Không xoá được'));
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
          {t('{months} tháng', { months: w.months, count: w.months })} •{' '}
          {formatDate(w.startDate, locale)} → {formatDate(w.endDate, locale)}
        </p>
      </div>

      <div className="mt-3 grid gap-x-6 sm:grid-cols-2">
        {w.cost != null && (
          <InfoLine
            icon={Wallet}
            label={t('Giá gói')}
            value={formatMoney(w.cost, currency, locale)}
          />
        )}
        <InfoLine
          icon={PhoneIcon}
          label={t('SĐT')}
          value={w.phone}
          href={w.phone ? `tel:${w.phone}` : undefined}
        />
        <InfoLine icon={MapPin} label={t('Địa chỉ')} value={w.address} href={mapsHref} />
        {w.notes && (
          <div className="sm:col-span-2">
            <InfoLine icon={StickyNote} label={t('Ghi chú')} value={w.notes} />
          </div>
        )}
      </div>

      {hasWarrantyTerms(w) && (
        <div className="mt-4 rounded-xl border border-border bg-surface-2 px-4 py-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
            {t('Điều khoản hợp đồng')}
          </p>
          <div className="mt-2 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <TermLine
              label={t('Bộ phận')}
              value={
                component.kind === 'whole' ? t('Toàn bộ thiết bị') : component.label
              }
            />
            {w.scope && <TermLine label={t('Phạm vi bảo hành')} value={w.scope} />}
            {capLabel && <TermLine label={t('Mức chi trả tối đa')} value={capLabel} />}
            {deductibleLabel && (
              <TermLine label={t('Khấu trừ mỗi lần')} value={deductibleLabel} />
            )}
            {claims && <TermLine value={claims} />}
            {w.region && <TermLine label={t('Khu vực áp dụng')} value={w.region} />}
            {transferable && (
              <TermLine label={t('Chuyển nhượng được')} value={transferable} />
            )}
            {w.exclusions && (
              <TermLine wide label={t('Loại trừ')} value={w.exclusions} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function WarrantyList({
  deviceId,
  warranties,
  currency = 'VND',
  maxPerDevice = 5,
}: {
  deviceId: string;
  warranties: WarrantyItem[];
  /** ISO-4217 code of the device: every `Warranty.cost` is in this currency. */
  currency?: string;
  maxPerDevice?: number;
}) {
  const [adding, setAdding] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const t = useT();
  const canAdd = warranties.length < maxPerDevice;

  return (
    <div className="space-y-3">
      {warranties.length === 0 && !adding && (
        <p className="text-sm text-muted-foreground">
          {t('Chưa có gói bảo hành nào. Bấm “Thêm gói” để tạo.')}
        </p>
      )}

      {warranties.map((w) =>
        editingId === w.id ? (
          <div
            key={w.id}
            className="rounded-2xl border-[1.5px] border-primary bg-primary-soft p-5"
          >
            <h4 className="mb-3 text-sm font-bold text-primary-ink">
              {t('Sửa gói bảo hành')}
            </h4>
            <WarrantyForm
              deviceId={deviceId}
              currency={currency}
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
                component: w.component,
                scope: w.scope,
                cap: w.cap,
                deductible: w.deductible,
                exclusions: w.exclusions,
                region: w.region,
                transferable: w.transferable,
                claimsAllowed: w.claimsAllowed,
                claimsUsed: w.claimsUsed,
              }}
              onCancel={() => setEditingId(null)}
            />
          </div>
        ) : (
          <WarrantyCard
            key={w.id}
            w={w}
            currency={currency}
            onEdit={() => setEditingId(w.id)}
          />
        ),
      )}

      {adding && (
        <div className="rounded-2xl border-[1.5px] border-primary bg-primary-soft p-5">
          <h4 className="mb-3 text-sm font-bold text-primary-ink">
            {t('Thêm gói bảo hành')}
          </h4>
          <WarrantyForm deviceId={deviceId} currency={currency} onCancel={() => setAdding(false)} />
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
          {t('Thêm gói bảo hành')}
        </Button>
      )}
      {!canAdd && (
        <p className="text-xs text-muted-foreground">
          {t('Đã đạt giới hạn {max} gói cho thiết bị này.', { max: maxPerDevice })}
        </p>
      )}
    </div>
  );
}
