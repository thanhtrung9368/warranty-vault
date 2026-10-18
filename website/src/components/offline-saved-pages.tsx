'use client';

// The honest half of "you can read this offline": list the pages the service
// worker actually has, with the time each was saved. Rendered inside the
// `/offline` page.
//
// It reads Cache Storage directly instead of asking the service worker over
// postMessage: the page may be shown by a worker that is still activating, and
// Cache Storage is the same origin-visible store either way. Links are plain
// `<a>` elements on purpose — a Next `<Link>` would try an RSC fetch that must
// fail offline.

import { useEffect, useState } from 'react';
import { useLocale, useT } from '@/lib/i18n/client';
import {
  listOfflinePages,
  type OfflinePageEntry,
} from '@/lib/offline/cache-client';

function formatSavedAt(timestamp: number, locale: string): string {
  const language = locale === 'vi' ? 'vi-VN' : 'en-US';
  try {
    return new Intl.DateTimeFormat(language, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(timestamp));
  } catch {
    return new Date(timestamp).toISOString().slice(0, 16).replace('T', ' ');
  }
}

export function OfflineSavedPages() {
  const t = useT();
  const locale = useLocale();
  const [pages, setPages] = useState<OfflinePageEntry[] | null>(null);

  useEffect(() => {
    let active = true;
    listOfflinePages()
      .then((entries) => {
        if (active) setPages(entries);
      })
      .catch(() => {
        if (active) setPages([]);
      });
    return () => {
      active = false;
    };
  }, []);

  if (pages === null) return null;

  return (
    <section className="rounded-md border-[1.5px] border-border bg-card p-4 text-left">
      <h2 className="text-sm font-bold text-ink">
        {t('Trang đã lưu để xem ngoại tuyến')}
      </h2>
      {pages.length === 0 ? (
        <p className="mt-1.5 text-sm text-muted">
          {t(
            'Chưa có trang nào được lưu. Khi còn mạng, mở một thiết bị hoặc trang tổng quan rồi quay lại đây.',
          )}
        </p>
      ) : (
        <ul className="mt-2.5 space-y-1">
          {pages.map((page) => (
            <li key={page.url}>
              <a
                href={page.url}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded-md px-1.5 py-1.5 text-sm hover:bg-surface-2"
              >
                <span className="font-semibold text-primary hover:underline">
                  {page.title}
                </span>
                {page.cachedAt !== null && (
                  <span className="text-xs text-muted">
                    {t('Đã lưu lúc {time}', {
                      time: formatSavedAt(page.cachedAt, locale),
                    })}
                  </span>
                )}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
