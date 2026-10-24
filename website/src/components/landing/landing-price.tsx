'use client';

import Link from 'next/link';
import { CheckCircle2, DoorOpen, LockKeyhole, Tag } from 'lucide-react';
import { Reveal } from '@/components/reveal';
import { useLocale, useT } from '@/lib/i18n/client';
import { localePath } from '@/lib/i18n/locale';

/**
 * Price & limits.
 *
 * This is the answer to the three "free forever" lines that used to appear with
 * no explanation anywhere. The limits are the Go service's constants, and the
 * exact same numbers are written into Terms §4 so the link at the bottom of the
 * first column really does substantiate the list rather than pointing at a
 * vague promise.
 *
 * The legal links are built from the ACTIVE locale, not the one the server
 * rendered with: after switching to Vietnamese on `/`, "Điều khoản" must go to
 * `/vi/terms`, not `/terms`.
 */
export function LandingPrice() {
  const t = useT();
  const locale = useLocale();

  return (
    <section className="px-4 py-20 md:px-8" aria-labelledby="wv-price-title">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 text-center">
          <span className="eyebrow">{t('Giá')}</span>
          <h2 id="wv-price-title" className="display mt-2 text-3xl text-ink">
            {t('Miễn phí. Đây là toàn bộ giới hạn.')}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted">
            {t('Miễn phí là hạng bạn dùng hôm nay, với các giới hạn dưới đây. Và đây là những con số máy chủ thật sự giữ.')}
          </p>
        </div>

        <Reveal>
          <div className="grid overflow-hidden rounded-xl border-[1.5px] border-border bg-card shadow-soft lg:grid-cols-3">
            <div className="flex flex-col border-b-[1.5px] border-border p-7 lg:border-b-0 lg:border-r-[1.5px]">
              <Tag className="h-5 w-5 text-primary" strokeWidth={1.75} aria-hidden />
              <p className="mt-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">
                {t('Gói miễn phí')}
              </p>
              <h3 className="mt-1 font-display text-[18px] font-bold tracking-tight text-ink">
                {t('Miễn phí, và đây là chỗ nó dừng')}
              </h3>
              <ul className="mt-5 space-y-2.5 text-[13px] leading-relaxed text-ink-2">
                {[
                  '50 thiết bị đang dùng — 500 dòng nếu tính cả máy đã bán',
                  '5 gói bảo hành mỗi thiết bị',
                  '5 tệp mỗi thiết bị, tối đa 5 MB mỗi tệp',
                  '100 MB tổng dung lượng tệp của cả tài khoản',
                  '100 gói đăng ký',
                  '200 món wishlist',
                ].map((limit) => (
                  <li key={limit} className="flex gap-2.5">
                    <CheckCircle2
                      className="mt-[3px] h-3.5 w-3.5 shrink-0"
                      style={{ color: 'hsl(var(--emerald))' }}
                      aria-hidden
                    />
                    {t(limit)}
                  </li>
                ))}
              </ul>
              <Link
                href={localePath('/terms#usage-limits', locale)}
                prefetch={false}
                className="mt-auto pt-6 text-[13px] font-semibold text-primary hover:underline"
              >
                {t('Điều khoản, mục 4')} →
              </Link>
            </div>

            <div className="flex flex-col border-b-[1.5px] border-border p-7 lg:border-b-0 lg:border-r-[1.5px]">
              <LockKeyhole className="h-5 w-5 text-primary" strokeWidth={1.75} aria-hidden />
              <p className="mt-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">
                {t('Dữ liệu của bạn')}
              </p>
              <h3 className="mt-1 font-display text-[18px] font-bold tracking-tight text-ink">
                {t('Hoá đơn là của bạn')}
              </h3>
              <p className="mt-4 text-[13px] leading-relaxed text-ink-2">
                {t('Ảnh và PDF được mã hoá AES-256-GCM trên máy chủ. Mỗi tệp có một khoá riêng, khoá đó lại được bọc bằng khoá chủ của hệ thống.')}
              </p>
              <p className="mt-3 text-[13px] leading-relaxed text-muted">
                {t('Không quảng cáo, không pixel theo dõi, không bán dữ liệu.')}
              </p>
              <Link
                href={localePath('/privacy', locale)}
                prefetch={false}
                className="mt-auto pt-6 text-[13px] font-semibold text-primary hover:underline"
              >
                {t('Chính sách bảo mật, mục 2 và 5')} →
              </Link>
            </div>

            <div className="flex flex-col p-7">
              <DoorOpen className="h-5 w-5 text-primary" strokeWidth={1.75} aria-hidden />
              <p className="mt-4 text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">
                {t('Ra đi')}
              </p>
              <h3 className="mt-1 font-display text-[18px] font-bold tracking-tight text-ink">
                {t('Đi bất cứ lúc nào')}
              </h3>
              <p className="mt-4 text-[13px] leading-relaxed text-ink-2">
                {t('Xuất mọi thứ ra JSON, hoặc .zip kèm nội dung ảnh đã mã hoá. Xoá tài khoản trong Cài đặt — không phải gửi yêu cầu qua email.')}
              </p>
              <Link
                href={localePath('/privacy#rights', locale)}
                prefetch={false}
                className="mt-auto pt-6 text-[13px] font-semibold text-primary hover:underline"
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
