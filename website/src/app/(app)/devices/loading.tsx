import {
  PageHeaderSkeleton,
  Skeleton,
  SkeletonRows,
} from '@/components/ui/skeleton';

export default function Loading() {
  return (
    <div className="space-y-6">
      <PageHeaderSkeleton withCta />
      <div className="flex flex-wrap items-center gap-2">
        <Skeleton className="h-10 w-full max-w-sm" />
        <Skeleton className="h-10 w-32" />
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="rounded-2xl border bg-card p-2 shadow-sm">
        <SkeletonRows count={5} />
      </div>
    </div>
  );
}
