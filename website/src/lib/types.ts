// Static label fallback for category codes. The DB Category table is the
// canonical source — pickers/filters fetch from there. This map is used for
// display lookups (lists, charts) where we already have a code on hand and
// don't want to round-trip the DB.
export const CATEGORY_LABELS: Record<string, string> = {
  PHONE: 'Điện thoại',
  LAPTOP: 'Laptop',
  TABLET: 'Máy tính bảng',
  SMARTWATCH: 'Đồng hồ thông minh',
  HEADPHONE: 'Tai nghe',
  SPEAKER: 'Loa',
  CAMERA: 'Máy ảnh / Quay phim',
  TV: 'Tivi',
  MONITOR: 'Màn hình',
  KEYBOARD: 'Bàn phím',
  MOUSE: 'Chuột',
  GAMING_CONSOLE: 'Máy chơi game',
  AC: 'Điều hòa',
  FRIDGE: 'Tủ lạnh',
  WASHING: 'Máy giặt / Sấy',
  KITCHEN: 'Đồ nhà bếp',
  APPLIANCE: 'Đồ gia dụng khác',
  ELECTRONICS: 'Điện tử khác',
  FURNITURE: 'Nội thất',
  OTHER: 'Khác',
};

export type Category = string;

export function categoryLabel(code: string): string {
  return CATEGORY_LABELS[code] ?? code;
}

export const STATUSES = ['ACTIVE', 'EXPIRED', 'SOLD', 'BROKEN', 'LOST'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABELS: Record<Status, string> = {
  ACTIVE: 'Đang dùng',
  EXPIRED: 'Hết bảo hành',
  SOLD: 'Đã bán',
  BROKEN: 'Hỏng',
  LOST: 'Mất',
};

export const STATUS_COLORS: Record<Status, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  EXPIRED: 'bg-zinc-200 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300',
  SOLD: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  BROKEN: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  LOST: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
};

// Maps a device status to the typed Badge variant. Use this with `<Badge variant={...}>`
// instead of the legacy STATUS_COLORS map (which is kept around for callsites that
// still need a raw class string).
export const STATUS_BADGE_VARIANT: Record<
  Status,
  'success' | 'secondary' | 'info' | 'destructive' | 'expiring'
> = {
  ACTIVE: 'success',
  EXPIRED: 'secondary',
  SOLD: 'info',
  BROKEN: 'destructive',
  LOST: 'expiring',
};

export const WARRANTY_TYPES = ['STANDARD', 'EXTENDED', 'THIRD_PARTY'] as const;
export type WarrantyType = (typeof WARRANTY_TYPES)[number];

export const WARRANTY_TYPE_LABELS: Record<WarrantyType, string> = {
  STANDARD: 'Tiêu chuẩn',
  EXTENDED: 'Mở rộng',
  THIRD_PARTY: 'Bên thứ ba',
};

export const WARRANTY_TYPE_COLORS: Record<WarrantyType, string> = {
  STANDARD: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200',
  EXTENDED: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  THIRD_PARTY: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300',
};
