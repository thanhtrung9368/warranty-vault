import { format, differenceInDays } from 'date-fns';
import { vi } from 'date-fns/locale';

export function formatVND(amount: number | null | undefined): string {
  if (amount == null || isNaN(amount)) return '0 ₫';
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(amount);
}

export function formatNumber(amount: number | null | undefined): string {
  if (amount == null || isNaN(amount)) return '0';
  return new Intl.NumberFormat('vi-VN').format(amount);
}

export function parseVNDInput(input: string): number {
  const cleaned = input.replace(/[^\d]/g, '');
  return cleaned ? parseInt(cleaned, 10) : 0;
}

export function formatDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, 'dd/MM/yyyy', { locale: vi });
}

export function formatDateLong(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return format(d, "EEEE, dd 'tháng' MM, yyyy", { locale: vi });
}

// Vietnamese relative-time, day-resolution. Anchored to "now" so:
//   today → "hôm nay", yesterday → "hôm qua", N≥2 ngày → "N ngày trước",
//   week+ → "N tuần trước", month+ → "N tháng trước". Future dates flip to
//   "trong …".
export function formatRelativeDay(date: Date | string, now: Date = new Date()): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  // Compare on day boundaries so a record at 23:59 yesterday reads "hôm qua",
  // not "vài giờ trước".
  const startOf = (x: Date) => {
    const c = new Date(x);
    c.setHours(0, 0, 0, 0);
    return c;
  };
  const days = Math.round(
    (startOf(now).getTime() - startOf(d).getTime()) / 86_400_000,
  );
  if (days === 0) return 'hôm nay';
  if (days === 1) return 'hôm qua';
  if (days === -1) return 'ngày mai';
  if (days > 1 && days < 7) return `${days} ngày trước`;
  if (days < -1 && days > -7) return `trong ${-days} ngày`;
  if (days >= 7 && days < 30) {
    const w = Math.round(days / 7);
    return `${w} tuần trước`;
  }
  if (days <= -7 && days > -30) {
    const w = Math.round(-days / 7);
    return `trong ${w} tuần`;
  }
  if (days >= 30 && days < 365) {
    const m = Math.round(days / 30);
    return `${m} tháng trước`;
  }
  if (days <= -30 && days > -365) {
    const m = Math.round(-days / 30);
    return `trong ${m} tháng`;
  }
  const y = Math.round(Math.abs(days) / 365);
  return days > 0 ? `${y} năm trước` : `trong ${y} năm`;
}

export type WarrantyState = {
  daysLeft: number;
  label: string;
  tone: 'safe' | 'warn' | 'danger' | 'expired';
};

export function warrantyState(warrantyEnd: Date | string): WarrantyState {
  const end = typeof warrantyEnd === 'string' ? new Date(warrantyEnd) : warrantyEnd;
  const days = differenceInDays(end, new Date());
  if (days < 0) {
    return { daysLeft: days, label: `Đã hết ${Math.abs(days)} ngày`, tone: 'expired' };
  }
  if (days === 0) return { daysLeft: 0, label: 'Hết hôm nay', tone: 'danger' };
  if (days <= 15) return { daysLeft: days, label: `Còn ${days} ngày`, tone: 'danger' };
  if (days <= 30) return { daysLeft: days, label: `Còn ${days} ngày`, tone: 'warn' };
  if (days <= 90) return { daysLeft: days, label: `Còn ${days} ngày`, tone: 'safe' };
  // > 90 days, render as months for compactness
  const months = Math.floor(days / 30);
  return { daysLeft: days, label: `Còn ${months} tháng`, tone: 'safe' };
}

export function warrantyToneClass(tone: WarrantyState['tone']): string {
  switch (tone) {
    case 'safe':
      return 'text-emerald-700 dark:text-emerald-400';
    case 'warn':
      return 'text-amber-600 dark:text-amber-400';
    case 'danger':
      return 'text-red-600 dark:text-red-400';
    case 'expired':
      return 'text-zinc-500 dark:text-zinc-500';
  }
}

export function warrantyBgClass(tone: WarrantyState['tone']): string {
  switch (tone) {
    case 'safe':
      return 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-900';
    case 'warn':
      return 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900';
    case 'danger':
      return 'bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-900';
    case 'expired':
      return 'bg-zinc-50 dark:bg-zinc-900/40 border-zinc-200 dark:border-zinc-800';
  }
}
