import Link from 'next/link';
import { Plus, Paperclip } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { CategoryIcon } from '@/components/category-icon';
import { WarrantyPill } from '@/components/warranty-pill';
import { EmptyState } from '@/components/empty-state';
import { DevicesFilterBar } from '@/components/devices-filter-bar';
import { listDevices, type DeviceListFilter } from '@/lib/devices';
import { requireUser } from '@/lib/auth';
import { getCategories } from '@/app/actions/catalog';
import {
  CATEGORY_LABELS,
  STATUS_LABELS,
  STATUS_COLORS,
  type Status,
} from '@/lib/types';
import { formatDate, formatVND } from '@/lib/format';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; status?: string; sort?: string; dir?: string }>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const filter: DeviceListFilter = {
    q: sp.q,
    category: sp.category,
    status: sp.status,
    sort: (sp.sort as DeviceListFilter['sort']) ?? 'purchaseDate',
    dir: (sp.dir as 'asc' | 'desc') ?? 'desc',
  };
  const [devices, categories] = await Promise.all([
    listDevices(user.id, filter),
    getCategories(),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Thiết bị</h1>
          <p className="text-sm text-muted-foreground">
            Tổng {devices.length} thiết bị
            {filter.q || filter.category || filter.status ? ' (đã lọc)' : ''}
          </p>
        </div>
        <Button asChild>
          <Link href="/devices/new">
            <Plus className="mr-1 h-4 w-4" />
            Thêm thiết bị
          </Link>
        </Button>
      </div>

      <DevicesFilterBar categories={categories} />

      {devices.length === 0 ? (
        <EmptyState
          title="Không có thiết bị"
          description={
            filter.q || filter.category || filter.status
              ? 'Không tìm thấy thiết bị phù hợp với bộ lọc.'
              : 'Chưa có thiết bị nào. Thêm ngay!'
          }
        />
      ) : (
        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Tên</TableHead>
                <TableHead className="hidden sm:table-cell">Loại</TableHead>
                <TableHead className="hidden lg:table-cell">Giá</TableHead>
                <TableHead className="hidden md:table-cell">Ngày mua</TableHead>
                <TableHead>Bảo hành</TableHead>
                <TableHead className="hidden md:table-cell">Trạng thái</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((d) => (
                <TableRow key={d.id} className="cursor-pointer">
                  <TableCell>
                    <Link href={`/devices/${d.id}`} className="flex items-center gap-3">
                      <div className="rounded-md bg-muted p-2">
                        <CategoryIcon
                          category={d.category}
                          className="h-4 w-4 text-muted-foreground"
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium">{d.name}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {d.brand}
                          {d.brand && d.model ? ' • ' : ''}
                          {d.model}
                          {d._count.attachments > 0 && (
                            <span className="ml-2 inline-flex items-center gap-0.5">
                              <Paperclip className="h-3 w-3" />
                              {d._count.attachments}
                            </span>
                          )}
                        </p>
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {CATEGORY_LABELS[d.category as keyof typeof CATEGORY_LABELS] ?? d.category}
                  </TableCell>
                  <TableCell className="hidden lg:table-cell font-medium">
                    {formatVND(d.purchasePrice)}
                  </TableCell>
                  <TableCell className="hidden md:table-cell text-muted-foreground">
                    {formatDate(d.purchaseDate)}
                  </TableCell>
                  <TableCell>
                    {d.effectiveWarrantyEnd ? (
                      <WarrantyPill warrantyEnd={d.effectiveWarrantyEnd} variant="badge" />
                    ) : (
                      <span className="text-xs text-muted-foreground">Không có</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <Badge
                      variant="outline"
                      className={cn(
                        'border-transparent',
                        STATUS_COLORS[d.status as Status] ?? '',
                      )}
                    >
                      {STATUS_LABELS[d.status as Status] ?? d.status}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
