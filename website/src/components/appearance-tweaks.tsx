'use client';

import * as React from 'react';
import {
  Check,
  Circle,
  Minus,
  Monitor,
  Moon,
  MoreHorizontal,
  PanelLeft,
  PanelLeftClose,
  Rows3,
  Square,
  Sun,
  Type,
} from 'lucide-react';
import { useTheme } from 'next-themes';

type Radius = 'sharp' | 'soft' | 'chunky';
type Density = 'loose' | 'cozy' | 'dense';
type Font = 'jakarta' | 'system' | 'inter' | 'serif';

/**
 * Accent keys — each one must have a matching `[data-accent='<key>']` block in
 * globals.css (light + `.dark` variants). Hex values are the design handoff's
 * swatch palette (`.design-handoff/project/js/app.jsx`, ACCENTS / ACCENTS_DARK).
 */
const ACCENTS = ['coral', 'emerald', 'violet', 'sky'] as const;
type Accent = (typeof ACCENTS)[number];

/** Sidebar variants — each key maps to a `[data-sidebar='<key>']` block in globals.css. */
const SIDEBARS = ['full', 'icon'] as const;
type SidebarVariant = (typeof SIDEBARS)[number];

type Prefs = {
  radius: Radius;
  density: Density;
  font: Font;
  accent: Accent;
  sidebar: SidebarVariant;
};

const DEFAULTS: Prefs = {
  radius: 'soft',
  density: 'cozy',
  font: 'jakarta',
  accent: 'coral',
  sidebar: 'full',
};

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
      accent: ACCENTS.includes(parsed.accent as Accent)
        ? (parsed.accent as Accent)
        : DEFAULTS.accent,
      sidebar: SIDEBARS.includes(parsed.sidebar as SidebarVariant)
        ? (parsed.sidebar as SidebarVariant)
        : DEFAULTS.sidebar,
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
  html.setAttribute('data-accent', p.accent);
  html.setAttribute('data-sidebar', p.sidebar);
}

/** Mirrors the handoff's `__twkIsLight()` so the tick stays legible on any swatch. */
function isLightHex(hex: string): boolean {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  if (Number.isNaN(n)) return true;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return r * 299 + g * 587 + b * 114 > 148000;
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

/** Swatch hexes are the light-mode brand colours from the design handoff. */
const ACCENT_OPTIONS: Array<{ value: Accent; label: string; hex: string }> = [
  { value: 'coral', label: 'Cam san hô', hex: '#FF6B45' },
  { value: 'emerald', label: 'Xanh lục bảo', hex: '#16A765' },
  { value: 'violet', label: 'Tím', hex: '#7B5BE0' },
  { value: 'sky', label: 'Xanh da trời', hex: '#0EA5E9' },
];

const SIDEBAR_OPTIONS: Array<{
  value: SidebarVariant;
  label: string;
  Icon: React.ComponentType<{ className?: string }>;
}> = [
  { value: 'full', label: 'Đầy đủ', Icon: PanelLeft },
  { value: 'icon', label: 'Biểu tượng', Icon: PanelLeftClose },
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
        label="Màu nhấn"
        description="Màu chủ đạo cho nút, liên kết, biểu đồ và các điểm nhấn."
      >
        <div className="swatch-group" role="group" aria-label="Màu nhấn">
          {ACCENT_OPTIONS.map(({ value, label, hex }) => {
            const active = mounted && prefs.accent === value;
            return (
              <button
                key={value}
                type="button"
                className="swatch"
                style={{ background: hex }}
                data-active={active}
                aria-pressed={active}
                aria-label={label}
                title={label}
                onClick={() => update({ accent: value })}
              >
                {active && (
                  <Check
                    className={`h-4 w-4 ${isLightHex(hex) ? 'text-[#1F1A14]' : 'text-white'}`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </Row>

      <Divider />

      <Row
        label="Thanh bên"
        description="Hiện đầy đủ nhãn, hoặc chỉ biểu tượng cho gọn."
      >
        <div className="pill-group" role="group" aria-label="Thanh bên">
          {SIDEBAR_OPTIONS.map(({ value, label, Icon }) => (
            <button
              key={value}
              type="button"
              data-active={mounted && prefs.sidebar === value}
              onClick={() => update({ sidebar: value })}
              aria-pressed={prefs.sidebar === value}
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
