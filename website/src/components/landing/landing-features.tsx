'use client';

import Link from 'next/link';
import { Reveal } from '@/components/reveal';
import { FeatureVisual, type FeatureVisualSubject } from './feature-visuals';
import { useT } from '@/lib/i18n/client';
import type { Translator } from '@/lib/i18n/catalog';
import { loginHref } from '@/lib/next-path';

/**
 * The six feature cards.
 *
 * The copy is built with `useT()` here rather than in the server page: the
 * cards cover the whole lower half of the landing, and an in-place switch must
 * reach every title, description and illustration alt text. The icons/SVGs are
 * plain components, so they move into the client graph with the copy; the
 * server still renders all of it to HTML.
 *
 * The subject is chosen per feature and the alt text is a translated key (see
 * `messages/public.ts`), never an English literal: the images are content, so a
 * screen reader must hear them in the reader's language.
 */
type Feature = {
  title: string;
  desc: string;
  href: string;
  visual: FeatureVisualSubject;
  alt: string;
};

function buildFeatures(t: Translator): Feature[] {
  return [
    {
      visual: 'warranty-booklet',
      alt: t('Sổ bảo hành'),
      title: t('Bảo hành'),
      desc: t(
        'Mỗi thiết bị có thể có nhiều gói — gốc, mở rộng, bên thứ ba. Warrly tự đếm ngược.',
      ),
      href: '/devices',
    },
    {
      visual: 'phone',
      alt: t('Điện thoại'),
      title: t('Gói đăng ký'),
      desc: t('Netflix, iCloud, ChatGPT: chu kỳ, ngày gia hạn, và chi phí mỗi tháng.'),
      href: '/subscriptions',
    },
    {
      visual: 'motorbike-key',
      alt: t('Chìa khoá xe máy'),
      title: t('Wishlist'),
      desc: t('Món đang ngắm — ngày mục tiêu, giá, và mua xong thì thành thiết bị.'),
      href: '/wishlist',
    },
    {
      visual: 'ac-remote',
      alt: t('Điều khiển điều hoà'),
      title: t('Nhắc trước khi hết hạn'),
      // The old card promised "the web and the iOS/Android apps". There is no
      // store link in this repo and iOS ships through TestFlight, so that was
      // an unactionable claim. This names the one install a visitor can
      // actually get.
      desc: t(
        'Thông báo đẩy trên web, và trên iOS beta qua TestFlight. Đủ sớm để bạn kịp xử lý.',
      ),
      href: '/reminders',
    },
    {
      visual: 'red-invoice',
      alt: t('Hoá đơn đỏ'),
      title: t('Hoá đơn & phiếu bảo hành'),
      desc: t(
        'Ảnh hoặc PDF, tối đa 5 tệp mỗi thiết bị, mã hoá AES-256. Mở lại đúng lúc bạn cần đi bảo hành.',
      ),
      // The capture-first inbox is where an invoice/PDF is uploaded before it
      // is attached to a device; the warranty card above already points at
      // /devices, so each card keeps its own destination.
      href: '/inbox',
    },
    {
      visual: 'rice-cooker',
      alt: t('Nồi cơm điện'),
      title: t('Chi tiêu'),
      desc: t('Theo tháng, theo loại, thiết bị đắt nhất. Biết tiền đã đi đâu.'),
      href: '/stats',
    },
  ];
}

export function LandingFeatures({ signedIn }: { signedIn: boolean }) {
  const t = useT();
  const features = buildFeatures(t);

  return (
    <section className="px-4 py-24 md:px-8">
      <div className="mx-auto max-w-5xl">
        <div className="mb-10 text-center">
          <span className="eyebrow">{t('Tính năng')}</span>
          <h2 className="display mt-2 text-4xl text-ink">
            {t('Sáu việc nhỏ. Một chỗ.')}
          </h2>
          <p className="mx-auto mt-3 max-w-lg text-muted">
            {t('Không bảng điều khiển rối rắm. Mỗi mục trả lời đúng một câu hỏi.')}
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f, index) => {
            // Signed-out visitors cannot render an `(app)` route: its
            // layout calls `requireUser()`, and a bare redirect to /login
            // would throw this card's destination away. Send them through
            // `/login?next=<this card's own href>` instead, so the auth
            // action can return them here after signing in.
            const href = signedIn ? f.href : loginHref(f.href);
            return (
              <Reveal
                key={f.visual}
                index={index}
                className="flex"
                // Three of the six get the CSS scroll-timeline path in
                // Chrome 115+/Safari 26+; the rest are JS-revealed. The
                // observer skips these only when that path is really live.
                scrollDriven={index < 3}
              >
                <div className="feature-card relative flex h-full w-full flex-col rounded-xl border-[1.5px] border-border bg-card p-6 shadow-soft">
                  {/* A Vietnamese household object, not a line icon.
                      One accent dot per drawing ties the set to the mark's
                      date dot; the card copy still carries the meaning. */}
                  <FeatureVisual subject={f.visual} label={f.alt} />
                  <h3 className="mt-4 font-display text-[17px] font-bold tracking-tight">
                    {/* The title is the card's link. Its ::after stretches
                        over the whole card, so the entire card is a target
                        while the keyboard still gets one real, named link.
                        `:has(:focus-visible)` below lifts the card and
                        draws the ring when that link has keyboard focus. */}
                    <Link
                      href={href}
                      className="feature-card-link after:absolute after:inset-0 after:content-['']"
                    >
                      {f.title}
                    </Link>
                  </h3>
                  <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.desc}</p>
                </div>
              </Reveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
