import { statusLabel } from '@/lib/i18n/labels';
import { getI18n } from '@/lib/i18n/server';
import type { Status } from '@/lib/types';
import { cn } from '@/lib/utils';

// The device-status chip, in ONE place.
//
// It used to be a local `STATUS_PILL` map copied into `/devices` and
// `/devices/[id]`, which is why the list could hide the chip below `md` without
// anything else noticing. Sharing the component is what makes the next
// responsive change impossible to apply to only one of them.
//
// Server Component: both call sites are RSC. It reads the locale itself so the
// call sites do not have to thread it through, exactly like `WarrantyPill`.

const STATUS_PILL: Record<Status, string> = {
  ACTIVE: 'bg-emerald-soft text-emerald-ink',
  EXPIRED: 'bg-amber-soft text-amber-ink',
  SOLD: 'bg-sky-soft text-sky-ink',
  BROKEN: 'bg-rose-soft text-rose-ink',
  LOST: 'bg-zinc-soft text-ink-2',
};

export async function DeviceStatusPill({
  status,
  className,
}: {
  status: Status;
  className?: string;
}) {
  const { locale } = await getI18n();
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-pill px-2.5 py-1 text-xs font-semibold',
        STATUS_PILL[status] ?? 'bg-zinc-soft text-ink-2',
        className,
      )}
    >
      {statusLabel(status, locale)}
    </span>
  );
}
