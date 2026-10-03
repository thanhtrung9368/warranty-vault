import Link from 'next/link';
import { Plus, Paperclip, Package, Search, Coins, ClipboardPaste } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { CategoryIconBadge } from '@/components/category-icon';
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
  type Status,
} from '@/lib/types';
import { formatDate, formatVND } from '@/lib/format';

export const dynamic = 'force-dynamic';

// Soft pill backgrounds keyed off the device status. Mirrors design tokens.
const STATUS_PILL: Record<Status, string> = {
  ACTIVE: 'bg-emerald-soft text-emerald-ink',
  EXPIRED: 'bg-amber-soft text-amber-ink',
  SOLD: 'bg-sky-soft text-sky-ink',
  BROKEN: 'bg-rose-soft text-rose-ink',
  LOST: 'bg-zinc-soft text-ink-2',
};

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
  const isFiltered = Boolean(filter.q || filter.category || filter.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Kho thiết bị</p>
          <h1 className="display mt-1 text-3xl text-ink md:text-4xl">Thiết bị</h1>
          <p className="mt-1.5 text-sm text-muted-foreground md:text-base">
            Tổng {devices.length} thiết bị
            {isFiltered ? ' (đã lọc)' : ''}. Bấm vào từng cái để xem chi tiết.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {/* đ/ngày (FEATURE_IDEAS #7) lives on /stats with the other money
              rollups; this is the link that makes it discoverable from the list.
              A sort option here would need every device's warranty costs (an
              N+1 read on the hottest page) and a new `sort` value the Go service
              does not accept, so the ranking is where the comparison happens. */}
          <Button asChild size="lg" variant="outline" className="rounded-pill">
            <Link href="/stats#chi-phi-moi-ngay">
              <Coins className="mr-1 h-4 w-4" />
              Chi phí mỗi ngày
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="rounded-pill">
            <Link href="/devices/import">
              <ClipboardPaste className="mr-1 h-4 w-4" />
              Dán bảng
            </Link>
          </Button>
          <Button asChild size="lg" className="rounded-pill">
            <Link href="/devices/new">
              <Plus className="mr-1 h-4 w-4" />
              Thêm thiết bị
            </Link>
          </Button>
        </div>
      </div>

      <DevicesFilterBar categories={categories} />

      {devices.length === 0 ? (
        <>
          <EmptyState
            icon={isFiltered ? Search : Package}
            tone={isFiltered ? 'zinc' : 'primary'}
            title={
              isFiltered ? 'Không có gì khớp bộ lọc' : 'Chưa có thiết bị nào, mày'
            }
            description={
              isFiltered
                ? 'Thử nới bộ lọc hoặc xoá ô tìm kiếm xem sao.'
                : 'Thêm thiết bị đầu tiên — laptop, điện thoại, máy giặt... gì cũng được.'
            }
            cta={!isFiltered}
          />
          {/* The cold-start case this feature exists for: ten old items already
              sitting in a spreadsheet. */}
          {!isFiltered && (
            <p className="text-center text-sm text-muted-foreground">
              Đã có sẵn danh sách trong Excel/Google Sheets?{' '}
              <Link
                href="/devices/import"
                className="font-semibold text-primary hover:underline"
              >
                Dán bảng để nhập nhiều thiết bị một lúc
              </Link>
              .
            </p>
          )}
        </>
      ) : (
        <div className="overflow-hidden rounded-lg border-[1.5px] border-border bg-card">
          <Table>
            <TableHeader className="bg-surface-2">
              <TableRow>
                <TableHead className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Tên
                </TableHead>
                <TableHead className="hidden text-[11px] font-bold uppercase tracking-wide text-muted-foreground sm:table-cell">
                  Loại
                </TableHead>
                <TableHead className="hidden text-[11px] font-bold uppercase tracking-wide text-muted-foreground lg:table-cell">
                  Giá
                </TableHead>
                <TableHead className="hidden text-[11px] font-bold uppercase tracking-wide text-muted-foreground md:table-cell">
                  Ngày mua
                </TableHead>
                <TableHead className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  Bảo hành
                </TableHead>
                <TableHead className="hidden text-[11px] font-bold uppercase tracking-wide text-muted-foreground md:table-cell">
                  Trạng thái
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {devices.map((d) => {
                const status = d.status as Status;
                return (
                  <TableRow
                    key={d.id}
                    className="cursor-pointer transition-colors hover:bg-surface-2"
                  >
                    <TableCell>
                      <Link
                        href={`/devices/${d.id}`}
                        className="flex items-center gap-3"
                      >
                        <CategoryIconBadge category={d.category} size="sm" />
                        <div className="min-w-0">
                          <p className="font-bold text-ink">{d.name}</p>
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
                      <span className="inline-flex items-center rounded-pill bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink-2">
                        {CATEGORY_LABELS[d.category as keyof typeof CATEGORY_LABELS] ??
                          d.category}
                      </span>
                    </TableCell>
                    <TableCell className="hidden font-semibold tabular-nums lg:table-cell">
                      {formatVND(d.purchasePrice)}
                    </TableCell>
                    <TableCell className="hidden text-ink-2 md:table-cell">
                      {formatDate(d.purchaseDate)}
                    </TableCell>
                    <TableCell>
                      {d.effectiveWarrantyEnd ? (
                        <WarrantyPill
                          warrantyEnd={d.effectiveWarrantyEnd}
                          variant="badge"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">Không có</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span
                        className={`inline-flex items-center rounded-pill px-2.5 py-1 text-xs font-semibold ${
                          STATUS_PILL[status] ?? 'bg-zinc-soft text-ink-2'
                        }`}
                      >
                        {STATUS_LABELS[status] ?? d.status}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
