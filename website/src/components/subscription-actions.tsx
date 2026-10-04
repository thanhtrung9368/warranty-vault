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
import { useLocale, useT } from '@/lib/i18n/client';
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
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [value, setValue] = React.useState<string>(formatNumber(defaultAmount, locale));
  const [paidAt, setPaidAt] = React.useState<string>(
    format(new Date(), 'yyyy-MM-dd'),
  );
  const [note, setNote] = React.useState('');

  const submit = async () => {
    const num = parseVNDInput(value);
    if (!num || num < 0) {
      toast.error(t('Nhập giá hợp lệ'));
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
        toast.error(res.message ?? t('Không lưu được'));
      } else {
        toast.success(t('Đã log payment'));
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
        <Button variant="outline" size="sm" className="rounded-pill border-border-strong">
          <RefreshCcw className="mr-2 h-4 w-4" />
          Log payment
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md rounded-2xl border-[1.5px]">
        <DialogTitle className="font-display text-xl text-ink">
          {t('Log một lần thanh toán')}
        </DialogTitle>
        <div className="space-y-3 pt-2">
          <div className="space-y-2">
            <Label htmlFor="amount">{t('Số tiền (VND)')}</Label>
            <div className="relative">
              <Input
                id="amount"
                inputMode="numeric"
                value={value}
                onChange={(e) => {
                  const n = parseVNDInput(e.target.value);
                  setValue(n ? formatNumber(n, locale) : '');
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
            <Label htmlFor="paidAt">{t('Ngày thanh toán')}</Label>
            <Input
              id="paidAt"
              type="date"
              value={paidAt}
              onChange={(e) => setPaidAt(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="note">{t('Ghi chú')}</Label>
            <Input
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('vd: tăng giá, khuyến mãi...')}
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              className="rounded-pill border-border-strong"
              onClick={() => setOpen(false)}
            >
              {t('Huỷ')}
            </Button>
            <Button className="rounded-pill" onClick={submit} disabled={pending}>
              {pending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-2 h-4 w-4" />
              )}
              {t('Lưu')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function RenewNowButton({ subId }: { subId: string }) {
  const router = useRouter();
  const t = useT();
  const [pending, setPending] = React.useState(false);
  return (
    <Button
      size="sm"
      className="rounded-pill"
      disabled={pending}
      onClick={async () => {
        if (!confirm(t('Đánh dấu đã gia hạn 1 chu kỳ? Sẽ log payment + bump ngày tới.')))
          return;
        setPending(true);
        try {
          const res = await renewSubscriptionNow(subId);
          if (res.ok === false) toast.error(res.message ?? t('Không gia hạn được'));
          else {
            toast.success(t('Đã gia hạn'));
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
      {t('Đã gia hạn')}
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
  const t = useT();
  const [pending, setPending] = React.useState<string | null>(null);

  const flip = async (next: string) => {
    setPending(next);
    try {
      const res = await setSubscriptionStatus(subId, next);
      if (!res.ok) toast.error(t('Không đổi được trạng thái'));
      else router.refresh();
    } finally {
      setPending(null);
    }
  };

  const options: { value: string; label: string; icon: React.ReactNode }[] = [
    { value: 'ACTIVE', label: t('Đang dùng'), icon: <Check className="h-3 w-3" /> },
    { value: 'PAUSED', label: t('Tạm dừng'), icon: <Pause className="h-3 w-3" /> },
    { value: 'CANCELED', label: t('Đã huỷ'), icon: <X className="h-3 w-3" /> },
  ];

  return (
    <div className="pill-group" role="tablist" aria-label={t('Đổi trạng thái')}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={status === o.value}
          data-active={status === o.value}
          disabled={pending !== null || status === o.value}
          onClick={() => flip(o.value)}
          className="inline-flex items-center gap-1.5"
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function DeleteSubscriptionButton({ subId }: { subId: string }) {
  const t = useT();
  const [pending, setPending] = React.useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className="rounded-pill border-destructive/40 text-destructive hover:bg-destructive-soft hover:text-destructive"
      disabled={pending}
      onClick={async () => {
        if (!confirm(t('Xoá gói này? Lịch sử thanh toán cũng sẽ mất.'))) return;
        setPending(true);
        try {
          await deleteSubscription(subId);
        } catch {
          toast.error(t('Không xoá được'));
          setPending(false);
        }
      }}
    >
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Trash2 className="mr-2 h-4 w-4" />
      )}
      {t('Xoá')}
    </Button>
  );
}
