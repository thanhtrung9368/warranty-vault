import Link from 'next/link';
import { ArrowRight, ClipboardList } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { CategoryIconBadge } from '@/components/category-icon';
import { getI18n } from '@/lib/i18n/server';
import {
  FIXUP_GAPS,
  FIXUP_GAP_LABEL_KEYS,
  fixupHref,
  type DeviceFixupSummary,
} from '@/lib/device-fixup';

// The fix-up step, rendered on the dashboard once there is at least one saved
// row. It exists because the starter kit's promise — "Warrly will remind you
// before the warranty lapses" — is only true when the row actually has the
// dates/price/receipt it needs. A row saved with just a name looks complete in
// every list and silently never produces a reminder.
//
// The card reports, counts and links; it never guesses. No derived purchase
// date, no estimated warranty end, no invented price — the fix is always the
// user's own next edit. Rows that are missing nothing never appear, and a
// payload field that was not sent is treated as unknown rather than missing
// (see `lib/device-fixup.ts`).

/** At most this many rows are listed; the rest are summarised by count. */
const ROW_LIMIT = 4;

export async function DeviceFixupPanel({ summary }: { summary: DeviceFixupSummary }) {
  const { t } = await getI18n();
  if (summary.rows.length === 0) return null;

  const visible = summary.rows.slice(0, ROW_LIMIT);
  const hidden = summary.rows.length - visible.length;
  const chips = FIXUP_GAPS.filter((gap) => summary.counts[gap] > 0);

  return (
    <Card padding="md">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-soft text-sky-ink">
          <ClipboardList className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg font-bold tracking-tight text-ink">
              {t('Hoàn tất hồ sơ thiết bị')}
            </h2>
            <span className="inline-flex items-center rounded-pill bg-surface-2 px-2.5 py-0.5 text-xs font-bold text-ink-2">
              {t('{count} thiết bị', { count: summary.rows.length })}
            </span>
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t(
              'Một vài dòng còn thiếu thông tin. Bổ sung để nhắc nhở và báo cáo chi phí đúng.',
            )}
          </p>

          {/* Per-gap counts: each one is the number of ROWS with that gap, so
              the numbers can overlap (one row can miss two fields). */}
          <div className="mt-3 flex flex-wrap gap-2">
            {chips.map((gap) => (
              <span
                key={gap}
                className="inline-flex items-center gap-1.5 rounded-pill bg-surface-2 px-3 py-1 text-xs font-semibold text-ink-2"
              >
                {t('Thiếu {fields}', { fields: t(FIXUP_GAP_LABEL_KEYS[gap]) })}
                <span className="rounded-pill bg-card px-1.5 text-xs font-bold tabular-nums text-ink">
                  {summary.counts[gap]}
                </span>
              </span>
            ))}
          </div>

          <ul className="mt-3 space-y-1.5">
            {visible.map(({ device, gaps }) => {
              const primaryHref = fixupHref(device.id, gaps);
              const receiptHref = `/devices/${device.id}#attachments`;
              // A row missing both an editable field and its receipt gets two
              // targets: the form for the dates/price, and the attachment
              // section for the receipt (the edit wizard has no uploader).
              const showReceiptLink =
                gaps.includes('receipt') && primaryHref !== receiptHref;
              return (
                <li key={device.id}>
                  <div className="flex flex-wrap items-center gap-2 rounded-md px-1 py-1.5 text-sm transition-colors hover:bg-surface-2">
                    <CategoryIconBadge category={device.category} size="sm" />
                    <Link
                      href={primaryHref}
                      className="min-w-0 truncate font-semibold text-ink underline-offset-2 hover:underline"
                    >
                      {device.name}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {gaps.map((gap) => t(FIXUP_GAP_LABEL_KEYS[gap])).join(' · ')}
                    </span>
                    <span className="ml-auto flex items-center gap-3">
                      {showReceiptLink && (
                        <Link
                          href={receiptHref}
                          className="text-xs font-semibold text-primary-text underline underline-offset-2 hover:text-primary-ink"
                        >
                          {t('Thêm hoá đơn')}
                        </Link>
                      )}
                      <Link
                        href={primaryHref}
                        aria-label={t('Bổ sung')}
                        className="text-muted-foreground transition-colors hover:text-primary-ink"
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs font-semibold">
            {hidden > 0 && (
              <span className="text-muted-foreground">
                {t('và {count} thiết bị khác', { count: hidden })}
              </span>
            )}
            <Link
              href="/devices"
              className="text-primary-text underline underline-offset-2 hover:text-primary-ink"
            >
              {t('Xem danh sách thiết bị')}
            </Link>
          </div>
        </div>
      </div>
    </Card>
  );
}
