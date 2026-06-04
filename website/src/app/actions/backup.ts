'use server';

// Thin proxy server actions over the Go backup endpoints.
//
// - `exportAllJson()` GETs /api/v1/backup/export and returns the parsed
//   BackupExport object — the client component then re-serialises it into
//   a Blob for the user to download.
// - `importJson()` POSTs to /api/v1/backup/import?mode=merge|replace.
//
// Both routes are owned by the Go service (`api/internal/handlers/backup.go`).
// The Vietnamese user-facing strings come from Go; we only fall back to a
// generic message on transport failure.

import { requireUser } from '@/lib/auth';
import { api } from '@/lib/api';
import type { BackupExport, ImportResult } from '@/lib/api/backup';

export type { BackupExport } from '@/lib/api/backup';

export async function exportAllJson(): Promise<BackupExport> {
  await requireUser();
  const res = await api.backup.exportRaw();
  if (!res.ok) {
    // Throw — the client component catches and toasts. Matches the previous
    // behaviour where Prisma errors would bubble up the same way.
    throw new Error(res.message ?? 'Không xuất được dữ liệu');
  }
  return JSON.parse(res.body) as BackupExport;
}

export async function importJson(
  payload: unknown,
  mode: 'merge' | 'replace' = 'merge',
): Promise<{ ok: boolean; message?: string }> {
  await requireUser();
  // Rate limiting is enforced on the Go side per-endpoint — the previous
  // web-side `rateLimitUserWrite()` guard is gone with Phase F.
  if (!payload || typeof payload !== 'object') {
    return { ok: false, message: 'File JSON không hợp lệ' };
  }

  const res = await api.backup.importJson(payload, mode);
  if (!res.ok) {
    return { ok: false, message: res.message ?? 'Import thất bại' };
  }

  // No revalidatePath: every page that reads the user's dataset (/dashboard,
  // /devices, /reminders, /wishlist, /subscriptions) is `force-dynamic`, so
  // path revalidation would be a no-op — the client refresh re-renders them.

  const r: ImportResult = res.data.result;
  const parts: string[] = [`Đã import ${r.imported} thiết bị`];
  if (r.skipped) parts.push(`bỏ qua ${r.skipped} thiết bị đã tồn tại`);
  if (r.wishlistImported) parts.push(`${r.wishlistImported} món wishlist`);
  if (r.wishlistSkipped) parts.push(`bỏ qua ${r.wishlistSkipped} món wishlist đã tồn tại`);
  if (r.subImported) parts.push(`${r.subImported} gói đăng ký`);
  if (r.subSkipped) parts.push(`bỏ qua ${r.subSkipped} gói đã tồn tại`);
  return { ok: true, message: `${parts.join(', ')}.` };
}
