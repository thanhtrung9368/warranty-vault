'use client';

import Link from 'next/link';
import { ArrowRight, CheckCircle2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LandingProduct, type LandingProductShot } from './landing-product';
import { useT } from '@/lib/i18n/client';

/**
 * The hero.
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

  // One sentence, one key. Both languages happen to put the warranty words in
  // the same slot, so the gradient highlight is applied to whichever substring
  // the active language uses — the sentence itself is never cut in two, which
  // would hand a translator two fragments whose order they cannot choose.
  // `sentence.indexOf` also means no text mask is involved: the Vietnamese
  // diacritics are never clipped.
  const sentence = t('Giữ ngày hết bảo hành — và cả hoá đơn — cho mọi thứ trong nhà.');
  const mark = t('bảo hành');
  const at = sentence.indexOf(mark);

  return (
    <section className="wv-hero px-4 pb-16 pt-16 md:px-8 md:pb-24 md:pt-24">
      <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[minmax(0,1.06fr)_minmax(0,0.94fr)] lg:gap-14">
        <div className="max-w-2xl">
          <p className="wv-hero-eyebrow text-balance">
            <Sparkles aria-hidden />
            {t('Miễn phí có quảng cáo · Gói trả phí chưa mở bán')}
          </p>
          {/* The H1 is the LCP element and is deliberately never wrapped in a
              reveal and never starts at `opacity: 0`. Its font size is capped
              so the longer sentence stays at three lines in the desktop column
              rather than five. */}
          <h1 className="display mt-5 text-[clamp(32px,3.2vw,46px)] text-ink">
            {at === -1 ? (
              sentence
            ) : (
              <>
                {sentence.slice(0, at)}
                <span
                  className="bg-clip-text text-transparent"
                  style={{
                    backgroundImage:
                      'linear-gradient(120deg, hsl(var(--primary)), hsl(var(--primary-2)))',
                  }}
                >
                  {mark}
                </span>
                {sentence.slice(at + mark.length)}
              </>
            )}
          </h1>
          <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-muted md:text-[19px]">
            {t(
              'Tủ lạnh, máy giặt, chiếc iPhone: mỗi món có một ngày hết hạn và một tấm hoá đơn. Warrly giữ cả hai, và nhắc bạn trước khi bảo hành hết hiệu lực.',
            )}
          </p>
          <div className="mb-6 mt-8 flex flex-wrap items-center gap-3">
            {signedIn ? (
              <Button asChild size="lg">
                <Link href="/dashboard">
                  {t('Mở Dashboard')}
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <>
                <Button asChild size="lg">
                  <Link href="/register">
                    {t('Tạo tài khoản miễn phí')}
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
                <Link
                  href="/login"
                  className="text-sm font-semibold text-primary hover:underline"
                >
                  {t('Đã có tài khoản → Đăng nhập')}
                </Link>
              </>
            )}
          </div>
          <ul className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-muted">
            {[
              'Không cần thẻ tín dụng',
              'Quảng cáo chỉ ở gói miễn phí',
              'Backup xuất/nhập JSON',
            ].map((bullet) => (
              <li key={bullet} className="inline-flex items-center gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" style={{ color: 'hsl(var(--emerald))' }} />
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
