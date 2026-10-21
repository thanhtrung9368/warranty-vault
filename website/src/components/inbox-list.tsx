'use client';

import * as React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Clock,
  FileText,
  Inbox,
  Loader2,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  deleteAttachment,
  fileAttachment,
  type FileAttachmentState,
} from '@/app/actions/attachments';
import type { InboxDevice, InboxItem } from '@/lib/inbox';
import { deviceIsFull } from '@/lib/inbox';
import { formatDate, formatRelativeDay } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

function fileUrl(id: string): string {
  return `/api/files/${id}`;
}

/**
 * The unfiled attachments, newest first (the server owns the order).
 *
 * Each row keeps its own selected device + error state so a 409 on one file
 * cannot disturb another. On success the row hides immediately and
 * `router.refresh()` re-renders the RSC list + the sidebar badge.
 */
export function InboxList({
  items,
  devices,
}: {
  items: InboxItem[];
  devices: InboxDevice[];
}) {
  const t = useT();

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-lg border-[1.5px] border-dashed border-border-strong bg-card/60 px-6 py-12 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-sky-soft text-sky-ink">
          <Inbox className="h-7 w-7" />
        </span>
        <p className="font-display text-lg font-bold text-ink">{t('Chưa có file nào chờ gán')}</p>
        <p className="max-w-md text-sm text-muted-foreground">
          {t(
            'Khi bạn tải hoá đơn lên mà chưa chọn thiết bị, file sẽ nằm ở đây. Mỗi thiết bị nhận tối đa 5 file.',
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {devices.length === 0 && (
        <p className="rounded-xl border border-amber-ink/20 bg-amber-soft px-4 py-3 text-sm font-semibold text-amber-ink">
          {t('Chưa có thiết bị nào để gán.')}{' '}
          <Link href="/devices/new" className="underline underline-offset-2">
            {t('Thêm thiết bị')}
          </Link>
        </p>
      )}
      <ul className="space-y-3">
        {items.map((item) => (
          <InboxRow key={item.id} item={item} devices={devices} />
        ))}
      </ul>
    </div>
  );
}

function InboxRow({ item, devices }: { item: InboxItem; devices: InboxDevice[] }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const selectRef = React.useRef<HTMLSelectElement>(null);
  const [deviceId, setDeviceId] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [gone, setGone] = React.useState(false);
  const [error, setError] = React.useState<Pick<FileAttachmentState, 'code' | 'message'> | null>(
    null,
  );

  const isImage = item.fileType.startsWith('image/');
  const uploadedDate = `${formatDate(item.uploadedAt, locale)} · ${formatRelativeDay(
    item.uploadedAt,
    locale,
  )}`;

  const file = async () => {
    if (!deviceId) return;
    setPending(true);
    setError(null);
    try {
      const res = await fileAttachment(item.id, deviceId);
      if (!res.ok) {
        setError({
          code: res.code ?? 'GENERIC',
          message: res.message ?? t('Không gán được file vào thiết bị'),
        });
        return;
      }
      setGone(true);
      toast.success(t('Đã gán file vào thiết bị'));
      router.refresh();
    } catch {
      setError({ code: 'GENERIC', message: t('Không gán được file vào thiết bị') });
    } finally {
      setPending(false);
    }
  };

  const remove = async () => {
    if (!confirm(t('Xoá file này khỏi hộp thư?'))) return;
    setDeleting(true);
    try {
      const res = await deleteAttachment(item.id);
      if (!res.ok) {
        toast.error(t('Không xoá được'));
        return;
      }
      setGone(true);
      toast.success(t('Đã xoá file khỏi hộp thư'));
      router.refresh();
    } catch {
      toast.error(t('Không xoá được'));
    } finally {
      setDeleting(false);
    }
  };

  if (gone) return null;

  return (
    <Card asChild padding="none" className="p-card-sm sm:p-card">
      <li>
      <div className="flex gap-3">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-border bg-surface-2">
          {isImage ? (
            <a
              href={fileUrl(item.id)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('Mở file {name}', { name: item.fileName })}
              className="block h-full w-full"
            >
              <Image
                src={fileUrl(item.id)}
                alt={item.description ?? item.fileName}
                width={80}
                height={80}
                unoptimized
                className="h-full w-full object-cover"
              />
            </a>
          ) : (
            <a
              href={fileUrl(item.id)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('Mở file {name}', { name: item.fileName })}
              className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center"
            >
              <FileText className="h-7 w-7 text-primary" />
              <span className="text-xs font-bold text-ink">PDF</span>
            </a>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate font-display text-sm font-bold text-ink" title={item.fileName}>
                {item.fileName}
              </p>
              {item.description && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {item.description}
                </p>
              )}
              <p className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" />
                {t('Tải lên {date}', { date: uploadedDate })}
              </p>
            </div>
            <button
              type="button"
              onClick={remove}
              disabled={deleting || pending}
              aria-label={t('Xoá file')}
              title={t('Xoá file')}
              className="shrink-0 text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
            >
              {deleting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
            </button>
          </div>

          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
            <label className="sr-only" htmlFor={`inbox-device-${item.id}`}>
              {t('Chọn thiết bị')}
            </label>
            <select
              ref={selectRef}
              id={`inbox-device-${item.id}`}
              value={deviceId}
              onChange={(event) => {
                setDeviceId(event.target.value);
                setError(null);
              }}
              disabled={pending || deleting || devices.length === 0}
              className="h-9 min-w-0 flex-1 rounded-md border-[1.5px] border-border bg-card px-2.5 text-sm text-ink focus-visible:border-primary focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <option value="">{t('Chọn thiết bị')}</option>
              {devices.map((device) => (
                <option key={device.id} value={device.id}>
                  {deviceIsFull(device)
                    ? `${device.name} · ${t('đã đủ 5 file')}`
                    : device.name}
                </option>
              ))}
            </select>
            <Button
              type="button"
              size="sm"
              onClick={file}
              disabled={!deviceId || pending || deleting}
              className="shrink-0 rounded-pill"
            >
              {pending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {pending ? t('Đang gán…') : t('Gán vào thiết bị')}
            </Button>
          </div>

          {error && (
            <div
              role="alert"
              className={cn(
                'mt-2 rounded-xl border px-3 py-2 text-xs',
                error.code === 'LIMIT_REACHED'
                  ? 'border-rose-ink/20 bg-rose-soft text-rose-ink'
                  : 'border-amber-ink/20 bg-amber-soft text-amber-ink',
              )}
            >
              <p className="flex items-start gap-1.5 font-semibold">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>{error.message}</span>
              </p>
              <div className="mt-2 flex flex-wrap gap-2 pl-5">
                {error.code === 'LIMIT_REACHED' && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setError(null);
                      selectRef.current?.focus();
                    }}
                    className="rounded-pill"
                  >
                    {t('Chọn thiết bị khác')}
                  </Button>
                )}
                {error.code === 'NOT_FOUND' && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => router.refresh()}
                    className="rounded-pill"
                  >
                    {t('Tải lại')}
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={remove}
                  disabled={deleting}
                  className="rounded-pill"
                >
                  {deleting ? (
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  )}
                  {t('Xoá file')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
    </Card>
  );
}
