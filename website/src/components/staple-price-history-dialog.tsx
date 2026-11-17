'use client';

// "Lịch sử giá" — every recorded purchase for one staple, newest first.
//
// Read-only and fetched on open (a page render has no reason to carry a
// staple's whole purchase log). The three summary numbers come from the
// staple's server-computed fields, not from re-deriving them here; the list is
// the detail behind those numbers.

import * as React from 'react';
import { Loader2, RefreshCcw } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { formatVND } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatDay } from '@/lib/api-day';
import type { Staple, StaplePurchase } from '@/lib/api/staples';
import { getStaplePurchases } from '@/app/actions/staples';

type HistoryState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: StaplePurchase[] };

export function StaplePriceHistoryDialog({
  open,
  onOpenChange,
  staple,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staple: Staple;
}) {
  const t = useT();
  const locale = useLocale();
  const [state, setState] = React.useState<HistoryState>({ status: 'loading' });
  const [attempt, setAttempt] = React.useState(0);

  React.useEffect(() => {
    let cancelled = false;
    void getStaplePurchases(staple.id).then((res) => {
      if (cancelled) return;
      setState(
        res.ok
          ? { status: 'ready', items: res.data.items }
          : { status: 'error', message: res.message ?? res.error },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [staple.id, attempt]);

  const summary = (value: number | null) =>
    value == null ? '—' : formatVND(value, locale);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {t('Lịch sử giá')}
            <span className="inline-flex items-center rounded-pill bg-surface-2 px-2.5 py-0.5 text-xs font-semibold text-ink-2">
              {t('{count} lần mua', { count: staple.purchaseCount })}
            </span>
          </DialogTitle>
          <DialogDescription>{staple.name}</DialogDescription>
        </DialogHeader>

        {staple.purchaseCount > 0 && (
          <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-surface-2/50 p-3">
            {[
              { label: t('Giá gần nhất'), value: staple.lastPrice },
              { label: t('Giá thấp nhất'), value: staple.lowestPrice },
              { label: t('Giá trung bình'), value: staple.averagePrice },
            ].map((cell) => (
              <div key={cell.label} className="min-w-0 space-y-0.5">
                <p className="truncate text-xs text-muted-foreground">
                  {cell.label}
                </p>
                <p className="truncate font-display text-sm font-bold tabular-nums text-ink">
                  {summary(cell.value)}
                </p>
              </div>
            ))}
          </div>
        )}

        {state.status === 'loading' ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('Đang tải…')}
          </div>
        ) : state.status === 'error' ? (
          <div className="flex flex-col items-start gap-3 py-4">
            <p className="text-sm text-destructive" role="alert">
              {t('Không tải được lịch sử giá')}
            </p>
            <p className="text-sm text-muted-foreground">{state.message}</p>
            <Button
              variant="outline"
              className="rounded-pill"
              onClick={() => {
                setState({ status: 'loading' });
                setAttempt((n) => n + 1);
              }}
            >
              <RefreshCcw className="mr-2 h-4 w-4" />
              {t('Thử lại')}
            </Button>
          </div>
        ) : state.items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t('Chưa có lần mua nào')}
          </p>
        ) : (
          // The server returns newest first; render that order as-is.
          <ul className="divide-y divide-dashed divide-border text-sm">
            {state.items.map((purchase) => (
              <li
                key={purchase.id}
                className="flex items-start justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="font-semibold text-ink">
                    {formatDay(purchase.purchasedAt, locale)}
                  </p>
                  {(purchase.store || purchase.note) && (
                    <p className="truncate text-xs text-muted-foreground">
                      {[purchase.store, purchase.note]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                </div>
                <span className="shrink-0 font-display font-bold tabular-nums text-ink">
                  {formatVND(purchase.price, locale)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            className="rounded-pill"
            onClick={() => onOpenChange(false)}
          >
            {t('Đóng')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
