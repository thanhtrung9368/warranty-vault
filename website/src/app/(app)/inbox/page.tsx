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
 */
export default async function InboxPage() {
  await requireUser();
  const { t } = await getI18n();

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
    <div className="space-y-6">
      <div>
        <p className="eyebrow">{t('Hộp thư')}</p>
        <h1 className="display mt-1 text-3xl text-ink md:text-4xl">{t('File chờ gán')}</h1>
        <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground md:text-base">
          {t(
            'Tải hoá đơn lên trước, chọn thiết bị sau. File nằm ở đây cho tới khi bạn gán vào một thiết bị.',
          )}
        </p>
      </div>

      <Card className="rounded-2xl border-[1.5px]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Inbox className="h-5 w-5 text-primary" />
            {t('Tải file lên hộp thư')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <InboxUploader />
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
    </div>
  );
}
