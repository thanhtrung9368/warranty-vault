import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
        display: ['var(--font-display)', 'system-ui', 'sans-serif'],
      },
      colors: {
        // shadcn / tailwind defaults wired to CSS vars
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        warning: {
          DEFAULT: 'hsl(var(--warning))',
          foreground: 'hsl(var(--warning-foreground))',
        },
        success: {
          DEFAULT: 'hsl(var(--success))',
          foreground: 'hsl(var(--success-foreground))',
        },
        info: {
          DEFAULT: 'hsl(var(--info))',
          foreground: 'hsl(var(--info-foreground))',
        },
        expiring: {
          DEFAULT: 'hsl(var(--expiring))',
          foreground: 'hsl(var(--expiring-foreground))',
        },

        // Playful palette — flat names so we don't shadow Tailwind's
        // built-in amber-500 / emerald-500 / rose-500 / violet-500 / sky-500 ramps.
        'border-strong': 'hsl(var(--border-strong))',
        ink: 'hsl(var(--ink))',
        'ink-2': 'hsl(var(--ink-2))',
        'muted-2': 'hsl(var(--muted-2))',
        'surface-2': 'hsl(var(--surface-2))',
        'surface-3': 'hsl(var(--surface-3))',

        'primary-2': 'hsl(var(--primary-2))',
        'primary-soft': 'hsl(var(--primary-soft))',
        'primary-soft-2': 'hsl(var(--primary-soft-2))',
        'primary-ink': 'hsl(var(--primary-ink))',

        'destructive-soft': 'hsl(var(--destructive-soft))',

        'emerald-soft': 'hsl(var(--emerald-soft))',
        'emerald-ink': 'hsl(var(--emerald-ink))',
        'amber-soft': 'hsl(var(--amber-soft))',
        'amber-ink': 'hsl(var(--amber-ink))',
        'rose-soft': 'hsl(var(--rose-soft))',
        'rose-ink': 'hsl(var(--rose-ink))',
        'violet-soft': 'hsl(var(--violet-soft))',
        'violet-ink': 'hsl(var(--violet-ink))',
        'sky-soft': 'hsl(var(--sky-soft))',
        'sky-ink': 'hsl(var(--sky-ink))',
        'zinc-soft': 'hsl(var(--zinc-soft))',
      },
      borderRadius: {
        pill: '9999px',
        lg: 'var(--radius)',
        md: 'var(--radius-sm)',
        sm: 'calc(var(--radius-sm) - 4px)',
        xl: 'var(--radius-lg)',
      },
      boxShadow: {
        soft: 'var(--shadow-1)',
        lift: 'var(--shadow-2)',
        chunky: 'var(--shadow-chunky)',
        pop: 'var(--shadow-3)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};

export default config;
