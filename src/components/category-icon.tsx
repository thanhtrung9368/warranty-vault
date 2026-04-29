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
