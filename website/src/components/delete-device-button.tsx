'use client';

import * as React from 'react';
import { Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { deleteDevice } from '@/app/actions/devices';
import { useT } from '@/lib/i18n/client';

export function DeleteDeviceButton({ id, name }: { id: string; name: string }) {
  const t = useT();
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="rounded-pill border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="mr-1 h-4 w-4" />
          {t('Xoá')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('Xóa thiết bị?')}</DialogTitle>
          <DialogDescription>
            {t(
              'Hành động này sẽ xóa vĩnh viễn {name} cùng toàn bộ file đính kèm và nhắc nhở. Không thể khôi phục.',
              { name },
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="ghost"
            className="rounded-pill"
            onClick={() => setOpen(false)}
            disabled={pending}
          >
            {t('Huỷ')}
          </Button>
          <Button
            variant="destructive"
            className="rounded-pill"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                try {
                  await deleteDevice(id);
                  toast.success(t('Đã xoá thiết bị'));
                } catch {
                  toast.error(t('Không xoá được, thử lại sau'));
                }
              })
            }
          >
            {pending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
            {t('Xoá vĩnh viễn')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
