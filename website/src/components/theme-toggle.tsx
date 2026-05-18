'use client';

import * as React from 'react';
import { Check, Monitor, Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

const OPTIONS = [
  { value: 'system', label: 'Theo hệ thống', Icon: Monitor },
  { value: 'light', label: 'Sáng', Icon: Sun },
  { value: 'dark', label: 'Tối', Icon: Moon },
] as const;

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR-safe hydration guard
  React.useEffect(() => setMounted(true), []);

  const current = mounted ? theme ?? 'system' : 'system';
  const TriggerIcon =
    !mounted || current === 'system'
      ? Monitor
      : (resolvedTheme ?? current) === 'dark'
        ? Moon
        : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          aria-label="Đổi giao diện"
          className="h-10 w-10 rounded-pill border-border bg-card text-ink-2 shadow-none hover:bg-secondary"
        >
          <TriggerIcon className={mounted ? 'h-[18px] w-[18px]' : 'h-[18px] w-[18px] opacity-0'} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[10rem]">
        {OPTIONS.map(({ value, label, Icon }) => (
          <DropdownMenuItem
            key={value}
            onSelect={() => setTheme(value)}
            className="gap-2"
          >
            <Icon className="h-4 w-4" />
            <span className="flex-1">{label}</span>
            {current === value ? <Check className="h-4 w-4" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
