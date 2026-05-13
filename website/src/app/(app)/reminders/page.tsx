import Link from 'next/link';
import { Bell } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { CategoryIcon } from '@/components/category-icon';
import { WarrantyPill } from '@/components/warranty-pill';
import { DismissButton } from '@/components/dismiss-button';
import { EmptyState } from '@/components/empty-state';
import { api } from '@/lib/api';
import type { ReminderRow as ApiReminder } from '@/lib/api/reminders';
import { requireUser } from '@/lib/auth';
import {
  CATEGORY_LABELS,
  WARRANTY_TYPE_LABELS,
  WARRANTY_TYPE_COLORS,
  type Category,
  type WarrantyType,
} from '@/lib/types';
import { formatDate } from '@/lib/format';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// Bucket the Go endpoint's already-filtered upcoming-reminders by remaining
// days. The Go endpoint excludes dismissed reminders + expired warranties,
// so this page only renders the three "Sắp hết" sections — the previous
// "Đã hết (gần đây)" + "Đã ẩn" sections went away with the Go cutover.
type Bucket = '30' | '60' | '90';

type ReminderItem = {
  warrantyId: string;
  deviceId: string;
  deviceName: string;
  category: string;
  warrantyType: WarrantyType;
  warrantyProvider: string | null;
  endDate: string;
  bucket: Bucket;
};

const SECTIONS: { key: Bucket; title: string; tone: string }[] = [
  { key: '30', title: 'Sắp hết trong 30 ngày', tone: 'text-red-600 dark:text-red-400' },
  { key: '60', title: 'Sắp hết trong 60 ngày', tone: 'text-amber-600 dark:text-amber-400' },
  { key: '90', title: 'Sắp hết trong 90 ngày', tone: 'text-emerald-600 dark:text-emerald-400' },
];

function bucketFor(endDate: string, now: Date): Bucket {
  const days = Math.round((new Date(endDate).getTime() - now.getTime()) / 86_400_000);
  if (days <= 30) return '30';
  if (days <= 60) return '60';
  return '90';
}

function toItem(r: ApiReminder, now: Date): ReminderItem {
  return {
    warrantyId: r.id,
    deviceId: r.device.id,
    deviceName: r.device.name,
    category: r.device.category,
    warrantyType: r.type as WarrantyType,
    warrantyProvider: r.provider,
    endDate: r.endDate,
    bucket: bucketFor(r.endDate, now),
  };
}

export default async function RemindersPage() {
  await requireUser();
  // 90-day horizon matches the previous UI's bucket coverage.
  const res = await api.reminders.list(90);
  const now = new Date();
  const active: ReminderItem[] = res.ok ? res.data.map((r) => toItem(r, now)) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight md:text-4xl">Nhắc nhở</h1>
        <p className="mt-1.5 text-sm text-muted-foreground md:text-base">
          Gói bảo hành sắp hết hoặc vừa hết. Bấm “Đã xem, ẩn đi” để bỏ qua từng gói.
        </p>
      </div>

      {active.length === 0 ? (
        <EmptyState
          icon={Bell}
          tone="emerald"
          title="Không có nhắc nhở nào, ngon!"
          description="Tất cả gói bảo hành đều an toàn. Mày khỏi lo gì hết."
          cta={false}
        />
      ) : (
        <div className="space-y-6">
          {SECTIONS.map((section) => {
            const items = active.filter((r) => r.bucket === section.key);
            if (items.length === 0) return null;
            return (
              <Card key={section.key} className="rounded-2xl shadow-sm transition-shadow hover:shadow-md">
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

        </div>
      )}
    </div>
  );
}
