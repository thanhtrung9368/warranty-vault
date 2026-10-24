'use client';

// Long-form legal copy, moved into a client component so the language switch on
// the public site is instant. It is still rendered to HTML on the server — the
// no-JS view, the crawler view and the first paint are byte-identical to when
// this JSX lived in `page.tsx`. Only the resolution of `t(...)` moved: it now
// reads the active locale from the `InstantI18nProvider` in
// `(public)/layout.tsx` instead of being frozen at request time.
//
// A paragraph is one key, except where the ORIGINAL puts a `<b>` or a `<code>`
// inside it: there the sentence is split at that markup and both halves are
// keys, which keeps the dictionary pure text (a translator should not have to
// place XML) and leaves the emphasis exactly where the Vietnamese had it. Every
// Vietnamese string below is byte-for-byte the original.

import { useT } from '@/lib/i18n/client';

const UPDATED = '05/06/2026';

export function CookiesContent() {
  const t = useT();
  return (
<article className="prose prose-slate max-w-none dark:prose-invert">
  <h1 className="display text-3xl">{t('Chính sách Cookie')}</h1>
  <p className="text-sm text-muted">{t('Cập nhật lần cuối: {date}', { date: UPDATED })}</p>

  <div className="mt-6 space-y-5 text-base leading-relaxed text-ink-2">
    <p>
      {t(
        'Warrly dùng cookie ở mức tối thiểu — chỉ đủ để mày đăng nhập và giữ phiên. Không có cookie quảng cáo hay theo dõi.',
      )}
    </p>

    <div>
      <h3 className="display text-lg">{t('1. Cookie thiết yếu')}</h3>
      <p className="mt-2">
        {t('Bọn tao dùng đúng một cookie cho phiên đăng nhập:')}{' '}
        <code className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-sm">
          wv_session
        </code>
        .{' '}
        {t(
          'Nó được mã hoá, chỉ chứa token phiên và thời hạn — không có thông tin cá nhân đọc được. Tắt cookie này thì không đăng nhập được.',
        )}
      </p>
    </div>

    <div>
      <h3 className="display text-lg">{t('2. Lưu trữ cục bộ trên máy')}</h3>
      <p className="mt-2">
        {t(
          'Một vài tuỳ chọn giao diện (ví dụ chế độ sáng/tối) được lưu trong bộ nhớ cục bộ của trình duyệt (localStorage) trên máy mày, không gửi về máy chủ.',
        )}
      </p>
    </div>

    <div>
      <h3 className="display text-lg">{t('3. Không cookie bên thứ ba')}</h3>
      <p className="mt-2">
        {t(
          'Không Google Analytics, không pixel mạng xã hội, không cookie quảng cáo hay tracking xuyên trang.',
        )}
      </p>
    </div>
  </div>
</article>
  );
}
