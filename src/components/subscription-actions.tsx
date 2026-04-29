'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, RefreshCcw, Check, Pause, X, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { format } from 'date-fns';
import { formatNumber, parseVNDInput } from '@/lib/format';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  logSubscriptionPayment,
  setSubscriptionStatus,
  deleteSubscription,
  renewSubscriptionNow,
} from '@/app/actions/subscriptions';

export function LogPaymentDialog({
  subId,
  defaultAmount,
}: {
  subId: string;
  defaultAmount: number;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [value, setValue] = React.useState<string>(formatNumber(defaultAmount));
  const [paidAt, setPaidAt] = React.useState<string>(
    format(new Date(), 'yyyy-MM-dd'),
  );
  const [note, setNote] = React.useState('');

  const submit = async () => {
    const num = parseVNDInput(value);
    if (!num || num < 0) {
      toast.error('Nhập giá hợp lệ');
      return;
    }
    setPending(true);
    try {
      const fd = new FormData();
      fd.append('amount', String(num));
      fd.append('paidAt', paidAt);
      if (note.trim()) fd.append('note', note.trim());
      const res = await logSubscriptionPayment(subId, fd);
      if (res.ok === false) {
        toast.error(res.message ?? 'Không lưu được');
      } else {
        toast.success('Đã log payment');
        setOpen(false);
        setNote('');
        router.refresh();
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <RefreshCcw className="mr-2 h-4 w-4" />
          Log payment
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogTitle>Log một lần thanh toán</DialogTitle>
        <div className="space-y-3 pt-2">
          <div className="space-y-2">
            <Label htmlFor="amount">Số tiền (VND)</Label>
            <div className="relative">
              <Input
                id="amount"
                inputMode="numeric"
                value={value}
                onChange={(e) => {
                  const n = parseVNDInput(e.target.value);
                  setValue(n ? formatNumber(n) : '');
                }}
                placeholder="0"
                className="pr-10"
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                ₫
              </span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="paidAt">Ngày thanh toán</Label>
            <Input
              id="paidAt"
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="note">Ghi chú</Label>
            <Input
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="vd: tăng giá, khuyến mãi..."
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setOpen(false)}>
              Huỷ
            </Button>
            <Button onClick={submit} disabled={pending}>
              {pending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              Lưu
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RenewNowButton({ subId }: { subId: string }) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  return (
    <Button
      size="sm"
      disabled={pending}
      onClick={async () => {
        if (!confirm('Đánh dấu đã gia hạn 1 chu kỳ? Sẽ log payment + bump ngày tới.'))
          return;
        setPending(true);
        try {
          const res = await renewSubscriptionNow(subId);
          if (res.ok === false) toast.error(res.message ?? 'Không gia hạn được');
          else {
            toast.success('Đã gia hạn');
            router.refresh();
          }
        } finally {
          setPending(false);
        }
      }}
    >
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <RefreshCcw className="mr-2 h-4 w-4" />
      )}
      Đã gia hạn
    </Button>
  );
}

export function SubscriptionStatusButtons({
  subId,
  status,
}: {
  subId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);

  const flip = async (next: string) => {
    setPending(next);
    try {
      const res = await setSubscriptionStatus(subId, next);
      if (!res.ok) toast.error('Không đổi được trạng thái');
      else router.refresh();
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      {status !== 'ACTIVE' && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => flip('ACTIVE')}
          disabled={pending !== null}
        >
          <Check className="mr-1 h-3 w-3" />
          Kích hoạt
        </Button>
      )}
      {status !== 'PAUSED' && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => flip('PAUSED')}
          disabled={pending !== null}
        >
          <Pause className="mr-1 h-3 w-3" />
          Tạm dừng
        </Button>
      )}
      {status !== 'CANCELED' && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => flip('CANCELED')}
          disabled={pending !== null}
        >
          <X className="mr-1 h-3 w-3" />
          Huỷ
        </Button>
      )}
    </div>
  );
}

export function DeleteSubscriptionButton({ subId }: { subId: string }) {
  const [pending, setPending] = React.useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={async () => {
        if (!confirm('Xoá gói này? Lịch sử thanh toán cũng sẽ mất.')) return;
        setPending(true);
        try {
          await deleteSubscription(subId);
        } catch {
          toast.error('Không xoá được');
          setPending(false);
        }
      }}
    >
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Trash2 className="mr-2 h-4 w-4" />
      )}
      Xoá
    </Button>
  );
}
