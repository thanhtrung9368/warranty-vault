'use client';

import * as React from 'react';
import { format } from 'date-fns';
import { Download, Upload, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { exportAllJson, importJson } from '@/app/actions/backup';

export function BackupTools() {
  const [downloading, setDownloading] = React.useState(false);
  const [importing, setImporting] = React.useState(false);
  const [mode, setMode] = React.useState<'merge' | 'replace'>('merge');
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
      a.download = `assetvault-backup-${format(new Date(), 'yyyyMMdd-HHmm')}.json`;
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
        'Chế độ "Thay thế" sẽ XÓA TOÀN BỘ dữ liệu hiện tại. File ảnh dưới /uploads sẽ KHÔNG bị xóa nhưng các bản ghi sẽ mất. Tiếp tục?',
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
      <div className="space-y-3">
        <h3 className="text-base font-semibold">Xuất dữ liệu</h3>
        <p className="text-sm text-muted-foreground">
          Tải toàn bộ thiết bị, file đính kèm (tên/đường dẫn) và nhắc nhở ra 1 file JSON.
          File ảnh thật vẫn nằm trong thư mục <code className="rounded bg-muted px-1">public/uploads</code>.
        </p>
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p>
            File backup chứa dữ liệu nhạy cảm: số seri, địa chỉ &amp; SĐT trung tâm bảo hành, giá mua.
            Lưu ở nơi an toàn — nếu upload cloud thì nên đặt mật khẩu zip trước.
          </p>
        </div>
        <Button onClick={handleDownload} disabled={downloading}>
          {downloading ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Download className="mr-2 h-4 w-4" />
          )}
          Tải file backup .json
        </Button>
      </div>

      <div className="space-y-3 border-t pt-6">
        <h3 className="text-base font-semibold">Nhập dữ liệu</h3>
        <p className="text-sm text-muted-foreground">
          Chọn file JSON đã xuất trước đó. Lưu ý sao chép lại folder <code className="rounded bg-muted px-1">public/uploads</code> để khớp đường dẫn ảnh.
        </p>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Select value={mode} onValueChange={(v) => setMode(v as 'merge' | 'replace')}>
            <SelectTrigger className="w-[220px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="merge">Gộp (bỏ qua trùng ID)</SelectItem>
              <SelectItem value="replace">Thay thế toàn bộ</SelectItem>
            </SelectContent>
          </Select>
          <Button
            onClick={() => fileRef.current?.click()}
            disabled={importing}
            variant="outline"
          >
            {importing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Chọn file .json
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleImport(f);
            }}
          />
        </div>
        {mode === 'replace' && (
          <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>
              Chế độ “Thay thế” sẽ xóa toàn bộ thiết bị, attachment và nhắc nhở hiện tại trước
              khi import. Hãy xuất backup trước cho chắc.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
