import Link from 'next/link';
import { PackageOpen, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function EmptyState({
  title = 'Chưa có thiết bị nào',
  description = 'Bắt đầu bằng cách thêm thiết bị đầu tiên để theo dõi bảo hành.',
  cta = true,
}: {
  title?: string;
  description?: string;
  cta?: boolean;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card/40 px-6 py-16 text-center">
      <div className="mb-4 rounded-full bg-primary/10 p-4 text-primary">
        <PackageOpen className="h-8 w-8" />
      </div>
      <h3 className="mb-1 text-lg font-semibold">{title}</h3>
      <p className="mb-6 max-w-sm text-sm text-muted-foreground">{description}</p>
      {cta && (
        <Button asChild>
          <Link href="/devices/new">
            <Plus className="mr-1 h-4 w-4" />
            Thêm thiết bị
          </Link>
        </Button>
      )}
    </div>
  );
}
