'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { Download, Upload, Loader2, AlertTriangle, FileJson } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { exportAllJson, importJson } from '@/app/actions/backup';
import { cn } from '@/lib/utils';

export function BackupTools() {
  const [downloading, setDownloading] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [mode, setMode] = React.useState<'merge' | 'replace'>('merge');
  const [dragActive, setDragActive] = React.useState(false);
  const fileRef = React.useRef<HTMLInputElement>(null);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const data = await exportAllJson();
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `warrantyvault-backup-${format(new Date(), 'yyyyMMdd-HHmm')}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`Đã xuất ${data.devices.length} thiết bị`);
    } catch {
      toast.error('Không xuất được dữ liệu');
    } finally {
      setDownloading(false);
    }
  };

  const handleImport = async (file: File) => {
    if (mode === 'replace') {
      const ok = confirm(
        'Chế độ "Thay thế" sẽ XOÁ TOÀN BỘ dữ liệu hiện tại. File ảnh dưới /uploads sẽ KHÔNG bị xoá nhưng các bản ghi sẽ mất. Tiếp tục?',
      );
      if (!ok) return;
    }
    setImporting(true);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      const res = await importJson(json, mode);
      if (res.ok) toast.success(res.message ?? 'Import thành công');
      else toast.error(res.message ?? 'Import thất bại');
    } catch {
      toast.error('File JSON không đọc được');
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
          Tải toàn bộ thiết bị, file đính kèm (tên/đường dẫn) và nhắc nhở ra 1 file JSON. File ảnh
          thật vẫn nằm trong thư mục{' '}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">
            public/uploads
          </code>
          .
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

      <div className="section-divider">
        <span>nhập từ file</span>
      </div>

      {/* Import */}
      <div className="space-y-3">
        <h3 className="font-display text-[15px] font-bold text-ink">Nhập dữ liệu</h3>
        <p className="text-sm text-muted-foreground">
          Chọn file JSON đã xuất trước đó. Lưu ý sao chép lại folder{' '}
          <code className="rounded bg-surface-2 px-1.5 py-0.5 font-mono text-xs">
            public/uploads
          </code>{' '}
          để khớp đường dẫn ảnh.
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
            if (f && f.name.endsWith('.json')) void handleImport(f);
            else if (f) toast.error('Chỉ nhận file .json');
          }}
        >
          <span className="icon-badge icon-badge-sm tint-primary">
            <FileJson className="h-4 w-4" />
          </span>
          <span className="font-display text-sm font-bold text-ink">
            Kéo thả file <code className="font-mono">.json</code> vào đây
          </span>
          <span className="text-xs text-muted-foreground">hoặc bấm để chọn</span>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
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
          Nhập JSON
        </Button>
      </div>
    </div>
  );
}
