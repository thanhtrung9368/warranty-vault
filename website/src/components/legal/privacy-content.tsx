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
// STRUCTURE. The document was restructured against the owner's shipped app
// (Stavely, approved on both stores) for coverage, not wording: identity of the
// controller first, then what is stored, then advertising, rights, third
// parties, legal basis, California, and only then the sections Vietnamese law
// adds — retention, cross-border transfer, children, international users,
// changes, contact. Section numbers are load-bearing: the landing page and the
// FAQ print them in link text ("Chính sách bảo mật, mục 5") and link to
// `#encryption`, `#ads`, `#rights`. Advertising therefore stays §5 and rights
// stay §6. The old §2 (encryption) is now §3 because identity took §1; those
// two cross-references were updated in the same change.
//
// The controller's name is a CONSTANT, not a translation key. It is identical
// in both languages, and `i18n.test.ts` fails any English column that still
// contains Vietnamese characters — a legal name with diacritics would fail that
// check while being exactly right. Same reason the email addresses are rendered
// as links instead of being baked into a sentence: they are data, not copy.
//
// There is deliberately NO postal address and no placeholder for one. GDPR
// Art 13(1)(a) requires the identity and contact details of the controller, not
// a street address; CCPA requires a privacy contact; Google Play requires the
// developer address in its own console, not here. The owner is a private
// individual, so publishing one would be a privacy cost with no legal gain.

import { useT } from '@/lib/i18n/client';
import { LegalDocument } from './legal-document';
import type { LegalSection } from './legal-toc';

const UPDATED = '27/10/2026';
const LEGAL_NAME = 'Lê Thành Trung';
const PRIVACY_EMAIL = 'privacy@warrly.com';
const SUPPORT_EMAIL = 'support@warrly.com';

/** The document's own headings, in render order, for the contents rail. */
const SECTIONS: LegalSection[] = [
  { id: 'who', key: '1. Chúng tôi là ai' },
  { id: 'data', key: '2. Dữ liệu bọn tao lưu' },
  { id: 'encryption', key: '3. Mã hoá & lưu trữ' },
  { id: 'ai', key: '4. Trợ lý AI (tự chọn bật)' },
  { id: 'ads', key: '5. Quảng cáo (Google AdMob)' },
  { id: 'rights', key: '6. Quyền của mày' },
  { id: 'third-parties', key: '7. Bên thứ ba & chia sẻ dữ liệu' },
  { id: 'legal-basis', key: '8. Cơ sở pháp lý & sự đồng ý' },
  { id: 'ccpa', key: '9. Người dùng California (CCPA/CPRA)' },
  { id: 'retention', key: '10. Lưu trữ trong bao lâu' },
  { id: 'transfers', key: '11. Chuyển dữ liệu ra nước ngoài' },
  { id: 'children', key: '12. Trẻ em' },
  { id: 'international', key: '13. Người dùng quốc tế' },
  { id: 'changes', key: '14. Thay đổi' },
  { id: 'contact', key: '15. Liên hệ' },
];

export function PrivacyContent() {
  const t = useT();
  const mailClass = 'font-semibold text-ink underline decoration-primary underline-offset-4 hover:decoration-2';
  return (
<LegalDocument
  titleKey="Chính sách bảo mật"
  updated={UPDATED}
  noteKey="Với người dùng tại Việt Nam, bản tiếng Việt là bản có giá trị pháp lý."
  sections={SECTIONS}
>
    <p>
      {t(
        'Warrly là công cụ cá nhân để theo dõi thiết bị, bảo hành, gói đăng ký và danh sách “thèm”. Trang này mô tả bọn tao thu thập gì, lưu thế nào và chia sẻ với ai. Nguyên tắc gọn lại:',
      )}{' '}
      <b>{t('dữ liệu của mày là của mày')}</b>
      {' — '}
      {t('bọn tao không bán dữ liệu của mày. Gói miễn phí có quảng cáo; gói trả phí thì không.')}
    </p>

    <div>
      <h2 id="who" className="display scroll-mt-28 border-t border-border pt-6 text-xl leading-[1.3] text-ink md:text-2xl">
        {t('1. Chúng tôi là ai')}
      </h2>
      <p className="mt-2">
        {t('Warrly do một cá nhân tại Việt Nam cung cấp —')} <b>{LEGAL_NAME}</b>{' '}
        {t(
          '— và không phải công ty. Trong chính sách này, “Warrly” và “bọn tao” là cá nhân đó.',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Đây cũng là đầu mối xử lý dữ liệu cá nhân theo Nghị định 13/2023/NĐ-CP và Luật Bảo vệ dữ liệu cá nhân (Luật 91/2025/QH15, hiệu lực từ 01/01/2026). Warrly không có nhân viên nên không có DPO riêng: chính người đó là đầu mối.',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Warrly được vận hành từ Việt Nam và phục vụ người dùng ở nhiều nước. Luật Việt Nam áp dụng cho toàn bộ hoạt động xử lý, bất kể người dùng ở đâu; luật địa phương của người dùng vẫn áp dụng thêm cho họ.',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Vai trò của Warrly: bên kiểm soát dữ liệu tài khoản (email, thiết bị, bảo hành, hoá đơn, wishlist), và bên xử lý đối với dữ liệu vận hành do hạ tầng bên thứ ba sinh ra khi chạy dịch vụ. Với dữ liệu quảng cáo, Google là bên kiểm soát độc lập — xem mục 5.',
        )}
      </p>
      <p className="mt-2">
        {t('Liên hệ về quyền riêng tư:')}{' '}
        <a href={`mailto:${PRIVACY_EMAIL}`} className={mailClass}>
          {PRIVACY_EMAIL}
        </a>
        {'. '}
        {t('Hỗ trợ chung:')}{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className={mailClass}>
          {SUPPORT_EMAIL}
        </a>
        .
      </p>
    </div>

    <div>
      <h2 id="data" className="display scroll-mt-28 border-t border-border pt-6 text-xl leading-[1.3] text-ink md:text-2xl">
        {t('2. Dữ liệu bọn tao lưu')}
      </h2>
      <p className="mt-2">
        {t(
          'Email và mật khẩu (lưu dưới dạng băm bcrypt, không bao giờ lưu mật khẩu gốc); các bản ghi mày tự nhập (thiết bị, gói bảo hành, subscription, wishlist); file đính kèm mày tải lên (ảnh hoá đơn / phiếu bảo hành); và token thông báo đẩy của thiết bị nếu mày bật push.',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Trạng thái đồng ý quảng cáo chỉ nằm trên thiết bị của mày — localStorage khoá wv_consent trên web, và do SDK của Google giữ trong app. Warrly không lưu trạng thái đó trên máy chủ của mình.',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Ngoài những mục trên, Warrly không lưu hồ sơ nào khác về mày: không có tài khoản quảng cáo gắn với mày, và không có hồ sơ hành vi để dựng chân dung quảng cáo.',
        )}
      </p>
    </div>

    <div>
      <h2 id="encryption" className="display scroll-mt-28 border-t border-border pt-6 text-xl leading-[1.3] text-ink md:text-2xl">
        {t('3. Mã hoá & lưu trữ')}
      </h2>
      <p className="mt-2">
        {t('File đính kèm được mã hoá')} <b>{t('AES-256-GCM')}</b>{' '}
        {t(
          'khi lưu trên máy chủ, mỗi file một khoá riêng (khoá này lại được bọc bởi khoá chủ của hệ thống). Phiên đăng nhập nằm trong một cookie đã mã hoá',
        )}{' '}
        (
        <code className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-sm">
          wv_session
        </code>
        ).{' '}
        {t('Toàn bộ dữ liệu nằm trên cơ sở dữ liệu do bọn tao tự vận hành.')}
      </p>
      <p className="mt-2">
        {t(
          'Máy chủ đó có thể đặt ngoài Việt Nam — xem mục 11.',
        )}
      </p>
    </div>

    <div>
      <h2 id="ai" className="display scroll-mt-28 border-t border-border pt-6 text-xl leading-[1.3] text-ink md:text-2xl">
        {t('4. Trợ lý AI (tự chọn bật)')}
      </h2>
      <p className="mt-2">
        {t('Mặc định tính năng này')} <b>{t('TẮT')}</b>
        {'. '}
        {t('Chỉ khi mày tự bật trong Cài đặt, trợ lý AI mới làm hai việc: đọc ảnh hoặc PDF hoá đơn mày chọn (được')}{' '}
        <b>{t('giải mã và gửi tới nhà cung cấp AI bên thứ ba (Anthropic)')}</b>{' '}
        {t(
          'để tự điền thông tin thiết bị), và đánh giá một lần sửa chữa có thuộc diện bảo hành hay không (gửi nội dung phiếu sửa chữa, thông tin thiết bị và các điều khoản hợp đồng bảo hành tới cùng nhà cung cấp đó). Kết quả luôn là gợi ý để mày kiểm tra lại — không phải quyết định bảo hành, và không có gì được tự động lưu. Không bật thì ảnh không bao giờ rời máy chủ ở dạng đã giải mã và không nội dung nào được gửi đi. Mày có thể tắt lại bất cứ lúc nào.',
        )}
      </p>
    </div>

    <div>
      <h2 id="ads" className="display scroll-mt-28 border-t border-border pt-6 text-xl leading-[1.3] text-ink md:text-2xl">
        {t('5. Quảng cáo (Google AdMob)')}
      </h2>
      <p className="mt-2">
        {t('Gói miễn phí có quảng cáo. Gói trả phí không có quảng cáo và hiện chưa mở bán.')}
      </p>
      <p className="mt-2">
        {t('Khi Warrly có quảng cáo, chúng nằm trong app iOS và Android và do Google AdMob phục vụ — một mạng quảng cáo của Google. Tính đến lần cập nhật này, app chưa tích hợp SDK quảng cáo nào và chưa có quảng cáo nào được hiển thị; phần này mô tả mô hình, không phải trạng thái đã chạy. Trên web chưa có quảng cáo.')}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          <b>{t('Nhà cung cấp:')}</b>{' '}
          {t(
            'Google AdMob — Google LLC (Hoa Kỳ) và Google Ireland Ltd (Ireland). Với dữ liệu quảng cáo, Google là bên kiểm soát độc lập: họ quyết định cách dùng dữ liệu đó theo chính sách của họ, không theo chỉ đạo của Warrly.',
          )}
        </li>
        <li>
          <b>{t('Dữ liệu AdMob nhận:')}</b>{' '}
          {t(
            'định danh quảng cáo của thiết bị (IDFA trên iOS, GAID trên Android); thông tin thiết bị tối thiểu (kiểu máy, phiên bản hệ điều hành, khu vực gần đúng suy ra từ IP); và sự kiện hiển thị, nhấp quảng cáo. Dữ liệu này được chia sẻ với Google để phục vụ và đo lường quảng cáo.',
          )}
        </li>
        <li>
          <b>{t('Cookie và định danh quảng cáo:')}</b>{' '}
          {t(
            'IDFA, GAID, và cookie hoặc định danh quảng cáo của Google (ví dụ NID, IDE — tuỳ sản phẩm Google dùng cho chỗ đặt quảng cáo). Mục đích: chọn quảng cáo, giới hạn tần suất và đo lường hiệu quả. Thời hạn: theo chính sách của Google; Warrly không đặt ra con số đó và không kiểm soát nó.',
          )}
        </li>
        <li>
          <b>{t('Thời hạn lưu dữ liệu quảng cáo:')}</b>{' '}
          {t(
            'theo chính sách Ads/AdMob của Google. Warrly không lưu dữ liệu quảng cáo: không có bảng nào trên máy chủ ghi việc mày đã thấy hay bấm quảng cáo nào. Thứ duy nhất Warrly giữ là trạng thái đồng ý, và nó nằm trên thiết bị của mày.',
          )}
        </li>
      </ul>
      <p className="mt-2">
        {t(
          'Mặc định quảng cáo không cá nhân hoá. Warrly chỉ phục vụ quảng cáo cá nhân hoá sau khi mày đồng ý: trên iOS là hộp thoại App Tracking Transparency (ATT) của Apple, và với người dùng EU, Vương quốc Anh hoặc Thuỵ Sĩ là hộp đồng ý của Google UMP (một nền tảng quản lý đồng ý đã được chứng nhận TCF v2.2). Từ chối thì quảng cáo vẫn hiển thị, nhưng là loại không cá nhân hoá.',
        )}
      </p>
      <p className="mt-2">
        <b>{t('Cách tắt hoặc đổi lựa chọn quảng cáo:')}</b>
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          {t(
            'iOS: Cài đặt hệ thống → Quyền riêng tư & Bảo mật → Theo dõi, bật hoặc tắt cho Warrly.',
          )}
        </li>
        <li>
          {t(
            'Android: Cài đặt → Google → Quảng cáo, xoá hoặc đặt lại Advertising ID, hoặc từ chối quảng cáo cá nhân hoá.',
          )}
        </li>
        <li>
          {t(
            'EU, Vương quốc Anh, Thuỵ Sĩ: mở lại lựa chọn bất cứ lúc nào qua nút “Tuỳ chọn quyền riêng tư” trong app (Google UMP).',
          )}
        </li>
        <li>
          {t(
            'Web: quảng cáo mặc định tắt — Warrly không tải script quảng cáo và không đặt cookie quảng cáo trước khi mày đồng ý. Đổi lựa chọn bất cứ lúc nào qua “Tuỳ chọn cookie” ở chân trang.',
          )}
        </li>
      </ul>
      <p className="mt-2">
        {t('Không đồng ý quảng cáo cá nhân hoá không chặn mày dùng app hay web. Cách Google dùng dữ liệu cho quảng cáo và cách quản lý lựa chọn:')}{' '}
        <a
          href="https://policies.google.com/technologies/ads"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-ink underline decoration-primary underline-offset-4 hover:decoration-2"
        >
          policies.google.com/technologies/ads
        </a>
        .
      </p>
      <p className="mt-2">
        {t('Warrly không nhúng Google Analytics hay Facebook SDK, và không tự theo dõi mày xuyên trang.')}
      </p>
    </div>

    <div>
      <h2 id="rights" className="display scroll-mt-28 border-t border-border pt-6 text-xl leading-[1.3] text-ink md:text-2xl">
        {t('6. Quyền của mày')}
      </h2>
      <p className="mt-2">
        {t('Mày có thể')} <b>{t('xuất toàn bộ dữ liệu')}</b>{' '}
        {t('ra file JSON hoặc .zip kèm ảnh đã mã hoá (Cài đặt → Sao lưu & khôi phục) bất cứ lúc nào, và')}{' '}
        <b>{t('xoá tài khoản')}</b>{' '}
        {t(
          'để xoá vĩnh viễn mọi thiết bị, hoá đơn, ảnh và cài đặt. Thao tác xoá không thể hoàn tác.',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Theo Nghị định 13/2023/NĐ-CP và Luật 91/2025/QH15, mày có quyền: được biết về việc xử lý dữ liệu, truy cập, chỉnh sửa, xoá dữ liệu; rút lại đồng ý; hạn chế xử lý; phản đối xử lý; yêu cầu bồi thường thiệt hại; và khiếu nại tới cơ quan có thẩm quyền — Cục An ninh mạng, Bộ Công an (A05).',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Nếu mày ở EEA hoặc Vương quốc Anh, mày có quyền truy cập, sửa, xoá, hạn chế xử lý, phản đối xử lý, chuyển dữ liệu, rút lại đồng ý và khiếu nại với cơ quan bảo vệ dữ liệu. Để thực hiện, gửi email tới privacy@warrly.com.',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Để thực hiện bất kỳ quyền nào ở trên, gửi email tới privacy@warrly.com. Warrly có thể hỏi thêm vài thông tin để xác minh đó là mày trước khi xoá hoặc sửa dữ liệu, và không phân biệt đối xử khi mày thực hiện quyền.',
        )}
      </p>
    </div>

    <div>
      <h2 id="third-parties" className="display scroll-mt-28 border-t border-border pt-6 text-xl leading-[1.3] text-ink md:text-2xl">
        {t('7. Bên thứ ba & chia sẻ dữ liệu')}
      </h2>
      <p className="mt-2">
        {t('Warrly chỉ chia sẻ dữ liệu với các bên sau, và chỉ phần cần cho việc đó:')}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          <b>{t('Anthropic')}</b>
          {' — '}
          {t('chỉ khi mày bật trợ lý AI (xem mục 4).')}
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
        <li>
          <b>{t('Google AdMob (Google LLC, Google Ireland Ltd)')}</b>
          {' — '}
          {t(
            'quảng cáo trong app, chỉ ở gói miễn phí (xem mục 5). Dữ liệu quảng cáo được chia sẻ với Google để phục vụ và đo lường quảng cáo; với dữ liệu đó Google là bên kiểm soát độc lập.',
          )}
        </li>
      </ul>
      <p className="mt-2">{t('Ngoài các dịch vụ trên, bọn tao không chia sẻ dữ liệu với ai.')}</p>
      <p className="mt-2">
        {t('Warrly không bán dữ liệu cá nhân, và không có nhà quảng cáo nào khác ngoài Google.')}
      </p>
    </div>

    <div>
      <h2 id="legal-basis" className="display scroll-mt-28 border-t border-border pt-6 text-xl leading-[1.3] text-ink md:text-2xl">
        {t('8. Cơ sở pháp lý & sự đồng ý')}
      </h2>
      <p className="mt-2">{t('Bọn tao xử lý dữ liệu theo các cơ sở sau:')}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          {t(
            'Phiên đăng nhập và ghi nhớ ngôn ngữ, giao diện: thực hiện hợp đồng và lợi ích hợp pháp trong việc giữ đúng lựa chọn của mày.',
          )}
        </li>
        <li>
          {t(
            'Cung cấp dịch vụ (tài khoản, thiết bị, bảo hành, hoá đơn, sao lưu): thực hiện hợp đồng với mày.',
          )}
        </li>
        <li>
          {t(
            'Thông báo đẩy và trợ lý AI: sự đồng ý của mày, có thể rút lại bất cứ lúc nào trong Cài đặt.',
          )}
        </li>
        <li>
          {t(
            'Quảng cáo ở gói miễn phí: sự đồng ý của mày — ATT trên iOS, hộp đồng ý Google UMP với người dùng EU/UK/Thuỵ Sĩ. Không đồng ý thì quảng cáo vẫn hiện nhưng không cá nhân hoá.',
          )}
        </li>
        <li>
          {t(
            'Bảo mật, chống lạm dụng và giới hạn tần suất: lợi ích hợp pháp của bọn tao trong việc giữ dịch vụ an toàn.',
          )}
        </li>
        <li>
          {t(
            'Email giao dịch (đặt lại mật khẩu, xác nhận đổi email): thực hiện hợp đồng và bảo mật tài khoản.',
          )}
        </li>
      </ul>
      <p className="mt-2">
        {t(
          'Sự đồng ý ở Warrly là tự nguyện, theo từng mục đích, không gộp chung và không tích sẵn: mỗi công tắc là một quyết định riêng. Mày rút lại bất cứ lúc nào — tắt quyền theo dõi trong Cài đặt hệ thống (iOS), mở lại hộp UMP trong app, đổi “Tuỳ chọn cookie” trên web, hoặc tắt push và trợ lý AI trong Cài đặt.',
        )}
      </p>
    </div>

    <div>
      <h2 id="ccpa" className="display scroll-mt-28 border-t border-border pt-6 text-xl leading-[1.3] text-ink md:text-2xl">
        {t('9. Người dùng California (CCPA/CPRA)')}
      </h2>
      <p className="mt-2">
        {t(
          'Nếu mày ở California, mày có quyền biết dữ liệu cá nhân bọn tao thu thập và chia sẻ, quyền xoá, quyền sửa và quyền từ chối bán hoặc chia sẻ dữ liệu cá nhân.',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Warrly không bán dữ liệu cá nhân. Mặc định quảng cáo không cá nhân hoá; quảng cáo cá nhân hoá chỉ chạy sau khi mày đồng ý, và mày có thể từ chối hoặc rút lại đồng ý bất cứ lúc nào.',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Để thực hiện các quyền này, gửi email tới privacy@warrly.com. Mày có thể dùng đại diện được uỷ quyền. Bọn tao sẽ xác minh yêu cầu và không phân biệt đối xử khi mày thực hiện quyền.',
        )}
      </p>
    </div>

    <div>
      <h2 id="retention" className="display scroll-mt-28 border-t border-border pt-6 text-xl leading-[1.3] text-ink md:text-2xl">
        {t('10. Lưu trữ trong bao lâu')}
      </h2>
      <p className="mt-2">
        {t(
          'Dữ liệu tài khoản (email, thiết bị, bảo hành, hoá đơn, wishlist) được giữ cho tới khi mày xoá tài khoản. Xoá tài khoản là xoá khỏi hệ thống; trong ứng dụng không có nút khôi phục.',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Dữ liệu quảng cáo do Google lưu theo chính sách Ads/AdMob của Google. Warrly không giữ bản sao nào, nên không có thời hạn riêng của Warrly để nêu.',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Trạng thái đồng ý trên web được nhớ tối đa 12 tháng — khớp với Chính sách Cookie — sau đó Warrly hỏi lại. Xoá localStorage là mất bản ghi đó, và biểu ngữ sẽ hiện lại.',
        )}
      </p>
    </div>

    <div>
      <h2 id="transfers" className="display scroll-mt-28 border-t border-border pt-6 text-xl leading-[1.3] text-ink md:text-2xl">
        {t('11. Chuyển dữ liệu ra nước ngoài')}
      </h2>
      <p className="mt-2">
        {t(
          'Warrly chạy từ Việt Nam, nhưng dữ liệu không chỉ nằm ở Việt Nam. Dữ liệu tài khoản nằm trên máy chủ do Warrly tự vận hành; phần còn lại đi qua các bên sau, và đó là chuyển dữ liệu ra nước ngoài:',
        )}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          <b>{t('Google')}</b>
          {' — '}
          {t(
            'quảng cáo (AdMob) và thông báo đẩy trên Android (FCM): Google LLC tại Hoa Kỳ, và Google Ireland Ltd tại Ireland cho người dùng EU.',
          )}
        </li>
        <li>
          <b>{t('Apple')}</b>
          {' — '}
          {t('thông báo đẩy trên iOS qua APNs: Apple Inc. tại Hoa Kỳ.')}
        </li>
        <li>
          <b>{t('Resend')}</b>
          {' — '}
          {t('email giao dịch (đặt lại mật khẩu, xác nhận đổi email): Hoa Kỳ.')}
        </li>
        <li>
          <b>{t('Anthropic')}</b>
          {' — '}
          {t('chỉ khi mày bật trợ lý AI: Hoa Kỳ.')}
        </li>
      </ul>
      <p className="mt-2">
        {t(
          'Nghị định 13/2023/NĐ-CP và Luật 91/2025/QH15 yêu cầu nêu rõ việc chuyển dữ liệu ra nước ngoài; mục này là chỗ nêu đó. Dữ liệu chỉ được chuyển tới các bên ở mục 7, cho các mục đích ở mục 8.',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Mỗi bên nói trên có chính sách quyền riêng tư riêng và chịu luật bảo vệ dữ liệu áp dụng với họ. Chính sách quảng cáo của Google:',
        )}{' '}
        <a
          href="https://policies.google.com/technologies/ads"
          target="_blank"
          rel="noopener noreferrer"
          className="font-semibold text-ink underline decoration-primary underline-offset-4 hover:decoration-2"
        >
          policies.google.com/technologies/ads
        </a>
        .
      </p>
    </div>

    <div>
      <h2 id="children" className="display scroll-mt-28 border-t border-border pt-6 text-xl leading-[1.3] text-ink md:text-2xl">
        {t('12. Trẻ em')}
      </h2>
      <p className="mt-2">
        {t(
          'Warrly không hướng đến trẻ em và không cố ý thu thập dữ liệu của người dưới 16 tuổi. Nếu mày cho rằng Warrly đã thu thập nhầm dữ liệu của một trẻ em, gửi email tới privacy@warrly.com và bọn tao sẽ xoá.',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Nếu phát hiện một tài khoản là của người dưới 16 tuổi, Warrly sẽ xoá tài khoản đó cùng dữ liệu bên trong.',
        )}
      </p>
    </div>

    <div>
      <h2 id="international" className="display scroll-mt-28 border-t border-border pt-6 text-xl leading-[1.3] text-ink md:text-2xl">
        {t('13. Người dùng quốc tế')}
      </h2>
      <p className="mt-2">
        {t(
          'Warrly được viết cho người dùng ở bất kỳ đâu, không chỉ Việt Nam. Người dùng EU, Vương quốc Anh và Thuỵ Sĩ được hưởng các quyền theo luật bảo vệ dữ liệu áp dụng — xem mục 6 — và với quảng cáo cá nhân hoá, Warrly dùng Google UMP, một nền tảng quản lý đồng ý đã được chứng nhận TCF v2.2.',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Warrly không có đại diện tại EU hay Vương quốc Anh: đây là ứng dụng của một cá nhân, xử lý từ Việt Nam, và đầu mối cho mọi yêu cầu — kể cả từ EU/UK — là privacy@warrly.com.',
        )}
      </p>
    </div>

    <div>
      <h2 id="changes" className="display scroll-mt-28 border-t border-border pt-6 text-xl leading-[1.3] text-ink md:text-2xl">
        {t('14. Thay đổi')}
      </h2>
      <p className="mt-2">
        {t(
          'Warrly có thể cập nhật chính sách này. Bản mới luôn ghi ngày “Cập nhật lần cuối” ở đầu trang; mày nên đọc lại sau mỗi lần đổi. Nếu thay đổi làm tăng phạm vi dữ liệu thu thập, Warrly sẽ hỏi lại sự đồng ý thay vì coi như mày đã đồng ý.',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Bản tiếng Việt và bản tiếng Anh được cập nhật cùng lúc. Nếu hai bản lệch nhau, bản tiếng Việt là bản có giá trị pháp lý.',
        )}
      </p>
    </div>

    <div>
      <h2 id="contact" className="display scroll-mt-28 border-t border-border pt-6 text-xl leading-[1.3] text-ink md:text-2xl">
        {t('15. Liên hệ')}
      </h2>
      <p className="mt-2">
        {t('Có thắc mắc về dữ liệu:')}{' '}
        <a href={`mailto:${PRIVACY_EMAIL}`} className={mailClass}>
          {PRIVACY_EMAIL}
        </a>
      </p>
      <p className="mt-2">
        {t('Hỗ trợ chung:')}{' '}
        <a href={`mailto:${SUPPORT_EMAIL}`} className={mailClass}>
          {SUPPORT_EMAIL}
        </a>
      </p>
      <p className="mt-2">
        <b>{t('Đơn vị chịu trách nhiệm')}:</b> {LEGAL_NAME}
        {', '}
        {t('cá nhân, Việt Nam.')}
      </p>
      <p className="mt-2">
        <b>{t('Đầu mối bảo vệ dữ liệu')}:</b>{' '}
        {t('không có DPO riêng; chính chủ sở hữu trả lời mọi yêu cầu qua privacy@warrly.com.')}
      </p>
    </div>
</LegalDocument>
  );
}
