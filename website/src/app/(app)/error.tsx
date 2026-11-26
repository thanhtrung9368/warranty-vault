'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { PageShell } from '@/components/page-shell';
import { useT } from '@/lib/i18n/client';

/**
 * The in-shell error boundary for every signed-in page.
 *
 * Pages like the device detail (`app/(app)/devices/[id]/page.tsx`) deliberately
 * throw when their read fails for any reason other than 404 — a 500 is not
 * "this device does not exist", and rendering the not-found page for it would
 * hide an outage. Without this file the throw escaped to the root, so the user
 * lost the shell (sidebar, top bar) and got no retry affordance at all. This
 * boundary renders INSIDE `(app)/layout.tsx`, which keeps the shell mounted, and
 * offers the two things a failed render can actually do: retry the segment
 * (`reset()`) or leave for a page whose list read is handled with a banner.
 *
 * It is a client component because React error boundaries cannot be server
 * components; the copy still goes through `useT()`, so it follows the same
 * language as the page it replaced.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useT();

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <PageShell>
      <Card padding="none" className="px-6 py-12 text-center md:px-10">
        <span className="icon-badge icon-badge-sm tint-rose">
          <AlertTriangle className="h-5 w-5" />
        </span>
        <h1 className="display mt-4 text-2xl text-ink md:text-3xl">
          {t('Không tải được trang này')}
        </h1>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          {t(
            'Đã có lỗi khi tải dữ liệu. Thử lại — hoặc về danh sách thiết bị nếu vẫn lỗi.',
          )}
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button size="lg" onClick={reset}>
            <RefreshCw className="mr-1 h-4 w-4" />
            {t('Thử lại')}
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/devices">{t('Về danh sách thiết bị')}</Link>
          </Button>
        </div>
      </Card>
    </PageShell>
  );
}
