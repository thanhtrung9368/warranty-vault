import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import Link from 'next/link';
import {
  Plus,
  Paperclip,
  Package,
  Search,
  Coins,
  ClipboardPaste,
  ListPlus,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
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
import { DeviceStatusPill } from '@/components/device-status-pill';
import { EmptyState } from '@/components/empty-state';
import { DevicesFilterBar } from '@/components/devices-filter-bar';
import { api } from '@/lib/api';
import type { DeviceListFilter } from '@/lib/api/devices';
import { requireUser } from '@/lib/auth';
import { categoryLabel } from '@/lib/i18n/labels';
import { getI18n } from '@/lib/i18n/server';
import { getCategories } from '@/app/actions/catalog';
import { type Status } from '@/lib/types';
import { formatDate, formatVND } from '@/lib/format';
import { formatMoney } from '@/lib/currency';

export const dynamic = 'force-dynamic';

export default async function DevicesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string; status?: string; sort?: string; dir?: string }>;
}) {
  await requireUser();
  const { locale, t } = await getI18n();
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
    <PageShell>
      <PageHeader
        eyebrow={t('Kho thiết bị')}
        title={t('Thiết bị')}
        description={isFiltered
              ? t('Tổng {count} thiết bị (đã lọc). Bấm vào từng cái để xem chi tiết.', {
                  count: devices.length,
                })
              : t('Tổng {count} thiết bị. Bấm vào từng cái để xem chi tiết.', {
                  count: devices.length,
                })}
        actions={
          <>
          {/* đ/ngày (FEATURE_IDEAS #7) lives on /stats with the other money
              rollups; this is the link that makes it discoverable from the list.
              A sort option here would need every device's warranty costs (an
              N+1 read on the hottest page) and a new `sort` value the Go service
              does not accept, so the ranking is where the comparison happens. */}
          <Button asChild size="lg" variant="outline" className="rounded-pill">
            <Link href="/stats#chi-phi-moi-ngay">
              <Coins className="mr-1 h-4 w-4" />
              {t('Chi phí mỗi ngày')}
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="rounded-pill">
            <Link href="/devices/import">
              <ClipboardPaste className="mr-1 h-4 w-4" />
              {t('Dán bảng')}
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="rounded-pill">
            <Link href="/devices/bulk">
              <ListPlus className="mr-1 h-4 w-4" />
              {t('Thêm hàng loạt')}
            </Link>
          </Button>
          <Button asChild size="lg" className="rounded-pill">
            <Link href="/devices/new">
              <Plus className="mr-1 h-4 w-4" />
              {t('Thêm thiết bị')}
            </Link>
          </Button>
          </>
        }
      />

      <DevicesFilterBar categories={categories} />

      {devices.length === 0 ? (
        <>
          <EmptyState
            icon={isFiltered ? Search : Package}
            tone={isFiltered ? 'zinc' : 'primary'}
            title={
              isFiltered ? t('Không có gì khớp bộ lọc') : t('Chưa có thiết bị nào, mày')
            }
            description={
              isFiltered
                ? t('Thử nới bộ lọc hoặc xoá ô tìm kiếm xem sao.')
                : t('Thêm thiết bị đầu tiên — laptop, điện thoại, máy giặt... gì cũng được.')
            }
            cta={!isFiltered}
          />
          {/* The cold-start case this feature exists for: ten old items already
              sitting in a spreadsheet. */}
          {!isFiltered && (
            <p className="text-center text-sm text-muted-foreground">
              {t('Đã có sẵn danh sách trong Excel/Google Sheets?')}{' '}
              <Link
                href="/devices/import"
                className="font-semibold text-primary hover:underline"
              >
                {t('Dán bảng để nhập nhiều thiết bị một lúc')}
              </Link>
              .
            </p>
          )}
        </>
      ) : (
        <Card padding="none" className="overflow-hidden">
          <Table>
            <TableHeader className="bg-surface-2">
              <TableRow>
                <TableHead className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {t('Tên')}
                </TableHead>
                <TableHead className="hidden text-xs font-bold uppercase tracking-wide text-muted-foreground sm:table-cell">
                  {t('Loại')}
                </TableHead>
                <TableHead className="hidden text-xs font-bold uppercase tracking-wide text-muted-foreground lg:table-cell">
                  {t('Giá')}
                </TableHead>
                <TableHead className="hidden text-xs font-bold uppercase tracking-wide text-muted-foreground md:table-cell">
                  {t('Ngày mua')}
                </TableHead>
                <TableHead className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                  {t('Bảo hành')}
                </TableHead>
                <TableHead className="hidden text-xs font-bold uppercase tracking-wide text-muted-foreground md:table-cell">
                  {t('Trạng thái')}
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
                          {/* Status is folded into the name cell below `md`.
                              The dedicated column disappears at that width, and
                              hiding it entirely made a BROKEN washer look
                              exactly like a healthy one on a phone — the one
                              thing the list exists to answer at a glance. The
                              same chip is rendered by both branches, so the
                              desktop and phone presentations cannot drift. */}
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <p className="font-bold text-ink">{d.name}</p>
                            <DeviceStatusPill status={status} className="md:hidden" />
                          </div>
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
                        {categoryLabel(d.category, locale)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden font-semibold tabular-nums lg:table-cell">
                      <span className="block">
                        {formatMoney(d.purchasePrice, d.currency, locale)}
                      </span>
                      {/* The raw price is meaningful only next to its currency;
                          show the server's VND value as the comparison line. */}
                      {d.currency !== 'VND' && d.purchasePriceVnd != null && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          ≈ {formatVND(d.purchasePriceVnd, locale)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-ink-2 md:table-cell">
                      {formatDate(d.purchaseDate, locale)}
                    </TableCell>
                    <TableCell>
                      {d.effectiveWarrantyEnd ? (
                        <WarrantyPill
                          warrantyEnd={d.effectiveWarrantyEnd}
                          variant="badge"
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">{t('Không có')}</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <DeviceStatusPill status={status} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </PageShell>
  );
}
