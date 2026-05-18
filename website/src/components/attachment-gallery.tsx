'use client';

import * as React from 'react';
import Image from 'next/image';
import { FileText, Trash2, ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog';
import { deleteAttachment } from '@/app/actions/attachments';

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
  const [active, setActive] = React.useState<Attachment | null>(null);
  const [pendingId, setPendingId] = React.useState<string | null>(null);

  if (items.length === 0) {
    return null;
  }

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
        {items.map((a) => {
          const isImage = a.fileType.startsWith('image/');
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
                    alt={a.description ?? a.fileName}
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
              <div className="flex items-center justify-between gap-1 border-t border-border bg-card/80 px-2.5 py-1.5 backdrop-blur">
                <span className="truncate text-[11px] font-medium text-ink-2">
                  {a.description ?? a.fileName}
                </span>
                <button
                  type="button"
                  disabled={pendingId === a.id}
                  onClick={async () => {
                    if (!confirm('Xóa file này?')) return;
                    setPendingId(a.id);
                    try {
                      await deleteAttachment(a.id);
                      toast.success('Đã xóa file');
                    } catch {
                      toast.error('Không xóa được');
                    } finally {
                      setPendingId(null);
                    }
                  }}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Xóa"
                >
                  {pendingId === a.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Trash2 className="h-3.5 w-3.5" />
                  )}
                </button>
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
                  alt={active.description ?? active.fileName}
                  className="mx-auto max-h-[80vh] w-auto object-contain"
                />
              </div>
              <div className="flex items-center justify-between px-2">
                <p className="text-sm text-muted-foreground">
                  {active.description ?? active.fileName}
                </p>
                <Button asChild variant="outline" size="sm">
                  <a href={fileUrl(active.id)} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="mr-1 h-3.5 w-3.5" />
                    Mở trong tab mới
                  </a>
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
