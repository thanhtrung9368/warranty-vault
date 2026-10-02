'use server';

// CSV export server action.
//
// Deliberately NOT a Go endpoint: the roadmap's cheap approach is to build the
// CSV in the web app from the rows it already fetches (`api.devices.list()`
// and friends) — no new API call, no streaming route. The Go service stays the
// single source of truth for the data; this action only re-formats it.
//
// The heavy lifting (escaping, BOM, Vietnamese labels, money as plain numbers)
// lives in the pure, unit-tested `@/lib/csv` + `@/lib/csv-export` modules. This
// file is just: require the user → fetch → serialise → hand the client a string
// it turns into a Blob.
//
// No `revalidatePath` — export reads, it never mutates.

import { api } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import {
  csvFileName,
  csvTableToString,
  devicesCsvTable,
  isCsvDataset,
  subscriptionsCsvTable,
  wishlistCsvTable,
  type CsvDataset,
} from '@/lib/csv-export';
import {
  CSV_DEFAULT_DELIMITER,
  toCsvDelimiter,
  type CsvDelimiter,
  type CsvTable,
} from '@/lib/csv';

export type CsvExportResult =
  | {
      ok: true;
      /** e.g. `warrantyvault-thiet-bi-20250115-1030.csv` */
      filename: string;
      /** Full file contents, BOM included. */
      content: string;
      /** Data rows, header excluded — used for the toast. */
      rowCount: number;
    }
  | { ok: false; message: string };

const EMPTY_MESSAGE = 'Không có dữ liệu để xuất';

export async function exportCsv(
  dataset: CsvDataset,
  delimiter: CsvDelimiter = CSV_DEFAULT_DELIMITER,
): Promise<CsvExportResult> {
  await requireUser();

  // Both arguments arrive from the client, so they are narrowed here rather
  // than trusted. An unknown dataset id falls back to `devices`.
  const safeDelimiter = toCsvDelimiter(delimiter);
  const safeDataset: CsvDataset = isCsvDataset(dataset) ? dataset : 'devices';

  let table: CsvTable;
  switch (safeDataset) {
    case 'devices': {
      // Same order as the /devices list (newest purchase first).
      const res = await api.devices.list({ sort: 'purchaseDate', dir: 'desc' });
      if (!res.ok) {
        return { ok: false, message: res.message ?? 'Không xuất được dữ liệu' };
      }
      table = devicesCsvTable(res.data);
      break;
    }
    case 'subscriptions': {
      const res = await api.subscriptions.list();
      if (!res.ok) {
        return { ok: false, message: res.message ?? 'Không xuất được dữ liệu' };
      }
      table = subscriptionsCsvTable(res.data.subscriptions ?? []);
      break;
    }
    case 'wishlist': {
      const res = await api.wishlist.list();
      if (!res.ok) {
        return { ok: false, message: res.message ?? 'Không xuất được dữ liệu' };
      }
      table = wishlistCsvTable(res.data.items ?? []);
      break;
    }
  }

  if (table.rows.length === 0) {
    return { ok: false, message: EMPTY_MESSAGE };
  }

  return {
    ok: true,
    filename: csvFileName(safeDataset),
    content: csvTableToString(table, safeDelimiter),
    rowCount: table.rows.length,
  };
}
