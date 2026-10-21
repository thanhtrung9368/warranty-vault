import { cn } from '@/lib/utils';

/**
 * The page rhythm.
 *
 * Every signed-in page used to pick its own vertical rhythm: `space-y-6` (24px)
 * almost everywhere, `gap-7` (28px) on the dashboard, `space-y-8` (32px) in its
 * loading skeleton, and `space-y-4` (16px) in the failure branches. This is the
 * one place that gap is decided, and it reads `--gap` — which
 * `[data-density]` rescales — so the Settings density control moves the page
 * itself, not just an unused custom property.
 *
 * Width constraints stay at the call site (`className="mx-auto max-w-3xl"`):
 * a detail page and the settings form have different natural widths, and that
 * is a layout decision, not a rhythm one.
 */
export function PageShell({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn('space-y-page', className)}>{children}</div>;
}
