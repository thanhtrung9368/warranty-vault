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
import { STATUSES, STATUS_LABELS } from '@/lib/types';
import type { CategoryOption } from '@/app/actions/catalog';

export function DevicesFilterBar({ categories }: { categories: CategoryOption[] }) {
  const router = useRouter();
  const params = useSearchParams();

  const update = (key: string, value: string | undefined) => {
    const next = new URLSearchParams(params.toString());
    if (!value || value === 'ALL') next.delete(key);
    else next.set(key, value);
    router.replace(`/devices?${next.toString()}`);
  };

  const [q, setQ] = React.useState(params.get('q') ?? '');
  React.useEffect(() => {
    const t = setTimeout(() => update('q', q || undefined), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Tìm theo tên, hãng, model, serial..."
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="pl-9"
        />
      </div>
      <div className="flex gap-2">
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
          value={params.get('status') ?? 'ALL'}
          onValueChange={(v) => update('status', v)}
        >
          <SelectTrigger className="w-[150px]">
            <SelectValue placeholder="Trạng thái" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Tất cả trạng thái</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={`${params.get('sort') ?? 'purchaseDate'}-${params.get('dir') ?? 'desc'}`}
          onValueChange={(v) => {
            const [sort, dir] = v.split('-');
            const next = new URLSearchParams(params.toString());
            next.set('sort', sort);
            next.set('dir', dir);
            router.replace(`/devices?${next.toString()}`);
          }}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Sắp xếp" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="purchaseDate-desc">Ngày mua mới nhất</SelectItem>
            <SelectItem value="purchaseDate-asc">Ngày mua cũ nhất</SelectItem>
            <SelectItem value="warrantyEndDate-asc">BH sắp hết trước</SelectItem>
            <SelectItem value="warrantyEndDate-desc">BH lâu hết trước</SelectItem>
            <SelectItem value="price-desc">Giá cao nhất</SelectItem>
            <SelectItem value="price-asc">Giá thấp nhất</SelectItem>
            <SelectItem value="name-asc">Tên A-Z</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
