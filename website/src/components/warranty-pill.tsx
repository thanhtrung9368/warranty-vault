import { cn } from '@/lib/utils';
import { warrantyState, warrantyToneClass, warrantyBgClass } from '@/lib/format';

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
      <span
        className={cn(
          'inline-flex rounded-full border px-2 py-0.5 text-xs font-medium',
          warrantyBgClass(state.tone),
          warrantyToneClass(state.tone),
        )}
      >
        {state.label}
      </span>
    );
  }
  return <span className={cn('text-sm font-medium', warrantyToneClass(state.tone))}>{state.label}</span>;
}
