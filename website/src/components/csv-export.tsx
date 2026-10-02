'use client';

// "Xuất bảng tính (CSV)" — sits next to the JSON backup on the settings page.
//
// The rows come from the server action (`@/app/actions/csv`), which reads the
// same Go endpoints the pages already use; this component only picks a dataset
// + delimiter and turns the returned string into a download. The string already
// starts with a UTF-8 BOM (see `@/lib/csv`), so Excel keeps Vietnamese
// diacritics intact.

import * as React from 'react';
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { exportCsv } from '@/app/actions/csv';
import { CSV_DATASET_META, CSV_DATASETS, type CsvDataset } from '@/lib/csv-export';
import { CSV_DEFAULT_DELIMITER, CSV_DELIMITERS, type CsvDelimiter } from '@/lib/csv';

const DELIMITER_LABELS: Record<CsvDelimiter, { label: string; hint: string }> = {
  ';': {
    label: 'Excel (Việt Nam)',
    hint: 'Dấu chấm phẩy — Excel bản tiếng Việt tách cột bằng dấu này.',
  },
  ',': {
    label: 'Chuẩn quốc tế',
    hint: 'Dấu phẩy — hợp với Google Sheets, Excel bản tiếng Anh, hoặc khi gửi file cho người khác.',
  },
};

export function CsvExport() {
  // Ships as `;` (vi-VN Excel); the picker exposes `,` for Google Sheets /
  // English-locale Excel. See the delimiter note in `@/lib/csv`.
  const [delimiter, setDelimiter] = React.useState<CsvDelimiter>(CSV_DEFAULT_DELIMITER);
  const [busy, setBusy] = React.useState<CsvDataset | null>(null);

  const handleDownload = async (dataset: CsvDataset) => {
    setBusy(dataset);
    try {
      const res = await exportCsv(dataset, delimiter);
      if (!res.ok) {
        toast.error(res.message);
        return;
      }
      // `\ufeff` is already at the front of `content`; Blob encodes it to the
      // EF BB BF bytes Excel looks for.
      const blob = new Blob([res.content], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = res.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Đã xuất ${res.rowCount} dòng ${CSV_DATASET_META[dataset].label}`);
    } catch {
      toast.error('Không xuất được dữ liệu');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Tải danh sách ra file <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">.csv</code>{' '}
        để mở bằng Excel hoặc Google Sheets — tiện khi cần gửi cho người khác, dán vào báo giá,
        hoặc tự tính toán lại. File có kèm <b>BOM UTF-8</b> nên tiếng Việt không bị lỗi font, và
        cột tiền là số trần (không có dấu chấm nghìn, không có ₫) để bảng tính cộng trừ được ngay.
        Muốn khôi phục lại vào app thì dùng file JSON ở mục trên — CSV chỉ để đọc.
      </p>

      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Dấu phân cách
        </div>
        <div className="pill-group">
          {CSV_DELIMITERS.map((d) => (
            <button
              key={d}
              type="button"
              data-active={delimiter === d}
              onClick={() => setDelimiter(d)}
            >
              {DELIMITER_LABELS[d].label}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{DELIMITER_LABELS[delimiter].hint}</p>
      </div>

      <ul className="space-y-3">
        {CSV_DATASETS.map((dataset) => {
          const meta = CSV_DATASET_META[dataset];
          const isBusy = busy === dataset;
          return (
            <li
              key={dataset}
              className="flex flex-wrap items-start justify-between gap-3 rounded-lg border-[1.5px] border-border bg-surface-2 p-4"
            >
              <div className="min-w-[220px] flex-1">
                <div className="flex items-center gap-2">
                  <span className="icon-badge icon-badge-sm tint-emerald">
                    <FileSpreadsheet className="h-4 w-4" />
                  </span>
                  <span className="font-display text-sm font-bold text-ink">{meta.label}</span>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">{meta.description}</p>
              </div>
              <Button
                variant="outline"
                onClick={() => void handleDownload(dataset)}
                disabled={busy !== null}
                className="rounded-pill"
              >
                {isBusy ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Download className="mr-2 h-4 w-4" />
                )}
                Tải CSV
              </Button>
            </li>
          );
        })}
      </ul>

      <p className="text-xs text-muted-foreground">
        File CSV chỉ chứa nội dung đang thấy trong app (tối đa 50 thiết bị, 100 gói đăng ký, 200
        món wishlist) — không kèm ảnh hoá đơn hay file đính kèm.
      </p>
    </div>
  );
}
