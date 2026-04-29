'use client';

import * as React from 'react';
import { Eye, EyeOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  dismissWarrantyReminder,
  restoreWarrantyReminder,
} from '@/app/actions/reminders';

export function DismissButton({
  warrantyId,
  isDismissed,
}: {
  warrantyId: string;
  isDismissed: boolean;
}) {
  const [pending, startTransition] = React.useTransition();
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          if (isDismissed) {
            await restoreWarrantyReminder(warrantyId);
            toast.success('Đã hiện lại nhắc nhở');
          } else {
            await dismissWarrantyReminder(warrantyId);
            toast.success('Đã ẩn nhắc nhở');
          }
        })
      }
    >
      {pending ? (
        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
      ) : isDismissed ? (
        <Eye className="mr-1 h-3.5 w-3.5" />
      ) : (
        <EyeOff className="mr-1 h-3.5 w-3.5" />
      )}
      {isDismissed ? 'Hiện lại' : 'Đã xem, ẩn đi'}
    </Button>
  );
}
