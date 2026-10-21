import { PageShell } from '@/components/page-shell';
import {
  PageHeaderSkeleton,
  Skeleton,
  SkeletonCard,
  SkeletonRows,
  SkeletonStatCards,
} from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShell>
      <PageHeaderSkeleton />
      <SkeletonStatCards count={4} />
      <SkeletonCard padding="sm" tone="muted" className="flex items-start gap-3">
        <Skeleton className="h-4 w-4 shrink-0 rounded-sm" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      </SkeletonCard>
      <SkeletonCard className="space-y-3">
        <Skeleton className="h-5 w-56" />
        <SkeletonRows count={4} />
      </SkeletonCard>
      <SkeletonCard className="space-y-3">
        <Skeleton className="h-5 w-32" />
        <SkeletonRows count={2} />
      </SkeletonCard>
    </PageShell>
  );
}
