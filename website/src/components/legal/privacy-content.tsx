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
// The advertising/consent sections were rewritten for the free-with-ads,
// paid-without model; the rest of the Vietnamese is the original. Sections 8
// and 9 are appended rather than inserted because the existing numbers are
// linked from the landing page and the FAQ, and renumbering would break those
// anchors.

import { useT } from '@/lib/i18n/client';
import { Placeholder } from './placeholder';

const UPDATED = '25/10/2026';

export function PrivacyContent() {
  const t = useT();
  return (
<article className="prose prose-slate max-w-none dark:prose-invert">
  <h1 className="display text-3xl">{t('Chính sách bảo mật')}</h1>
  <p className="text-sm text-muted">{t('Cập nhật lần cuối: {date}', { date: UPDATED })}</p>

  <div className="mt-6 space-y-5 text-base leading-relaxed text-ink-2">
    <p>
      {t(
        'Warrly là công cụ cá nhân để theo dõi thiết bị, bảo hành, gói đăng ký và danh sách “thèm”. Trang này mô tả bọn tao thu thập gì, lưu thế nào và chia sẻ với ai. Nguyên tắc gọn lại:',
      )}{' '}
      <b>{t('dữ liệu của mày là của mày')}</b>
      {' — '}
      {t('bọn tao không bán dữ liệu của mày. Gói miễn phí có quảng cáo; gói trả phí thì không.')}
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
      <h3 id="encryption" className="display scroll-mt-24 text-lg">
        {t('2. Mã hoá & lưu trữ')}
      </h3>
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
    </div>

    <div>
      <h3 className="display text-lg">{t('3. Trợ lý AI (tự chọn bật)')}</h3>
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
      <h3 className="display text-lg">{t('4. Bên thứ ba bọn tao dùng')}</h3>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          <b>{t('Anthropic')}</b>
          {' — '}
          {t('chỉ khi mày bật trợ lý AI (xem mục 3).')}
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
          <b>{t('Nhà cung cấp quảng cáo')}</b>
          {' — '}
          {t('chỉ ở gói miễn phí và chỉ khi mày đồng ý (xem mục 5).')}
        </li>
      </ul>
      <p className="mt-2">{t('Ngoài các dịch vụ trên, bọn tao không chia sẻ dữ liệu với ai.')}</p>
    </div>

    <div>
      <h3 id="ads" className="display scroll-mt-24 text-lg">
        {t('5. Quảng cáo')}
      </h3>
      <p className="mt-2">
        {t('Gói miễn phí có quảng cáo. Gói trả phí không có quảng cáo và hiện chưa mở bán.')}
      </p>
      <p className="mt-2">
        {t(
          'Quảng cáo có thể do một nhà cung cấp bên thứ ba phục vụ. Nhà cung cấp đó có thể đặt cookie hoặc đọc định danh thiết bị (ví dụ mã quảng cáo của hệ điều hành) để chọn, giới hạn và đo lường quảng cáo.',
        )}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          <b>{t('Nhà cung cấp quảng cáo')}:</b>{' '}
          <Placeholder>
            tên, địa chỉ và vai trò pháp lý (bên kiểm soát hay bên xử lý dữ liệu) của nhà cung cấp
            quảng cáo
          </Placeholder>
        </li>
        <li>
          <b>{t('Dữ liệu nhận và mục đích')}:</b>{' '}
          <Placeholder>
            dữ liệu nhà cung cấp nhận, quảng cáo có được cá nhân hoá theo hành vi không, và việc
            Warrly có chia sẻ dữ liệu với họ hay không
          </Placeholder>
        </li>
        <li>
          <b>{t('Cookie, định danh và thời hạn')}:</b>{' '}
          <Placeholder>
            tên cookie và định danh thiết bị, mục đích và thời hạn lưu
          </Placeholder>
        </li>
        <li>
          <b>{t('Thời hạn lưu dữ liệu quảng cáo')}:</b>{' '}
          <Placeholder>thời hạn nhà cung cấp lưu dữ liệu quảng cáo</Placeholder>
        </li>
      </ul>
      <p className="mt-2">
        {t(
          'Mặc định quảng cáo tắt. Warrly không tải script quảng cáo và không đặt cookie quảng cáo trước khi mày đồng ý. Mày có thể từ chối, chọn từng loại, hoặc đổi lựa chọn bất cứ lúc nào qua “Tuỳ chọn cookie” ở chân trang.',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Từ chối quảng cáo không chặn mày dùng gói miễn phí. Nếu không muốn thấy quảng cáo, mày có thể dùng gói trả phí khi nó mở bán.',
        )}
      </p>
      <p className="mt-2">
        {t('Warrly không nhúng Google Analytics hay Facebook SDK, và không tự theo dõi mày xuyên trang.')}
      </p>
    </div>

    <div>
      <h3 id="rights" className="display scroll-mt-24 text-lg">
        {t('6. Quyền của mày')}
      </h3>
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
          'Nếu mày ở EEA hoặc Vương quốc Anh, mày có quyền truy cập, sửa, xoá, hạn chế xử lý, phản đối xử lý, chuyển dữ liệu, rút lại đồng ý và khiếu nại với cơ quan bảo vệ dữ liệu. Để thực hiện, gửi email tới hi@warrly.com.',
        )}
      </p>
    </div>

    <div>
      <h3 id="contact" className="display scroll-mt-24 text-lg">
        {t('7. Liên hệ')}
      </h3>
      <p className="mt-2">
        {t('Có thắc mắc về dữ liệu:')}{' '}
        <a href="mailto:hi@warrly.com" className="font-semibold text-primary hover:underline">
          hi@warrly.com
        </a>
      </p>
      <p className="mt-2">
        {t(
          'Yêu cầu truy cập, xoá hoặc sửa dữ liệu: gửi tới hi@warrly.com. Bọn tao trả lời trong thời hạn luật định.',
        )}
      </p>
      <p className="mt-2">
        <b>{t('Đơn vị chịu trách nhiệm')}:</b>{' '}
        <Placeholder>tên pháp nhân, địa chỉ đăng ký và đại diện tại EU/UK (nếu có)</Placeholder>
      </p>
      <p className="mt-2">
        <b>{t('Đầu mối bảo vệ dữ liệu')}:</b>{' '}
        <Placeholder>email hoặc chức danh của DPO/đầu mối bảo vệ dữ liệu, nếu có</Placeholder>
      </p>
    </div>

    <div>
      <h3 className="display text-lg">{t('8. Cơ sở pháp lý')}</h3>
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
            'Quảng cáo ở gói miễn phí: sự đồng ý của mày, thể hiện qua “Tuỳ chọn cookie”; từ chối thì không có quảng cáo.',
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
    </div>

    <div>
      <h3 className="display text-lg">{t('9. Người dùng California (CCPA/CPRA)')}</h3>
      <p className="mt-2">
        {t(
          'Nếu mày ở California, mày có quyền biết dữ liệu cá nhân bọn tao thu thập và chia sẻ, quyền xoá, quyền sửa và quyền từ chối bán hoặc chia sẻ dữ liệu cá nhân.',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Warrly không bán dữ liệu cá nhân. Ở gói miễn phí, quảng cáo chỉ có khi mày đồng ý; mày có thể từ chối hoặc rút lại đồng ý bất cứ lúc nào qua “Tuỳ chọn cookie”.',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Để thực hiện các quyền này, gửi email tới hi@warrly.com. Mày có thể dùng đại diện được uỷ quyền. Bọn tao sẽ xác minh yêu cầu và không phân biệt đối xử khi mày thực hiện quyền.',
        )}
      </p>
    </div>
  </div>
</article>
  );
}
