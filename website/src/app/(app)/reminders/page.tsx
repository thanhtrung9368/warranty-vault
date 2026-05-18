import Link from 'next/link';
import { Bell } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { CategoryIconBadge } from '@/components/category-icon';
import { WarrantyPill } from '@/components/warranty-pill';
import { DismissButton } from '@/components/dismiss-button';
import { EmptyState } from '@/components/empty-state';
import { api } from '@/lib/api';
import type { ReminderRow as ApiReminder } from '@/lib/api/reminders';
import { requireUser } from '@/lib/auth';
import {
  CATEGORY_LABELS,
  WARRANTY_TYPE_LABELS,
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

type SectionTone = 'rose' | 'amber' | 'emerald';

const SECTIONS: {
  key: Bucket;
  title: string;
  tone: SectionTone;
}[] = [
  { key: '30', title: 'Sắp hết trong 30 ngày', tone: 'rose' },
  { key: '60', title: 'Sắp hết trong 60 ngày', tone: 'amber' },
  { key: '90', title: 'Sắp hết trong 90 ngày', tone: 'emerald' },
];

const TONE_BADGE: Record<SectionTone, string> = {
  rose: 'tint-rose',
  amber: 'tint-amber',
  emerald: 'tint-emerald',
};

const TONE_TITLE: Record<SectionTone, string> = {
  rose: 'text-rose-ink',
  amber: 'text-amber-ink',
  emerald: 'text-emerald-ink',
};

const WARRANTY_TYPE_TINT: Record<WarrantyType, string> = {
  STANDARD: 'tint-primary',
  EXTENDED: 'tint-violet',
  THIRD_PARTY: 'tint-sky',
};

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
        <p className="eyebrow">Bảo hành sắp hết</p>
        <h1 className="display mt-1 text-3xl text-ink md:text-4xl">Nhắc nhở</h1>
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
        <div className="space-y-2">
          {SECTIONS.map((section) => {
            const items = active.filter((r) => r.bucket === section.key);
            if (items.length === 0) return null;
            return (
              <section key={section.key} className="space-y-3">
                <div className="section-divider">
                  <span
                    className={cn(
                      'inline-flex items-center gap-2 rounded-pill px-3 py-1 text-xs font-bold',
                      TONE_BADGE[section.tone],
                    )}
                  >
                    <Bell className="h-3.5 w-3.5" />
                    {items.length}
                  </span>
                  <span
                    className={cn(
                      'font-display text-[15px] font-bold tracking-tight',
                      TONE_TITLE[section.tone],
                    )}
                  >
                    {section.title}
                  </span>
                </div>
                <Card className="rounded-lg border-[1.5px] border-border bg-card shadow-soft">
                  <CardContent className="p-4 sm:p-5">
                    <ul>
                      {items.map((r, i) => (
                        <li
                          key={r.warrantyId}
                          className={cn(
                            'info-row flex flex-wrap items-center gap-3 py-3',
                            i === 0 && '!border-t-0 pt-0',
                          )}
                        >
                          <Link
                            href={`/devices/${r.deviceId}`}
                            className="flex min-w-0 flex-1 items-center gap-3 hover:opacity-80"
                          >
                            <CategoryIconBadge category={r.category} size="sm" />
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="truncate font-display text-sm font-bold text-ink">
                                  {r.deviceName}
                                </p>
                                <span
                                  className={cn(
                                    'inline-flex items-center rounded-pill px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
                                    WARRANTY_TYPE_TINT[r.warrantyType] ?? 'tint-primary',
                                  )}
                                >
                                  {WARRANTY_TYPE_LABELS[r.warrantyType] ?? r.warrantyType}
                                </span>
                              </div>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {CATEGORY_LABELS[r.category as Category] ?? r.category}
                                {r.warrantyProvider ? ` • ${r.warrantyProvider}` : ''} • Hết{' '}
                                {formatDate(r.endDate)}
                              </p>
                            </div>
                          </Link>
                          <div className="ml-auto flex items-center gap-2">
                            <WarrantyPill warrantyEnd={r.endDate} variant="badge" />
                            <DismissButton warrantyId={r.warrantyId} isDismissed={false} />
                          </div>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
