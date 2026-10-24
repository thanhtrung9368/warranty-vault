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
 */
export function LandingClosing({ signedIn }: { signedIn: boolean }) {
  const t = useT();

  return (
    <section className="px-4 py-20 md:px-8">
      <div className="mx-auto max-w-2xl">
        <div
          className="rounded-xl border-[2px] border-ink p-12 text-center shadow-chunky"
          style={{
            background:
              'linear-gradient(135deg, hsl(var(--primary-soft)), hsl(var(--primary-soft-2)))',
          }}
        >
          {/* Symbol alone: no background tile, no radius token. */}
          <div className="mx-auto mb-4 flex justify-center">
            <WarrlyMark size={64} />
          </div>
          <h2 className="display text-3xl text-primary-ink">
            {t('Giữ ngày bảo hành ngay từ hôm nay.')}
          </h2>
          <p className="mt-2 text-primary-ink/80">
            {t('Miễn phí để bắt đầu. Không cần thẻ. Không quảng cáo.')}
          </p>
          <div className="mt-6 flex justify-center">
            <Button asChild size="lg">
              <Link href={signedIn ? '/dashboard' : '/register'}>
                {signedIn ? t('Mở Dashboard') : t('Tạo tài khoản miễn phí')}
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>

        <Reveal>
          <div className="mt-6 rounded-xl border-[1.5px] border-border bg-card p-7 shadow-soft">
            <p className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">
              {t('Ghi chú từ người làm Warrly')}
            </p>
            <p className="mt-3 text-[17px] leading-relaxed text-ink-2">
              {t('Warrly bắt đầu từ một cái hạn 30 ngày. Một chiếc máy mới thường có một cửa sổ đổi trả ngắn — thường là 30 ngày — trước khi chỉ còn đường gửi sửa. Cửa sổ đó là chính sách của nơi bán và của hãng, không phải luật, và mỗi nơi một khác. Ngày bảo hành cũng có khi tính từ lúc kích hoạt, lúc xuất kho hay lúc mua, tuỳ hãng — và tấm hoá đơn là thứ chứng minh ngày đó. Tôi làm Warrly để giữ ngày và hoá đơn cạnh nhau, nhắc trước theo lịch bạn đặt — mặc định 30 và 7 ngày — và không hứa gì ngoài việc đó.')}
            </p>
            <p className="mt-4 text-[13px] font-semibold text-muted">
              {t('— Người làm Warrly')}
            </p>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
