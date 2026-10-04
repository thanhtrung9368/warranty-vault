'use client';

import * as React from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import {
  FileText,
  Trash2,
  ExternalLink,
  Loader2,
  Pencil,
  Check,
  X,
  Paperclip,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  deleteAttachment,
  updateAttachmentDescription,
} from '@/app/actions/attachments';
import { useT } from '@/lib/i18n/client';

type Attachment = {
  id: string;
  fileName: string;
  fileType: string;
  description: string | null;
};

// Authenticated file URL — only the logged-in owner can fetch this.
function fileUrl(id: string, opts?: { download?: boolean }): string {
  return `/api/files/${id}${opts?.download ? '?download=1' : ''}`;
}

export function AttachmentGallery({ items }: { items: Attachment[] }) {
  const router = useRouter();
  const t = useT();
  const [active, setActive] = React.useState<Attachment | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  // Inline description editing. `overrides` holds the optimistic caption per
  // attachment id, so the tile updates the moment you hit save instead of
  // waiting for the round-trip; a failure rolls the previous value back and
  // the successful response's normalized value (trimmed, or null = cleared)
  // replaces the guess. `router.refresh()` then re-syncs from the server.
  const [overrides, setOverrides] = React.useState<
    Record<string, string | null>
  >({});
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');
  const [savingId, setSavingId] = React.useState<string | null>(null);

  const descriptionOf = (a: Attachment): string | null =>
    Object.prototype.hasOwnProperty.call(overrides, a.id)
      ? overrides[a.id]
      : a.description;

  const startEdit = (a: Attachment) => {
    setEditingId(a.id);
    setDraft(descriptionOf(a) ?? '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setDraft('');
  };

  const saveEdit = async (a: Attachment) => {
    const previous = descriptionOf(a);
    const typed = draft;
    const optimistic = typed.trim() === '' ? null : typed.trim();

    setOverrides((o) => ({ ...o, [a.id]: optimistic }));
    setSavingId(a.id);
    try {
      const res = await updateAttachmentDescription(a.id, typed);
      if (!res.ok) {
        setOverrides((o) => ({ ...o, [a.id]: previous }));
        toast.error(res.message ?? t('Không lưu được mô tả'));
        return;
      }
      setOverrides((o) => ({ ...o, [a.id]: res.description ?? null }));
      setEditingId(null);
      setDraft('');
      toast.success(res.description ? t('Đã lưu mô tả') : t('Đã xoá mô tả'));
      // Re-render the device-detail RSC so the refreshed props match the
      // optimistic state (and the dialog shows the saved value).
      router.refresh();
    } catch {
      setOverrides((o) => ({ ...o, [a.id]: previous }));
      toast.error(t('Không lưu được mô tả'));
    } finally {
      setSavingId(null);
    }
  };

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1.5 rounded-2xl border-2 border-dashed border-border-strong bg-surface-2/60 px-6 py-8 text-center">
        <Paperclip className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-bold text-ink">{t('Chưa có file đính kèm nào')}</p>
        <p className="max-w-xs text-xs text-muted-foreground">
          {t(
            'Tải lên ảnh hoá đơn hoặc phiếu bảo hành để lưu kèm thiết bị. Sau khi tải lên, bấm biểu tượng bút chì để đặt mô tả cho từng file.',
          )}
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map((a) => {
          const isImage = a.fileType.startsWith('image/');
          const isEditing = editingId === a.id;
          const isSaving = savingId === a.id;
          const caption = descriptionOf(a);
          return (
            <div
              key={a.id}
              className="group relative overflow-hidden rounded-2xl border-[1.5px] border-border bg-surface-2"
            >
              {isImage ? (
                <button
                  type="button"
                  onClick={() => setActive(a)}
                  className="relative block aspect-square w-full overflow-hidden"
                >
                  <Image
                    src={fileUrl(a.id)}
                    alt={caption ?? a.fileName}
                    fill
                    sizes="(max-width: 768px) 50vw, 25vw"
                    unoptimized
                    className="object-cover transition-transform group-hover:scale-105"
                  />
                </button>
              ) : (
                <a
                  href={fileUrl(a.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex aspect-square w-full flex-col items-center justify-center gap-2 p-4 text-center"
                >
                  <FileText className="h-10 w-10 text-primary" />
                  <span className="text-xs font-bold text-ink">PDF</span>
                  <span className="line-clamp-2 text-[10px] text-muted-foreground">
                    {a.fileName}
                  </span>
                </a>
              )}
              <div className="border-t border-border bg-card/80 px-2.5 py-1.5 backdrop-blur">
                {isEditing ? (
                  <div className="flex items-center gap-1">
                    <Input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          void saveEdit(a);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          cancelEdit();
                        }
                      }}
                      placeholder={t('Mô tả cho file này')}
                      aria-label={t('Mô tả cho {name}', { name: a.fileName })}
                      disabled={isSaving}
                      className="h-7 min-w-0 px-2 py-0 text-[11px]"
                    />
                    <button
                      type="button"
                      onClick={() => void saveEdit(a)}
                      disabled={isSaving}
                      className="shrink-0 text-muted-foreground hover:text-primary disabled:opacity-50"
                      aria-label={t('Lưu mô tả')}
                      title={t('Lưu (Enter)')}
                    >
                      {isSaving ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Check className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      disabled={isSaving}
                      className="shrink-0 text-muted-foreground hover:text-destructive disabled:opacity-50"
                      aria-label={t('Huỷ sửa mô tả')}
                      title={t('Huỷ (Esc)')}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate text-[11px] font-medium text-ink-2">
                      {caption ?? a.fileName}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => startEdit(a)}
                        className="text-muted-foreground hover:text-primary"
                        aria-label={t('Sửa mô tả')}
                        title={t('Sửa mô tả')}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={pendingId === a.id}
                        onClick={async () => {
                          if (!confirm(t('Xóa file này?'))) return;
                          setPendingId(a.id);
                          try {
                            await deleteAttachment(a.id);
                            toast.success(t('Đã xóa file'));
                          } catch {
                            toast.error(t('Không xóa được'));
                          } finally {
                            setPendingId(null);
                          }
                        }}
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={t('Xóa')}
                      >
                        {pendingId === a.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-4xl p-2 sm:p-4">
          <DialogTitle className="sr-only">{active?.fileName}</DialogTitle>
          {active && (
            <div className="space-y-2">
              <div className="relative max-h-[80vh] overflow-hidden rounded-md bg-black">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={fileUrl(active.id)}
                  alt={descriptionOf(active) ?? active.fileName}
                  className="mx-auto max-h-[80vh] w-auto object-contain"
                />
              </div>
              <div className="flex items-center justify-between gap-2 px-2">
                <p className="min-w-0 truncate text-sm text-muted-foreground">
                  {descriptionOf(active) ?? active.fileName}
                </p>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      if (active) startEdit(active);
                      setActive(null);
                    }}
                  >
                    <Pencil className="mr-1 h-3.5 w-3.5" />
                    {t('Sửa mô tả')}
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <a href={fileUrl(active.id)} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="mr-1 h-3.5 w-3.5" />
                      {t('Mở trong tab mới')}
                    </a>
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
