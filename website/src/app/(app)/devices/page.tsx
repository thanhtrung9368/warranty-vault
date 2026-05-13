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
import { api } from '@/lib/api';
import type { DeviceListFilter } from '@/lib/api/devices';
import { requireUser } from '@/lib/auth';
import { getCategories } from '@/app/actions/catalog';
import {
  CATEGORY_LABELS,
  STATUS_LABELS,
  STATUS_BADGE_VARIANT,
  type Status,
} from '@/lib/types';
import { formatDate, formatVND } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; status?: string; sort?: string; dir?: string }>;
}) {
  await requireUser();
  const sp = await searchParams;
  const filter: DeviceListFilter = {
    q: sp.q,
    category: sp.category,
    status: sp.status,
    sort: (sp.sort as DeviceListFilter['sort']) ?? 'purchaseDate',
    dir: (sp.dir as 'asc' | 'desc') ?? 'desc',
  };
  const [devicesRes, categories] = await Promise.all([
    api.devices.list(filter),
    getCategories(),
  ]);
  const devices = devicesRes.ok ? devicesRes.data : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Thiết bị</h1>
          <p className="mt-1.5 text-sm text-muted-foreground md:text-base">
            Tổng {devices.length} thiết bị
            {filter.q || filter.category || filter.status ? ' (đã lọc)' : ''}.
            Bấm vào từng cái để xem chi tiết.
          </p>
        </div>
        <Button
          asChild
          size="lg"
          className="rounded-full transition-transform hover:scale-[1.02]"
        >
          <Link href="/devices/new">
            <Plus className="mr-1 h-4 w-4" />
            Thêm thiết bị
          </Link>
        </Button>
      </div>

      <DevicesFilterBar categories={categories} />

      {devices.length === 0 ? (
        <EmptyState
          title={
            filter.q || filter.category || filter.status
              ? 'Không có gì khớp bộ lọc'
              : 'Chưa có thiết bị nào, mày'
          }
          description={
            filter.q || filter.category || filter.status
              ? 'Thử nới bộ lọc hoặc xoá ô tìm kiếm xem sao.'
              : 'Thêm thiết bị đầu tiên — laptop, điện thoại, máy giặt... gì cũng được.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow hover:shadow-md">
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
                <TableRow
                  key={d.id}
                  className="cursor-pointer transition-colors hover:bg-accent/50"
                >
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
                          {d.attachmentCount > 0 && (
                            <span className="ml-2 inline-flex items-center gap-0.5">
                              <Paperclip className="h-3 w-3" />
                              {d.attachmentCount}
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
                      variant={STATUS_BADGE_VARIANT[d.status as Status] ?? 'secondary'}
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
