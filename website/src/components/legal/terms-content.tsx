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

const UPDATED = '21/10/2026';

export function TermsContent() {
  const t = useT();
  return (
<article className="prose prose-slate max-w-none dark:prose-invert">
  <h1 className="display text-3xl">{t('Điều khoản sử dụng')}</h1>
  <p className="text-sm text-muted">{t('Cập nhật lần cuối: {date}', { date: UPDATED })}</p>

  <div className="mt-6 space-y-5 text-base leading-relaxed text-ink-2">
    <p>
      {t(
        'Dùng Warrly tức là mày đồng ý với các điều khoản dưới đây. Bọn tao cố giữ chúng ngắn và dễ hiểu.',
      )}
    </p>

    <div>
      <h3 id="purpose" className="display scroll-mt-24 text-lg">
        {t('1. Dịch vụ & mục đích cá nhân')}
      </h3>
      <p className="mt-2">
        {t(
          'Warrly là công cụ cá nhân để quản lý thiết bị, bảo hành, gói đăng ký và wishlist của chính mày. Đừng dùng để lưu trữ dữ liệu của người khác khi chưa được họ cho phép.',
        )}
      </p>
    </div>

    <div>
      <h3 className="display text-lg">{t('2. Tài khoản & bảo mật')}</h3>
      <p className="mt-2">
        {t(
          'Mày chịu trách nhiệm giữ mật khẩu an toàn và mọi hoạt động dưới tài khoản của mình. Báo cho bọn tao ngay nếu nghi ngờ tài khoản bị truy cập trái phép.',
        )}
      </p>
    </div>

    <div>
      <h3 className="display text-lg">{t('3. Nội dung của mày')}</h3>
      <p className="mt-2">
        {t(
          'Mày sở hữu dữ liệu mình nhập và tải lên. Mày tự đảm bảo nội dung đó hợp pháp và mày có quyền lưu trữ nó. Bọn tao không yêu cầu quyền sở hữu nội dung của mày.',
        )}
      </p>
    </div>

    <div>
      <h3 id="usage-limits" className="display scroll-mt-24 text-lg">
        {t('4. Giới hạn sử dụng')}
      </h3>
      <p className="mt-2">
        {t(
          'Để hệ thống chạy ổn cho mọi người, mỗi tài khoản có giới hạn: 50 thiết bị đang dùng (500 dòng kể cả máy đã bán), 5 gói bảo hành và 5 tệp mỗi thiết bị, 5 MB mỗi tệp, 100 MB tổng dung lượng tệp, 100 gói đăng ký và 200 món wishlist. Khi chạm giới hạn, ứng dụng báo rõ trong ngôn ngữ bạn đang dùng.',
        )}
      </p>
    </div>

    <div>
      <h3 id="no-warranty" className="display scroll-mt-24 text-lg">
        {t('5. Không bảo đảm')}
      </h3>
      <p className="mt-2">
        {t(
          'Dịch vụ được cung cấp “nguyên trạng” (as-is). Bọn tao cố gắng giữ dữ liệu an toàn và nhắc nhở đúng hạn, nhưng không bảo đảm dịch vụ không gián đoạn hay không có lỗi. Hãy tự sao lưu dữ liệu quan trọng (Cài đặt → Sao lưu & khôi phục).',
        )}
      </p>
    </div>

    <div>
      <h3 id="termination" className="display scroll-mt-24 text-lg">
        {t('6. Chấm dứt')}
      </h3>
      <p className="mt-2">
        {t(
          'Mày có thể xoá tài khoản bất cứ lúc nào trong phần Cài đặt — toàn bộ dữ liệu sẽ bị xoá vĩnh viễn. Bọn tao có thể tạm ngưng tài khoản nếu phát hiện hành vi lạm dụng hệ thống.',
        )}
      </p>
    </div>

    <div>
      <h3 className="display text-lg">{t('7. Liên hệ')}</h3>
      <p className="mt-2">
        {t('Có thắc mắc:')}{' '}
        <a href="mailto:hi@warrly.com" className="font-semibold text-primary hover:underline">
          hi@warrly.com
        </a>
      </p>
    </div>
  </div>
</article>
  );
}
