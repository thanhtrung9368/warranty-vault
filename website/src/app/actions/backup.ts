'use server';

// Server action over the Go backup export endpoint.
//
// `exportAllJson()` GETs `/api/v1/backup/export` (the default, metadata-only v5
// JSON) and returns the parsed `BackupExport` so the client component can
// re-serialise it and report how many devices it holds.
//
// The blob-carrying `.zip` export (?includeBlobs=true) and BOTH import formats
// do NOT live here: they stream through `src/app/api/backup/{export,import}/
// route.ts`, because a backup with invoice images blows past the server-action
// body limit (10 MB) — and Go decides the import format by ZIP magic, so there
// is nothing to parse client-side anyway.
//
// Route ownership: `api/internal/handlers/backup.go`. The Vietnamese
// user-facing strings come from Go; we only fall back on transport failure.

import { requireUser } from '@/lib/auth';
import { api } from '@/lib/api';
import { getI18n } from '@/lib/i18n/server';
import type { BackupExport } from '@/lib/api/backup';

export type { BackupExport } from '@/lib/api/backup';

export async function exportAllJson(): Promise<BackupExport> {
  await requireUser();
  const { t } = await getI18n();
  const res = await api.backup.exportRaw();
  if (!res.ok) {
    // Throw — the client component catches and toasts. Matches the previous
    // behaviour where Prisma errors would bubble up the same way. The message is
    // thrown, not returned, so it has to be resolved here rather than downstream.
    throw new Error(res.message ?? t('Không xuất được dữ liệu'));
  }
  return JSON.parse(res.body) as BackupExport;
}
