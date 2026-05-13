import {
  PageHeaderSkeleton,
  Skeleton,
  SkeletonRows,
} from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <div className="space-y-3 rounded-2xl border bg-card p-5 shadow-sm">
        <Skeleton className="h-5 w-56" />
        <SkeletonRows count={4} />
      </div>
      <div className="space-y-3 rounded-2xl border bg-card p-5 shadow-sm">
        <Skeleton className="h-5 w-56" />
        <SkeletonRows count={3} />
      </div>
    </div>
  );
}
