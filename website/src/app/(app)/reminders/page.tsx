import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import Link from 'next/link';
import { Bell, BellOff } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { CategoryIconBadge } from '@/components/category-icon';
import { WarrantyPill } from '@/components/warranty-pill';
import { DismissButton } from '@/components/dismiss-button';
import { EmptyState } from '@/components/empty-state';
import { api } from '@/lib/api';
import type { ReminderRow as ApiReminder } from '@/lib/api/reminders';
import { dismissedReminders, type DismissedReminder } from '@/lib/dismissed-reminders';
import { emptyReasonFor } from '@/lib/empty-state';
import { requireUser } from '@/lib/auth';
import {
  type Category,
  type Status,
  type WarrantyType,
} from '@/lib/types';
import { categoryLabel, statusLabel, warrantyTypeLabel } from '@/lib/i18n/labels';
import { getI18n } from '@/lib/i18n/server';
import { formatDate } from '@/lib/format';
import { daysUntil } from '@/lib/api-day';
import { cn } from '@/lib/utils';

export const dynamic = 'force-dynamic';

// Bucket the Go endpoint's already-filtered upcoming-reminders by remaining
// days. The Go endpoint excludes dismissed reminders + expired warranties,
// so this page only renders the three "Sắp hết" sections — the previous
// "Đã hết (gần đây)" section went away with the Go cutover, while the hidden
// ones are rolled up separately into "Đã ẩn" at the bottom.
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

// `title` is the Vietnamese section heading — which is also its dictionary key
// (`src/lib/i18n/messages/warranties.ts`), so it is translated at render time
// rather than here, where there is no locale yet.
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
  // Day-resolution, not a millisecond window: `endDate` is a calendar day and
  // `new Date(day)` is UTC midnight, so a deadline exactly 30 days out could
  // fall into the 60-day bucket west of UTC.
  const days = daysUntil(endDate, now);
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
  const { locale, t } = await getI18n();
  // 90-day horizon matches the previous UI's bucket coverage.
  // The “Đã ẩn” list comes from that same light feed, widened with
  // `includeDismissed=true`, instead of the whole-database export document it
  // used to parse — see `lib/dismissed-reminders.ts`. The plain call is left
  // exactly as it was so the active sections keep their previous behaviour.
  const [res, dismissedRes, devicesRes] = await Promise.all([
    api.reminders.list(90),
    api.reminders.list(90, { includeDismissed: true }),
    // Only to tell the two empty states apart: "nothing is due" is a claim
    // about data the account actually has, and an account with no devices has
    // none. One extra list read, no extra endpoint.
    api.devices.list(),
  ]);
  const now = new Date();
  const active: ReminderItem[] = res.ok ? res.data.map((r) => toItem(r, now)) : [];
  // A failed read falls to `no-data`: the safer lie is "add a device" (which is
  // always actionable) rather than congratulating an account we could not read.
  const hasDevices = devicesRes.ok && devicesRes.data.length > 0;
  const emptyReason = emptyReasonFor(hasDevices);

  let dismissed: DismissedReminder[] = [];
  let dismissedUnavailable = false;
  if (dismissedRes.ok) {
    try {
      dismissed = dismissedReminders(dismissedRes.data);
    } catch {
      // Malformed payload → same “Không tải được” copy as a failed request, so
      // a bad response never renders as “nothing hidden”.
      dismissedUnavailable = true;
    }
  } else {
    dismissedUnavailable = true;
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow={t('Bảo hành sắp hết')}
        title={t('Nhắc nhở')}
        description={t(
          'Gói bảo hành sắp hết hoặc vừa hết. Bấm “Đã xem, ẩn đi” để bỏ qua từng gói — gói đã ẩn luôn xem lại và khôi phục được ở mục “Đã ẩn” bên dưới.',
        )}
      />

      {active.length === 0 ? (
        <EmptyState
          icon={Bell}
          tone="emerald"
          emptyReason={emptyReason}
          // The reassuring sentence is only true when there are devices for it
          // to be about; with none, the component's `no-data` copy takes over.
          title={hasDevices ? t('Không có nhắc nhở nào, ngon!') : undefined}
          description={
            hasDevices ? t('Tất cả gói bảo hành đều an toàn. Mày khỏi lo gì hết.') : undefined
          }
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
                      'font-display text-sm font-bold tracking-tight',
                      TONE_TITLE[section.tone],
                    )}
                  >
                    {t(section.title)}
                  </span>
                </div>
                <Card>
                  <CardContent className="p-card-sm sm:p-card">
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
                                    'inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-bold uppercase tracking-wide',
                                    WARRANTY_TYPE_TINT[r.warrantyType] ?? 'tint-primary',
                                  )}
                                >
                                  {warrantyTypeLabel(r.warrantyType, locale)}
                                </span>
                              </div>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {categoryLabel(r.category, locale)}
                                {r.warrantyProvider ? ` • ${r.warrantyProvider}` : ''} • {t('Hết')}{' '}
                                {formatDate(r.endDate, locale)}
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

      {/* Đã ẩn — xem lại + khôi phục (restore = DELETE /v1/warranties/{id}/reminder) */}
      <section className="space-y-3">
        <div className="section-divider">
          <span className="inline-flex items-center gap-2 rounded-pill px-3 py-1 text-xs font-bold tint-zinc">
            <BellOff className="h-3.5 w-3.5" />
            {dismissedUnavailable ? '?' : dismissed.length}
          </span>
          <span className="font-display text-sm font-bold tracking-tight text-ink-2">
            {t('Đã ẩn')}
          </span>
        </div>
        <Card>
          <CardContent className="p-card-sm sm:p-card">
            {dismissedUnavailable ? (
              <p className="py-3 text-sm text-muted-foreground">
                {t('Không tải được danh sách nhắc nhở đã ẩn — thử tải lại trang nhé.')}
              </p>
            ) : dismissed.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">
                {t(
                  'Chưa ẩn gói bảo hành nào. Gói nào mày bấm “Đã xem, ẩn đi” sẽ nằm ở đây để khôi phục lại.',
                )}
              </p>
            ) : (
              <ul>
                {dismissed.map((r, i) => (
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
                      <CategoryIconBadge category={r.deviceCategory} size="sm" />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-display text-sm font-bold text-ink">
                            {r.deviceName}
                          </p>
                          <span
                            className={cn(
                              'inline-flex items-center rounded-pill px-2 py-0.5 text-xs font-bold uppercase tracking-wide',
                              WARRANTY_TYPE_TINT[r.warrantyType as WarrantyType] ?? 'tint-primary',
                            )}
                          >
                            {warrantyTypeLabel(r.warrantyType as WarrantyType, locale)}
                          </span>
                          {r.deviceStatus !== 'ACTIVE' && (
                            <span className="inline-flex items-center rounded-pill bg-zinc-soft px-2 py-0.5 text-xs font-bold uppercase tracking-wide text-ink-2">
                              {statusLabel(r.deviceStatus as Status, locale)}
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {categoryLabel(r.deviceCategory as Category, locale)}
                          {r.warrantyProvider ? ` • ${r.warrantyProvider}` : ''} • {t('Hết')}{' '}
                          {formatDate(r.endDate, locale)}
                        </p>
                      </div>
                    </Link>
                    <div className="ml-auto flex items-center gap-2">
                      <WarrantyPill warrantyEnd={r.endDate} variant="badge" />
                      <DismissButton warrantyId={r.warrantyId} isDismissed />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>
    </PageShell>
  );
}
