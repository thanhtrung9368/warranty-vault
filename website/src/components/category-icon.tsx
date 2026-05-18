import {
  Laptop,
  Smartphone,
  Tablet,
  WashingMachine,
  Tv,
  Sofa,
  Package,
  Headphones,
  Speaker,
  Watch,
  Camera,
  Monitor,
  Keyboard,
  Mouse,
  Gamepad2,
  AirVent,
  Refrigerator,
  ChefHat,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

const map: Record<string, LucideIcon> = {
  LAPTOP: Laptop,
  PHONE: Smartphone,
  TABLET: Tablet,
  SMARTWATCH: Watch,
  HEADPHONE: Headphones,
  SPEAKER: Speaker,
  CAMERA: Camera,
  TV: Tv,
  MONITOR: Monitor,
  KEYBOARD: Keyboard,
  MOUSE: Mouse,
  GAMING_CONSOLE: Gamepad2,
  AC: AirVent,
  FRIDGE: Refrigerator,
  WASHING: WashingMachine,
  KITCHEN: ChefHat,
  APPLIANCE: WashingMachine,
  ELECTRONICS: Tv,
  FURNITURE: Sofa,
  OTHER: Package,
};

// Default tint mapping per category — picks from the warm coral palette helpers.
const tintByCategory: Record<string, string> = {
  LAPTOP: 'tint-primary',
  PHONE: 'tint-sky',
  TABLET: 'tint-sky',
  SMARTWATCH: 'tint-violet',
  HEADPHONE: 'tint-violet',
  SPEAKER: 'tint-violet',
  CAMERA: 'tint-amber',
  TV: 'tint-rose',
  MONITOR: 'tint-rose',
  KEYBOARD: 'tint-zinc',
  MOUSE: 'tint-zinc',
  GAMING_CONSOLE: 'tint-violet',
  AC: 'tint-sky',
  FRIDGE: 'tint-emerald',
  WASHING: 'tint-emerald',
  KITCHEN: 'tint-amber',
  APPLIANCE: 'tint-emerald',
  ELECTRONICS: 'tint-rose',
  FURNITURE: 'tint-amber',
  OTHER: 'tint-zinc',
};

export function CategoryIcon({
  category,
  className,
}: {
  category: string;
  className?: string;
}) {
  const Icon = map[category] || Package;
  return <Icon className={className} />;
}

/**
 * Round/squared icon badge for a category. Picks an appropriate tint from
 * the design palette (.tint-* helpers). Sizes match the design's
 * `.icon-badge`, `.icon-badge-sm`, `.icon-badge-xs`.
 */
export function CategoryIconBadge({
  category,
  size = 'md',
  className,
}: {
  category: string;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const Icon = map[category] || Package;
  const tint = tintByCategory[category] ?? 'tint-zinc';
  const sizeCls =
    size === 'xs'
      ? 'icon-badge-xs'
      : size === 'sm'
        ? 'icon-badge-sm'
        : size === 'lg'
          ? 'icon-badge-lg'
          : '';
  const iconSize =
    size === 'xs'
      ? 'h-3.5 w-3.5'
      : size === 'sm'
        ? 'h-4 w-4'
        : size === 'lg'
          ? 'h-6 w-6'
          : 'h-5 w-5';
  return (
    <span className={cn('icon-badge', sizeCls, tint, className)}>
      <Icon className={iconSize} />
    </span>
  );
}
