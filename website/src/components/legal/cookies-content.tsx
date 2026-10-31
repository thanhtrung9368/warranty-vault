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
// The advertising section is deliberately not "no ads" copy any more. It states
// the model (free with ads, paid without), the consent gate, and the provider
// facts the owner confirmed — Google AdMob, Google LLC / Google Ireland Ltd,
// independent controller for ad data, non-personalised by default. The cookie
// banner and the `wv_consent` record it reads are described in sections 2 and 4.
//
// Ads ship in the iOS/Android apps only; the web carries none. If web ads are
// ever enabled, this section and `privacy-content.tsx` §5 both have to say who
// serves them, and the web consent banner has to be replaced by Google UMP —
// the self-built banner is not a TCF-certified CMP.

import { useT } from '@/lib/i18n/client';

const UPDATED = '27/10/2026';

export function CookiesContent() {
  const t = useT();
  return (
<article className="prose prose-slate max-w-none dark:prose-invert">
  <h1 className="display text-3xl">{t('Chính sách Cookie')}</h1>
  <p className="text-sm text-muted">{t('Cập nhật lần cuối: {date}', { date: UPDATED })}</p>

  <div className="mt-6 space-y-5 text-base leading-relaxed text-ink-2">
    <p>
      {t(
        'Warrly dùng cookie thiết yếu để mày đăng nhập, giữ phiên và ghi nhớ ngôn ngữ, giao diện. Ở gói miễn phí, quảng cáo có thể dùng cookie hoặc định danh thiết bị của bên thứ ba — nhưng chỉ sau khi mày đồng ý. Gói trả phí không có quảng cáo.',
      )}
    </p>

    <div>
      <h3 className="display text-lg">{t('1. Cookie thiết yếu')}</h3>
      <p className="mt-2">{t('Bọn tao dùng hai cookie thiết yếu:')}</p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          <code className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-sm">
            wv_session
          </code>
          {' — '}
          {t(
            'Được mã hoá, chỉ chứa token phiên và thời hạn (tối đa 7 ngày) — không có thông tin cá nhân đọc được. Tắt cookie này thì không đăng nhập được.',
          )}
        </li>
        <li>
          <code className="rounded-sm bg-surface-2 px-1.5 py-0.5 font-mono text-sm">
            wv_locale
          </code>
          {' — '}
          {t(
            'ghi nhớ ngôn ngữ mày chọn (en hoặc vi), tối đa 1 năm. Không chứa thông tin cá nhân.',
          )}
        </li>
      </ul>
      <p className="mt-2">
        {t('Cả hai cookie đều do Warrly đặt trên tên miền này, không phải cookie bên thứ ba.')}
      </p>
    </div>

    <div>
      <h3 className="display text-lg">{t('2. Lưu trữ cục bộ trên máy')}</h3>
      <p className="mt-2">
        {t(
          'Một vài tuỳ chọn giao diện (chế độ sáng/tối, cỡ chữ, màu nhấn) được lưu trong bộ nhớ cục bộ của trình duyệt (localStorage, các khoá theme và wv:prefs) trên máy mày, không gửi về máy chủ.',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Lựa chọn cookie được lưu trong localStorage dưới khoá wv_consent. Đây là bản ghi cần thiết để biết mày đã đồng ý hay từ chối; không có cookie nào được đặt cho việc này. Lựa chọn được nhớ tối đa 12 tháng, sau đó Warrly hỏi lại.',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Xoá dữ liệu trình duyệt sẽ xoá các mục này; xoá wv_consent khiến biểu ngữ cookie hiện lại.',
        )}
      </p>
    </div>

    <div>
      <h3 id="ads" className="display scroll-mt-24 text-lg">
        {t('3. Cookie quảng cáo (chỉ ở gói miễn phí)')}
      </h3>
      <p className="mt-2">
        {t(
          'Khi có quảng cáo, chúng nằm trong app iOS và Android và do Google AdMob phục vụ. Trên web hiện chưa có quảng cáo: Warrly không tải script quảng cáo và không đặt cookie quảng cáo trước khi mày đồng ý.',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Trên app, khi mày đồng ý, AdMob có thể đọc định danh quảng cáo của thiết bị để chọn, giới hạn và đo lường quảng cáo. Gói trả phí không có quảng cáo, nên không có dữ liệu quảng cáo.',
        )}
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        <li>
          <b>{t('Nhà cung cấp quảng cáo')}:</b>{' '}
          {t(
            'Google AdMob — Google LLC (Hoa Kỳ) và Google Ireland Ltd (Ireland). Với dữ liệu quảng cáo, Google là bên kiểm soát độc lập.',
          )}
        </li>
        <li>
          <b>{t('Cookie, định danh và thời hạn')}:</b>{' '}
          {t(
            'Trên app: IDFA (iOS) và GAID (Android), cộng cookie hoặc định danh quảng cáo của Google (ví dụ NID, IDE); thời hạn theo chính sách của Google. Trên web hiện chưa có quảng cáo.',
          )}
        </li>
        <li>
          <b>{t('Dữ liệu nhận và mục đích')}:</b>{' '}
          {t(
            'Định danh quảng cáo, thông tin thiết bị tối thiểu và sự kiện hiển thị, nhấp, để chọn và đo lường quảng cáo. Mặc định không cá nhân hoá; chỉ cá nhân hoá sau khi mày đồng ý (ATT trên iOS, Google UMP với EU/UK/Thuỵ Sĩ).',
          )}
        </li>
        <li>
          <b>{t('Thời hạn lưu dữ liệu quảng cáo')}:</b>{' '}
          {t('theo chính sách Ads/AdMob của Google. Warrly không lưu dữ liệu quảng cáo.')}
        </li>
      </ul>
    </div>

    <div>
      <h3 className="display text-lg">{t('4. Đổi hoặc rút lại lựa chọn')}</h3>
      <p className="mt-2">
        {t(
          'Mở “Tuỳ chọn cookie” ở chân trang bất cứ lúc nào. Chọn “Từ chối không cần thiết” để tắt quảng cáo ngay, hoặc “Quản lý” để bật/tắt từng loại.',
        )}
      </p>
      <p className="mt-2">
        {t(
          'Rút lại đồng ý không làm mất hiệu lực của việc xử lý đã xảy ra trước đó, và không chặn mày dùng gói miễn phí.',
        )}
      </p>
    </div>
  </div>
</article>
  );
}
