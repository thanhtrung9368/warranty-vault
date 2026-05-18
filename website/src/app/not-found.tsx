import Link from 'next/link';
import { Vault } from 'lucide-react';
import { Button } from '@/components/ui/button';

export const metadata = {
  title: 'Không tìm thấy — WarrantyVault',
};

export default function NotFound() {
  return (
    <div className="auth-gradient flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-4 py-5 md:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="brand-mark">
            <Vault className="h-[18px] w-[18px]" />
          </span>
          <span className="font-display text-base font-extrabold tracking-tight text-ink">
            WarrantyVault
          </span>
        </Link>
      </header>

      <main className="flex flex-1 items-center justify-center px-4 pb-12">
        <div className="w-full max-w-lg rounded-[var(--radius)] border border-border bg-card/80 px-6 py-10 text-center shadow-[0_30px_80px_-40px_rgba(60,20,5,0.25)] backdrop-blur md:px-10">
          <div className="mb-2 flex justify-center">
            <span className="eyebrow">Mã 404</span>
          </div>

          <div className="mb-6 flex justify-center">
            <Vault404Illustration />
          </div>

          <h1 className="display text-[34px] text-ink md:text-[40px]">
            Két sắt trống rỗng!
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted md:text-[15px]">
            Trang mày tìm chưa từng tồn tại — hoặc đã bị di chuyển đi nơi khác.
          </p>

          <div className="mt-7 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/">Về trang chủ</Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link href="/dashboard">Quay lại Dashboard</Link>
            </Button>
          </div>

          <p className="mt-8 text-[11px] font-medium uppercase tracking-[0.12em] text-muted/80">
            Mã lỗi 404 · WarrantyVault
          </p>
        </div>
      </main>
    </div>
  );
}

function Vault404Illustration() {
  return (
    <svg
      viewBox="0 0 220 180"
      width="220"
      height="180"
      role="img"
      aria-label="Két sắt trống rỗng"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* soft background tint */}
      <ellipse cx="110" cy="160" rx="86" ry="10" fill="hsl(var(--primary-soft))" opacity="0.7" />

      {/* back cube shadow */}
      <rect
        x="36"
        y="36"
        width="148"
        height="112"
        rx="18"
        fill="hsl(var(--primary-soft))"
        stroke="hsl(var(--primary))"
        strokeWidth="2"
      />

      {/* main vault body */}
      <rect
        x="28"
        y="28"
        width="148"
        height="112"
        rx="18"
        fill="hsl(var(--background))"
        stroke="hsl(var(--ink))"
        strokeWidth="2.5"
      />

      {/* inner panel */}
      <rect
        x="40"
        y="40"
        width="124"
        height="88"
        rx="12"
        fill="hsl(var(--primary-soft))"
        stroke="hsl(var(--ink))"
        strokeWidth="2"
        strokeOpacity="0.6"
      />

      {/* dial — circle 1 (outer ring) */}
      <circle
        cx="102"
        cy="84"
        r="38"
        fill="hsl(var(--background))"
        stroke="hsl(var(--ink))"
        strokeWidth="2.5"
      />
      {/* dial ticks */}
      <g stroke="hsl(var(--ink))" strokeWidth="2" opacity="0.35">
        <line x1="102" y1="50" x2="102" y2="56" />
        <line x1="102" y1="112" x2="102" y2="118" />
        <line x1="68" y1="84" x2="74" y2="84" />
        <line x1="130" y1="84" x2="136" y2="84" />
      </g>
      {/* dial inner ring */}
      <circle
        cx="102"
        cy="84"
        r="28"
        fill="hsl(var(--primary))"
        opacity="0.12"
        stroke="hsl(var(--primary))"
        strokeWidth="1.5"
      />
      {/* 404 text on dial */}
      <text
        x="102"
        y="92"
        textAnchor="middle"
        fontFamily="'Plus Jakarta Sans', system-ui, sans-serif"
        fontWeight="800"
        fontSize="22"
        letterSpacing="-0.02em"
        fill="hsl(var(--primary-ink))"
      >
        404
      </text>

      {/* dial knob */}
      <circle cx="102" cy="84" r="4" fill="hsl(var(--ink))" />

      {/* hinges (left side) */}
      <rect x="22" y="50" width="10" height="14" rx="3" fill="hsl(var(--ink))" />
      <rect x="22" y="104" width="10" height="14" rx="3" fill="hsl(var(--ink))" />

      {/* handle (right side) */}
      <rect
        x="156"
        y="76"
        width="22"
        height="16"
        rx="6"
        fill="hsl(var(--primary))"
        stroke="hsl(var(--ink))"
        strokeWidth="2"
      />

      {/* feet */}
      <rect x="46" y="140" width="14" height="10" rx="3" fill="hsl(var(--ink))" />
      <rect x="144" y="140" width="14" height="10" rx="3" fill="hsl(var(--ink))" />

      {/* sparkle accents */}
      <g fill="hsl(var(--primary))">
        <circle cx="186" cy="42" r="3" />
        <circle cx="22" cy="130" r="2.5" opacity="0.7" />
        <circle cx="196" cy="120" r="2" opacity="0.6" />
      </g>
    </svg>
  );
}
