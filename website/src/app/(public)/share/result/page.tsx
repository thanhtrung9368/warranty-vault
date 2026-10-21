import type { Metadata } from 'next';
import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { getI18n } from '@/lib/i18n/server';
import {
  SHARE_FAILURE_MESSAGES,
  parseShareFailureReason,
} from '@/lib/share-target';

// Public on purpose. A share can fail because the session is missing/expired —
// and that is exactly the case where an `(app)` layout's `requireUser()` would
// bounce to /login and destroy the reason. This screen is the honest landing
// for every failure and is readable in both languages without an account.
//
// `reason` is a STABLE CODE, never upstream copy: an unknown/tampered value
// falls back to `failed` (`parseShareFailureReason`), so a crafted link cannot
// put arbitrary text on our domain.

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t('Không nhận được file — Warrly'),
    // A share attempt that failed is not a destination and must not inherit the
    // root layout's `/` canonical or enter an index. The certificate itself is
    // served by Go and already carries `X-Robots-Tag: noindex` (+ `<meta
    // name="robots">`); this is the Next-side failure screen, covered here so
    // neither half of the share flow can be indexed.
    robots: { index: false, follow: false },
    alternates: { canonical: null },
  };
}

export default async function ShareResultPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const { reason } = await searchParams;
  const failure = parseShareFailureReason(reason);
  const { t } = await getI18n();

  return (
    <div className="text-center">
      <div className="mb-4 flex justify-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-full bg-rose-soft text-rose-ink">
          <AlertTriangle className="h-6 w-6" aria-hidden />
        </span>
      </div>

      <p className="eyebrow">{t('Chia sẻ file')}</p>
      <h1 className="display mt-2 text-3xl text-ink">{t('Chưa nhận được file')}</h1>
      <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground md:text-base">
        {t(SHARE_FAILURE_MESSAGES[failure])}
      </p>

      <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
        {failure === 'auth' ? (
          <Button asChild size="lg">
            <Link href="/login">{t('Đăng nhập')}</Link>
          </Button>
        ) : (
          <Button asChild size="lg">
            <Link href="/inbox">{t('Mở hộp thư')}</Link>
          </Button>
        )}
        <Button asChild size="lg" variant="outline">
          <Link href="/">{t('Quay về trang chủ')}</Link>
        </Button>
      </div>

      <p className="mt-8 text-xs leading-relaxed text-muted">
        {t('Muốn thử lại? Mở ứng dụng có file rồi chọn “Chia sẻ” → Warrly.')}
      </p>
    </div>
  );
}
