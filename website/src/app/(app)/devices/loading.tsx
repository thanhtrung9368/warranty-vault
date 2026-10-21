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
      <PageHeaderSkeleton withCta />
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-11 w-full max-w-sm" />
        <Skeleton className="h-11 w-32" />
        <Skeleton className="h-11 w-32" />
      </div>
      <SkeletonCard padding="none">
        <SkeletonRows count={5} />
      </SkeletonCard>
    </PageShell>
  );
}
