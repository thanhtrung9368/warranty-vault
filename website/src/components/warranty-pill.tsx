'use client';

// Client component purely so it can read the locale from the provider: the badge
// is rendered from Server Components (`/devices`, `/dashboard`, `/reminders`,
// `/devices/[id]`) *and* from the client-side warranty list, and a hook cannot
// run in an RSC. Keeping the locale internal means the four RSC call sites need
// no new prop.

import { cn } from '@/lib/utils';
import { warrantyState, warrantyToneClass } from '@/lib/format';
import { useLocale } from '@/lib/i18n/client';

export function WarrantyPill({
  warrantyEnd,
  variant = 'inline',
}: {
  warrantyEnd: Date | string;
  variant?: 'inline' | 'badge';
}) {
  const locale = useLocale();
  const state = warrantyState(warrantyEnd, locale);
  if (variant === 'badge') {
    return (
      <span className="wv-warranty-pill" data-status={state.tone}>
        <span className="dot" />
        {state.label}
      </span>
    );
  }
  return (
    <span className={cn('text-sm font-medium', warrantyToneClass(state.tone))}>
      {state.label}
    </span>
  );
}
