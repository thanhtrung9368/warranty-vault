'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  BILLING_CYCLES,
  BILLING_CYCLE_LABELS,
  SUBSCRIPTION_STATUSES,
  SUBSCRIPTION_STATUS_LABELS,
} from '@/lib/subscription-types';
import type { CategoryOption } from '@/app/actions/catalog';

export function SubscriptionFilterBar({ categories }: { categories: CategoryOption[] }) {
  const router = useRouter();
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

  const status = params.get('status') ?? 'ACTIVE_PAUSED';

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Tìm tên, hãng, plan..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-9"
        />
      </div>
      <div className="flex flex-wrap gap-2">
        <Select value={status} onValueChange={(v) => update('status', v)}>
          <SelectTrigger className="w-[170px]">
            <SelectValue placeholder="Trạng thái" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ACTIVE_PAUSED">Đang dùng + tạm dừng</SelectItem>
            <SelectItem value="ALL">Tất cả trạng thái</SelectItem>
            {SUBSCRIPTION_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {SUBSCRIPTION_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={params.get('billingCycle') ?? 'ALL'}
          onValueChange={(v) => update('billingCycle', v)}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Chu kỳ" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tất cả chu kỳ</SelectItem>
            {BILLING_CYCLES.map((c) => (
              <SelectItem key={c} value={c}>
                {BILLING_CYCLE_LABELS[c]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={params.get('category') ?? 'ALL'}
          onValueChange={(v) => update('category', v)}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue placeholder="Loại" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tất cả loại</SelectItem>
            {categories.map((c) => (
              <SelectItem key={c.code} value={c.code}>
                {c.name}
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
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Sắp xếp" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="renewal-asc">Sắp gia hạn trước</SelectItem>
            <SelectItem value="renewal-desc">Lâu gia hạn nhất</SelectItem>
            <SelectItem value="monthly-desc">Tốn nhiều/tháng nhất</SelectItem>
            <SelectItem value="monthly-asc">Ít nhất/tháng</SelectItem>
            <SelectItem value="price-desc">Giá/cycle cao</SelectItem>
            <SelectItem value="recent-desc">Mới thêm</SelectItem>
            <SelectItem value="name-asc">Tên A-Z</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
