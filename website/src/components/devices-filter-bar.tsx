'use client';

import * as React from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { STATUSES } from '@/lib/types';
import { statusLabel } from '@/lib/i18n/labels';
import { useLocale, useT } from '@/lib/i18n/client';
import type { CategoryOption } from '@/app/actions/catalog';

export function DevicesFilterBar({ categories }: { categories: CategoryOption[] }) {
  const t = useT();
  const locale = useLocale();
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

  const activeCategory = params.get('category') ?? '';
  const activeStatus = params.get('status') ?? '';
  const isFiltered = Boolean(q || activeCategory || activeStatus);

  // We cap the visible categories in the pill-group; everything still
  // available through the dropdown to the right.
  const pillCategories = categories.slice(0, 5);

  const clearAll = () => {
    setQ('');
    const next = new URLSearchParams(params.toString());
    next.delete('q');
    next.delete('category');
    next.delete('status');
    router.replace(`/devices?${next.toString()}`);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('Tìm theo tên, hãng, model, serial...')}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="rounded-pill pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Select
            value={activeStatus || 'ALL'}
            onValueChange={(v) => update('status', v)}
          >
            <SelectTrigger className="w-[150px] rounded-pill">
              <SelectValue placeholder={t('Trạng thái')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">{t('Tất cả trạng thái')}</SelectItem>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {statusLabel(s, locale)}
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
            <SelectTrigger className="w-[180px] rounded-pill">
              <SelectValue placeholder={t('Sắp xếp')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="purchaseDate-desc">{t('Ngày mua mới nhất')}</SelectItem>
              <SelectItem value="purchaseDate-asc">{t('Ngày mua cũ nhất')}</SelectItem>
              <SelectItem value="warrantyEndDate-asc">{t('BH sắp hết trước')}</SelectItem>
              <SelectItem value="warrantyEndDate-desc">{t('BH lâu hết trước')}</SelectItem>
              <SelectItem value="price-desc">{t('Giá cao nhất')}</SelectItem>
              <SelectItem value="price-asc">{t('Giá thấp nhất')}</SelectItem>
              <SelectItem value="name-asc">{t('Tên A-Z')}</SelectItem>
            </SelectContent>
          </Select>
          {isFiltered && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="rounded-pill"
              onClick={clearAll}
            >
              <X className="mr-1 h-3.5 w-3.5" />
              {t('Xoá lọc')}
            </Button>
          )}
        </div>
      </div>

      {pillCategories.length > 0 && (
        <div className="pill-group flex-wrap">
          <button
            type="button"
            data-active={activeCategory === ''}
            onClick={() => update('category', undefined)}
          >
            {t('Tất cả')}
          </button>
          {pillCategories.map((c) => (
            <button
              key={c.code}
              type="button"
              data-active={activeCategory === c.code}
              onClick={() => update('category', c.code)}
            >
              {/* The DB stores the Vietnamese name (seeded by migration 0004).
                  `t()` maps it to English through the catalog; an admin-added
                  category that the dictionary has never seen comes back
                  unchanged, which is the honest answer. */}
              {t(c.name)}
            </button>
          ))}
          {categories.length > pillCategories.length && (
            <Select
              value={
                activeCategory && !pillCategories.find((c) => c.code === activeCategory)
                  ? activeCategory
                  : ''
              }
              onValueChange={(v) => update('category', v || undefined)}
            >
              <SelectTrigger
                className="!h-8 !w-auto !rounded-pill !border-0 !bg-transparent !px-3.5 !py-0 !text-[13px] !font-semibold !text-muted !shadow-none !ring-0 hover:!text-ink focus-visible:!ring-0 data-[state=open]:!bg-card data-[state=open]:!text-ink data-[state=open]:!shadow-soft [&>svg]:!h-3.5 [&>svg]:!w-3.5"
                aria-label={t('Loại khác')}
              >
                <SelectValue placeholder={t('Loại khác…')} />
              </SelectTrigger>
              <SelectContent>
                {categories.slice(pillCategories.length).map((c) => (
                  <SelectItem key={c.code} value={c.code}>
                    {/* The DB stores the Vietnamese name (seeded by migration 0004).
                  `t()` maps it to English through the catalog; an admin-added
                  category that the dictionary has never seen comes back
                  unchanged, which is the honest answer. */}
              {t(c.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}
    </div>
  );
}
