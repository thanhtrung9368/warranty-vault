'use client';

import Link from 'next/link';
import { Reveal } from '@/components/reveal';
import { useLocale, useT } from '@/lib/i18n/client';
import { localePath } from '@/lib/i18n/locale';

/**
 * Price & limits.
 *
 * The answer to the older "free forever" lines that used to appear with no
 * explanation anywhere. The limits are the Go service's constants, and the
 * exact same numbers are written into Terms §4 so the link really does
 * substantiate the list rather than pointing at a vague promise. The model is
 * a free ad-supported tier plus a paid tier that removes ads and raises the
 * limits — no price and no launch date exists in this repo, so none is stated.
 *
 * It used to be three equal cards of 13 px copy, which made the one thing a
 * reader wants — "what do I actually get for free" — as quiet as the data
 * notes. Now the free plan is the lead column at reading size, and the two
 * notes are columns beside it on a wide screen and rows on a phone. No icons,
 * no cards inside cards; the list is a spec sheet.
 *
 * The legal links are built from the ACTIVE locale, not the one the server
 * rendered with: after switching to Vietnamese on `/`, "Điều khoản" must go to
 * `/vi/terms`, not `/terms`.
 */
export function LandingPrice() {
  const t = useT();
  const locale = useLocale();

  return (
    <section className="px-4 py-16 md:px-8 md:py-24" aria-labelledby="wv-price-title">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <p className="text-[13px] font-semibold text-ink-2/80">{t('Giá')}</p>
          <h2
            id="wv-price-title"
            className="display mt-2 text-balance text-3xl leading-[1.1] tracking-[-0.02em] text-ink md:text-4xl"
          >
            {t('Miễn phí có quảng cáo. Gói trả phí nâng giới hạn.')}
          </h2>
          <p className="mt-4 max-w-xl text-[17px] leading-[1.65] text-ink-2">
            {t('Gói miễn phí là hạng bạn dùng hôm nay: có quảng cáo và dừng ở các con số dưới đây. Gói trả phí chưa mở bán; khi mở bán, nó bỏ quảng cáo và nâng các giới hạn này.')}
          </p>
        </div>

        <Reveal className="mt-10">
          <div className="grid overflow-hidden rounded-lg border border-border bg-card lg:grid-cols-[1.4fr_1fr_1fr]">
            <div className="flex flex-col border-b border-border p-6 md:p-8 lg:border-b-0 lg:border-r">
              <p className="text-[13px] font-semibold text-ink-2/80">{t('Gói miễn phí')}</p>
              <h3 className="display mt-2 text-2xl leading-[1.2] tracking-[-0.015em] text-ink">
                {t('Miễn phí, có quảng cáo, và đây là chỗ nó dừng')}
              </h3>
              <ul className="mt-6 divide-y divide-border/70 border-y border-border/70">
                {[
                  '50 thiết bị đang dùng — 500 dòng nếu tính cả máy đã bán',
                  '5 gói bảo hành mỗi thiết bị',
                  '5 tệp mỗi thiết bị, tối đa 5 MB mỗi tệp',
                  '100 MB tổng dung lượng tệp của cả tài khoản',
                  '100 gói đăng ký',
                  '200 món wishlist',
                ].map((limit) => (
                  <li
                    key={limit}
                    className="py-2.5 text-[14px] leading-[1.6] text-ink-2"
                  >
                    {t(limit)}
                  </li>
                ))}
              </ul>
              <Link
                href={localePath('/terms#usage-limits', locale)}
                prefetch={false}
                className="mt-6 text-[14px] font-semibold text-ink underline decoration-primary underline-offset-4 hover:decoration-2"
              >
                {t('Điều khoản, mục 4')} →
              </Link>
            </div>

            <div className="flex flex-col border-b border-border p-6 md:p-8 lg:border-b-0 lg:border-r">
              <p className="text-[13px] font-semibold text-ink-2/80">{t('Dữ liệu của bạn')}</p>
              <h3 className="display mt-2 text-xl leading-[1.25] tracking-[-0.01em] text-ink">
                {t('Hoá đơn là của bạn')}
              </h3>
              <div className="mt-5 space-y-4 text-[14px] leading-[1.7] text-ink-2">
                <p>
                  {t('Ảnh và PDF được mã hoá AES-256-GCM trên máy chủ. Mỗi tệp có một khoá riêng, khoá đó lại được bọc bằng khoá chủ của hệ thống.')}
                </p>
                <p className="text-ink-2/80">
                  {t('Gói miễn phí có quảng cáo. Quảng cáo có thể dùng cookie hoặc định danh thiết bị; khi mở bán, gói trả phí sẽ bỏ quảng cáo. Chi tiết ở Chính sách bảo mật, mục 5.')}
                </p>
              </div>
              <Link
                href={localePath('/privacy', locale)}
                prefetch={false}
                className="mt-6 text-[14px] font-semibold text-ink underline decoration-primary underline-offset-4 hover:decoration-2"
              >
                {t('Chính sách bảo mật, mục 3 và 5')} →
              </Link>
            </div>

            <div className="flex flex-col p-6 md:p-8">
              <p className="text-[13px] font-semibold text-ink-2/80">{t('Ra đi')}</p>
              <h3 className="display mt-2 text-xl leading-[1.25] tracking-[-0.01em] text-ink">
                {t('Đi bất cứ lúc nào')}
              </h3>
              <p className="mt-5 text-[14px] leading-[1.7] text-ink-2">
                {t('Xuất mọi thứ ra JSON, hoặc .zip kèm nội dung ảnh đã mã hoá. Xoá tài khoản trong Cài đặt — không phải gửi yêu cầu qua email.')}
              </p>
              <Link
                href={localePath('/privacy#rights', locale)}
                prefetch={false}
                className="mt-6 text-[14px] font-semibold text-ink underline decoration-primary underline-offset-4 hover:decoration-2"
              >
                {t('Chính sách bảo mật, mục 6')} →
              </Link>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
