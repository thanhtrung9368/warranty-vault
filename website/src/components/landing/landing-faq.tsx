'use client';

import Link from 'next/link';
import { Plus } from 'lucide-react';
import { Reveal } from '@/components/reveal';
import { useLocale, useT } from '@/lib/i18n/client';
import type { Translator } from '@/lib/i18n/catalog';
import { localePath } from '@/lib/i18n/locale';

/**
 * The FAQ.
 *
 * Native `<details>`/`<summary>`: the accordion opens and closes with the
 * keyboard and with JavaScript disabled, and there is no client bundle to pay
 * for. The only client-side change is who resolves the sentences — `useT()`
 * here, so an in-place switch updates the questions and answers without the
 * page reloading.
 *
 * The section header sits in its own column on a wide screen instead of
 * centred above a card. The first answer is open, because a FAQ whose content
 * is invisible until clicked reads as an empty list; the rest stay collapsed.
 *
 * There is deliberately no FAQPage JSON-LD. Google retired FAQ rich results
 * (announced 2026-05-07, documentation removed 2026-06-15), so a second,
 * machine-only copy of these five answers was dead weight on every response.
 * The visible accordion stays; `lib/structured-data.tsx` emits only the
 * WebSite + Organization nodes that still do something.
 */
type FaqEntry = {
  q: string;
  a: string;
  /** The public page that substantiates the answer, when one exists. */
  href?: string;
  link?: string;
};

function buildFaq(t: Translator): FaqEntry[] {
  return [
    {
      q: t('Có thật là miễn phí không?'),
      a: t(
        'Có — và nó có giới hạn, cùng quảng cáo. Gói miễn phí không hết hạn, không cần thẻ, nhưng có quảng cáo và dừng ở các con số ở trên: 50 thiết bị đang dùng, 5 gói bảo hành mỗi thiết bị, 5 tệp mỗi thiết bị, 100 MB tổng, 100 gói đăng ký, 200 món wishlist. Gói trả phí chưa mở bán; khi mở bán, nó bỏ quảng cáo và nâng các giới hạn đó.',
      ),
      href: '/terms#usage-limits',
      link: t('Điều khoản, mục 4'),
    },
    {
      q: t('Nếu tôi ngừng dùng thì hoá đơn của tôi ra sao?'),
      a: t(
        'Không có gì tự xoá chỉ vì bạn không đăng nhập. Dữ liệu nằm đó cho đến khi bạn tự xoá tài khoản. Trước khi đi, vào Cài đặt → Sao lưu & khôi phục để tải JSON (thông tin) hoặc .zip (kèm nội dung ảnh đã mã hoá). Bản JSON không chứa ảnh; ảnh trong .zip chỉ mở lại được khi khôi phục vào một máy chủ còn giữ đúng khoá đó.',
      ),
      href: '/privacy#rights',
      link: t('Chính sách bảo mật, mục 6'),
    },
    {
      q: t('Có dùng trên iPhone được không?'),
      a: t(
        'Được, qua Safari — không cần tải app. Trên iOS 16.4 trở lên, bạn có thể thêm Warrly vào màn hình chính rồi bật thông báo đẩy. Bản iOS native hiện là beta qua TestFlight, chưa có trên App Store.',
      ),
    },
    {
      q: t('Dữ liệu của tôi có an toàn không?'),
      a: t(
        'Hoá đơn được mã hoá AES-256-GCM trên máy chủ; mỗi tệp có một khoá riêng, khoá đó lại được bọc bằng khoá chủ của hệ thống. Mật khẩu lưu dưới dạng băm bcrypt, phiên đăng nhập nằm trong cookie đã mã hoá. Không có Google Analytics, không Facebook SDK, không bán dữ liệu; gói miễn phí có quảng cáo và quảng cáo có thể dùng cookie hoặc định danh thiết bị (xem Chính sách bảo mật, mục 5). Trợ lý AI mặc định tắt và chỉ gửi ảnh hoá đơn đã giải mã hoặc nội dung một lần đánh giá bảo hành tới Anthropic khi bạn tự bật.',
      ),
      href: '/privacy#encryption',
      link: t('Chính sách bảo mật, mục 3 và 5'),
    },
    {
      q: t('Các bạn có phải đơn vị bảo hành không?'),
      a: t(
        'Không. Warrly chỉ ghi lại ngày, hoá đơn và gửi lời nhắc. Bảo hành là hợp đồng giữa bạn với hãng hoặc cửa hàng; việc sửa chữa, đổi trả hay từ chối bảo hành do họ quyết định. Phần đánh giá bằng AI, nếu bạn bật, chỉ là gợi ý để bạn kiểm tra — không phải cam kết bảo hành.',
      ),
      href: '/terms#purpose',
      link: t('Điều khoản, mục 1'),
    },
  ];
}

export function LandingFaq() {
  const t = useT();
  const locale = useLocale();
  const faq = buildFaq(t);

  return (
    <section
      className="border-y border-border bg-card px-4 py-16 md:px-8 md:py-24"
      aria-labelledby="wv-faq-title"
    >
      <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <div>
          <p className="text-[13px] font-semibold text-ink-2/80">{t('Hỏi thẳng')}</p>
          <h2
            id="wv-faq-title"
            className="display mt-2 text-3xl leading-[1.1] tracking-[-0.02em] text-ink md:text-4xl"
          >
            {t('Năm câu thường gặp.')}
          </h2>
          <p className="mt-4 max-w-md text-[17px] leading-[1.65] text-ink-2">
            {t('Nếu câu bạn cần không có ở đây, email hỗ trợ ở cuối trang.')}
          </p>
        </div>

        <Reveal className="border-t border-border">
          <div>
            {faq.map((item, index) => (
              <details
                key={index}
                open={index === 0}
                className="group border-b border-border"
              >
                <summary className="flex cursor-pointer list-none items-start justify-between gap-5 py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset md:py-6 [&::-webkit-details-marker]:hidden">
                  <span className="flex min-w-0 items-start gap-4">
                    <span className="mt-1 w-6 shrink-0 text-[12px] font-semibold tabular-nums text-ink-2/50">
                      {String(index + 1).padStart(2, '0')}
                    </span>
                    <h3 className="font-display text-[17px] font-bold leading-[1.35] tracking-[-0.01em] text-ink md:text-[18px]">
                      {item.q}
                    </h3>
                  </span>
                  <Plus
                    className="mt-1 h-4 w-4 shrink-0 text-ink-2/60 transition-transform duration-200 group-open:rotate-45"
                    aria-hidden
                  />
                </summary>
                <div className="pb-6 pl-10 pr-9 text-[15px] leading-[1.7] text-ink-2/80">
                  <p>{item.a}</p>
                  {item.href && item.link ? (
                    <Link
                      href={localePath(item.href, locale)}
                      prefetch={false}
                      className="mt-2 inline-block text-[14px] font-semibold text-ink underline decoration-primary underline-offset-4 hover:decoration-2"
                    >
                      {item.link} →
                    </Link>
                  ) : null}
                </div>
              </details>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}
