import { PageHeader } from '@/components/page-header';
import { PageShell } from '@/components/page-shell';
import { Inbox } from 'lucide-react';
import { InboxUploader } from '@/components/inbox-uploader';
import { InboxList } from '@/components/inbox-list';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import { inboxCount, type InboxDevice } from '@/lib/inbox';
import { getI18n } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

/**
 * The capture-first inbox: attachments with no device yet.
 *
 * This page is the ONE obvious place to drop a receipt precisely because it
 * asks nothing else: no device, no warranty, no purchase date. The nav item
 * carries the waiting count, so the user can see there is something to file
 * without opening the page first.
 *
 * The device picker needs every device row, not just the ones with spare
 * slots: the contract makes the server the quota authority (409
 * `LIMIT_REACHED`), and the 409 itself is the screen's most important state.
 * Full devices are labelled in the picker but stay selectable on purpose.
 *
 * `?shared=1` is set by the Web Share Target route's success redirect
 * (`app/share-target/route.ts`). It only drives the confirmation banner; the
 * new row itself comes from `GET /v1/inbox` on this force-dynamic render.
 */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ shared?: string }>;
}) {
  await requireUser();
  const { t } = await getI18n();
  const sp = await searchParams;
  const justShared = sp.shared === '1';

  const [inboxRes, devicesRes] = await Promise.all([
    api.inbox.getInbox(),
    api.devices.list({ sort: 'name', dir: 'asc' }),
  ]);

  const items = inboxRes.ok ? inboxRes.data : [];
  const devices: InboxDevice[] = devicesRes.ok
    ? devicesRes.data.map((device) => ({
        id: device.id,
        name: device.name,
        attachmentCount: device.attachmentCount,
      }))
    : [];
  const waiting = inboxCount(items);

  return (
    <PageShell>
      <PageHeader
        eyebrow={t('Hộp thư')}
        title={t('File chờ gán')}
        description={t(
          'Tải hoá đơn lên trước, chọn thiết bị sau. File nằm ở đây cho tới khi bạn gán vào một thiết bị.',
        )}
      />

      {justShared && (
        <p
          role="status"
          className="rounded-xl border border-emerald-ink/20 bg-emerald-soft px-4 py-3 text-sm font-semibold text-emerald-ink"
        >
          {t('Đã nhận file từ chia sẻ. File đang chờ gán thiết bị.')}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Inbox className="h-5 w-5 text-primary" />
            {t('Tải file lên hộp thư')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <InboxUploader />
          {/* The share sheet is the only OS-level entry point, and only
              Chromium implements `share_target`. Saying so here is honest
              without hiding the uploader from anyone: this box works in every
              browser. */}
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t(
              'Trên Android, trình duyệt Chromium (Chrome, Edge, Samsung Internet) cho phép chia sẻ ảnh hoặc PDF thẳng vào hộp thư này sau khi cài Warrly. Safari và Firefox không hỗ trợ.',
            )}
          </p>
        </CardContent>
      </Card>

      {!inboxRes.ok && (
        <p
          role="alert"
          className="rounded-xl border border-rose-ink/20 bg-rose-soft px-4 py-3 text-sm font-semibold text-rose-ink"
        >
          {t('Không tải được hộp thư — thử tải lại trang nhé.')}
        </p>
      )}

      <section className="space-y-3">
        <h2 className="font-display text-lg font-bold text-ink">
          {t('{count} file đang chờ gán thiết bị.', { count: waiting })}
        </h2>
        <InboxList items={items} devices={devices} />
      </section>
    </PageShell>
  );
}
