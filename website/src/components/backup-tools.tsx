'use client';

import * as React from 'react';
import { format } from 'date-fns';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileArchive,
  FileJson,
  Loader2,
  Upload,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { exportAllJson } from '@/app/actions/backup';
import { cn } from '@/lib/utils';
import {
  ATTACHMENT_BYTES_NOTE_ZIP,
  BACKUP_DROP_TITLE,
  BACKUP_IMPORT_ACCEPT,
  describeImportResult,
  filenameFromDisposition,
  type ImportCounters,
  type ImportSummary,
} from '@/lib/backup-media';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function BackupTools() {
  const [downloading, setDownloading] = React.useState(false);
  const [downloadingBlobs, setDownloadingBlobs] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [mode, setMode] = React.useState<'merge' | 'replace'>('merge');
  const [dragActive, setDragActive] = React.useState(false);
  const [importSummary, setImportSummary] = React.useState<ImportSummary | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const data = await exportAllJson();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      triggerDownload(blob, `warrantyvault-backup-${format(new Date(), 'yyyyMMdd-HHmm')}.json`);
      toast.success(`Đã xuất ${data.devices.length} thiết bị`);
    } catch {
      toast.error('Không xuất được dữ liệu');
    } finally {
      setDownloading(false);
    }
  };

  // The blob-carrying export is a real .zip (up to ~110 MB) streamed by
  // /api/backup/export — a server action would have to buffer the whole archive.
  const handleDownloadBlobs = async () => {
    setDownloadingBlobs(true);
    try {
      const res = await fetch('/api/backup/export?includeBlobs=true', { cache: 'no-store' });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { message?: string } | null;
        toast.error(body?.message ?? 'Không xuất được file kèm ảnh');
        return;
      }
      const blob = await res.blob();
      const filename =
        filenameFromDisposition(res.headers.get('Content-Disposition')) ??
        `warrantyvault-backup-${format(new Date(), 'yyyyMMdd-HHmm')}.zip`;
      triggerDownload(blob, filename);
      toast.success('Đã xuất file .zip kèm nội dung ảnh đã mã hoá');
    } catch {
      toast.error('Không xuất được dữ liệu');
    } finally {
      setDownloadingBlobs(false);
    }
  };

  const handleImport = async (file: File) => {
    if (mode === 'replace') {
      const ok = confirm(
        'Chế độ "Thay thế" sẽ XOÁ TOÀN BỘ dữ liệu hiện tại (thiết bị, bảo hành, đăng ký, wishlist). Ảnh đính kèm đã mã hoá nằm trong kho riêng của máy chủ nên không bị xoá theo, nhưng mọi bản ghi trỏ tới chúng sẽ mất. Tiếp tục?',
      );
      if (!ok) return;
    }
    setImporting(true);
    setImportSummary(null);
    try {
      // The file is posted untouched. Go decides the format by ZIP magic bytes
      // (PK\x03\x04), so nothing here looks at the name or the MIME type — a
      // `.zip` renamed to `.json` (or the reverse) imports just the same.
      const res = await fetch(`/api/backup/import?mode=${mode}`, {
        method: 'POST',
        body: file,
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; message?: string; result?: ImportCounters }
        | null;
      if (!res.ok || !body?.ok || !body.result) {
        toast.error(body?.message ?? 'Import thất bại');
        return;
      }
      const summary = describeImportResult(body.result);
      setImportSummary(summary);
      // Unreadable attachments are a WARNING, not a success: the rows and bytes
      // were restored but this server's FILE_MASTER_KEY cannot decrypt them.
      if (summary.tone === 'warning') toast.warning(summary.message);
      else toast.success(summary.message);
    } catch {
      toast.error('Không gửi được file lên máy chủ, thử lại sau');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      {/* Export */}
      <div className="space-y-3">
        <h3 className="font-display text-[15px] font-bold text-ink">Xuất dữ liệu</h3>
        <p className="text-sm text-muted-foreground">
          Tải toàn bộ thiết bị, gói bảo hành, nhắc nhở, gói đăng ký và wishlist ra 1 file JSON. File
          đính kèm chỉ đi kèm phần mô tả (tên file, kích thước, đường dẫn) — <b>ảnh gốc không nằm
          trong file backup</b>. Ảnh được mã hoá AES-256-GCM và lưu trong kho riêng của máy chủ
          (không nằm trong thư mục public của web), nên file JSON không mang ảnh theo được.
        </p>
        <div className="flex items-start gap-3 rounded-md bg-amber-soft p-3.5 text-sm text-amber-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>
            File backup chứa dữ liệu nhạy cảm: số seri, địa chỉ &amp; SĐT trung tâm bảo hành, giá
            mua. Lưu ở nơi an toàn — nếu upload cloud thì nên đặt mật khẩu zip trước.
          </p>
        </div>
        <Button
          onClick={handleDownload}
          disabled={downloading}
          className="rounded-pill"
          size="lg"
        >
          {downloading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Tải JSON
        </Button>
      </div>

      {/* Export with attachment blobs */}
      <div className="space-y-3 rounded-lg border-[1.5px] border-dashed border-border-strong bg-surface-2 p-4">
        <h3 className="font-display text-[15px] font-bold text-ink">Xuất kèm nội dung ảnh (.zip)</h3>
        <p className="text-sm text-muted-foreground">
          Bản .zip chứa file <code className="rounded bg-card px-1.5 py-0.5 font-mono text-xs">data.json</code> và
          toàn bộ nội dung <b>đã mã hoá</b> của từng file đính kèm (mỗi ảnh một entry
          <code className="rounded bg-card px-1.5 py-0.5 font-mono text-xs">attachments/…</code>), nên khôi
          phục sang máy chủ mới mang theo được ảnh hoá đơn — thứ bản JSON chỉ có metadata không làm
          được.
        </p>
        <div className="flex items-start gap-3 rounded-md bg-amber-soft p-3.5 text-sm text-amber-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>
            <b>Máy chủ ghi rõ trong file:</b> {ATTACHMENT_BYTES_NOTE_ZIP}
          </p>
        </div>
        <Button
          onClick={handleDownloadBlobs}
          disabled={downloadingBlobs}
          variant="outline"
          className="rounded-pill"
          size="lg"
        >
          {downloadingBlobs ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileArchive className="mr-2 h-4 w-4" />
          )}
          Tải kèm ảnh (.zip)
        </Button>
      </div>

      <div className="section-divider">
        <span>nhập từ file</span>
      </div>

      {/* Import */}
      <div className="space-y-3">
        <h3 className="font-display text-[15px] font-bold text-ink">Nhập dữ liệu</h3>
        <p className="text-sm text-muted-foreground">
          Chọn file <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">.json</code> (chỉ
          bản ghi) hoặc <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">.zip</code> (kèm
          nội dung ảnh đã mã hoá) đã xuất trước đó. Máy chủ tự nhận dạng file bằng nội dung, không
          cần đổi tên. Nhập lại chỉ khôi phục <b>bản ghi</b> (thiết bị, bảo hành, đăng ký, wishlist):
          với file JSON, ảnh cũ chỉ hiện lại nếu kho file trên máy chủ vẫn còn — muốn chắc thì dùng
          bản .zip.
        </p>

        <div>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Chế độ
          </div>
          <div className="pill-group">
            <button
              type="button"
              data-active={mode === 'merge'}
              onClick={() => setMode('merge')}
            >
              Merge (gộp)
            </button>
            <button
              type="button"
              data-active={mode === 'replace'}
              onClick={() => setMode('replace')}
            >
              Replace (xoá hết)
            </button>
          </div>
        </div>

        {mode === 'replace' && (
          <div className="flex items-start gap-3 rounded-md bg-destructive-soft p-3.5 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>
              <b>Replace</b> sẽ XOÁ TOÀN BỘ dữ liệu hiện tại trước khi nạp backup. Không thể hoàn
              tác. Chắc chắn rồi mới làm nha.
            </p>
          </div>
        )}

        {/* Dropzone */}
        <label
          className={cn(
            'flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border-strong bg-surface-2 p-7 text-center transition-colors',
            'hover:border-primary hover:bg-primary-soft',
            dragActive && 'border-primary bg-primary-soft',
          )}
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragActive(false);
            const f = e.dataTransfer.files?.[0];
            // No extension check: the server sniffs the bytes and answers with
            // its own Vietnamese message for anything it cannot read.
            if (f) void handleImport(f);
          }}
        >
          <span className="icon-badge icon-badge-sm tint-primary">
            <FileJson className="h-4 w-4" />
          </span>
          <span className="font-display text-sm font-bold text-ink">{BACKUP_DROP_TITLE}</span>
          <span className="text-xs text-muted-foreground">hoặc bấm để chọn</span>
          <input
            ref={fileRef}
            type="file"
            accept={BACKUP_IMPORT_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImport(f);
            }}
          />
        </label>

        <Button
          onClick={() => fileRef.current?.click()}
          disabled={importing}
          variant="outline"
          className="rounded-pill"
        >
          {importing ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          Nhập từ file
        </Button>

        {/* Import result. Stays on screen (a toast can be missed) because
            `attachmentsUnreadable` means restored-but-undecryptable files. */}
        {importSummary && (
          <div
            className={cn(
              'flex items-start gap-3 rounded-md p-3.5 text-sm',
              importSummary.tone === 'warning'
                ? 'bg-amber-soft text-amber-ink'
                : 'border-[1.5px] border-emerald-soft bg-emerald-soft/60 text-emerald-ink',
            )}
          >
            {importSummary.tone === 'warning' ? (
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
            )}
            <div className="space-y-1.5">
              <p className="font-semibold">{importSummary.message}</p>
              {importSummary.unreadableWarning && <p>{importSummary.unreadableWarning}</p>}
              {importSummary.details.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-4">
                  {importSummary.details.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
