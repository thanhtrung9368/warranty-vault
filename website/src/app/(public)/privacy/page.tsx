import type { Metadata } from 'next';
import { getI18n } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getI18n();
  return {
    title: t('Chính sách bảo mật — Warranty Vault'),
    description: t('Chính sách bảo mật và xử lý dữ liệu của Warranty Vault'),
  };
}

const UPDATED = '05/06/2026';

// Long-form legal copy. A paragraph is one key, except where the ORIGINAL puts a
// `<b>` or a `<code>` inside it: there the sentence is split at that markup and
// both halves are keys, which keeps the dictionary pure text (a translator
// should not have to place XML) and leaves the emphasis exactly where the
// Vietnamese had it. Every Vietnamese string below is byte-for-byte the
// original.
export default async function PrivacyPage() {
  const { t } = await getI18n();
  return (
    <article className="prose prose-slate max-w-none dark:prose-invert">
      <h1 className="display text-3xl">{t('Chính sách bảo mật')}</h1>
      <p className="text-sm text-muted">{t('Cập nhật lần cuối: {date}', { date: UPDATED })}</p>

      <div className="mt-6 space-y-5 text-[15px] leading-relaxed text-ink-2">
        <p>
          {t(
            'Warranty Vault là công cụ cá nhân để theo dõi thiết bị, bảo hành, gói đăng ký và danh sách “thèm”. Trang này mô tả bọn tao thu thập gì, lưu thế nào và chia sẻ với ai. Nguyên tắc gọn lại:',
          )}{' '}
          <b>{t('dữ liệu của mày là của mày')}</b>
          {' — '}
          {t('bọn tao không bán, không quảng cáo, không tracking.')}
        </p>

        <div>
          <h3 className="display text-lg">{t('1. Dữ liệu bọn tao lưu')}</h3>
          <p className="mt-2">
            {t(
              'Email và mật khẩu (lưu dưới dạng băm bcrypt, không bao giờ lưu mật khẩu gốc); các bản ghi mày tự nhập (thiết bị, gói bảo hành, subscription, wishlist); file đính kèm mày tải lên (ảnh hoá đơn / phiếu bảo hành); và token thông báo đẩy của thiết bị nếu mày bật push.',
            )}
          </p>
        </div>

        <div>
          <h3 className="display text-lg">{t('2. Mã hoá & lưu trữ')}</h3>
          <p className="mt-2">
            {t('File đính kèm được mã hoá')} <b>{t('AES-256-GCM')}</b>{' '}
            {t(
              'khi lưu trên máy chủ, mỗi file một khoá riêng (khoá này lại được bọc bởi khoá chủ của hệ thống). Phiên đăng nhập nằm trong một cookie đã mã hoá',
            )}{' '}
            (
            <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-[13px]">
              wv_session
            </code>
            ).{' '}
            {t('Toàn bộ dữ liệu nằm trên cơ sở dữ liệu do bọn tao tự vận hành.')}
          </p>
        </div>

        <div>
          <h3 className="display text-lg">{t('3. Tính năng AI quét hoá đơn (tự chọn bật)')}</h3>
          <p className="mt-2">
            {t('Mặc định tính năng này')} <b>{t('TẮT')}</b>
            {'. '}
            {t('Chỉ khi mày tự bật trong Cài đặt, ảnh hoá đơn mày chọn mới được')}{' '}
            <b>{t('giải mã và gửi tới nhà cung cấp AI bên thứ ba (Anthropic)')}</b>{' '}
            {t(
              'để tự đọc thông tin điền vào form. Kết quả luôn là bản nháp — mày kiểm tra lại rồi mới lưu. Không bật thì ảnh không bao giờ rời máy chủ ở dạng đã giải mã. Mày có thể tắt lại bất cứ lúc nào.',
            )}
          </p>
        </div>

        <div>
          <h3 className="display text-lg">{t('4. Bên thứ ba bọn tao dùng')}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <b>{t('Anthropic')}</b>
              {' — '}
              {t('chỉ khi mày bật AI quét hoá đơn (xem mục 3).')}
            </li>
            <li>
              <b>{t('Resend')}</b>
              {' — '}
              {t('gửi email đặt lại mật khẩu khi mày yêu cầu.')}
            </li>
            <li>
              <b>{t('Apple (APNs), Google (FCM), trình duyệt (Web Push)')}</b>
              {' — '}
              {t('chuyển thông báo nhắc bảo hành tới thiết bị, chỉ khi mày bật push.')}
            </li>
          </ul>
          <p className="mt-2">{t('Ngoài các dịch vụ trên, bọn tao không chia sẻ dữ liệu với ai.')}</p>
        </div>

        <div>
          <h3 className="display text-lg">{t('5. Không quảng cáo, không tracking')}</h3>
          <p className="mt-2">
            {t('Không gắn pixel, không Google Analytics, không Facebook SDK, không cookie quảng cáo.')}
          </p>
        </div>

        <div>
          <h3 className="display text-lg">{t('6. Quyền của mày')}</h3>
          <p className="mt-2">
            {t('Mày có thể')} <b>{t('xuất toàn bộ dữ liệu')}</b>{' '}
            {t('ra file JSON (Cài đặt → Dữ liệu) bất cứ lúc nào, và')}{' '}
            <b>{t('xoá tài khoản')}</b>{' '}
            {t(
              'để xoá vĩnh viễn mọi thiết bị, hoá đơn, ảnh và cài đặt. Thao tác xoá không thể hoàn tác.',
            )}
          </p>
        </div>

        <div>
          <h3 className="display text-lg">{t('7. Liên hệ')}</h3>
          <p className="mt-2">
            {t('Có thắc mắc về dữ liệu:')}{' '}
            <a href="mailto:hi@warrantyvault.app" className="font-semibold text-primary hover:underline">
              hi@warrantyvault.app
            </a>
          </p>
        </div>
      </div>
    </article>
  );
}
