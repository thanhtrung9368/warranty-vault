'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, RefreshCcw, Check, ShoppingBag, Ban, Trash2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatNumber, parseVNDInput } from '@/lib/format';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  logWishlistPrice,
  setWishlistStatus,
  deleteWishlistItem,
} from '@/app/actions/wishlist';

export function UpdatePriceDialog({
  itemId,
  currentPrice,
}: {
  itemId: string;
  currentPrice: number | null;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [value, setValue] = React.useState<string>(
    currentPrice ? formatNumber(currentPrice) : '',
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
      fd.append('price', String(num));
      if (note.trim()) fd.append('note', note.trim());
      const res = await logWishlistPrice(itemId, fd);
      if (res.ok === false) {
        toast.error(res.message ?? 'Không lưu được');
      } else {
        toast.success('Đã log giá mới');
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
          Cập nhật giá
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md rounded-2xl border-[1.5px]">
        <DialogTitle className="font-display text-xl text-ink">
          Cập nhật giá hiện tại
        </DialogTitle>
        <div className="space-y-3 pt-2">
          <div className="space-y-2">
            <Label htmlFor="price">Giá mới (VND)</Label>
            <div className="relative">
              <Input
                id="price"
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
            <Label htmlFor="note">Ghi chú (tuỳ chọn)</Label>
            <Input
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="vd: deal Black Friday, ưu đãi student..."
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              className="rounded-pill border-border-strong"
              onClick={() => setOpen(false)}
            >
              Huỷ
            </Button>
            <Button className="rounded-pill" onClick={submit} disabled={pending}>
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

export function WishlistStatusButtons({
  itemId,
  status,
}: {
  itemId: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, setPending] = React.useState<string | null>(null);

  const flip = async (next: string) => {
    setPending(next);
    try {
      const res = await setWishlistStatus(itemId, next);
      if (!res.ok) toast.error('Không đổi được trạng thái');
      else router.refresh();
    } finally {
      setPending(null);
    }
  };

  if (status === 'PURCHASED') {
    // Already purchased — only allow undoing back to WATCHING.
    return (
      <Button
        variant="outline"
        size="sm"
        className="rounded-pill border-border-strong"
        onClick={() => flip('WATCHING')}
        disabled={pending !== null}
      >
        Khôi phục về theo dõi
      </Button>
    );
  }

  const options: { value: string; label: string; icon: React.ReactNode | null }[] = [
    { value: 'WATCHING', label: 'Theo dõi', icon: null },
    { value: 'DECIDED', label: 'Quyết mua', icon: <Check className="h-3 w-3" /> },
    { value: 'SKIPPED', label: 'Bỏ qua', icon: <Ban className="h-3 w-3" /> },
  ];

  return (
    <div className="pill-group" role="tablist" aria-label="Đổi trạng thái">
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

export function MarkPurchasedButton({ itemId }: { itemId: string }) {
  return (
    <Button asChild size="sm" className="rounded-pill">
      <a href={`/devices/new?fromWishlist=${itemId}`}>
        <ShoppingBag className="mr-2 h-4 w-4" />
        Đã mua → tạo Device
      </a>
    </Button>
  );
}

export function MarkSubscribedButton({ itemId }: { itemId: string }) {
  return (
    <Button asChild variant="outline" size="sm" className="rounded-pill border-border-strong">
      <a href={`/subscriptions/new?fromWishlist=${itemId}`}>
        <RefreshCw className="mr-2 h-4 w-4" />
        Đã đăng ký → tạo Subscription
      </a>
    </Button>
  );
}

export function DeleteWishlistButton({ itemId }: { itemId: string }) {
  const [pending, setPending] = React.useState(false);
  return (
    <Button
      variant="outline"
      size="sm"
      className="rounded-pill border-destructive/40 text-destructive hover:bg-destructive-soft hover:text-destructive"
      disabled={pending}
      onClick={async () => {
        if (!confirm('Xoá món này khỏi wishlist? Lịch sử giá cũng sẽ mất.')) return;
        setPending(true);
        try {
          await deleteWishlistItem(itemId);
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
