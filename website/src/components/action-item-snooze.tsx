'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Clock, Loader2, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SNOOZE_CHOICES } from '@/lib/action-queue';
import { snoozeActionItem, unsnoozeActionItem } from '@/app/actions/actions';
import { formatDate } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/client';

// Per-item snooze control for the "Việc cần xử lý" queue.
//
// Two things it deliberately is not:
//   - it is not a delete: a snooze is an acknowledgement with an expiry, and the
//     row stays visible (and undoable) under "Đang hoãn";
//   - it is not a push setting: the server keeps `DecisionSnooze` separate from
//     `Reminder`, so snoozing here never silences a warranty notification.
// Errors are surfaced with the server's own message, already in the page's
// language (`?lang=` on every API call); the local fallbacks and everything
// else here go through the client translator, so nothing renders Vietnamese
// under an English UI.
export function ActionItemSnooze({
  itemKey,
  isSnoozed,
}: {
  itemKey: string;
  isSnoozed: boolean;
}) {
  const [pending, startTransition] = React.useTransition();
  const router = useRouter();
  const t = useT();
  const locale = useLocale();

  // Shared by the row button and the toast's undo, so both paths put the row
  // back exactly the same way.
  const unsnooze = React.useCallback(
    (options?: { silent?: boolean }) =>
      startTransition(async () => {
        const res = await unsnoozeActionItem(itemKey);
        if (!res.ok) {
          toast.error(t(res.message));
          return;
        }
        router.refresh();
        if (!options?.silent) {
          toast.success(res.message ? t(res.message) : t('Đã bỏ hoãn'));
        }
      }),
    [itemKey, router, t],
  );

  const snooze = (days: number) =>
    startTransition(async () => {
      const res = await snoozeActionItem(itemKey, days);
      if (!res.ok) {
        toast.error(t(res.message));
        return;
      }
      router.refresh();
      // The row leaves the active list on refresh, so undo lives on the toast —
      // same pattern as the reminders' "Đã ẩn nhắc nhở".
      toast.success(
        res.snoozedUntil
          ? t('Đã hoãn tới {date}', { date: formatDate(res.snoozedUntil, locale) })
          : res.message
            ? t(res.message, { days: res.days ?? days, count: res.days ?? days })
            : t('Đã hoãn việc này'),
        { action: { label: t('Bỏ hoãn'), onClick: () => unsnooze({ silent: true }) } },
      );
    });

  if (isSnoozed) {
    return (
      <Button
        size="sm"
        variant="outline"
        className="rounded-pill border-border-strong bg-surface-2 text-ink-2 hover:bg-surface-3"
        disabled={pending}
        onClick={() => unsnooze()}
      >
        {pending ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Undo2 className="mr-1 h-3.5 w-3.5" />
        )}
        {t('Bỏ hoãn')}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="rounded-pill border-border-strong bg-surface-2 text-ink-2 hover:bg-surface-3"
          disabled={pending}
        >
          {pending ? (
            <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Clock className="mr-1 h-3.5 w-3.5" />
          )}
          {t('Hoãn')}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[11rem]">
        <DropdownMenuLabel className="text-xs font-semibold text-muted-foreground">
          {t('Hoãn việc này trong')}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {SNOOZE_CHOICES.map((choice) => (
          <DropdownMenuItem
            key={choice.days}
            onSelect={() => snooze(choice.days)}
            className="cursor-pointer"
          >
            {/* `label` is the Vietnamese dictionary key (`action-queue.ts`). */}
            {t(choice.label)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

