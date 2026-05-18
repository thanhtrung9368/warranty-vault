'use client';

import * as React from 'react';
import {
  Circle,
  Minus,
  Monitor,
  Moon,
  MoreHorizontal,
  Rows3,
  Square,
  Sun,
  Type,
} from 'lucide-react';
import { useTheme } from 'next-themes';

type Radius = 'sharp' | 'soft' | 'chunky';
type Density = 'loose' | 'cozy' | 'dense';
type Font = 'jakarta' | 'system' | 'inter' | 'serif';

type Prefs = {
  radius: Radius;
  density: Density;
  font: Font;
};

const DEFAULTS: Prefs = { radius: 'soft', density: 'cozy', font: 'jakarta' };

const STORAGE_KEY = 'wv:prefs';

function readPrefs(): Prefs {
  if (typeof window === 'undefined') return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    return {
      radius: (parsed.radius ?? DEFAULTS.radius) as Radius,
      density: (parsed.density ?? DEFAULTS.density) as Density,
      font: (parsed.font ?? DEFAULTS.font) as Font,
    };
  } catch {
    return DEFAULTS;
  }
}

function writePrefs(p: Prefs) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* ignore quota / privacy mode */
  }
}

function applyPrefs(p: Prefs) {
  const html = document.documentElement;
  html.setAttribute('data-radius', p.radius);
  html.setAttribute('data-density', p.density);
  html.setAttribute('data-font', p.font);
}

const THEME_OPTIONS = [
  { value: 'light', label: 'Sáng', Icon: Sun },
  { value: 'dark', label: 'Tối', Icon: Moon },
  { value: 'system', label: 'Hệ thống', Icon: Monitor },
] as const;

const RADIUS_OPTIONS: Array<{ value: Radius; label: string; Icon: React.ComponentType<{ className?: string }> }> = [
  { value: 'sharp', label: 'Vuông', Icon: Square },
  { value: 'soft', label: 'Vừa', Icon: Square },
  { value: 'chunky', label: 'Bo nhiều', Icon: Circle },
];

const DENSITY_OPTIONS: Array<{ value: Density; label: string; Icon: React.ComponentType<{ className?: string }> }> = [
  { value: 'loose', label: 'Thoáng', Icon: Rows3 },
  { value: 'cozy', label: 'Vừa', Icon: MoreHorizontal },
  { value: 'dense', label: 'Đặc', Icon: Minus },
];

const FONT_OPTIONS: Array<{ value: Font; label: string }> = [
  { value: 'jakarta', label: 'Plus Jakarta' },
  { value: 'system', label: 'Hệ thống' },
  { value: 'inter', label: 'Inter' },
  { value: 'serif', label: 'Fraunces (serif)' },
];

export function AppearanceTweaks() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [prefs, setPrefs] = React.useState<Prefs>(DEFAULTS);

  React.useEffect(() => {
    const p = readPrefs();
    applyPrefs(p);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe hydration from localStorage
    setPrefs(p);
    setMounted(true);
  }, []);

  const update = (patch: Partial<Prefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    applyPrefs(next);
    writePrefs(next);
  };

  const currentTheme = mounted ? (theme ?? 'system') : 'system';

  return (
    <div className="space-y-6">
      <Row
        label="Chế độ"
        description="Tông màu sáng, tối, hay theo cài đặt hệ thống."
      >
        <div className="pill-group" role="group" aria-label="Chế độ">
          {THEME_OPTIONS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              data-active={currentTheme === value}
              onClick={() => setTheme(value)}
              aria-pressed={currentTheme === value}
            >
              <Icon className="mr-1.5 inline h-3.5 w-3.5 -translate-y-px" />
              {label}
            </button>
          ))}
        </div>
      </Row>

      <Divider />

      <Row
        label="Bo góc"
        description="Độ bo của thẻ, nút và ô nhập."
      >
        <div className="pill-group" role="group" aria-label="Bo góc">
          {RADIUS_OPTIONS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              data-active={mounted && prefs.radius === value}
              onClick={() => update({ radius: value })}
              aria-pressed={prefs.radius === value}
            >
              <Icon className="mr-1.5 inline h-3.5 w-3.5 -translate-y-px" />
              {label}
            </button>
          ))}
        </div>
      </Row>

      <Divider />

      <Row
        label="Mật độ"
        description="Khoảng cách giữa các thành phần — thoáng dễ thở, đặc xem nhiều hơn."
      >
        <div className="pill-group" role="group" aria-label="Mật độ">
          {DENSITY_OPTIONS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              data-active={mounted && prefs.density === value}
              onClick={() => update({ density: value })}
              aria-pressed={prefs.density === value}
            >
              <Icon className="mr-1.5 inline h-3.5 w-3.5 -translate-y-px" />
              {label}
            </button>
          ))}
        </div>
      </Row>

      <Divider />

      <Row
        label="Font hiển thị"
        description="Kiểu chữ cho tiêu đề và số liệu nổi bật."
      >
        <div className="pill-group flex-wrap" role="group" aria-label="Font hiển thị">
          {FONT_OPTIONS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              data-active={mounted && prefs.font === value}
              onClick={() => update({ font: value })}
              aria-pressed={prefs.font === value}
            >
              <Type className="mr-1.5 inline h-3.5 w-3.5 -translate-y-px" />
              {label}
            </button>
          ))}
        </div>
      </Row>
    </div>
  );
}

function Row({
  label,
  description,
  children,
}: {
  label: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-6">
      <div className="md:max-w-[18rem]">
        <p className="font-display text-[14px] font-bold text-ink">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
      </div>
      <div className="md:flex md:justify-end">{children}</div>
    </div>
  );
}

function Divider() {
  return <hr className="border-t border-dashed border-border" />;
}
