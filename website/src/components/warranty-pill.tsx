import { cn } from '@/lib/utils';
import { warrantyState, warrantyToneClass } from '@/lib/format';

export function WarrantyPill({
  warrantyEnd,
  variant = 'inline',
}: {
  warrantyEnd: Date | string;
  variant?: 'inline' | 'badge';
}) {
  const state = warrantyState(warrantyEnd);
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
