'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Reveal } from '@/components/reveal';
import { WarrlyMark } from '@/components/brand';
import { useT } from '@/lib/i18n/client';

/**
 * The final CTA and the first-person note beside it.
 *
 * The proof next to the CTA is deliberately not a testimonial, a rating or a
 * user count: there are no users to count yet, and inventing one would be the
 * one thing this page cannot do. It is a first-person note whose facts are in
 * this repo (the 30-day 1-đổi-1 window, the warranty clock's varying start, the
 * receipt requirement, and the default 30/7-day lead-day schedule in
 * `services/leaddays.go`). No name is invented; the signature says what the repo
 * can prove.
 *
 * The panel is ink, not coral. Coral on this page is the action (the button);
 * a full coral block made the closing read as one more marketing surface and
 * spent the accent before the reader reached the last thing to click. The
 * inverse panel also gives the page a real ending instead of a seventh white
 * card.
 */
export function LandingClosing({ signedIn }: { signedIn: boolean }) {
  const t = useT();

  return (
    <section className="px-4 py-16 md:px-8 md:py-24">
      <div className="mx-auto max-w-6xl">
        <div className="rounded-lg bg-ink px-6 py-10 text-background md:px-12 md:py-14">
          <WarrlyMark size={52} />
          <div className="mt-6 max-w-2xl">
            <h2 className="display text-3xl leading-[1.1] tracking-[-0.02em] text-background md:text-4xl">
              {t('Giữ ngày bảo hành ngay từ hôm nay.')}
            </h2>
            <p className="mt-3 max-w-xl text-[17px] leading-[1.65] text-background/70">
              {t('Miễn phí để bắt đầu. Không cần thẻ. Gói miễn phí có quảng cáo; gói trả phí thì không.')}
            </p>
          </div>
          <div className="mt-7">
            <Button asChild size="lg" className="h-12 !rounded-md px-6 text-[15px] shadow-none">
              <Link href={signedIn ? '/dashboard' : '/register'}>
                {signedIn ? t('Mở Dashboard') : t('Tạo tài khoản miễn phí')}
                <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
              </Link>
            </Button>
          </div>
        </div>

        <Reveal>
          <div className="mt-10 grid gap-5 border-t border-border pt-8 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] md:gap-10">
            <p className="text-[13px] font-semibold leading-[1.5] text-ink-2/80">
              {t('Ghi chú từ người làm Warrly')}
            </p>
            <div className="min-w-0">
              <p className="max-w-[64ch] text-[17px] leading-[1.75] text-ink-2">
                {t('Warrly bắt đầu từ một cái hạn 30 ngày. Một chiếc máy mới thường có một cửa sổ đổi trả ngắn — thường là 30 ngày — trước khi chỉ còn đường gửi sửa. Cửa sổ đó là chính sách của nơi bán và của hãng, không phải luật, và mỗi nơi một khác. Ngày bảo hành cũng có khi tính từ lúc kích hoạt, lúc xuất kho hay lúc mua, tuỳ hãng — và tấm hoá đơn là thứ chứng minh ngày đó. Tôi làm Warrly để giữ ngày và hoá đơn cạnh nhau, nhắc trước theo lịch bạn đặt — mặc định 30 và 7 ngày — và không hứa gì ngoài việc đó.')}
              </p>
              <p className="mt-4 text-[13px] font-semibold text-ink-2/80">
                {t('— Người làm Warrly')}
              </p>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
