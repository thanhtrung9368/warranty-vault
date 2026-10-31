'use client';

import Link from 'next/link';
import { ArrowRight, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LandingProduct, type LandingProductShot } from './landing-product';
import { useT } from '@/lib/i18n/client';

/**
 * The hero.
 *
 * One lead: the sentence, in ink, at the largest type on the page. The old
 * hero stacked an uppercase free/paid disclaimer, a gradient-highlighted word
 * and a sparkle icon above it, so three things competed to be read first.
 * Coral is now reserved for the one action (`Tạo tài khoản miễn phí`); the
 * headline is monochrome, which is also what the shared visual direction asks
 * for — colour encodes a state or an action, never decoration.
 *
 * The H1 is an LCP element and is deliberately never wrapped in a reveal or an
 * opacity-0 start state. It is a client component anyway — React Server
 * Components are rendered to HTML on the server, so the text is in the first
 * response exactly as before; the client component only means the same DOM
 * knows how to re-render itself in the other language.
 */
export function LandingHero({
  signedIn,
  shot,
}: {
  signedIn: boolean;
  shot: LandingProductShot;
}) {
  const t = useT();

  return (
    <section className="wv-hero px-4 pb-14 pt-10 md:px-8 md:pb-24 md:pt-16 lg:pt-24">
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-16">
        <div className="max-w-[37rem]">
          {/* The H1 is the LCP element and is deliberately never wrapped in a
              reveal and never starts at `opacity: 0`. The size is 32 px at
              390 so the Vietnamese first line holds "Giữ ngày hết bảo hành"
              whole — 34 px split the term across two lines. The manual
              line-height leaves room for stacked diacritics. */}
          <h1 className="display text-pretty text-[32px] leading-[1.08] tracking-[-0.03em] text-ink sm:text-[38px] md:text-[44px] lg:text-[46px]">
            {t('Giữ ngày hết bảo hành — và cả hoá đơn — cho mọi thứ trong nhà.')}
          </h1>
          <p className="mt-5 max-w-[44ch] text-[17px] leading-[1.65] text-ink-2 md:mt-6 md:text-[18px]">
            {t(
              'Tủ lạnh, máy giặt, chiếc iPhone: mỗi món có một ngày hết hạn và một tấm hoá đơn. Warrly giữ cả hai, và nhắc bạn trước khi bảo hành hết hiệu lực.',
            )}
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
            {signedIn ? (
              <Button
                asChild
                size="lg"
                className="h-12 w-full !rounded-md px-6 text-[15px] shadow-none sm:w-auto"
              >
                <Link href="/dashboard">
                  {t('Mở Dashboard')}
                  <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
                </Link>
              </Button>
            ) : (
              <>
                <Button
                  asChild
                  size="lg"
                  className="h-12 w-full !rounded-md px-6 text-[15px] shadow-none sm:w-auto"
                >
                  <Link href="/register">
                    {t('Tạo tài khoản miễn phí')}
                    <ArrowRight className="ml-1 h-4 w-4" aria-hidden />
                  </Link>
                </Button>
                <Link
                  href="/login"
                  className="text-sm font-semibold text-ink-2 underline decoration-border-strong underline-offset-4 hover:text-ink"
                >
                  {t('Đã có tài khoản → Đăng nhập')}
                </Link>
              </>
            )}
          </div>
          {/* Facts, not decorations: neutral checks, no emerald. Green is
              reserved for a date state, per the shared direction. */}
          <ul className="mt-7 flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-ink-2/80">
            {[
              'Không cần thẻ tín dụng',
              'Quảng cáo chỉ ở gói miễn phí',
              'Backup xuất/nhập JSON',
            ].map((bullet) => (
              <li key={bullet} className="inline-flex items-center gap-1.5">
                <Check className="h-3.5 w-3.5 text-ink-2/50" aria-hidden />
                {t(bullet)}
              </li>
            ))}
          </ul>
        </div>
        <div className="wv-hero-visual">
          <LandingProduct shot={shot} />
        </div>
      </div>
    </section>
  );
}
