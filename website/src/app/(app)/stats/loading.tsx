import { PageShell } from '@/components/page-shell';
import {
  PageHeaderSkeleton,
  Skeleton,
  SkeletonCard,
  SkeletonStatCards,
} from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShell>
      <PageHeaderSkeleton />
      <SkeletonStatCards count={3} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SkeletonCard className="space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-64 w-full" />
        </SkeletonCard>
        <SkeletonCard className="space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-64 w-full" />
        </SkeletonCard>
      </div>
    </PageShell>
  );
}
