import {
  PageHeaderSkeleton,
  Skeleton,
  SkeletonRows,
  SkeletonStatCards,
} from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-8">
      <PageHeaderSkeleton />
      <SkeletonStatCards count={4} />
      <div className="space-y-3 rounded-2xl border bg-card p-5 shadow-sm">
        <Skeleton className="h-5 w-44" />
        <SkeletonRows count={4} />
      </div>
    </div>
  );
}
