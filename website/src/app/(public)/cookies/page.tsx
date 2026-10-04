import type { Metadata } from 'next';
import { getI18n } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t('Chính sách Cookie — WarrantyVault'),
    description: t('Chính sách sử dụng cookie của WarrantyVault'),
  };
}

const UPDATED = '05/06/2026';

// See the note in `privacy/page.tsx`: one paragraph is one key, split only where
// the original puts inline markup (here: the `wv_session` code chip).
export default async function CookiesPage() {
  const { t } = await getI18n();
  return (
    <article className="prose prose-slate max-w-none dark:prose-invert">
      <h1 className="display text-3xl">{t('Chính sách Cookie')}</h1>
      <p className="text-sm text-muted">{t('Cập nhật lần cuối: {date}', { date: UPDATED })}</p>

      <div className="mt-6 space-y-5 text-[15px] leading-relaxed text-ink-2">
        <p>
          {t(
            'WarrantyVault dùng cookie ở mức tối thiểu — chỉ đủ để mày đăng nhập và giữ phiên. Không có cookie quảng cáo hay theo dõi.',
          )}
        </p>

        <div>
          <h3 className="display text-lg">{t('1. Cookie thiết yếu')}</h3>
          <p className="mt-2">
            {t('Bọn tao dùng đúng một cookie cho phiên đăng nhập:')}{' '}
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px]">
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
