import { differenceInDays } from 'date-fns';
import { Progress } from '@/components/ui/progress';
import { formatDate, warrantyState } from '@/lib/format';
import { cn } from '@/lib/utils';

export function WarrantyTimeline({
  purchaseDate,
  warrantyEndDate,
}: {
  purchaseDate: Date | string;
  warrantyEndDate: Date | string;
}) {
  const start = typeof purchaseDate === 'string' ? new Date(purchaseDate) : purchaseDate;
  const end = typeof warrantyEndDate === 'string' ? new Date(warrantyEndDate) : warrantyEndDate;
  const total = Math.max(1, differenceInDays(end, start));
  const elapsed = Math.max(0, Math.min(total, differenceInDays(new Date(), start)));
  const pct = Math.round((elapsed / total) * 100);
  const state = warrantyState(end);

  const indicator =
    state.tone === 'expired'
      ? 'bg-zinc-400'
      : state.tone === 'danger'
      ? 'bg-red-500'
      : state.tone === 'warn'
      ? 'bg-amber-500'
      : 'bg-emerald-500';

  return (
    <div className="space-y-2">
      <Progress value={Math.min(100, pct)} indicatorClassName={cn(indicator)} />
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>Mua: {formatDate(start)}</span>
        <span className="font-medium text-foreground">{state.label}</span>
        <span>Hết: {formatDate(end)}</span>
      </div>
    </div>
  );
}
