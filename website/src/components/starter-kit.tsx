import Link from 'next/link';
import {
  CheckCircle2,
  Circle,
  ClipboardPaste,
  ListPlus,
  Receipt,
  ShieldCheck,
} from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { AddSampleDataButton } from '@/components/sample-data-buttons';
import type { DeviceListItem } from '@/lib/api/devices';
import { getI18n } from '@/lib/i18n/server';
import { SAMPLE_DEVICE_COUNT } from '@/lib/starter-kit';

// The first-run starter kit for an EMPTY vault.
//
// Why this replaces the old single-CTA panel: an account with nothing saved is
// not "covered" and not "fine" — it has nothing for the app to reason about. The
// previous dashboard rendered zero tiles and one green tick; this card says
// "here is the loop, in four steps" and gives three ways into it (create,
// import the list you already keep, or look at sample data first).
//
// The steps are real, checkable states, not a tour:
//   * device      — the account owns at least one device row;
//   * warranty    — at least one device has a warranty end date (the thing the
//                   reminders are actually about);
//   * subscription— at least one subscription row exists;
//   * reminder    — a push target is registered, i.e. the reminder can reach
//                   this account. It is the only step whose state is not in the
//                   device/subscription lists, so the page reads `GET /v1/push`
//                   once and only while this card is on screen.
//
// Nothing here writes anything except the sample-data button, which goes
// through the ordinary bulk endpoint. No modal, no tour, no new design system:
// the card is the same `Card` / `Button` / `Progress` the rest of the dashboard
// uses.

export async function StarterKit({
  devices,
  subscriptions,
  reminderReady,
}: {
  devices: readonly DeviceListItem[];
  subscriptions: number;
  /** A push target is registered for this account (`GET /v1/push` non-empty). */
  reminderReady: boolean;
}) {
  const { t } = await getI18n();
  // The card is only mounted for a vault with no devices, but the steps are
  // derived rather than hard-coded so the component tells the truth if it is
  // ever rendered after the first save.
  const deviceDone = devices.length > 0;
  const warrantyDone = devices.some(
    (device) => device.effectiveWarrantyEnd !== null,
  );
  const subscriptionDone = subscriptions > 0;
  const reminderDone = reminderReady;

  const firstMissingWarranty = devices.find(
    (device) => device.effectiveWarrantyEnd === null,
  );

  const steps = [
    {
      key: 'device',
      done: deviceDone,
      title: 'Thêm thiết bị đầu tiên',
      description: 'Tên, loại và ngày mua — mất khoảng 30 giây.',
      href: '/devices/new',
    },
    {
      key: 'warranty',
      done: warrantyDone,
      title: 'Ghi ngày hết bảo hành',
      description: 'Bước 3 của form thiết bị. Đây là ngày Warrly canh giúp bạn.',
      href: firstMissingWarranty
        ? `/devices/${firstMissingWarranty.id}/edit`
        : '/devices/new',
    },
    {
      key: 'subscription',
      done: subscriptionDone,
      title: 'Thêm gói đăng ký',
      description: 'Netflix, iCloud, phần mềm... để không quên ngày gia hạn.',
      href: '/subscriptions/new',
    },
    {
      key: 'reminder',
      done: reminderDone,
      title: 'Bật nhắc nhở',
      description: 'Nhắc trước 30 và 7 ngày qua thông báo trình duyệt.',
      href: '/settings',
    },
  ] as const;

  const doneCount = steps.filter((step) => step.done).length;
  const total: number = steps.length;

  return (
    <Card padding="md" tone="gradient">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-full bg-card text-primary sm:flex">
            <ShieldCheck className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h2 className="display text-2xl text-ink md:text-3xl">
              {t('Bắt đầu với một thiết bị')}
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-ink-2 md:text-base">
              {t(
                'Thêm thiết bị kèm ngày hết bảo hành — Warrly nhắc bạn trước 30 và 7 ngày và giữ hoá đơn ở cùng một chỗ.',
              )}
            </p>
          </div>
        </div>
        <div className="w-full sm:w-56">
          <div className="flex items-center justify-between gap-3 text-xs font-semibold text-ink-2">
            <span>{t('Bắt đầu trong 4 bước')}</span>
            <span className="tabular-nums">
              {t('{done}/{total} bước', { done: doneCount, total })}
            </span>
          </div>
          <Progress
            value={total === 0 ? 0 : (doneCount / total) * 100}
            className="mt-2 bg-card/70"
            aria-label={t('Bắt đầu trong 4 bước')}
          />
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1.15fr_1fr]">
        {/* The checklist. An unchecked step is a link; a checked one is text —
            clicking a finished step has nothing useful to do. */}
        <ol className="space-y-3">
          {steps.map((step) => (
            <li key={step.key} className="flex items-start gap-3">
              {step.done ? (
                <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-ink" />
              ) : (
                <Circle className="mt-0.5 h-5 w-5 shrink-0 text-ink-2/50" />
              )}
              <div className="min-w-0">
                {step.done ? (
                  <p className="font-display text-sm font-bold text-ink-2">
                    {t(step.title)}
                  </p>
                ) : (
                  <Link
                    href={step.href}
                    className="font-display text-sm font-bold text-ink underline underline-offset-2 hover:text-primary-ink"
                  >
                    {t(step.title)}
                  </Link>
                )}
                <p className="mt-0.5 text-xs text-ink-2/80">{t(step.description)}</p>
              </div>
            </li>
          ))}
        </ol>

        {/* Two alternatives to typing: look at sample data first, or import a
            list the user already keeps. Both use existing screens/endpoints. */}
        <div className="space-y-3">
          <div className="rounded-lg border-[1.5px] border-border bg-card/70 p-card-sm">
            <h3 className="font-display text-sm font-bold text-ink">
              {t('Dùng thử bằng dữ liệu mẫu')}
            </h3>
            <p className="mt-1 text-xs text-ink-2/85">
              {t(
                'Thêm {count} thiết bị mẫu kèm bảo hành để xem bảng tổng quan trông thế nào. Xoá lại bất cứ lúc nào.',
                { count: SAMPLE_DEVICE_COUNT },
              )}
            </p>
            <AddSampleDataButton className="mt-3 rounded-pill" />
          </div>

          <div className="rounded-lg border-[1.5px] border-border bg-card/70 p-card-sm">
            <h3 className="font-display text-sm font-bold text-ink">
              {t('Có sẵn bảng tính?')}
            </h3>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button asChild variant="outline" size="sm" className="rounded-pill bg-card">
                <Link href="/devices/import">
                  <ClipboardPaste className="mr-1 h-3.5 w-3.5" />
                  {t('Dán bảng')}
                </Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="rounded-pill bg-card">
                <Link href="/devices/bulk">
                  <ListPlus className="mr-1 h-3.5 w-3.5" />
                  {t('Thêm hàng loạt')}
                </Link>
              </Button>
              <Button asChild variant="ghost" size="sm" className="rounded-pill">
                <Link href="/inbox">
                  <Receipt className="mr-1 h-3.5 w-3.5" />
                  {t('Tôi đã có hoá đơn')}
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
}
