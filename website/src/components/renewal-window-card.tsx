import type { ReactNode } from 'react';
import { CalendarClock, Info } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { LogPaymentDialog } from '@/components/subscription-actions';
import { formatVND } from '@/lib/format';
import { daysUntil, formatDay } from '@/lib/api-day';
import type { RenewalWindow } from '@/lib/api/subscriptions';
import { getI18n } from '@/lib/i18n/server';

// "Sau dùng thử" — the card that exists because the money already left.
//
// FEATURE_RESEARCH_2026-11 §6.6: the trial reminder shipped, but the two weeks
// AFTER the conversion were silent. This is copy plus one derived object — no new
// endpoint, no new column. The server sends `RenewalWindow` only while a trial
// converted in the last 14 days, so the caller renders this component or nothing
// (never a placeholder).
//
// The rules this component holds, in order of how badly they would hurt:
//
//   * **No refund promise.** The store sentences (`consentCopy` / `refundCopy`)
//     are the server's, shown verbatim, and Apple's row deliberately has
//     `refundWindowHours: null`. Never reformat one into a deadline.
//   * **No external purchase link.** There is no "buy again" / "manage purchase"
//     call to action here. The two links inside step 3 point at the stores'
//     POLICY pages (the sources the table was verified against), not a checkout.
//   * **"~2 ngày" is a calendar-day count**, via `daysUntil` on the `windowEndsAt`
//     day. A day count must never be a subtraction of instants — that is what
//     made a trial end a day early west of UTC.
//   * **A recorded amount is not an expected amount.** `amountRecognisedVnd` is a
//     `SubscriptionPayment` the user (or the cron) logged; `expectedAmountVnd` is
//     `convertsToPrice` and is never labelled as money taken.
//
// `LogPaymentDialog` is the EXISTING payment sheet; the only change it needed was
// a label override, so "Ghi nhận khoản đã trừ" opens that sheet instead of a
// second form.

export async function RenewalWindowCard({
  renewalWindow,
  subId,
  defaultAmount,
}: {
  renewalWindow: RenewalWindow;
  subId: string;
  defaultAmount: number;
}) {
  const { t, locale } = await getI18n();
  const convertedOn = formatDay(renewalWindow.convertedOn, locale);
  const recognised = renewalWindow.amountRecognisedVnd;
  const recognisedOn =
    renewalWindow.recognisedPaidOn != null
      ? formatDay(renewalWindow.recognisedPaidOn, locale)
      : null;
  // CALENDAR DAYS, never hours: `windowEndsAt` is a `YYYY-MM-DD` day, so
  // `daysUntil` counts days between two day components. This is an RSC, so the
  // clock is the web host's — the same clock and the same rule the page already
  // uses for `renewalDaysLeft`; what must never happen is subtracting instants,
  // which made a trial read one day short west of UTC.
  const daysLeft = daysUntil(renewalWindow.windowEndsAt);
  const daysLabel =
    Number.isFinite(daysLeft) && daysLeft > 0
      ? t('~{days} ngày nữa', { days: daysLeft, count: daysLeft })
      : t('Ngày cuối của cửa sổ');

  const steps: { title: string; body: ReactNode }[] = [
    {
      title: t('Kiểm tra khoản vừa bị trừ'),
      body: (
        <p>
          {t(
            'Xem ngày chuyển đổi và khoản đã ghi nhận ở trên. Nếu cửa hàng đã trừ tiền mà app chưa có, bấm "Ghi nhận khoản đã trừ" để lưu vào lịch sử thanh toán.',
          )}
        </p>
      ),
    },
    {
      title: t('Mở phần quản lý đăng ký của cửa hàng'),
      body: (
        <p>
          {t(
            'App Store hoặc Google Play cho bạn thấy gói đang ở giá nào và lần trừ kế tiếp là khi nào. App không mở được tài khoản cửa hàng của bạn.',
          )}
        </p>
      ),
    },
    {
      title: t('Biết quyền của mình theo quy tắc cửa hàng'),
      body: (
        <ul className="mt-1 space-y-2">
          <li className="text-muted-foreground">
            {t('Quy tắc áp dụng tuỳ nơi bạn mua gói — app không lưu nơi mua.')}
          </li>
          {renewalWindow.storeRules.map((rule) => (
            <li key={rule.store} className="rounded-lg border border-border bg-surface-2 p-2.5">
              <p className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-semibold text-ink-2">{rule.name}</span>
                <span className="text-xs text-muted-foreground">
                  {t('đã kiểm tra {date}', {
                    date: formatDay(rule.checkedOn, locale),
                  })}
                </span>
              </p>
              {/* Server-rendered sentences, verbatim: they are built from the
                  same numbers the API returns, so a local rewrite could only
                  make them disagree or over-promise. */}
              <p className="mt-1">{rule.consentCopy}</p>
              <p className="mt-1">{rule.refundCopy}</p>
              <p className="mt-1 flex flex-wrap gap-x-3 text-xs">
                <a
                  className="text-primary underline underline-offset-2"
                  href={rule.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('Nguồn')}
                </a>
                <a
                  className="text-primary underline underline-offset-2"
                  href={rule.refundSourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {t('Chính sách hoàn tiền')}
                </a>
              </p>
            </li>
          ))}
        </ul>
      ),
    },
    {
      title: t('Dừng bị trừ tiếp thì huỷ ở cửa hàng'),
      body: (
        <p>
          {t(
            'Huỷ gói trong phần quản lý đăng ký của cửa hàng trước ngày gia hạn kế tiếp. App không tự huỷ gói và không gửi yêu cầu hoàn tiền thay bạn.',
          )}
        </p>
      ),
    },
    {
      title: t('App chỉ ghi lại những gì bạn nhập'),
      body: (
        <p>
          {t(
            'App không trừ tiền và không đọc được giao dịch của cửa hàng, nên không hứa hạn hoàn tiền: hạn mức là của cửa hàng, xem câu ở bước 3.',
          )}
        </p>
      ),
    },
  ];

  return (
    <Card padding="md" tone="primary">
      <div className="flex items-start gap-3">
        <span className="icon-badge icon-badge-sm bg-primary/15 text-primary">
          <CalendarClock className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-display text-lg font-bold text-ink">{t('Sau dùng thử')}</h3>
          <p className="mt-0.5 text-sm text-ink-2">
            {t('Dùng thử đã chuyển sang trả phí ngày {date}.', { date: convertedOn })}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card/70 p-3">
          <p className="eyebrow">{t('Ngày chuyển đổi')}</p>
          <p className="display mt-1 text-lg text-ink">{convertedOn}</p>
        </div>
        <div className="rounded-xl border border-border bg-card/70 p-3">
          <p className="eyebrow">{t('Đã ghi nhận')}</p>
          {recognised != null ? (
            <>
              <p className="display mt-1 text-lg tabular-nums text-ink">
                {formatVND(recognised, locale)}
              </p>
              {recognisedOn && (
                <p className="text-xs text-muted-foreground">
                  {t('ngày {date}', { date: recognisedOn })}
                </p>
              )}
            </>
          ) : (
            <>
              <p className="mt-1 text-sm font-semibold text-ink-2">
                {t('Chưa ghi nhận khoản nào')}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {t('Nếu cửa hàng đã trừ, bấm nút bên dưới để lưu vào lịch sử thanh toán.')}
              </p>
            </>
          )}
          {renewalWindow.expectedAmountVnd != null && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t('Giá sau dùng thử: {amount}', {
                amount: formatVND(renewalWindow.expectedAmountVnd, locale),
              })}
            </p>
          )}
        </div>
        <div className="rounded-xl border border-border bg-card/70 p-3">
          <p className="eyebrow">{t('Còn lại')}</p>
          <p className="display mt-1 text-lg text-ink">{daysLabel}</p>
          <p className="text-xs text-muted-foreground">{t('Đếm theo ngày lịch.')}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        {/* The existing log-payment sheet, with a label that says what the
            button actually does. No second form lives here. */}
        <LogPaymentDialog
          subId={subId}
          defaultAmount={recognised ?? defaultAmount}
          label={t('Ghi nhận khoản đã trừ')}
        />
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t('Cửa sổ 14 ngày này chỉ để xem lại, không phải hạn chót nào.')}</span>
        </p>
      </div>

      <details className="mt-4 rounded-xl border-[1.5px] border-dashed border-border px-3.5 py-3">
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-muted-foreground">
          {t('Hướng dẫn sau khi bị trừ tiền ({count} bước)', { count: steps.length })}
        </summary>
        <ol className="mt-2 space-y-3 text-xs text-muted-foreground">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-2">
              <span className="font-display font-bold text-ink-2">{index + 1}.</span>
              <div className="min-w-0">
                <p className="font-semibold text-ink-2">{step.title}</p>
                <div className="mt-0.5">{step.body}</div>
              </div>
            </li>
          ))}
        </ol>
      </details>
    </Card>
  );
}
