'use client';

import Link from 'next/link';
import { Reveal } from '@/components/reveal';
import { FeatureVisual, type FeatureVisualSubject } from './feature-visuals';
import { useT } from '@/lib/i18n/client';
import type { Translator } from '@/lib/i18n/catalog';
import { loginHref } from '@/lib/next-path';

/**
 * The six jobs Warrly does.
 *
 * This used to be a grid of six identical cards: same size, same padding,
 * same headline weight, a full-bleed illustration above each. Nothing told a
 * reader which one to read and the section ran to six screens on a phone. It
 * is now an index: one heading, then numbered rows in two columns on a wide
 * screen. The illustrations keep their one coral dot but are the size of a
 * stamp, not the size of the card, so the copy leads and the object supports
 * it. The whole section is one surface change rather than six boxes.
 *
 * The copy is built with `useT()` here rather than in the server page: an
 * in-place switch must reach every title, description and illustration alt
 * text. The icons/SVGs are plain components, so they move into the client
 * graph with the copy; the server still renders all of it to HTML.
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
    <section
      className="border-y border-border bg-card px-4 py-16 md:px-8 md:py-24"
      aria-labelledby="wv-features-title"
    >
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <p className="text-[13px] font-semibold text-ink-2/80">{t('Tính năng')}</p>
          <h2
            id="wv-features-title"
            className="display mt-2 text-3xl leading-[1.1] tracking-[-0.02em] text-ink md:text-4xl"
          >
            {t('Sáu việc nhỏ. Một chỗ.')}
          </h2>
          <p className="mt-4 max-w-xl text-[17px] leading-[1.65] text-ink-2">
            {t('Không bảng điều khiển rối rắm. Mỗi mục trả lời đúng một câu hỏi.')}
          </p>
        </div>

        <ul className="mt-10 grid border-t border-border md:grid-cols-2 md:gap-x-12">
          {features.map((f, index) => {
            // Signed-out visitors cannot render an `(app)` route: its layout
            // calls `requireUser()`, and a bare redirect to /login would throw
            // this row's destination away. Send them through
            // `/login?next=<this row's own href>` instead, so the auth action
            // can return them here after signing in.
            const href = signedIn ? f.href : loginHref(f.href);
            return (
              <li key={f.visual} className="border-b border-border">
                <Reveal index={index} className="block">
                  <Link
                    href={href}
                    className="group flex items-start gap-4 rounded-md py-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-4 focus-visible:ring-offset-card md:gap-5"
                  >
                    <span
                      className="mt-0.5 flex w-[84px] shrink-0 items-center justify-center rounded-md bg-surface-2 p-1.5 transition-colors group-hover:bg-surface-3 md:w-24"
                    >
                      <FeatureVisual
                        subject={f.visual}
                        label={f.alt}
                        className="h-auto w-full"
                      />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12px] font-semibold tabular-nums text-ink-2/50">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span className="mt-0.5 block font-display text-[18px] font-bold tracking-[-0.01em] text-ink group-hover:underline group-hover:decoration-border-strong group-hover:underline-offset-4">
                        {f.title}
                      </span>
                      <span className="mt-1.5 block text-[14px] leading-[1.6] text-ink-2/80">
                        {f.desc}
                      </span>
                    </span>
                  </Link>
                </Reveal>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
