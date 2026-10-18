'use client';

// The "Sửa chữa & bảo hành" card body on a device detail page.
//
// A claim belongs to a device, so this is the anchor surface: the device's own
// cases, newest/open first, with inline add/edit (the same interaction the
// warranty list uses). The standalone `/claims` page is the cross-device view;
// this one is the place where the facts live.
//
// The nudge at the top is the whole reason the feature exists: a device marked
// BROKEN with no OPEN/IN_REPAIR case is the dead end ("Hỏng" and nothing after
// it). It is shown as one compact callout, only in that exact state, and its
// button opens the create form — not a wall of alerts.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle,
  CalendarClock,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  ShieldCheck,
  Ticket,
  Trash2,
  Wallet,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ClaimForm,
  type ClaimInitial,
  type ClaimWarrantyOption,
} from '@/components/claim-form';
import type { Claim } from '@/lib/api/claims';
import {
  CLAIM_STATUS_TONE,
  claimAnchorId,
  claimCoverageLabel,
  claimIsOpen,
  claimStatusLabel,
  formatClaimCost,
  sortClaimsForDisplay,
} from '@/lib/claims';
import { deleteClaim } from '@/app/actions/claims';
import { formatDate } from '@/lib/format';
import { warrantyTypeLabel } from '@/lib/i18n/labels';
import { useLocale, useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

function ClaimCard({
  claim,
  warranty,
  onEdit,
}: {
  claim: Claim;
  warranty: ClaimWarrantyOption | null;
  onEdit: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const costLabel = formatClaimCost(claim.cost, locale);

  const remove = () => {
    if (!confirm(t('Xoá phiếu "{issue}"?', { issue: claim.issue }))) return;
    startTransition(async () => {
      const res = await deleteClaim(claim.id, claim.deviceId);
      if (res.ok) {
        toast.success(t('Đã xoá phiếu sửa chữa'));
        router.refresh();
      } else {
        toast.error(res.message ?? t('Không xoá được phiếu sửa chữa'));
      }
    });
  };

  return (
    <div
      id={claimAnchorId(claim.id)}
      className="scroll-mt-24 rounded-2xl border-[1.5px] border-border bg-surface-2 p-5"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                'inline-flex items-center rounded-pill px-2.5 py-1 text-xs font-bold',
                CLAIM_STATUS_TONE[claim.status] ?? 'bg-zinc-soft text-ink-2',
              )}
            >
              {claimStatusLabel(claim.status, locale)}
            </span>
            {warranty && (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5" />
                {warranty.provider ?? warrantyTypeLabel(warranty.type, locale)}
              </span>
            )}
          </div>
          <p className="mt-2 text-sm font-semibold text-ink">{claim.issue}</p>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded-full"
            onClick={onEdit}
            aria-label={t('Sửa phiếu sửa chữa')}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-8 w-8 rounded-full text-destructive hover:text-destructive"
            disabled={pending}
            onClick={remove}
            aria-label={t('Xoá phiếu sửa chữa')}
          >
            {pending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="h-3.5 w-3.5" />
          {t('Mở ngày {date}', { date: formatDate(claim.openedAt, locale) })}
        </span>
        {claim.expectedReturnAt && (
          <span className="inline-flex items-center gap-1 font-medium text-amber-ink">
            <CalendarClock className="h-3.5 w-3.5" />
            {t('Dự kiến trả {date}', {
              date: formatDate(claim.expectedReturnAt, locale),
            })}
          </span>
        )}
        {claim.closedAt && (
          <span className="inline-flex items-center gap-1">
            <CalendarClock className="h-3.5 w-3.5" />
            {t('Đã đóng {date}', { date: formatDate(claim.closedAt, locale) })}
          </span>
        )}
        {claim.ticketNumber && (
          <span className="inline-flex items-center gap-1 font-mono font-semibold text-ink-2">
            <Ticket className="h-3.5 w-3.5" />
            {claim.ticketNumber}
          </span>
        )}
        {claim.serviceCenter && (
          <span className="inline-flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" />
            {claim.serviceCenter}
          </span>
        )}
        {costLabel && (
          <span className="inline-flex items-center gap-1">
            <Wallet className="h-3.5 w-3.5" />
            {costLabel}
          </span>
        )}
        <span
          className={cn(
            'inline-flex items-center gap-1 rounded-pill px-2 py-0.5 font-semibold',
            claim.coveredByWarranty === true
              ? 'bg-emerald-soft text-emerald-ink'
              : claim.coveredByWarranty === false
                ? 'bg-rose-soft text-rose-ink'
                : 'bg-surface-3 text-ink-2',
          )}
        >
          {claimCoverageLabel(claim.coveredByWarranty, locale)}
        </span>
      </div>

      {(claim.diagnosis || claim.outcome) && (
        <div className="mt-3 grid gap-2 border-t border-dashed border-border pt-3 text-sm sm:grid-cols-2">
          {claim.diagnosis && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {t('Chẩn đoán')}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-ink-2">{claim.diagnosis}</p>
            </div>
          )}
          {claim.outcome && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                {t('Kết quả')}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap text-ink-2">{claim.outcome}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function ClaimList({
  deviceId,
  deviceName,
  deviceStatus,
  claims,
  warranties,
}: {
  deviceId: string;
  deviceName: string;
  deviceStatus: string;
  claims: Claim[];
  warranties: ClaimWarrantyOption[];
}) {
  const t = useT();
  const [adding, setAdding] = React.useState(false);
  const [editingId, setEditingId] = React.useState<string | null>(null);

  // Open claims first, so the case the user is waiting on is never buried under
  // years of resolved history.
  const ordered = sortClaimsForDisplay(claims);
  const openCount = ordered.filter(claimIsOpen).length;
  // The dead end this feature removes: BROKEN + no open case. It is true for a
  // device with only closed history too — an old repair does not describe the
  // current fault.
  const needsNudge = deviceStatus === 'BROKEN' && openCount === 0;

  const warrantiesById = new Map(warranties.map((warranty) => [warranty.id, warranty]));

  const editing = editingId
    ? ordered.find((claim) => claim.id === editingId) ?? null
    : null;

  return (
    <div className="space-y-3">
      {needsNudge && !adding && (
        <div className="rounded-xl border border-amber-ink/25 bg-amber-soft px-4 py-3 text-sm text-amber-ink">
          <div className="flex flex-wrap items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {t('Thiết bị này đang Hỏng nhưng chưa có phiếu sửa chữa.')}
              </p>
              <p className="mt-0.5 text-xs">
                {t('Tạo phiếu để ghi lại nơi sửa, số phiếu và chi phí.')}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 rounded-pill bg-card"
              onClick={() => setAdding(true)}
            >
              <Wrench className="mr-1 h-3.5 w-3.5" />
              {t('Tạo phiếu sửa chữa')}
            </Button>
          </div>
        </div>
      )}

      {ordered.length === 0 && !adding && !needsNudge && (
        <p className="text-sm text-muted-foreground">
          {t('Chưa có phiếu sửa chữa nào.')}{' '}
          {t('Thêm một phiếu khi bạn mang máy đi sửa hoặc đi bảo hành.')}
        </p>
      )}

      {ordered.map((claim) =>
        claim.id === editingId ? (
          <div
            key={claim.id}
            className="rounded-2xl border-[1.5px] border-primary bg-primary-soft p-5"
          >
            <h4 className="mb-3 text-sm font-bold text-primary-ink">
              {t('Sửa phiếu sửa chữa')}
            </h4>
            <ClaimForm
              deviceId={deviceId}
              deviceName={deviceName}
              warranties={warranties}
              initial={claim as ClaimInitial}
              onCancel={() => setEditingId(null)}
            />
          </div>
        ) : (
          <ClaimCard
            key={claim.id}
            claim={claim}
            warranty={
              claim.warrantyId
                ? warrantiesById.get(claim.warrantyId) ?? null
                : null
            }
            onEdit={() => {
              setAdding(false);
              setEditingId(claim.id);
            }}
          />
        ),
      )}

      {adding && (
        <div className="rounded-2xl border-[1.5px] border-primary bg-primary-soft p-5">
          <h4 className="mb-3 text-sm font-bold text-primary-ink">
            {t('Thêm phiếu sửa chữa')}
          </h4>
          <ClaimForm
            deviceId={deviceId}
            deviceName={deviceName}
            warranties={warranties}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {!adding && editing === null && (
        <Button
          variant="outline"
          size="sm"
          className="rounded-pill"
          onClick={() => setAdding(true)}
        >
          <Plus className="mr-1 h-4 w-4" />
          {t('Thêm phiếu sửa chữa')}
        </Button>
      )}
    </div>
  );
}
