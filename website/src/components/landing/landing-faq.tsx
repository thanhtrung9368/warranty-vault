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
      link: t('Chính sách bảo mật, mục 2 và 5'),
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
    <section className="px-4 pb-20 md:px-8" aria-labelledby="wv-faq-title">
      <div className="mx-auto max-w-3xl">
        <div className="text-center">
          <span className="eyebrow">{t('Hỏi thẳng')}</span>
          <h2 id="wv-faq-title" className="display mt-2 text-3xl text-ink">
            {t('Năm câu thường gặp.')}
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-muted">
            {t('Nếu câu bạn cần không có ở đây, email hỗ trợ ở cuối trang.')}
          </p>
        </div>

        <Reveal>
          <div className="mt-8 overflow-hidden rounded-xl border-[1.5px] border-border bg-card shadow-soft">
            {faq.map((item, index) => (
              <details
                key={index}
                className={`group${index > 0 ? ' border-t-[1.5px] border-border' : ''}`}
              >
                <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-6 py-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&::-webkit-details-marker]:hidden">
                  <h3 className="font-display text-[17px] font-bold tracking-tight text-ink">
                    {item.q}
                  </h3>
                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-border text-muted transition-transform duration-200 group-open:rotate-45">
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                  </span>
                </summary>
                <div className="px-6 pb-5 text-sm leading-relaxed text-muted">
                  <p>{item.a}</p>
                  {item.href && item.link ? (
                    <Link
                      href={localePath(item.href, locale)}
                      prefetch={false}
                      className="mt-2 inline-block text-[13px] font-semibold text-primary hover:underline"
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
