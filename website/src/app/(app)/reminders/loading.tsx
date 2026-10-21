import { PageShell } from '@/components/page-shell';
import {
  PageHeaderSkeleton,
  Skeleton,
  SkeletonCard,
  SkeletonRows,
} from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShell>
      <PageHeaderSkeleton />
      <SkeletonCard className="space-y-3">
        <Skeleton className="h-5 w-56" />
        <SkeletonRows count={4} />
      </SkeletonCard>
      <SkeletonCard className="space-y-3">
        <Skeleton className="h-5 w-32" />
        <SkeletonRows count={3} />
      </SkeletonCard>
    </PageShell>
  );
}
