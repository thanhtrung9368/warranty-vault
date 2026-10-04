import Link from 'next/link';
import {
  AlarmClock,
  ArrowRight,
  Copy,
  Info,
  SearchCheck,
  ShieldQuestion,
  TrendingUp,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { SubscriptionAudit, SubscriptionAuditFinding } from '@/lib/api/subscriptions';
import type { Translator } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';
import { getI18n } from '@/lib/i18n/server';
import {
  findingCount,
  findingSubjects,
  findingTag,
  findingTone,
  thresholdLines,
  type AuditTone,
} from '@/lib/subscription-audit';
import { formatDate, formatVND } from '@/lib/format';
import { cn } from '@/lib/utils';

// "Soát gói đăng ký" — the advisory panel on /subscriptions (openapi
// `SubscriptionAudit`).
//
// Three rules govern this component, and they are the point of the feature:
//
//  1. NO USAGE CLAIM. The app has no telemetry and cannot read a bank statement,
//     so a finding is never "bạn không dùng gói này". `title`, `detail` and
//     `note` come from Go, where that wording is pinned; this component adds only
//     factual labels derived from machine codes (threshold, reason, material).
//     The one date that could be misread as "last used" is labelled as a
//     recorded-payment date, which is what the server can actually vouch for.
//  2. NO ACTION. `advisory` is always true and the endpoint has no write path —
//     so there is no cancel / disable-auto-renew / "dọn gói này" button here.
//     Turning a finding into a change stays a user click on the subscription's
//     own page. Links are navigation only.
//  3. SHOW THE RULE. Every verdict is accompanied by the thresholds the server
//     applied (`thresholdLines`), so a flag is never an unexplained badge.
//
// `audit === null` means the read failed — rendered as an explicit "không tải
// được" line rather than an empty panel, which would read as "nothing found".

const TONE_TAG: Record<AuditTone, string> = {
  rose: 'tint-rose',
  amber: 'tint-amber',
  zinc: 'tint-zinc',
};

const KIND_ICON: Record<string, typeof Info> = {
  QUIET_AUTO_RENEW: AlarmClock,
  PRICE_INCREASED: TrendingUp,
  DUPLICATE: Copy,
};

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="inline-flex items-baseline gap-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-semibold tabular-nums text-ink-2">{value}</span>
    </span>
  );
}

function FindingRow({
  finding,
  t,
  locale,
}: {
  finding: SubscriptionAuditFinding;
  t: Translator;
  locale: Locale;
}) {
  const tone = findingTone(finding);
  const tag = findingTag(finding, locale);
  const subjects = findingSubjects(finding);
  const Icon = KIND_ICON[finding.kind] ?? ShieldQuestion;

  return (
    <li className="rounded-xl border-[1.5px] border-border bg-surface-2 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn('icon-badge icon-badge-sm', TONE_TAG[tone])}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        {tag && (
          <span
            className={cn(
              'inline-flex items-center rounded-pill px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide',
              TONE_TAG[tone],
            )}
          >
            {tag}
          </span>
        )}
        <p className="font-display text-sm font-bold text-ink">{finding.title}</p>
      </div>

      <p className="mt-1.5 text-xs text-muted-foreground">{finding.detail}</p>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
        {/* QUIET_AUTO_RENEW — money already taken automatically. */}
        {finding.kind === 'QUIET_AUTO_RENEW' && (
          <>
            <Metric
              label={t('Máy đã tự trừ:')}
              value={`${t('{count} lần', { count: finding.chargeCount })} · ${formatVND(finding.chargedTotalVnd, locale)}`}
            />
            {finding.monthlyVnd > 0 && (
              <Metric
                label="~"
                value={t('{amount}/tháng', {
                  amount: formatVND(finding.monthlyVnd, locale),
                })}
              />
            )}
            {finding.lastRecordedAt && (
              <span className="inline-flex flex-wrap items-baseline gap-1">
                <span className="text-muted-foreground">{t('Khoản ghi nhận mới nhất:')}</span>
                <span className="font-semibold text-ink-2">
                  {formatDate(finding.lastRecordedAt, locale)}
                </span>
                <span className="text-muted-foreground">
                  {t('(ngày ghi nhận thanh toán — không phải ngày dùng cuối)')}
                </span>
              </span>
            )}
            {finding.nextRenewalAt && (
              <Metric
                label={t('Lần trừ tới:')}
                value={
                  finding.daysUntilRenewal != null
                    ? t('{date} · còn {days} ngày', {
                        date: formatDate(finding.nextRenewalAt, locale),
                        days: finding.daysUntilRenewal,
                        count: finding.daysUntilRenewal,
                      })
                    : formatDate(finding.nextRenewalAt, locale)
                }
              />
            )}
          </>
        )}

        {/* PRICE_INCREASED — the two consecutive payments that produced the verdict. */}
        {finding.kind === 'PRICE_INCREASED' && (
          <>
            {finding.previousAmountVnd != null && finding.amountVnd != null && (
              <Metric
                label={t('Giá:')}
                value={`${formatVND(finding.previousAmountVnd, locale)} → ${formatVND(finding.amountVnd, locale)}`}
              />
            )}
            {finding.increaseVnd != null && (
              <Metric
                label={t('Tăng:')}
                value={
                  finding.increasePercent != null
                    ? `${formatVND(finding.increaseVnd, locale)} (+${finding.increasePercent}%)`
                    : formatVND(finding.increaseVnd, locale)
                }
              />
            )}
            {finding.monthlyVnd > 0 && (
              <Metric
                label="~"
                value={t('{amount}/tháng', {
                  amount: formatVND(finding.monthlyVnd, locale),
                })}
              />
            )}
            {finding.lastRecordedAt && (
              <Metric
                label={t('Kỳ ghi nhận:')}
                value={formatDate(finding.lastRecordedAt, locale)}
              />
            )}
          </>
        )}

        {/* DUPLICATE — the combined monthly equivalent of both packages. */}
        {finding.kind === 'DUPLICATE' && finding.monthlyVnd > 0 && (
          <Metric
            label={t('Cộng lại:')}
            value={t('{amount}/tháng', { amount: formatVND(finding.monthlyVnd, locale) })}
          />
        )}
      </div>

      {subjects.length > 0 && (
        <div className="mt-2.5 flex flex-wrap gap-2">
          {subjects.map((s) => (
            <Link
              key={s.id}
              href={s.href}
              className="inline-flex items-center gap-1 rounded-pill border-[1.5px] border-border bg-card px-2.5 py-1 text-[11px] font-semibold text-ink-2 transition-colors hover:border-border-strong hover:text-ink"
            >
              {s.name}
              <ArrowRight className="h-3 w-3" />
            </Link>
          ))}
        </div>
      )}
    </li>
  );
}

export async function SubscriptionAuditPanel({ audit }: { audit: SubscriptionAudit | null }) {
  // A Server Component (the panel has no interactivity of its own), so the
  // locale comes from `getI18n()` rather than `useLocale()` — the brief's
  // `useLocale()` would require turning this into a Client Component and
  // shipping the whole threshold table to the browser for nothing.
  const { locale, t } = await getI18n();

  if (!audit) {
    return (
      <Card className="rounded-2xl border-[1.5px]">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <SearchCheck className="h-5 w-5 text-primary" />
            {t('Soát gói đăng ký')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {t('Không tải được phần soát gói đăng ký — thử tải lại trang nhé. Danh sách gói bên dưới vẫn là dữ liệu thật.')}
          </p>
        </CardContent>
      </Card>
    );
  }

  const total = findingCount(audit);
  const findings = audit.findings ?? [];

  return (
    <Card className="rounded-2xl border-[1.5px]">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="flex items-center gap-2 text-base">
          <SearchCheck className="h-5 w-5 text-primary" />
          {t('Soát gói đăng ký')}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {/* `advisory` is a payload field, not an assumption: the panel only
              promises "no automatic changes" when the server says so. */}
          {audit.advisory && (
            <span className="inline-flex items-center rounded-pill px-2.5 py-1 text-[11px] font-semibold tint-emerald">
              {t('Chỉ tư vấn — không tự sửa hay huỷ gì')}
            </span>
          )}
          <span
            className={cn(
              'inline-flex items-center rounded-pill px-2.5 py-1 text-[11px] font-semibold',
              total > 0 ? 'tint-amber' : 'tint-zinc',
            )}
          >
            {total > 0
              ? t('{total} phát hiện', { total, count: total })
              : t('Không có phát hiện nào')}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* The server's own limits, verbatim — it names what the analysis cannot
            know (bank transactions, whether a package is in use). */}
        <div className="flex items-start gap-3 rounded-xl border-[1.5px] border-border bg-surface-2 p-3.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm text-ink-2">{audit.note}</p>
            <p className="text-xs text-muted-foreground">
              {t('Soát từ lịch sử thanh toán bạn đã ghi, tính tới {date}.', {
                date: formatDate(audit.generatedAt, locale),
              })}
            </p>
          </div>
        </div>

        {findings.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {t('Không có phát hiện nào từ dữ liệu bạn đã ghi. Các luật bên dưới vẫn được chạy lại mỗi lần bạn mở trang này.')}
          </p>
        ) : (
          <ul className="space-y-2.5">
            {findings.map((f) => (
              <FindingRow key={f.findingKey} finding={f} t={t} locale={locale} />
            ))}
          </ul>
        )}

        {/* Why each verdict exists: the thresholds the server actually applied,
            read out of the payload instead of hard-coded here. */}
        <details className="rounded-xl border-[1.5px] border-dashed border-border px-3.5 py-3">
          <summary className="cursor-pointer text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {t('Luật đang áp dụng')}
          </summary>
          <ul className="mt-2 space-y-1.5 text-xs text-muted-foreground">
            {thresholdLines(audit.thresholds, locale).map((line) => (
              <li key={line} className="flex gap-2">
                <span aria-hidden>•</span>
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </details>
      </CardContent>
    </Card>
  );
}
