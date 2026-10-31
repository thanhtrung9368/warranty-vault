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
// place XML) and leaves the emphasis exactly where the Vietnamese had it.
//
// STRUCTURE. Section 5 is new and is modelled on the subscription clause of the
// owner's shipped app (Stavely), but it describes a tier that does NOT exist
// yet. That is the whole constraint: the paid tier has no price, no billing
// interval, no trial and no launch date, and inventing any of the four would be
// a false statement in a contract. So the section states the commitments that
// WILL apply when it goes on sale — auto-renewal, cancellation at least 24 h
// before the period ends, billing and cancellation through the App Store / Play,
// price shown in-app before purchase, ads removed — and says explicitly which
// facts are absent and why. If a future launch adds a price, this is the file
// that has to change.
//
// `#usage-limits` stays §4 because the landing page links to it and prints the
// number. The subscription section was inserted after it, and every later
// section shifted down by one; none of them is linked by number.
//
// The controller's name is a constant for the same reason as in
// `privacy-content.tsx`: it is identical in both languages, and the i18n tests
// reject an English column that still contains Vietnamese characters.

import { useT } from '@/lib/i18n/client';

const UPDATED = '27/10/2026';
const LEGAL_NAME = 'Lê Thành Trung';
const PRIVACY_EMAIL = 'privacy@warrly.com';
const SUPPORT_EMAIL = 'support@warrly.com';

export function TermsContent() {
  const t = useT();
  const mailClass = 'font-semibold text-primary hover:underline';
  return (
<article className="prose prose-slate max-w-none dark:prose-invert">
  <h1 className="display text-3xl">{t('Điều khoản sử dụng')}</h1>
  <p className="text-sm text-muted">{t('Cập nhật lần cuối: {date}', { date: UPDATED })}</p>
  <p className="mt-2 text-sm text-muted">
    {t('Khi có khác biệt về diễn giải, ưu tiên bản tiếng Việt cho người dùng tại Việt Nam.')}
  </p>

  <div className="mt-6 space-y-5 text-base leading-relaxed text-ink-2">
    <p>
      {t('Warrly do một cá nhân tại Việt Nam cung cấp —')} <b>{LEGAL_NAME}</b>{' '}
      {t(
        '— và không phải công ty. Điều khoản này cũng là thoả thuận cấp phép người dùng cuối (EULA) giữa mày và Warrly.',
      )}
    </p>
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
      <p className="mt-2">
        {t(
          'Warrly cấp cho mày quyền dùng cá nhân, không độc quyền, không chuyển nhượng. Mày không được dịch ngược, gỡ rối hay can thiệp mã nguồn; không cào dữ liệu hàng loạt; và không dùng Warrly để vi phạm pháp luật.',
        )}
      </p>
    </div>

    <div>
      <h3 id="accounts" className="display scroll-mt-24 text-lg">
        {t('2. Tài khoản & bảo mật')}
      </h3>
      <p className="mt-2">
        {t(
          'Mày chịu trách nhiệm giữ mật khẩu an toàn và mọi hoạt động dưới tài khoản của mình. Báo cho bọn tao ngay nếu nghi ngờ tài khoản bị truy cập trái phép.',
        )}
      </p>
    </div>

    <div>
      <h3 id="your-content" className="display scroll-mt-24 text-lg">
        {t('3. Nội dung của mày')}
      </h3>
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
          'Để hệ thống chạy ổn cho mọi người, mỗi tài khoản có giới hạn: 50 thiết bị đang dùng (500 dòng kể cả máy đã bán), 5 gói bảo hành và 5 tệp mỗi thiết bị, 5 MB mỗi tệp, 100 MB tổng dung lượng tệp, 100 gói đăng ký và 200 món wishlist. Gói miễn phí có quảng cáo. Gói trả phí, khi mở bán, sẽ nâng các giới hạn này và tắt quảng cáo trên tài khoản trả phí. Khi chạm giới hạn, ứng dụng báo rõ trong ngôn ngữ bạn đang dùng.',
        )}
      </p>
    </div>

    <div>
      <h3 id="subscription" className="display scroll-mt-24 text-lg">
        {t('5. Gói trả phí — chưa mở bán')}
      </h3>
      <p className="mt-2">
        {t(
          'Gói trả phí của Warrly chưa mở bán. Hiện không có giá, không có ngày ra mắt, và mày không thể mua nó ở đâu cả. Mục này nói trước những gì sẽ áp dụng khi nó mở bán — không phải những gì đang chạy hôm nay.',
        )}
      </p>
      <p className="mt-2">{t('Khi mở bán, gói trả phí sẽ:')}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          <b>{t('Tự động gia hạn:')}</b>{' '}
          {t(
            'gói tự gia hạn cho tới khi mày tắt tự động gia hạn, và phải tắt xong ít nhất 24 giờ trước khi kỳ hiện tại kết thúc.',
          )}
        </li>
        <li>
          <b>{t('Do cửa hàng thu tiền:')}</b>{' '}
          {t(
            'mua qua App Store (iOS) hoặc Google Play (Android), trừ vào tài khoản cửa hàng của mày. Warrly không nhận, không lưu và không xử lý thông tin thanh toán.',
          )}
        </li>
        <li>
          <b>{t('Huỷ trong cửa hàng:')}</b>{' '}
          {t(
            'huỷ trong phần quản lý gói đăng ký của App Store hoặc Google Play; huỷ có hiệu lực từ kỳ kế tiếp, và mày dùng tiếp đến hết kỳ đã trả tiền.',
          )}
        </li>
        <li>
          <b>{t('Giá hiện trước khi mua:')}</b>{' '}
          {t(
            'giá và độ dài kỳ hiện trong ứng dụng trước khi mày xác nhận, theo tiền tệ tài khoản cửa hàng của mày.',
          )}
        </li>
        <li>
          <b>{t('Bỏ quảng cáo:')}</b>{' '}
          {t('gói trả phí tắt quảng cáo và nâng các giới hạn ở mục 4.')}
        </li>
      </ul>
      <p className="mt-2">
        {t(
          'Mục này không nêu giá, không nêu độ dài kỳ và không nêu bản dùng thử, vì chưa có cái nào được chốt. Khi có, chúng sẽ hiện trong ứng dụng trước khi mua — Warrly không bán một gói mà mày chưa thấy giá.',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Hoàn tiền: giao dịch trong ứng dụng do Apple và Google xử lý theo chính sách của họ; Warrly không tự hoàn tiền, nhưng trả lời email support@warrly.com nếu mày gặp trục trặc.',
        )}
      </p>
      <p className="mt-2">{t('Điều khoản này là EULA áp dụng cho gói trả phí.')}</p>
    </div>

    <div>
      <h3 id="no-warranty" className="display scroll-mt-24 text-lg">
        {t('6. Không bảo đảm')}
      </h3>
      <p className="mt-2">
        {t(
          'Dịch vụ được cung cấp “nguyên trạng” (as-is). Bọn tao cố gắng giữ dữ liệu an toàn và nhắc nhở đúng hạn, nhưng không bảo đảm dịch vụ không gián đoạn hay không có lỗi. Hãy tự sao lưu dữ liệu quan trọng (Cài đặt → Sao lưu & khôi phục).',
        )}
      </p>
    </div>

    <div>
      <h3 id="termination" className="display scroll-mt-24 text-lg">
        {t('7. Chấm dứt')}
      </h3>
      <p className="mt-2">
        {t(
          'Mày có thể xoá tài khoản bất cứ lúc nào trong phần Cài đặt — toàn bộ dữ liệu sẽ bị xoá vĩnh viễn. Bọn tao có thể tạm ngưng tài khoản nếu phát hiện hành vi lạm dụng hệ thống.',
        )}
      </p>
    </div>

    <div>
      <h3 id="changes" className="display scroll-mt-24 text-lg">
        {t('8. Thay đổi điều khoản')}
      </h3>
      <p className="mt-2">
        {t(
          'Warrly có thể cập nhật điều khoản này; bản mới ghi ngày “Cập nhật lần cuối” ở đầu trang. Dùng Warrly tiếp sau ngày đó là chấp nhận bản mới. Nếu thay đổi quan trọng, Warrly sẽ nói rõ thay đổi gì.',
        )}
      </p>
    </div>

    <div>
      <h3 id="governing-law" className="display scroll-mt-24 text-lg">
        {t('9. Luật áp dụng')}
      </h3>
      <p className="mt-2">
        {t(
          'Điều khoản này theo pháp luật Việt Nam, và tranh chấp được giải quyết tại cơ quan có thẩm quyền ở Việt Nam. Nếu mày là người tiêu dùng ở nước khác, mày vẫn giữ các quyền bắt buộc mà luật nước mày dành cho mày.',
        )}
      </p>
    </div>

    <div>
      <h3 id="contact" className="display scroll-mt-24 text-lg">
        {t('10. Liên hệ')}
      </h3>
      <p className="mt-2">
        {t('Có thắc mắc:')}{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className={mailClass}>
          {SUPPORT_EMAIL}
        </a>
      </p>
      <p className="mt-2">
        {t('Quyền riêng tư:')}{' '}
        <a href={`mailto:${PRIVACY_EMAIL}`} className={mailClass}>
          {PRIVACY_EMAIL}
        </a>
      </p>
      <p className="mt-2">
        <b>{t('Người cung cấp')}:</b> {LEGAL_NAME}
        {', '}
        {t('cá nhân, Việt Nam.')}
      </p>
    </div>
  </div>
</article>
  );
}
