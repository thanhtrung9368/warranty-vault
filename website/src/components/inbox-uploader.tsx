'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { useRouter } from 'next/navigation';
import { Loader2, Upload, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  uploadAttachmentForm,
  type AttachmentUploadState,
} from '@/app/actions/attachments';
import {
  ATTACHMENT_ACCEPT,
  attachmentRuleRejection,
} from '@/lib/attachment-rules';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils';

function SubmitButton() {
  const t = useT();
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} className="shrink-0 rounded-pill">
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Upload className="mr-2 h-4 w-4" />
      )}
      {pending ? t('Đang tải lên…') : t('Tải lên hộp thư')}
    </Button>
  );
}

/**
 * The capture-first entry point: pick (or drop) a receipt and upload it with
 * NO device. The file lands in `GET /v1/inbox` and consumes none of a device's
 * five slots, so nothing here asks "which device?" — that question is answered
 * later, on the list below, when the user actually knows.
 *
 * Plain React + `useActionState` (no form library), matching the rest of the
 * app. The success stamp in the action state is what resets the form and
 * refreshes the server-rendered list without an optimistic copy of the inbox.
 */
export function InboxUploader() {
  const t = useT();
  const router = useRouter();
  const [state, formAction] = useActionState<AttachmentUploadState, FormData>(
    uploadAttachmentForm,
    {},
  );
  const formRef = React.useRef<HTMLFormElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);
  const [fileName, setFileName] = React.useState<string | null>(null);
  // Guards against React's strict-mode double effect (and any later re-render
  // that carries the same success state) firing two toasts / two refreshes.
  const handledUpload = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (!state.ok || !state.uploadedAt) return;
    if (handledUpload.current === state.uploadedAt) return;
    handledUpload.current = state.uploadedAt;
    formRef.current?.reset();
    setFileName(null);
    toast.success(t('Đã tải file vào hộp thư'));
    router.refresh();
  }, [state.ok, state.uploadedAt, t, router]);

  const validate = (file: File): boolean => {
    // Shared with the device uploader and the Web Share Target route: one
    // definition of the 5 MB cap and the accepted families.
    const rejection = attachmentRuleRejection(file);
    if (rejection === 'too_large') {
      toast.error(t('{name} vượt quá 5MB', { name: file.name }));
      return false;
    }
    if (rejection === 'wrong_type') {
      toast.error(t('{name}: chỉ chấp nhận ảnh hoặc PDF', { name: file.name }));
      return false;
    }
    return true;
  };

  const onPick = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setFileName(null);
      return;
    }
    if (!validate(file)) {
      event.target.value = '';
      setFileName(null);
      return;
    }
    setFileName(file.name);
  };

  const onDrop = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (!file || !inputRef.current || !validate(file)) return;
    // A native file input cannot be given a File directly, so rebuild its
    // FileList. This keeps the submitted body exactly the same as a click-pick.
    const transfer = new DataTransfer();
    transfer.items.add(file);
    inputRef.current.files = transfer.files;
    setFileName(file.name);
  };

  const clearFile = () => {
    if (inputRef.current) inputRef.current.value = '';
    setFileName(null);
  };

  return (
    <form ref={formRef} action={formAction} className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        aria-label={t('Kéo thả hoặc bấm để chọn file')}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        className={cn(
          'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed p-7 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
          dragOver
            ? 'border-primary bg-primary-soft'
            : 'border-border-strong bg-surface-2 hover:bg-primary-soft/60',
        )}
      >
        <Upload className="h-7 w-7 text-primary" />
        <p className="text-sm font-bold text-ink">{t('Kéo thả hoặc bấm để chọn file')}</p>
        <p className="text-xs text-muted-foreground">
          {t('Ảnh hoặc PDF, tối đa 5MB. Không cần chọn thiết bị ngay.')}
        </p>
        <input
          ref={inputRef}
          type="file"
          name="file"
          accept={ATTACHMENT_ACCEPT}
          className="hidden"
          onChange={onPick}
        />
      </div>

      {fileName && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">
          <span className="min-w-0 truncate font-medium text-ink">{fileName}</span>
          <button
            type="button"
            onClick={clearFile}
            className="shrink-0 text-muted-foreground hover:text-destructive"
            aria-label={t('Bỏ chọn')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          name="description"
          placeholder={t('Mô tả (không bắt buộc)')}
          aria-label={t('Mô tả (không bắt buộc)')}
          className="sm:flex-1"
        />
        <SubmitButton />
      </div>

      {!state.ok && state.message && (
        <p
          role="alert"
          className="rounded-lg border border-rose-ink/20 bg-rose-soft px-3 py-2 text-xs font-semibold text-rose-ink"
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
