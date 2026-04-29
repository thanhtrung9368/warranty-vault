import Link from 'next/link';
import { Bell, BellOff, ArrowRight } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CategoryIcon } from '@/components/category-icon';
import { WarrantyPill } from '@/components/warranty-pill';
import { DismissButton } from '@/components/dismiss-button';
import { EmptyState } from '@/components/empty-state';
import { getReminders, type ReminderRow } from '@/lib/reminders';
import { requireUser } from '@/lib/auth';
import {
  CATEGORY_LABELS,
  WARRANTY_TYPE_LABELS,
  WARRANTY_TYPE_COLORS,
  type Category,
} from '@/lib/types';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

const SECTIONS: { key: ReminderRow['bucket']; title: string; tone: string }[] = [
  { key: 'EXPIRED', title: 'Đã hết bảo hành (gần đây)', tone: 'text-zinc-500' },
  { key: '30', title: 'Sắp hết trong 30 ngày', tone: 'text-red-600 dark:text-red-400' },
  { key: '60', title: 'Sắp hết trong 60 ngày', tone: 'text-amber-600 dark:text-amber-400' },
  { key: '90', title: 'Sắp hết trong 90 ngày', tone: 'text-emerald-600 dark:text-emerald-400' },
];

export default async function RemindersPage() {
  const user = await requireUser();
  const all = await getReminders(user.id);
  const active = all.filter((r) => !r.isDismissed);
  const dismissed = all.filter((r) => r.isDismissed);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Nhắc nhở</h1>
        <p className="text-sm text-muted-foreground">
          Gói bảo hành sắp hết hoặc vừa hết. Bấm “Đã xem, ẩn đi” để bỏ qua từng gói.
        </p>
      </div>

      {active.length === 0 && dismissed.length === 0 ? (
        <EmptyState
          title="Không có nhắc nhở nào"
          description="Tất cả gói bảo hành đều an toàn. Quá tuyệt!"
          cta={false}
        />
      ) : (
        <div className="space-y-6">
          {SECTIONS.map((section) => {
            const items = active.filter((r) => r.bucket === section.key);
            if (items.length === 0) return null;
            return (
              <Card key={section.key}>
                <CardHeader>
                  <CardTitle className={`flex items-center gap-2 text-base ${section.tone}`}>
                    <Bell className="h-5 w-5" />
                    {section.title}
                    <span className="ml-auto text-sm font-normal text-muted-foreground">
                      {items.length} gói
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="divide-y">
                    {items.map((r) => (
                      <li key={r.warrantyId} className="flex items-center justify-between gap-3 py-3">
                        <Link
                          href={`/devices/${r.deviceId}`}
                          className="flex min-w-0 flex-1 items-center gap-3 hover:underline"
                        >
                          <div className="rounded-md bg-muted p-2">
                            <CategoryIcon
                              category={r.category}
                              className="h-4 w-4 text-muted-foreground"
                            />
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate font-medium">{r.deviceName}</p>
                              <Badge
                                variant="outline"
                                className={cn(
                                  'border-transparent text-[10px]',
                                  WARRANTY_TYPE_COLORS[r.warrantyType] ?? '',
                                )}
                              >
                                {WARRANTY_TYPE_LABELS[r.warrantyType] ?? r.warrantyType}
                              </Badge>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              {CATEGORY_LABELS[r.category as Category] ?? r.category}
                              {r.brand ? ` • ${r.brand}` : ''}
                              {r.warrantyProvider ? ` • ${r.warrantyProvider}` : ''} • Hết{' '}
                              {formatDate(r.endDate)}
                            </p>
                          </div>
                        </Link>
                        <div className="flex items-center gap-2">
                          <WarrantyPill warrantyEnd={r.endDate} variant="badge" />
                          <DismissButton warrantyId={r.warrantyId} isDismissed={false} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            );
          })}

          {dismissed.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-muted-foreground">
                  <BellOff className="h-5 w-5" />
                  Đã ẩn ({dismissed.length})
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="divide-y">
                  {dismissed.map((r) => (
                    <li
                      key={r.warrantyId}
                      className="flex items-center justify-between gap-3 py-3 opacity-70"
                    >
                      <Link
                        href={`/devices/${r.deviceId}`}
                        className="flex min-w-0 flex-1 items-center gap-3 hover:underline"
                      >
                        <CategoryIcon
                          category={r.category}
                          className="h-4 w-4 text-muted-foreground"
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm">
                            {r.deviceName}{' '}
                            <span className="text-xs text-muted-foreground">
                              ({WARRANTY_TYPE_LABELS[r.warrantyType] ?? r.warrantyType})
                            </span>
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Hết {formatDate(r.endDate)}
                          </p>
                        </div>
                      </Link>
                      <DismissButton warrantyId={r.warrantyId} isDismissed />
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {active.length === 0 && dismissed.length > 0 && (
            <p className="text-center text-sm text-muted-foreground">
              Tất cả nhắc nhở hiện tại đã được ẩn. <ArrowRight className="inline h-3 w-3" />
            </p>
          )}
        </div>
      )}
    </div>
  );
}
