'use client';

import * as React from 'react';
import { Upload, Loader2, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { uploadAttachment } from '@/app/actions/attachments';
import { useT } from '@/lib/i18n/client';

const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = 'image/*,application/pdf';

export function AttachmentUploader({
  deviceId,
  remaining,
}: {
  deviceId: string;
  remaining: number;
}) {
  const t = useT();
  const [files, setFiles] = React.useState<File[]>([]);
  const [description, setDescription] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [dragOver, setDragOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  if (remaining <= 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        {t('Đã đạt tối đa 5 file cho thiết bị này. Xóa file cũ để tải file mới.')}
      </p>
    );
  }

  const accept = (incoming: FileList | File[]) => {
    const arr = Array.from(incoming).filter((f) => {
      if (f.size > MAX_BYTES) {
        toast.error(t('{name} vượt quá 5MB', { name: f.name }));
        return false;
      }
      const ok = f.type.startsWith('image/') || f.type === 'application/pdf';
      if (!ok) {
        toast.error(t('{name}: chỉ chấp nhận ảnh hoặc PDF', { name: f.name }));
        return false;
      }
      return true;
    });
    setFiles((prev) => [...prev, ...arr].slice(0, remaining));
  };

  const submit = async () => {
    if (files.length === 0) return;
    setPending(true);
    try {
      for (const f of files) {
        const fd = new FormData();
        fd.append('deviceId', deviceId);
        fd.append('file', f);
        if (description) fd.append('description', description);
        const res = await uploadAttachment(fd);
        if (!res.ok) {
          toast.error(res.message ?? t('Upload thất bại'));
        }
      }
      toast.success(t('Đã tải lên {count} file', { count: files.length }));
      setFiles([]);
      setDescription('');
    } catch {
      toast.error(t('Không tải được file'));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          accept(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
          dragOver
            ? 'border-primary bg-primary-soft'
            : 'border-border-strong bg-surface-2 hover:bg-primary-soft/60'
        }`}
      >
        <Upload className="h-7 w-7 text-primary" />
        <p className="text-sm font-bold text-ink">{t('Kéo thả hoặc bấm để chọn file')}</p>
        <p className="text-xs text-muted-foreground">
          {t('Ảnh hoặc PDF, tối đa 5MB. Còn lại: {remaining} file.', {
            remaining,
            count: remaining,
          })}
        </p>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          onChange={(e) => e.target.files && accept(e.target.files)}
        />
      </div>

      {files.length > 0 && (
        <div className="space-y-2 rounded-2xl border-[1.5px] border-border p-4">
          <ul className="space-y-1.5 text-sm">
            {files.map((f, i) => (
              <li
                key={i}
                className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2"
              >
                <span className="truncate font-medium">{f.name}</span>
                <button
                  type="button"
                  onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={t('Bỏ chọn')}
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
          <Input
            placeholder={t('Mô tả chung (vd: Hóa đơn VAT, Phiếu bảo hành)')}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <Button
            onClick={submit}
            disabled={pending}
            className="w-full rounded-pill"
          >
            {pending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {t('Tải lên {count} file', { count: files.length })}
          </Button>
        </div>
      )}
    </div>
  );
}
