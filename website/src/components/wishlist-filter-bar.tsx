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
  WISHLIST_PRIORITIES,
  WISHLIST_PRIORITY_LABELS,
  WISHLIST_STATUSES,
  WISHLIST_STATUS_LABELS,
} from '@/lib/wishlist-types';
import type { CategoryOption } from '@/app/actions/catalog';

type StatusPill = 'ACTIVE' | 'ALL' | (typeof WISHLIST_STATUSES)[number];

const QUICK_STATUSES: { value: StatusPill; label: string }[] = [
  { value: 'ACTIVE', label: 'Đang theo dõi' },
  { value: 'WATCHING', label: 'Watching' },
  { value: 'DECIDED', label: 'Quyết mua' },
  { value: 'PURCHASED', label: 'Đã mua' },
  { value: 'ALL', label: 'Tất cả' },
];

export function WishlistFilterBar({ categories }: { categories: CategoryOption[] }) {
  const router = useRouter();
  const params = useSearchParams();

  const update = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params.toString());
    if (!value) next.delete(key);
    else if (key === 'status' && value === 'ACTIVE') next.delete(key);
    else if (key !== 'status' && value === 'ALL') next.delete(key);
    else next.set(key, value);
    router.replace(`/wishlist?${next.toString()}`);
  };

  const [q, setQ] = React.useState(params.get('q') ?? '');
  React.useEffect(() => {
    const t = setTimeout(() => update('q', q || undefined), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const status = (params.get('status') ?? 'ACTIVE') as StatusPill;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border-[1.5px] border-border bg-card p-3 shadow-soft">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Tìm tên, hãng, ghi chú..."
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="rounded-pill border-border-strong bg-surface pl-9"
          />
        </div>
        <div className="pill-group" role="tablist" aria-label="Trạng thái">
          {QUICK_STATUSES.map((s) => (
            <button
              key={s.value}
              type="button"
              role="tab"
              aria-selected={status === s.value}
              data-active={status === s.value}
              onClick={() => update('status', s.value)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Select
          value={params.get('priority') ?? 'ALL'}
          onValueChange={(v) => update('priority', v)}
        >
          <SelectTrigger className="w-[140px] rounded-pill border-border-strong bg-surface-2">
            <SelectValue placeholder="Mức độ" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tất cả mức</SelectItem>
            {WISHLIST_PRIORITIES.map((p) => (
              <SelectItem key={p} value={p}>
                {WISHLIST_PRIORITY_LABELS[p]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={params.get('category') ?? 'ALL'}
          onValueChange={(v) => update('category', v)}
        >
          <SelectTrigger className="w-[140px] rounded-pill border-border-strong bg-surface-2">
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
          value={status === 'ACTIVE' ? 'ACTIVE' : status}
          onValueChange={(v) => update('status', v)}
        >
          <SelectTrigger className="w-[180px] rounded-pill border-border-strong bg-surface-2">
            <SelectValue placeholder="Trạng thái chi tiết" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ACTIVE">Đang theo dõi + quyết mua</SelectItem>
            <SelectItem value="ALL">Tất cả trạng thái</SelectItem>
            {WISHLIST_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {WISHLIST_STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={`${params.get('sort') ?? 'priority'}-${params.get('dir') ?? 'asc'}`}
          onValueChange={(v) => {
            const [sort, dir] = v.split('-');
            const next = new URLSearchParams(params.toString());
            next.set('sort', sort);
            next.set('dir', dir);
            router.replace(`/wishlist?${next.toString()}`);
          }}
        >
          <SelectTrigger className="w-[200px] rounded-pill border-border-strong bg-surface-2">
            <SelectValue placeholder="Sắp xếp" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="priority-asc">Mức độ thèm cao trước</SelectItem>
            <SelectItem value="target-asc">Target gần nhất trước</SelectItem>
            <SelectItem value="target-desc">Target xa nhất trước</SelectItem>
            <SelectItem value="recent-desc">Mới thêm</SelectItem>
            <SelectItem value="price-desc">Giá cao trước</SelectItem>
            <SelectItem value="price-asc">Giá thấp trước</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
