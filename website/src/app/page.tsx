import Link from 'next/link';
import {
  Vault,
  ShieldCheck,
  Bell,
  Receipt,
  BarChart3,
  Repeat,
  Heart,
  ArrowRight,
  CheckCircle2,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { LocaleSwitcher } from '@/components/locale-switcher';
import { Reveal } from '@/components/reveal';
import { RevealObserver } from '@/components/reveal-observer';
import { PinnedStage } from '@/components/pinned-stage';
import { LandingProduct } from '@/components/landing-product';
import { getCurrentUser } from '@/lib/auth';
import { getI18n } from '@/lib/i18n/server';
import type { Translator } from '@/lib/i18n/catalog';
import { loginHref } from '@/lib/next-path';

export const dynamic = 'force-dynamic';

// The three content arrays below carry user-facing copy, so they are built
// inside the page (and inside `t`) rather than at module scope: a module-level
// constant cannot see the request's language. Only the icons and hrefs — which
// are not copy — would survive out here, so the whole shape moved together.
function buildFeatures(t: Translator) {
  return [
    {
      icon: ShieldCheck,
      title: t('Bảo hành'),
      desc: t(
        'Mỗi thiết bị có thể có nhiều gói — gốc, mở rộng, bên thứ ba. Warrly tự đếm ngược.',
      ),
      href: '/devices',
    },
    {
      icon: Repeat,
      title: t('Gói đăng ký'),
      desc: t('Netflix, iCloud, ChatGPT: chu kỳ, ngày gia hạn, và chi phí mỗi tháng.'),
      href: '/subscriptions',
    },
    {
      icon: Heart,
      title: t('Wishlist'),
      desc: t('Món đang ngắm — ngày mục tiêu, giá, và mua xong thì thành thiết bị.'),
      href: '/wishlist',
    },
    {
      icon: Bell,
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
      icon: Receipt,
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
      icon: BarChart3,
      title: t('Chi tiêu'),
      desc: t('Theo tháng, theo loại, thiết bị đắt nhất. Biết tiền đã đi đâu.'),
      href: '/stats',
    },
  ];
}

function buildSteps(t: Translator) {
  return [
    {
      n: 1,
      title: t('Đăng ký miễn phí'),
      desc: t('Email và mật khẩu. Xong trong 30 giây.'),
    },
    {
      n: 2,
      title: t('Thêm thiết bị'),
      desc: t('Laptop, điện thoại, máy giặt — bất cứ thứ gì có bảo hành.'),
    },
    {
      n: 3,
      title: t('Để Warrly nhắc'),
      desc: t('Warrly giữ ngày hết hạn và nhắc bạn trước.'),
    },
  ];
}

function buildStage(t: Translator) {
  return {
    eyebrow: t('Trước khi hết hạn'),
    title: t('Từ lúc mua đến lúc hết hạn.'),
    sub: t('Warrly giữ ngày bảo hành, hoá đơn và lời nhắc ở cùng một chỗ.'),
    beats: [
      {
        title: t('Mọi thứ trong nhà'),
        desc: t('Tủ lạnh, máy giặt, chiếc iPhone. Một danh sách, đúng tên bạn gọi.'),
      },
      {
        title: t('Ngày và hoá đơn'),
        desc: t('Ngày hết hạn, các gói bảo hành và tấm ảnh hoá đơn nằm cạnh nhau.'),
      },
      {
        title: t('Nhắc trước khi quá muộn'),
        desc: t(
          'Warrly báo trước qua thông báo đẩy — đủ sớm để bạn kịp đi bảo hành.',
        ),
      },
    ],
  };
}

export default async function LandingPage() {
  // `locale` is needed for the compact language switch, not just for `t`: the
  // switcher marks the active language and posts the chosen one to the same
  // Server Action the public legal pages use (cookie + `User.locale`).
  const { locale, t } = await getI18n();
  const user = await getCurrentUser();

  const FEATURES = buildFeatures(t);
  const STEPS = buildSteps(t);
  const STAGE = buildStage(t);

  return (
    <div className="flex min-h-screen flex-col">
      {/* One observer for every <Reveal> on the page. It renders nothing; the
          wrapper markup and the animation are server/CSS-owned. Mounted here
          rather than in the root layout so no other route pays for the JS. */}
      <RevealObserver />
      {/* Header */}
      <header
        className="sticky top-0 z-30 border-b-[1.5px] border-border backdrop-blur-md"
        style={{ background: 'hsl(var(--background) / 0.85)' }}
      >
        {/* `flex-wrap`: the logo row keeps its size and the controls drop to a
            second, right-aligned row on narrow phones instead of pushing the
            header into horizontal overflow. */}
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-y-2 px-4 py-3.5 md:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="brand-mark">
              <Vault className="h-[18px] w-[18px]" />
            </span>
            <span className="font-display text-base font-extrabold tracking-tight text-ink">
              Warrly
            </span>
          </Link>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {/* The same compact switcher `/privacy`, `/terms` and `/cookies`
                render. `/` is public and has no session, so without it a
                Vietnamese visitor landing here could not choose a language at
                all — their copy would be whatever `Accept-Language` happened to
                say. The action writes the `wv_locale` cookie (and `User.locale`
                when signed in), then revalidates the shell. */}
            <LocaleSwitcher current={locale} variant="compact" />
            <ThemeToggle />
            {user ? (
              <Button asChild>
                <Link href="/dashboard">
                  {t('Vào app')}
                  <ArrowRight className="ml-1 h-4 w-4" />
                </Link>
              </Button>
            ) : (
              <>
                <Link
                  href="/login"
                  className="hidden text-sm font-semibold text-ink-2 hover:text-ink sm:inline-flex"
                >
                  {t('Đăng nhập')}
                </Link>
                <Button asChild>
                  <Link href="/register">{t('Bắt đầu miễn phí')}</Link>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero — the H1 is the LCP element and is deliberately never wrapped
            in a reveal or an opacity-0 start state. The product composition
            appears beside it from the server HTML. */}
        <section className="wv-hero px-4 pb-16 pt-16 md:px-8 md:pb-24 md:pt-24">
          <div className="mx-auto grid max-w-6xl items-center gap-12 lg:grid-cols-[minmax(0,1.06fr)_minmax(0,0.94fr)] lg:gap-14">
            <div className="max-w-2xl">
              <p className="wv-hero-eyebrow">
                <Sparkles aria-hidden />
                {t('Miễn phí · Không quảng cáo, không theo dõi · Xây cho Việt Nam')}
              </p>
              {/* One sentence, one key. Both languages happen to put the
                  warranty words in the same slot, so the gradient highlight is
                  applied to whichever substring the active language uses — the
                  sentence itself is never cut in two, which would hand a
                  translator two fragments whose order they cannot choose.
                  `sentence.indexOf` also means no text mask is involved: the
                  Vietnamese diacritics are never clipped.

                  The H1 is the LCP element and is deliberately never wrapped
                  in a reveal and never starts at `opacity: 0`. Its font size is
                  capped so the longer sentence stays at three lines in the
                  desktop column rather than five. */}
              <h1 className="display mt-5 text-[clamp(32px,3.2vw,46px)] text-ink">
                {(() => {
                  const sentence = t(
                    'Giữ ngày hết bảo hành — và cả hoá đơn — cho mọi thứ trong nhà.',
                  );
                  // `t('bảo hành')` is a deliberate call on a registered key:
                  // it returns "bảo hành" in Vietnamese and the dictionary's
                  // English word for it in English, which is exactly the
                  // substring this page wants to highlight. If a future English
                  // sentence stops containing that word, `at === -1` below just
                  // renders the whole sentence unhighlighted instead of
                  // breaking the layout.
                  const mark = t('bảo hành');
                  const at = sentence.indexOf(mark);
                  if (at === -1) return sentence;
                  return (
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
                  );
                })()}
              </h1>
              <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-muted md:text-[19px]">
                {t(
                  'Tủ lạnh, máy giặt, chiếc iPhone: mỗi món có một ngày hết hạn và một tấm hoá đơn. Warrly giữ cả hai, và nhắc bạn trước khi bảo hành hết hiệu lực.',
                )}
              </p>
              <div className="mb-6 mt-8 flex flex-wrap items-center gap-3">
                {user ? (
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
                  'Không quảng cáo',
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
              <LandingProduct t={t} locale={locale} />
            </div>
          </div>
        </section>

        {/* Pinned product stage.
            Above `lg` the wrapper is a tall track and the panel sticks below
            the header; `PinnedStage` writes `--p` and every beat, the scale and
            the clip wipe are CSS `calc()`. Below `lg` the pin is gone and the
            same three beats are a plain vertical sequence with the existing
            one-shot `<Reveal>`. Under reduced motion the CSS collapses the pin
            entirely and the composition is shown static and unclipped. */}
        <section className="wv-stage" aria-labelledby="wv-stage-title">
          <PinnedStage>
            <div className="wv-stage-copy">
              <p className="eyebrow">{STAGE.eyebrow}</p>
              <h2 id="wv-stage-title" className="display wv-stage-title">
                {STAGE.title}
              </h2>
              <p className="wv-stage-sub">{STAGE.sub}</p>
              <div className="wv-stage-beats">
                {STAGE.beats.map((beat, index) => (
                  <Reveal key={beat.title} index={index} className="wv-stage-beat">
                    <div className="wv-stage-beat-inner">
                      <p className="wv-stage-beat-num">
                        {String(index + 1).padStart(2, '0')}
                      </p>
                      <h3 className="wv-stage-beat-title">{beat.title}</h3>
                      <p className="wv-stage-beat-desc">{beat.desc}</p>
                    </div>
                  </Reveal>
                ))}
              </div>
              <div className="wv-stage-progress" aria-hidden>
                <span />
              </div>
            </div>
            <div className="wv-stage-visual">
              <LandingProduct t={t} locale={locale} />
            </div>
          </PinnedStage>
        </section>

        {/* Features */}
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
              {FEATURES.map((f, index) => {
                const Icon = f.icon;
                // Signed-out visitors cannot render an `(app)` route: its
                // layout calls `requireUser()`, and a bare redirect to /login
                // would throw this card's destination away. Send them through
                // `/login?next=<this card's own href>` instead, so the auth
                // action can return them here after signing in.
                const href = user ? f.href : loginHref(f.href);
                return (
                  <Reveal
                    key={f.title}
                    index={index}
                    className="flex"
                    // Three of the six get the CSS scroll-timeline path in
                    // Chrome 115+/Safari 26+; the rest are JS-revealed. The
                    // observer skips these only when that path is really live.
                    scrollDriven={index < 3}
                  >
                    <div className="feature-card relative flex h-full w-full flex-col rounded-xl border-[1.5px] border-border bg-card p-6 shadow-soft">
                      {/* No pastel chip behind the icon. The six tinted
                          badges made the grid read like a toy dashboard; a
                          single-colour line icon is the quieter, more Apple
                          shape and lets the card copy carry the hierarchy. */}
                      <Icon className="h-6 w-6 text-primary" strokeWidth={1.75} aria-hidden />
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

        {/* 3 steps */}
        <section className="px-4 py-14 md:px-8">
          <div className="mx-auto max-w-5xl">
            <div className="mb-10 text-center">
              <span className="eyebrow">{t('Bắt đầu như thế nào')}</span>
              <h2 className="display mt-2 text-3xl text-ink">
                {t('Ba bước để bắt đầu.')}
              </h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {STEPS.map((s, index) => (
                <Reveal key={s.n} index={index} className="flex">
                  <div className="h-full w-full rounded-xl border-[1.5px] border-border bg-card p-7 text-center shadow-soft">
                    <div className="mx-auto mb-3.5 inline-flex h-[52px] w-[52px] items-center justify-center rounded-[16px] bg-primary font-display text-2xl font-extrabold text-primary-foreground">
                      {s.n}
                    </div>
                    <h4 className="font-display text-[18px] font-bold">{s.title}</h4>
                    <p className="mt-1.5 text-sm text-muted">{s.desc}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="px-4 py-20 md:px-8">
          <div className="mx-auto max-w-2xl">
            <div
              className="rounded-xl border-[2px] border-ink p-12 text-center shadow-chunky"
              style={{
                background:
                  'linear-gradient(135deg, hsl(var(--primary-soft)), hsl(var(--primary-soft-2)))',
              }}
            >
              <div className="mx-auto mb-4 inline-flex h-16 w-16 items-center justify-center rounded-[18px] bg-ink text-background">
                <Vault className="h-8 w-8" />
              </div>
              <h2 className="display text-3xl text-primary-ink">
                {t('Giữ ngày bảo hành ngay từ hôm nay.')}
              </h2>
              <p className="mt-2 text-primary-ink/80">
                {t('Free mãi mãi. Không cần thẻ. Không quảng cáo.')}
              </p>
              <div className="mt-6 flex justify-center">
                <Button asChild size="lg">
                  <Link href={user ? '/dashboard' : '/register'}>
                    {user ? t('Mở Dashboard') : t('Tạo tài khoản miễn phí')}
                    <ArrowRight className="ml-1 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            </div>
          </div>
        </section>

        {/* Footer */}
        <footer className="border-t-[1.5px] border-border bg-card px-4 py-8 md:px-8">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="brand-mark brand-mark-sm">
                <Vault className="h-4 w-4" />
              </span>
              <span className="font-display text-sm font-extrabold tracking-tight text-ink">
                Warrly
              </span>
            </Link>
            {/* The year is interpolated rather than concatenated, so the
                sentence stays one translatable key. */}
            <div className="text-[13px] text-muted">
              {t('© {year} Warrly.', {
                year: new Date().getFullYear(),
              })}
            </div>
            <div className="flex items-center gap-4 text-[13px]">
              <Link href="/privacy" className="text-muted hover:text-ink">
                Privacy
              </Link>
              <Link href="/terms" className="text-muted hover:text-ink">
                Terms
              </Link>
              <Link href="/cookies" className="text-muted hover:text-ink">
                Cookies
              </Link>
              <Link href="/login" className="font-semibold text-primary hover:underline">
                {t('Đăng nhập')}
              </Link>
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
