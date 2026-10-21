import { Card, type CardPadding, type CardTone } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('animate-pulse rounded-md bg-surface-2', className)}
      {...props}
    />
  );
}

/**
 * A loading surface is a real Card. That is the whole point: before this every
 * `loading.tsx` used `rounded-2xl border bg-card p-5 shadow-sm`, so navigation
 * flashed a 16px card with a native black shadow and snapped to the real card
 * when the page arrived. `SkeletonCard` inherits the radius, border, padding
 * and warm shadow from the same component the page uses.
 */
export function SkeletonCard({
  className,
  children,
  padding = 'md',
  tone,
}: {
  className?: string;
  children?: React.ReactNode;
  padding?: CardPadding;
  tone?: CardTone;
}) {
  return (
    <Card padding={padding} tone={tone} className={className}>
      {children}
    </Card>
  );
}

/**
 * Rows inside a card. Deliberately dividers, not nested bordered cards: the
 * real list surfaces (`/reminders`, `/actions`, the devices table) separate
 * rows with a rule, so the skeleton should too.
 */
export function SkeletonRows({
  count = 5,
  className,
}: {
  count?: number;
  className?: string;
}) {
  return (
    <div className={cn('divide-y divide-border/60', className)}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-card-sm">
          <Skeleton className="h-10 w-10 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="hidden h-6 w-20 rounded-full sm:block" />
        </div>
      ))}
    </div>
  );
}

export function PageHeaderSkeleton({
  withCta = false,
  withEyebrow = true,
}: {
  withCta?: boolean;
  withEyebrow?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-2">
        {withEyebrow && <Skeleton className="h-3 w-28" />}
        <Skeleton className="h-8 w-48 md:h-10 md:w-64" />
        <Skeleton className="h-4 w-72" />
      </div>
      {withCta && <Skeleton className="h-12 w-36 rounded-full" />}
    </div>
  );
}

/**
 * Tiles for pages whose real content is a grid of cards (`/subscriptions`,
 * `/wishlist`), not a list. The old skeleton showed one wide list card on both
 * pages, so the incoming layout did not match what was on screen.
 */
export function SkeletonCardTiles({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} className="flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <Skeleton className="h-10 w-10 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
            </div>
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <div className="grid grid-cols-2 gap-3 border-t border-dashed border-border pt-4">
            <div className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-5 w-24" />
            </div>
            <div className="space-y-2">
              <Skeleton className="h-3 w-16" />
              <Skeleton className="h-5 w-24" />
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-dashed border-border pt-3">
            <Skeleton className="h-3 w-14" />
            <Skeleton className="h-6 w-20 rounded-full" />
          </div>
        </SkeletonCard>
      ))}
    </div>
  );
}

export function SkeletonStatCards({ count = 4 }: { count?: number }) {
  const columns =
    count === 3
      ? 'sm:grid-cols-3'
      : count === 5
        ? 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5'
        : 'sm:grid-cols-2 lg:grid-cols-4';
  return (
    <div className={cn('grid gap-4', columns)}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} className="flex items-center justify-between">
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-8 w-16" />
            <Skeleton className="h-3 w-20" />
          </div>
          <Skeleton className="h-12 w-12 rounded-full" />
        </SkeletonCard>
      ))}
    </div>
  );
}
