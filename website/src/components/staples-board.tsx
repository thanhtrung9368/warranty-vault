'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Loader2,
  MoreHorizontal,
  Package,
  Pencil,
  Plus,
  RefreshCcw,
  Trash2,
  XCircle,
} from 'lucide-react';
import { addDays } from 'date-fns';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useLocale, useT } from '@/lib/i18n/client';
import { dayToInputValue, daysUntil, formatDay, parseDay } from '@/lib/api-day';
import type { Staple, StapleState } from '@/lib/api/staples';
import {
  deleteStaple,
  restockStaple,
  setStapleState,
} from '@/app/actions/staples';
import { StapleFormDialog } from '@/components/staple-form-dialog';

const STATE_META: Record<
  StapleState,
  { variant: 'emerald' | 'amber' | 'rose'; label: string }
> = {
  ENOUGH: { variant: 'emerald', label: 'Đủ dùng' },
  LOW: { variant: 'amber', label: 'Sắp hết' },
  OUT: { variant: 'rose', label: 'Đã hết' },
};

export function StaplesBoard({ items }: { items: Staple[] }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const [editing, setEditing] = React.useState<Staple | null | undefined>(undefined);
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  const toBuy = items.filter((item) => item.state !== 'ENOUGH');
  const enough = items.filter((item) => item.state === 'ENOUGH');
  const existingCategories = Array.from(
    new Set(
      items
        .map((item) => item.category?.trim())
        .filter((category): category is string => Boolean(category)),
    ),
  );

  async function runQuick(
    item: Staple,
    action: () => Promise<{ ok?: boolean; message?: string }>,
  ) {
    setPendingId(item.id);
    try {
      const res = await action();
      if (res.ok) {
        toast.success(t('Đã lưu'));
        router.refresh();
      } else {
        toast.error(res.message ?? t('Không lưu được'));
      }
    } finally {
      setPendingId(null);
    }
  }

  async function mark(item: Staple, state: StapleState) {
    await runQuick(item, () => setStapleState(item.id, state));
  }

  async function restock(item: Staple) {
    await runQuick(item, () =>
      restockStaple(item.id, dayToInputValue(new Date())),
    );
  }

  async function remove(item: Staple) {
    if (!window.confirm(`${t('Xoá đồ dùng?')}\n${item.name}`)) return;
    await runQuick(item, () => deleteStaple(item.id));
  }

  function schedule(item: Staple): string {
    if (item.cadenceDays != null && item.lastBoughtAt) {
      const due = addDays(parseDay(item.lastBoughtAt), item.cadenceDays);
      const days = daysUntil(dayToInputValue(due));
      if (days < 0) return t('Đến lúc kiểm tra');
      if (days === 0) return t('Hôm nay');
      return t('Còn {days} ngày', { days });
    }
    if (item.lastBoughtAt) {
      return t('Mua gần nhất: {date}', {
        date: formatDay(item.lastBoughtAt, locale),
      });
    }
    return t('Không nhắc');
  }

  function meta(item: Staple): string {
    return (
      [item.category, item.unit].filter(Boolean).join(' · ') || t('Đồ dùng')
    );
  }

  function card(item: Staple) {
    const state = STATE_META[item.state];
    const busy = pendingId === item.id;
    return (
      <Card key={item.id} className="flex flex-col gap-3 p-card">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-soft text-emerald-ink">
              <Package className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h3 className="truncate font-display text-base font-bold text-ink">
                {item.name}
              </h3>
              <p className="mt-0.5 truncate text-sm text-muted-foreground">
                {meta(item)}
              </p>
            </div>
          </div>
          <Badge variant={state.variant}>{t(state.label)}</Badge>
        </div>

        <div className="mt-auto flex items-center justify-between gap-2 border-t border-dashed border-border pt-3">
          <span className="truncate text-xs text-muted-foreground">
            {schedule(item)}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 rounded-pill"
                disabled={busy}
                aria-label={t('Sửa')}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <MoreHorizontal className="h-4 w-4" />
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onSelect={() => void mark(item, 'LOW')}
                disabled={item.state === 'LOW'}
              >
                <AlertTriangle className="mr-2 h-4 w-4" />
                {t('Sắp hết')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => void mark(item, 'OUT')}
                disabled={item.state === 'OUT'}
              >
                <XCircle className="mr-2 h-4 w-4" />
                {t('Đã hết')}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => void restock(item)}>
                <RefreshCcw className="mr-2 h-4 w-4" />
                {t('Đã mua lại')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setEditing(item)}>
                <Pencil className="mr-2 h-4 w-4" />
                {t('Sửa')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => void remove(item)}
                className="text-destructive focus:text-destructive"
              >
                <Trash2 className="mr-2 h-4 w-4" />
                {t('Xoá')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button
          size="lg"
          className="rounded-pill"
          onClick={() => setEditing(null)}
        >
          <Plus className="mr-1 h-4 w-4" />
          {t('Thêm đồ dùng')}
        </Button>
      </div>

      {items.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-soft text-emerald-ink">
            <Package className="h-8 w-8" />
          </span>
          <h2 className="display text-2xl text-ink">{t('Chưa có đồ dùng nào')}</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            {t('Thêm món đầu tiên để nhắc mua lại khi sắp hết.')}
          </p>
          <Button className="rounded-pill" onClick={() => setEditing(null)}>
            <Plus className="mr-1 h-4 w-4" />
            {t('Thêm đồ dùng')}
          </Button>
        </Card>
      ) : (
        <div className="space-y-8">
          {toBuy.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="display text-xl text-ink">{t('Cần mua')}</h2>
                <Badge variant="amber">{toBuy.length}</Badge>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">{toBuy.map(card)}</div>
            </section>
          )}
          {enough.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center gap-2">
                <h2 className="display text-xl text-ink">{t('Đủ dùng')}</h2>
                <Badge variant="emerald">{enough.length}</Badge>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">{enough.map(card)}</div>
            </section>
          )}
        </div>
      )}

      {editing !== undefined && (
        <StapleFormDialog
          key={editing?.id ?? 'new'}
          open
          initial={editing ?? undefined}
          existingCategories={existingCategories}
          onOpenChange={(open) => {
            if (!open) setEditing(undefined);
          }}
          onSaved={() => {
            setEditing(undefined);
            toast.success(t('Đã lưu'));
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
