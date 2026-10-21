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
      {/* Same header shape as the page, eyebrow included. */}
      <PageHeaderSkeleton />
      <SkeletonStatCards count={5} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <SkeletonCard className="space-y-3">
          <Skeleton className="h-5 w-44" />
          <SkeletonRows count={4} />
        </SkeletonCard>
        <SkeletonCard className="space-y-3">
          <Skeleton className="h-5 w-40" />
          <SkeletonRows count={3} />
        </SkeletonCard>
      </div>
    </PageShell>
  );
}
