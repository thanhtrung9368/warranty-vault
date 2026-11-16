import type { Metadata } from 'next';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Calendar,
  FileText,
  Hash,
  Info,
  ShieldCheck,
  UserRound,
  Wrench,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { HandoffClaim } from '@/components/handoff-claim';
import { api } from '@/lib/api';
import type { PublicHandoff, PublicHandoffWarranty } from '@/lib/api/handoff';
import { getCurrentUser } from '@/lib/auth';
import { claimStatusLabel } from '@/lib/claims';
import { formatDate } from '@/lib/format';
import {
  HANDOFF_IS_DATA_ONLY,
  HANDOFF_PUBLIC_NOT_VERIFIED,
  handoffExpiryLabel,
  handoffFailureBody,
  handoffFailureTitle,
  handoffFileSizeLabel,
  handoffRemainingLabel,
  normalizeHandoffCode,
  publicHandoffIsOpen,
  type HandoffFailureReason,
} from '@/lib/handoff';
import { categoryLabel, warrantyTypeLabel } from '@/lib/i18n/labels';
import { getI18n } from '@/lib/i18n/server';
import { withNext } from '@/lib/next-path';
import type { WarrantyType } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t('Nhận thiết bị — Warrly'),
    description: t(
      'Mở lời mời chuyển chủ thiết bị trên Warrly. App chỉ chuyển dữ liệu, không phải giấy tờ pháp lý.',
    ),
  };
}

/**
 * Public resale-handoff claim page (Warrly 2.0).
 *
 * The server's public preview is the ONLY source of device facts here. It is a
 * deliberate projection: no userId, email, price, notes or full serial. This
 * page must never read `/devices/{id}` (owner-gated) and redact it client-side;
 * anything not on `PublicHandoff` simply does not exist to the buyer.
 *
 * Failure honesty: unknown / expired / claimed / cancelled are ONE state. The
 * server answers them with the same 404 on purpose, so this page says "mã không
 * còn hiệu lực" and never guesses which one it was. Only a signed-in claim POST
 * can name 403/409/410 — and that naming happens in the client component.
 */
export default async function HandoffClaimPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: rawCode } = await params;
  const code = normalizeHandoffCode(rawCode);
  const { locale, t } = await getI18n();
  const user = await getCurrentUser();

  if (!code) {
    return <FailureState reason="unavailable" signedIn={Boolean(user)} />;
  }

  const res = await api.handoff.preview(code);
  if (!res.ok) {
    // 404 is uniform by contract. 410 is mapped to the same state so this page
    // cannot become the oracle the server refuses to be. 429 and transport
    // failures get their own, actionable copy.
    const reason: HandoffFailureReason =
      res.status === 429
        ? 'rate_limited'
        : res.status === 0 || res.status >= 500
          ? 'error'
          : 'unavailable';
    return <FailureState reason={reason} signedIn={Boolean(user)} code={code} />;
  }

  const handoff = res.data;
  if (!publicHandoffIsOpen(handoff)) {
    return <FailureState reason="unavailable" signedIn={Boolean(user)} />;
  }

  const device = handoff.device;
  const category = categoryLabel(device.category, locale);
  const sellerName = handoff.sellerName?.trim() ?? '';

  return (
    <article className="space-y-6">
      <header className="space-y-3">
        <p className="eyebrow flex items-center gap-1.5">
          <ArrowRight className="h-3.5 w-3.5" />
          {t('Chuyển chủ thiết bị')}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="display text-3xl text-ink sm:text-4xl">
            {t('Nhận thiết bị từ người bán')}
          </h1>
          <Badge variant="amber">{t('Đang chờ người nhận')}</Badge>
        </div>
        <p className="text-sm leading-relaxed text-muted-foreground md:text-base">
          {t(
            'Người bán đã gửi hồ sơ thiết bị qua Warrly. Đăng nhập để nhận một bản sao trong tài khoản của bạn.',
          )}
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Info className="h-5 w-5 text-primary" />
            {t('Thông tin thiết bị')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <div>
            <p className="font-display text-xl font-bold text-ink">{device.name}</p>
            <p className="text-sm text-muted-foreground">
              {[category, device.brand, device.model].filter(Boolean).join(' • ')}
            </p>
          </div>

          {sellerName && (
            <div className="rounded-xl border-[1.5px] border-border bg-surface-2 p-3">
              <p className="flex items-center gap-2 text-sm font-semibold text-ink">
                <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                {t('Người bán: {name}', { name: sellerName })}
              </p>
              <p className="mt-1 pl-6 text-xs text-muted-foreground">
                {t('Tên do người bán tự nhập, Warrly không xác minh danh tính.')}
              </p>
            </div>
          )}

          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('Ngày mua')}
              </dt>
              <dd className="mt-0.5 flex items-center gap-1.5 text-sm text-ink">
                <Calendar className="h-4 w-4 shrink-0 text-muted-foreground" />
                {formatDate(device.purchaseDate, locale)}
              </dd>
            </div>
            {device.serialMasked && (
              <div>
                <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('Serial (đã che một phần)')}
                </dt>
                <dd className="mt-0.5 flex items-center gap-1.5 font-mono text-sm text-ink">
                  <Hash className="h-4 w-4 shrink-0 text-muted-foreground" />
                  {device.serialMasked}
                </dd>
              </div>
            )}
          </dl>

          <WarrantySection warranties={handoff.warranties} />

          <section aria-labelledby="handoff-documents">
            <p
              id="handoff-documents"
              className="flex items-center gap-2 text-sm font-semibold text-ink"
            >
              <FileText className="h-4 w-4 text-muted-foreground" />
              {t('Tài liệu kèm theo')}
            </p>
            {handoff.attachments.length === 0 ? (
              <p className="mt-1 pl-6 text-sm text-muted-foreground">
                {t('Không có tài liệu nào được gửi kèm.')}
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5 pl-6">
                {handoff.attachments.map((attachment, index) => {
                  const size = handoffFileSizeLabel(attachment.sizeBytes, locale);
                  return (
                    <li
                      key={`${attachment.fileName}-${index}`}
                      className="flex flex-wrap items-baseline gap-x-2 text-sm text-ink-2"
                    >
                      <span className="break-all">{attachment.fileName}</span>
                      {size && (
                        <span className="text-xs text-muted-foreground">{size}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-1 pl-6 text-xs text-muted-foreground">
              {t(
                'Chỉ tên tài liệu hiện ở đây; bản xem được chuyển vào tài khoản của bạn sau khi nhận.',
              )}
            </p>
          </section>

          {handoff.claims.length > 0 && (
            <section aria-labelledby="handoff-claims">
              <p
                id="handoff-claims"
                className="flex items-center gap-2 text-sm font-semibold text-ink"
              >
                <Wrench className="h-4 w-4 text-muted-foreground" />
                {t('Lịch sử sửa chữa')}
              </p>
              <p className="mt-1 pl-6 text-xs text-muted-foreground">
                {t('Đã ghi {count} lần đi bảo hành/sửa chữa.', {
                  count: handoff.claims.length,
                })}
              </p>
              <ul className="mt-2 space-y-1.5 pl-6">
                {handoff.claims.map((claim, index) => {
                  // The projection's exact keys are the server's choice, so each
                  // fact is rendered only when present. A missing field must
                  // shorten the line, not print a stray separator.
                  const parts = [
                    claim.status ? claimStatusLabel(claim.status, locale) : '',
                    claim.openedAt
                      ? t('Sửa ngày {date}', {
                          date: formatDate(claim.openedAt, locale),
                        })
                      : '',
                    claim.closedAt
                      ? t('Xong ngày {date}', {
                          date: formatDate(claim.closedAt, locale),
                        })
                      : '',
                  ].filter(Boolean);
                  return (
                    <li
                      key={`${claim.openedAt ?? 'claim'}-${index}`}
                      className="text-sm text-ink-2"
                    >
                      {parts.join(' • ')}
                    </li>
                  );
                })}
              </ul>
            </section>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3 rounded-2xl border-[1.5px] border-border bg-surface-2 p-5">
        <p className="flex items-start gap-2 text-xs leading-relaxed text-ink-2">
          <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-ink" />
          <span>{t(HANDOFF_IS_DATA_ONLY)}</span>
        </p>
        <p className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{t(HANDOFF_PUBLIC_NOT_VERIFIED)}</span>
        </p>
      </div>

      <section className="space-y-3">
        <p className="text-sm text-ink-2">
          {handoffExpiryLabel(handoff.expiresAt, locale)}
          {handoffRemainingLabel(handoff.expiresAt, locale)
            ? ` • ${handoffRemainingLabel(handoff.expiresAt, locale)}`
            : ''}
        </p>
        {user ? (
          <HandoffClaim code={code} />
        ) : (
          <div className="space-y-3 rounded-2xl border-[1.5px] border-border bg-card p-5">
            <p className="text-sm leading-relaxed text-ink-2">
              {t(
                'Thiết bị và các tài liệu đã chọn sẽ được sao vào tài khoản bạn. Người bán giữ một bản đã bán và không còn xem được thiết bị này. Mã chỉ dùng được một lần.',
              )}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild size="lg" className="rounded-pill">
                <Link href={withNext('/login', `/handoff/${code}`)}>
                  {t('Đăng nhập để nhận')}
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="rounded-pill">
                <Link href={withNext('/register', `/handoff/${code}`)}>
                  {t('Chưa có tài khoản? Đăng ký')}
                </Link>
              </Button>
            </div>
          </div>
        )}
      </section>
    </article>
  );
}

async function WarrantySection({
  warranties,
}: {
  warranties: PublicHandoffWarranty[];
}) {
  const { locale, t } = await getI18n();
  return (
    <section aria-labelledby="handoff-warranties">
      <p
        id="handoff-warranties"
        className="flex items-center gap-2 text-sm font-semibold text-ink"
      >
        <ShieldCheck className="h-4 w-4 text-emerald-ink" />
        {t('Bảo hành còn lại')}
      </p>
      {warranties.length === 0 ? (
        <p className="mt-1 pl-6 text-sm text-muted-foreground">
          {t('Chưa có gói bảo hành nào.')}
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5 pl-6">
          {warranties.map((warranty, index) => (
            <li key={`${warranty.type}-${warranty.endDate ?? ''}-${index}`} className="text-sm text-ink-2">
              <span className="font-medium">
                {warrantyTypeLabel(warranty.type as WarrantyType, locale)}
              </span>
              {warranty.provider ? ` • ${warranty.provider}` : ''}
              <span className="block text-xs text-muted-foreground">
                {warranty.endDate
                  ? t('Hết hạn {date}', {
                      date: formatDate(warranty.endDate, locale),
                    })
                  : t('Chưa ghi ngày kết thúc')}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The ONE failure state for unknown / expired / claimed / cancelled codes,
 * plus the two actionable ones (rate limited, transport error). The title and
 * body come from `lib/handoff.ts` so the client claim error panel and this page
 * cannot drift.
 */
async function FailureState({
  reason,
  signedIn,
  code,
}: {
  reason: HandoffFailureReason;
  signedIn: boolean;
  code?: string;
}) {
  const { locale, t } = await getI18n();
  return (
    <div className="rounded-2xl border-[1.5px] border-border bg-card p-6 text-center sm:p-8">
      <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-soft text-amber-ink">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </span>
      <p className="eyebrow">{t('Chuyển chủ thiết bị')}</p>
      <h1 className="display mt-2 text-2xl text-ink sm:text-3xl">
        {handoffFailureTitle(reason, locale)}
      </h1>
      <p className="mx-auto mt-3 max-w-lg text-sm leading-relaxed text-muted-foreground">
        {handoffFailureBody(reason, locale)}
      </p>

      <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
        {(reason === 'rate_limited' || reason === 'error') && code && (
          <Button asChild className="rounded-pill">
            <Link href={`/handoff/${code}`}>{t('Thử lại')}</Link>
          </Button>
        )}
        {reason === 'unavailable' && signedIn && (
          <Button asChild className="rounded-pill">
            <Link href="/devices">{t('Danh sách thiết bị')}</Link>
          </Button>
        )}
        <Button asChild variant="outline" className="rounded-pill">
          <Link href="/">{t('Quay về trang chủ')}</Link>
        </Button>
      </div>

      {reason === 'unavailable' && signedIn && (
        <p className="mx-auto mt-4 max-w-lg text-xs text-muted-foreground">
          {t('Nếu bạn vừa nhận thiết bị, mở danh sách thiết bị để xem.')}
        </p>
      )}
    </div>
  );
}
