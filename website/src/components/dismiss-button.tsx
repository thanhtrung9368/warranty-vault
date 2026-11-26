'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  dismissWarrantyReminder,
  restoreWarrantyReminder,
} from '@/app/actions/reminders';
import { useT } from '@/lib/i18n/client';

export function DismissButton({
  warrantyId,
  isDismissed,
}: {
  warrantyId: string;
  isDismissed: boolean;
}) {
  const t = useT();
  const [pending, startTransition] = React.useTransition();
  const router = useRouter();

  // Restore is also the toast's "Hoàn tác". It only refreshes and confirms
  // after the server actually restored the row — a failed call must not look
  // like it worked, and there is no second undo to offer.
  const restore = () =>
    startTransition(async () => {
      const res = await restoreWarrantyReminder(warrantyId);
      if (!res.ok) {
        toast.error(res.message ?? t('Không hiện lại được nhắc nhở'));
        return;
      }
      router.refresh();
      toast.success(t('Đã hiện lại nhắc nhở'));
    });

  return (
    <Button
      size="sm"
      variant="outline"
      className="rounded-pill border-border-strong bg-surface-2 text-ink-2 hover:bg-surface-3"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          if (isDismissed) {
            const res = await restoreWarrantyReminder(warrantyId);
            if (!res.ok) {
              toast.error(res.message ?? t('Không hiện lại được nhắc nhở'));
              return;
            }
            router.refresh();
            toast.success(t('Đã hiện lại nhắc nhở'));
          } else {
            const res = await dismissWarrantyReminder(warrantyId);
            if (!res.ok) {
              toast.error(res.message ?? t('Không ẩn được nhắc nhở'));
              return;
            }
            router.refresh();
            // The row leaves the list (force-dynamic page re-renders), so the
            // undo lives on the toast — mirrors the mobile snackbar/banner.
            toast.success(t('Đã ẩn nhắc nhở'), {
              action: { label: t('Hoàn tác'), onClick: restore },
            });
          }
        })
      }
    >
      {pending ? (
        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
      ) : isDismissed ? (
        <Eye className="mr-1 h-3.5 w-3.5" />
      ) : (
        <EyeOff className="mr-1 h-3.5 w-3.5" />
      )}
      {isDismissed ? t('Hiện lại') : t('Đã xem, ẩn đi')}
    </Button>
  );
}
