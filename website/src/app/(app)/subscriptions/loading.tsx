import { PageShell } from '@/components/page-shell';
import {
  PageHeaderSkeleton,
  Skeleton,
  SkeletonCardTiles,
  SkeletonStatCards,
} from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <PageShell>
      <PageHeaderSkeleton withCta />
      <SkeletonStatCards count={3} />
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-11 w-full max-w-sm" />
        <Skeleton className="h-11 w-32" />
      </div>
      <SkeletonCardTiles />
    </PageShell>
  );
}
