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
  Package,
  ShieldX,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/theme-toggle';
import { getCurrentUser } from '@/lib/auth';
import { getI18n } from '@/lib/i18n/server';
import type { Translator } from '@/lib/i18n/catalog';

export const dynamic = 'force-dynamic';

// The three content arrays below carry user-facing copy, so they are built
// inside the page (and inside `t`) rather than at module scope: a module-level
// constant cannot see the request's language. Only the icons and tints — which
// are not copy — would survive out here, so the whole shape moved together.
function buildFeatures(t: Translator) {
  return [
    {
      icon: ShieldCheck,
      title: t('Theo dõi bảo hành'),
      desc: t(
        'Mỗi thiết bị có thể có nhiều gói bảo hành — gốc, mở rộng, bên thứ 3. Đếm ngược tự động.',
      ),
      tint: 'tint-primary',
    },
    {
      icon: Repeat,
      title: t('Quản lý gói đăng ký'),
      desc: t(
        'Netflix, iCloud, ChatGPT... theo dõi chu kỳ và ngày gia hạn. Quy ra chi phí mỗi tháng.',
      ),
      tint: 'tint-sky',
    },
    {
      icon: Heart,
      title: t('Wishlist “đang thèm”'),
      desc: t(
        'Món đang ngắm — đặt ngày mục tiêu, theo dõi giá. Mua xong là thành thiết bị luôn.',
      ),
      tint: 'tint-rose',
    },
    {
      icon: Bell,
      title: t('Cảnh báo sắp hết'),
      desc: t(
        'Bọn tao nhắc trước qua push notification — cả trên web lẫn app iOS/Android. Khỏi lo bỏ lỡ.',
      ),
      tint: 'tint-amber',
    },
    {
      icon: Receipt,
      title: t('Lưu hoá đơn & phiếu BH'),
      desc: t(
        'Tải ảnh hoặc PDF — tối đa 5 file mỗi thiết bị, mã hoá AES-256. Tìm lại nhanh khi cần đi bảo hành.',
      ),
      tint: 'tint-emerald',
    },
    {
      icon: BarChart3,
      title: t('Thống kê chi tiêu'),
      desc: t('Biểu đồ theo tháng, theo loại, top thiết bị đắt nhất. Biết tiền đi đâu.'),
      tint: 'tint-violet',
    },
  ];
}

function buildSteps(t: Translator) {
  return [
    { n: 1, title: t('Đăng ký miễn phí'), desc: t('Email + mật khẩu. 30 giây xong.') },
    {
      n: 2,
      title: t('Thêm thiết bị'),
      desc: t('Laptop, điện thoại, máy giặt... bất cứ thứ gì có bảo hành.'),
    },
    { n: 3, title: t('Theo dõi tự động'), desc: t('Khỏi đụng vào, tao lo phần đếm ngược.') },
  ];
}

function buildStatCards(t: Translator) {
  return [
    { l: t('Tổng'), v: '10', Icon: Package, tint: 'tint-primary' },
    { l: t('Còn BH'), v: '8', Icon: ShieldCheck, tint: 'tint-emerald' },
    { l: t('Sắp hết'), v: '2', Icon: AlertTriangle, tint: 'tint-amber' },
    // `Hết hạn`, not the bare `Hết` this card used to carry. The dictionary is
    // keyed by the Vietnamese sentence, and `Hết` is already taken by
    // `warranties.ts` as "Expires" — the end DATE on a warranty timeline, the
    // opposite sense to this card, which counts devices whose warranty has
    // already run out. One Vietnamese key cannot carry two English meanings, so
    // the two-character shorthand gave way to the unambiguous term the Go
    // catalog already uses for this state ("Đã hết hạn" → "Expired").
    { l: t('Hết hạn'), v: '1', Icon: ShieldX, tint: 'tint-zinc' },
  ];
}

function HeroIllustration() {
  return (
    <svg
      viewBox="0 0 320 280"
      width="100%"
      className="max-w-[360px]"
      style={{ filter: 'drop-shadow(0 30px 40px rgba(80, 40, 10, 0.18))' }}
      aria-hidden
    >
      <defs>
        <linearGradient id="vault-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary-2))" />
          <stop offset="100%" stopColor="hsl(var(--primary))" />
        </linearGradient>
      </defs>
      {/* Background blobs */}
      <circle cx="60" cy="70" r="40" fill="hsl(var(--violet-soft))" opacity="0.5" />
      <circle cx="280" cy="220" r="36" fill="hsl(var(--emerald-soft))" opacity="0.6" />
      <circle cx="270" cy="60" r="20" fill="hsl(var(--amber-soft))" />
      {/* Vault */}
      <g transform="translate(60, 50)">
        <rect
          x="0"
          y="20"
          width="200"
          height="180"
          rx="24"
          fill="url(#vault-grad)"
          stroke="hsl(var(--ink))"
          strokeWidth="3"
        />
        <rect
          x="14"
          y="34"
          width="172"
          height="150"
          rx="16"
          fill="hsl(var(--card))"
          stroke="hsl(var(--ink))"
          strokeWidth="3"
        />
        {/* dial */}
        <circle
          cx="80"
          cy="108"
          r="50"
          fill="hsl(var(--surface-2))"
          stroke="hsl(var(--ink))"
          strokeWidth="3"
        />
        <circle
          cx="80"
          cy="108"
          r="36"
          fill="hsl(var(--card))"
          stroke="hsl(var(--ink))"
          strokeWidth="2"
        />
        <circle cx="80" cy="108" r="10" fill="hsl(var(--ink))" />
        {[0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330].map((deg) => {
          const rad = ((deg - 90) * Math.PI) / 180;
          const x1 = 80 + Math.cos(rad) * 42;
          const y1 = 108 + Math.sin(rad) * 42;
          const x2 = 80 + Math.cos(rad) * 48;
          const y2 = 108 + Math.sin(rad) * 48;
          return (
            <line
              key={deg}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke="hsl(var(--ink))"
              strokeWidth="2"
            />
          );
        })}
        <line
          x1="80"
          y1="108"
          x2="80"
          y2="76"
          stroke="hsl(var(--ink))"
          strokeWidth="4"
          strokeLinecap="round"
          transform="rotate(45 80 108)"
        />
        {/* handle */}
        <circle cx="160" cy="108" r="6" fill="hsl(var(--ink))" />
        <rect x="156" y="60" width="8" height="100" rx="4" fill="hsl(var(--ink))" />
        <circle cx="160" cy="60" r="10" fill="hsl(var(--ink))" />
        <circle cx="160" cy="158" r="10" fill="hsl(var(--ink))" />
        {/* feet */}
        <rect x="4" y="200" width="16" height="14" rx="3" fill="hsl(var(--ink))" />
        <rect x="180" y="200" width="16" height="14" rx="3" fill="hsl(var(--ink))" />
        {/* eyes */}
        <circle cx="65" cy="102" r="3" fill="hsl(var(--ink))" />
        <circle cx="95" cy="102" r="3" fill="hsl(var(--ink))" />
        <path
          d="M 70 118 Q 80 124 90 118"
          stroke="hsl(var(--ink))"
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
        />
      </g>
      {/* Floating receipt */}
      <g transform="translate(220, 80) rotate(12)">
        <rect
          x="0"
          y="0"
          width="56"
          height="72"
          rx="6"
          fill="hsl(var(--card))"
          stroke="hsl(var(--ink))"
          strokeWidth="2"
        />
        <line
          x1="8"
          y1="14"
          x2="48"
          y2="14"
          stroke="hsl(var(--ink))"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <line
          x1="8"
          y1="24"
          x2="42"
          y2="24"
          stroke="hsl(var(--muted))"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <line
          x1="8"
          y1="32"
          x2="36"
          y2="32"
          stroke="hsl(var(--muted))"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <circle cx="28" cy="50" r="10" fill="hsl(var(--emerald-soft))" />
        <path
          d="M 23 50 l 4 4 l 8 -8"
          stroke="hsl(var(--emerald-ink))"
          strokeWidth="2.5"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
      {/* Floating bell */}
      <g transform="translate(28, 168) rotate(-14)">
        <circle
          cx="0"
          cy="0"
          r="22"
          fill="hsl(var(--amber-soft))"
          stroke="hsl(var(--ink))"
          strokeWidth="2.5"
        />
        <path
          d="M -8 -2 a 8 8 0 0 1 16 0 v 6 l 2 4 h -20 l 2 -4 z"
          fill="hsl(var(--ink))"
        />
      </g>
    </svg>
  );
}

export default async function LandingPage() {
  const { t } = await getI18n();
  const user = await getCurrentUser();

  const FEATURES = buildFeatures(t);
  const STEPS = buildSteps(t);
  const STAT_CARDS = buildStatCards(t);

  return (
    <div className="flex min-h-screen flex-col">
      {/* Header */}
      <header
        className="sticky top-0 z-30 border-b-[1.5px] border-border backdrop-blur-md"
        style={{ background: 'hsl(var(--background) / 0.85)' }}
      >
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3.5 md:px-8">
          <Link href="/" className="flex items-center gap-2.5">
            <span className="brand-mark">
              <Vault className="h-[18px] w-[18px]" />
            </span>
            <span className="font-display text-base font-extrabold tracking-tight text-ink">
              WarrantyVault
            </span>
          </Link>
          <div className="flex items-center gap-3">
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
        {/* Hero */}
        <section className="hero-gradient px-4 py-16 md:px-8 md:py-20">
          <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div>
              <span className="mb-5 inline-flex items-center gap-1.5 rounded-pill border-[1.5px] border-primary-soft-2 bg-primary-soft/70 px-3 py-1 text-xs font-bold text-primary-ink">
                <Sparkles className="h-3 w-3" />
                {t('Miễn phí · Local-first · Tiếng Việt')}
              </span>
              {/* One sentence, one key. Both languages happen to put the
                  warranty words in the same slot, so the gradient highlight is
                  applied to whichever substring the active language uses — the
                  sentence itself is never cut in two, which would hand a
                  translator two fragments whose order they cannot choose. */}
              <h1 className="display text-[clamp(36px,5vw,60px)]">
                {(() => {
                  const sentence = t('Đừng quên ngày hết bảo hành thiết bị của bạn');
                  // `t('bảo hành')` is a deliberate call on an unregistered key:
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
              <p className="mb-7 mt-4 max-w-xl text-[17px] leading-relaxed text-muted">
                {t(
                  'Theo dõi thiết bị, gói đăng ký và những món đang thèm — tất cả ở một chỗ. Nhắc bảo hành sắp hết, lưu hoá đơn, biết tiền chảy đi đâu.',
                )}
              </p>
              <div className="mb-6 flex flex-wrap items-center gap-3">
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
            <div className="flex justify-center lg:justify-end">
              <HeroIllustration />
            </div>
          </div>
        </section>

        {/* Mock preview */}
        <section className="px-4 md:px-8" style={{ marginTop: -40 }}>
          <div
            className="mx-auto max-w-5xl rounded-xl border-[2px] border-ink bg-card p-5 shadow-chunky"
            style={{ transform: 'rotate(-0.4deg)' }}
          >
            <div className="mb-4 flex items-center gap-2">
              <span className="h-3 w-3 rounded-full bg-[#FF6B5C]" />
              <span className="h-3 w-3 rounded-full bg-[#FBBF24]" />
              <span className="h-3 w-3 rounded-full bg-[#10B981]" />
              <span className="ml-2 text-xs text-muted">warrantyvault.app/dashboard</span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {STAT_CARDS.map((s) => {
                const Icon = s.Icon;
                return (
                  <div
                    key={s.l}
                    className="rounded-lg border-[1.5px] border-border bg-card p-3.5"
                  >
                    <div className="flex items-center justify-between">
                      <span className="eyebrow">{s.l}</span>
                      <span
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-md ${s.tint}`}
                      >
                        <Icon className="h-4 w-4" />
                      </span>
                    </div>
                    <div className="mt-1.5 font-display text-2xl font-extrabold tracking-tight">
                      {s.v}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Features */}
        <section className="px-4 py-24 md:px-8">
          <div className="mx-auto max-w-5xl">
            <div className="mb-10 text-center">
              <span className="eyebrow">{t('Tính năng')}</span>
              <h2 className="display mt-2 text-4xl">{t('Tất cả những gì mày cần')}</h2>
              <p className="mx-auto mt-3 max-w-lg text-muted">
                {t('Không spam tính năng, không tracking. Chỉ những thứ thực sự hữu ích.')}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => {
                const Icon = f.icon;
                return (
                  <div
                    key={f.title}
                    className="rounded-xl border-[1.5px] border-border bg-card p-6 shadow-soft transition-transform hover:-translate-y-0.5 hover:shadow-lift"
                  >
                    <span
                      className={`icon-badge-sm inline-flex h-11 w-11 items-center justify-center rounded-xl ${f.tint}`}
                    >
                      <Icon className="h-5 w-5" />
                    </span>
                    <h3 className="mt-4 font-display text-[17px] font-bold tracking-tight">
                      {f.title}
                    </h3>
                    <p className="mt-1.5 text-sm leading-relaxed text-muted">{f.desc}</p>
                  </div>
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
              <h2 className="display mt-2 text-3xl">{t('3 bước để bắt đầu')}</h2>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {STEPS.map((s) => (
                <div
                  key={s.n}
                  className="rounded-xl border-[1.5px] border-border bg-card p-7 text-center shadow-soft"
                >
                  <div className="mx-auto mb-3.5 inline-flex h-[52px] w-[52px] items-center justify-center rounded-[16px] bg-primary font-display text-2xl font-extrabold text-primary-foreground">
                    {s.n}
                  </div>
                  <h4 className="font-display text-[18px] font-bold">{s.title}</h4>
                  <p className="mt-1.5 text-sm text-muted">{s.desc}</p>
                </div>
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
                {t('Sẵn sàng quản lý thiết bị?')}
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
                WarrantyVault
              </span>
            </Link>
            {/* The year is interpolated rather than concatenated, so the
                sentence stays one translatable key. */}
            <div className="text-[13px] text-muted">
              {t('© {year} WarrantyVault. Made with ♥ in Vietnam.', {
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
