import Link from 'next/link';
import { Vault, Wifi, Plane, RotateCcw } from 'lucide-react';
import { RetryButton } from './retry-button';

export const metadata = {
  title: 'Ngoại tuyến — WarrantyVault',
};

export default function OfflinePage() {
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
            <span className="eyebrow">Trạng thái · Offline</span>
          </div>

          <div className="mb-5 flex justify-center">
            <OfflineCloudIllustration />
          </div>

          <h1 className="display text-[30px] text-ink md:text-[36px]">
            Mất kết nối rồi 📡
          </h1>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted md:text-[15px]">
            Mày đang offline. Một số dữ liệu đã lưu trước đó vẫn xem được — phần còn lại sẽ sync khi có mạng.
          </p>

          <div className="mt-6 flex justify-center">
            <RetryButton />
          </div>

          <div className="mt-8 text-left">
            <div className="info-row">
              <span className="info-row-icon">
                <Wifi className="h-4 w-4" />
              </span>
              <div>
                <div className="info-row-label">Bước 1</div>
                <div className="info-row-value">Kiểm tra Wi-Fi / dữ liệu di động</div>
              </div>
            </div>
            <div className="info-row">
              <span className="info-row-icon">
                <Plane className="h-4 w-4" />
              </span>
              <div>
                <div className="info-row-label">Bước 2</div>
                <div className="info-row-value">Bật/tắt chế độ máy bay</div>
              </div>
            </div>
            <div className="info-row">
              <span className="info-row-icon">
                <RotateCcw className="h-4 w-4" />
              </span>
              <div>
                <div className="info-row-label">Bước 3</div>
                <div className="info-row-value">Kết nối lại rồi thử lại</div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

function OfflineCloudIllustration() {
  return (
    <svg
      viewBox="0 0 200 140"
      width="200"
      height="140"
      role="img"
      aria-label="Mất kết nối"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* ground shadow */}
      <ellipse cx="100" cy="124" rx="64" ry="6" fill="hsl(var(--primary-soft))" opacity="0.6" />

      {/* back cloud shadow */}
      <g transform="translate(6,6)">
        <path
          d="M50 78 C 36 78 28 68 32 56 C 24 50 26 38 36 34 C 38 22 52 18 62 24 C 70 14 90 14 96 28 C 110 24 124 32 124 46 C 134 46 142 56 138 68 C 142 78 134 86 122 84 L 58 84 C 52 86 50 84 50 78 Z"
          fill="hsl(var(--primary-soft))"
          opacity="0.7"
        />
      </g>

      {/* main cloud */}
      <path
        d="M50 78 C 36 78 28 68 32 56 C 24 50 26 38 36 34 C 38 22 52 18 62 24 C 70 14 90 14 96 28 C 110 24 124 32 124 46 C 134 46 142 56 138 68 C 142 78 134 86 122 84 L 58 84 C 52 86 50 84 50 78 Z"
        fill="hsl(var(--background))"
        stroke="hsl(var(--ink))"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />

      {/* sad face on cloud */}
      <g fill="hsl(var(--ink))">
        <circle cx="76" cy="52" r="3" />
        <circle cx="104" cy="52" r="3" />
      </g>
      <path
        d="M76 70 Q 90 60 104 70"
        fill="none"
        stroke="hsl(var(--ink))"
        strokeWidth="2.5"
        strokeLinecap="round"
      />

      {/* strike-through line — coral */}
      <line
        x1="24"
        y1="22"
        x2="172"
        y2="100"
        stroke="hsl(var(--background))"
        strokeWidth="8"
        strokeLinecap="round"
      />
      <line
        x1="24"
        y1="22"
        x2="172"
        y2="100"
        stroke="hsl(var(--primary))"
        strokeWidth="4"
        strokeLinecap="round"
      />

      {/* signal dots — fading */}
      <g fill="hsl(var(--primary))">
        <circle cx="170" cy="36" r="3" opacity="0.9" />
        <circle cx="182" cy="48" r="2.5" opacity="0.55" />
        <circle cx="188" cy="62" r="2" opacity="0.3" />
      </g>
      <g fill="hsl(var(--primary))">
        <circle cx="22" cy="100" r="2" opacity="0.4" />
        <circle cx="14" cy="86" r="2.5" opacity="0.6" />
      </g>
    </svg>
  );
}
