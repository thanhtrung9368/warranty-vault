import { cn } from '@/lib/utils';

/**
 * Empty-state art for the one genuine cold-start screen.
 *
 * Scope, deliberately narrow: this is only used when `emptyReason ===
 * 'no-data'` — the account has never saved a device, so the app is not
 * congratulating the user about data it never read. The `nothing-due` state
 * keeps its tinted icon chip because that state is a verdict on real data, and
 * the filtered-list callers (`/devices?q=…`, `/subscriptions`) must not start
 * showing a "first device" drawing.
 *
 * Same visual language as the landing feature set: solid fills, one coral dot,
 * no strokes/gradients/text. The plus is soft, not coral, so the dot stays the
 * only accent and keeps its meaning (the date you must remember).
 */
export function EmptyStateArt({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  const ink = 'hsl(var(--ink))';
  const soft = 'hsl(var(--primary-soft))';
  const accent = 'hsl(var(--primary))';
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 180 130"
      width={180}
      height={130}
      role="img"
      aria-label={label}
      data-empty-art
      className={cn('block h-auto w-[180px]', className)}
    >
      <ellipse cx="90" cy="118" rx="62" ry="7" fill={soft} />
      {/* receipt with a torn top and rounded bottom */}
      <path
        d="M52 28L64 34L76 24L88 34L100 24L112 34L124 24L128 28V96A8 8 0 0 1 120 104H60A8 8 0 0 1 52 96Z"
        fill={ink}
      />
      <rect x="66" y="48" width="48" height="7" rx="3.5" fill={soft} />
      <rect x="66" y="62" width="36" height="7" rx="3.5" fill={soft} />
      <rect x="66" y="76" width="44" height="7" rx="3.5" fill={soft} />
      {/* the one coral dot: the date stamp, low-right as on the mark */}
      <circle cx="112" cy="88" r="8" fill={accent} />
      {/* "add" — soft, so it does not compete with the dot */}
      <g fill={soft}>
        <rect x="138" y="54" width="20" height="6" rx="3" />
        <rect x="145" y="47" width="6" height="20" rx="3" />
      </g>
    </svg>
  );
}
