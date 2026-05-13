import {
  PageHeaderSkeleton,
  Skeleton,
  SkeletonStatCards,
} from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton />
      <SkeletonStatCards count={3} />
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-2xl border bg-card p-5 shadow-sm">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-64 w-full" />
        </div>
        <div className="space-y-3 rounded-2xl border bg-card p-5 shadow-sm">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    </div>
  );
}
