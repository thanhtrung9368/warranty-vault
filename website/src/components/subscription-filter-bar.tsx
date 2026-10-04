'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { useLocale, useT } from '@/lib/i18n/client';
import { billingCycleLabel, subscriptionStatusLabel } from '@/lib/i18n/labels';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  BILLING_CYCLES,
  SUBSCRIPTION_STATUSES,
} from '@/lib/subscription-types';
import type { CategoryOption } from '@/app/actions/catalog';

type StatusPill = 'ACTIVE_PAUSED' | 'ALL' | (typeof SUBSCRIPTION_STATUSES)[number];

// Pill-group quick filters for the most common statuses — full select stays
// below for less common picks (EXPIRED) to keep the bar compact.
// The labels are the Vietnamese source text (`t` translates them at render).
const QUICK_STATUSES: { value: StatusPill; label: string }[] = [
  { value: 'ACTIVE_PAUSED', label: 'Đang dùng' },
  { value: 'ACTIVE', label: 'Hoạt động' },
  { value: 'PAUSED', label: 'Tạm dừng' },
  { value: 'CANCELED', label: 'Đã huỷ' },
  { value: 'ALL', label: 'Tất cả' },
];

export function SubscriptionFilterBar({ categories }: { categories: CategoryOption[] }) {
  const router = useRouter();
  const t = useT();
  const locale = useLocale();
  const params = useSearchParams();

  const update = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params.toString());
    if (!value) next.delete(key);
    else if (key === 'status' && value === 'ACTIVE_PAUSED') next.delete(key);
    else if (key !== 'status' && value === 'ALL') next.delete(key);
    else next.set(key, value);
    router.replace(`/subscriptions?${next.toString()}`);
  };

  const [q, setQ] = React.useState(params.get('q') ?? '');
  React.useEffect(() => {
    const t = setTimeout(() => update('q', q || undefined), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const status = (params.get('status') ?? 'ACTIVE_PAUSED') as StatusPill;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border-[1.5px] border-border bg-card p-3 shadow-soft">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('Tìm tên, hãng, plan...')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="rounded-pill border-border-strong bg-surface pl-9"
          />
        </div>
        <div className="pill-group" role="tablist" aria-label={t('Trạng thái')}>
          {QUICK_STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="tab"
              aria-selected={status === s.value}
              data-active={status === s.value}
              onClick={() => update('status', s.value)}
            >
              {t(s.label)}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select
          value={params.get('billingCycle') ?? 'ALL'}
          onValueChange={(v) => update('billingCycle', v)}
        >
          <SelectTrigger className="w-[150px] rounded-pill border-border-strong bg-surface-2">
            <SelectValue placeholder={t('Chu kỳ')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('Tất cả chu kỳ')}</SelectItem>
            {BILLING_CYCLES.map((c) => (
              <SelectItem key={c} value={c}>
                {billingCycleLabel(c, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={params.get('category') ?? 'ALL'}
          onValueChange={(v) => update('category', v)}
        >
          <SelectTrigger className="w-[140px] rounded-pill border-border-strong bg-surface-2">
            <SelectValue placeholder={t('Loại')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">{t('Tất cả loại')}</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={status === 'ACTIVE_PAUSED' ? 'ACTIVE_PAUSED' : status}
          onValueChange={(v) => update('status', v)}
        >
          <SelectTrigger className="w-[180px] rounded-pill border-border-strong bg-surface-2">
            <SelectValue placeholder={t('Trạng thái chi tiết')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ACTIVE_PAUSED">{t('Đang dùng + tạm dừng')}</SelectItem>
            <SelectItem value="ALL">{t('Tất cả trạng thái')}</SelectItem>
            {SUBSCRIPTION_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {subscriptionStatusLabel(s, locale)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={`${params.get('sort') ?? 'renewal'}-${params.get('dir') ?? 'asc'}`}
          onValueChange={(v) => {
            const [sort, dir] = v.split('-');
            const next = new URLSearchParams(params.toString());
            next.set('sort', sort);
            next.set('dir', dir);
            router.replace(`/subscriptions?${next.toString()}`);
          }}
        >
          <SelectTrigger className="w-[190px] rounded-pill border-border-strong bg-surface-2">
            <SelectValue placeholder={t('Sắp xếp')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="renewal-asc">{t('Sắp gia hạn trước')}</SelectItem>
            <SelectItem value="renewal-desc">{t('Lâu gia hạn nhất')}</SelectItem>
            <SelectItem value="monthly-desc">{t('Tốn nhiều/tháng nhất')}</SelectItem>
            <SelectItem value="monthly-asc">{t('Ít nhất/tháng')}</SelectItem>
            <SelectItem value="price-desc">{t('Giá/cycle cao')}</SelectItem>
            <SelectItem value="recent-desc">{t('Mới thêm')}</SelectItem>
            <SelectItem value="name-asc">{t('Tên A-Z')}</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
