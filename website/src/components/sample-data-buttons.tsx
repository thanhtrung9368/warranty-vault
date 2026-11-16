'use client';

// The two buttons that write and remove the starter-kit sample rows.
//
// Both call the server actions in `app/actions/devices.ts`, which use the
// ordinary bulk-create / delete endpoints — no sample-only route exists. Kept
// as client components only because they need a toast, a pending state and
// `router.refresh()` after the write; the surrounding starter-kit card stays a
// server component.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  createSampleDevices,
  deleteSampleDevices,
} from '@/app/actions/devices';
import { useT } from '@/lib/i18n/client';

/** "Add sample data" — the first-run card's demo action. */
export function AddSampleDataButton({ className }: { className?: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  return (
    <Button
      type="button"
      className={className ?? 'rounded-pill'}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await createSampleDevices();
          if (!res.ok) {
            toast.error(t(res.message ?? 'Không thêm được dữ liệu mẫu.'));
            return;
          }
          router.refresh();
          toast.success(t(res.message ?? 'Đã thêm dữ liệu mẫu.'));
        })
      }
    >
      {pending ? (
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
      ) : (
        <Sparkles className="mr-1.5 h-4 w-4" />
      )}
      {t('Thêm dữ liệu mẫu')}
    </Button>
  );
}

/** "Remove sample data" — shown while the account still holds sample rows. */
export function RemoveSampleDataButton() {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="rounded-pill border-border-strong bg-card"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const res = await deleteSampleDevices();
          if (!res.ok) {
            toast.error(t(res.message ?? 'Không xoá được dữ liệu mẫu.'));
            return;
          }
          router.refresh();
          toast.success(t(res.message ?? 'Đã xoá dữ liệu mẫu.'));
        })
      }
    >
      {pending ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
      ) : (
        <Trash2 className="mr-1.5 h-3.5 w-3.5" />
      )}
      {t('Xoá dữ liệu mẫu')}
    </Button>
  );
}
