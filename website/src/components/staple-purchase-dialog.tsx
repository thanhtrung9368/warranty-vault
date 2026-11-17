'use client';

// "Đã mua lại" — one restock, with the price it cost.
//
// The price is the point of this dialog: it is what makes the staple's price
// history (and the card's last/lowest summary) real. Everything except the
// price is optional; Go owns the validation and the transaction that also
// advances `lastBoughtAt` and puts the item back to ENOUGH.

import * as React from 'react';
import { Loader2 } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { formatNumber, parseVNDInput } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { dayToInputValue } from '@/lib/api-day';
import type { Staple } from '@/lib/api/staples';
import { addStaplePurchase } from '@/app/actions/staples';

export function StaplePurchaseDialog({
  open,
  onOpenChange,
  staple,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  staple: Staple;
  onSaved: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const [price, setPrice] = React.useState(() =>
    staple.lastPrice != null ? formatNumber(staple.lastPrice, locale) : '',
  );
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  // Captured once so a dialog left open across midnight cannot drift.
  const [today] = React.useState(() => dayToInputValue(new Date()));

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (price.trim() === '') {
      setError(t('Nhập giá hợp lệ'));
      return;
    }
    const formData = new FormData(event.currentTarget);
    // The input displays grouped digits; the wire wants a plain integer.
    formData.set('price', String(parseVNDInput(price)));
    setSaving(true);
    try {
      const res = await addStaplePurchase(staple.id, formData);
      if (res.ok) {
        onSaved();
        return;
      }
      setError(
        res.errors?.price?.[0] ??
          res.errors?.purchasedAt?.[0] ??
          res.errors?.store?.[0] ??
          res.errors?.note?.[0] ??
          res.message ??
          t('Không lưu được'),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('Thêm lần mua')}</DialogTitle>
          <DialogDescription>
            {staple.name} — {t('Lưu giá mỗi lần mua lại để theo dõi chi phí.')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="staple-purchase-price">{t('Giá mua (VND)')}</Label>
            <div className="relative">
              <Input
                id="staple-purchase-price"
                name="price"
                inputMode="numeric"
                value={price}
                onChange={(event) => {
                  const digits = event.target.value.replace(/[^\d]/g, '');
                  setPrice(digits === '' ? '' : formatNumber(Number(digits), locale));
                }}
                placeholder="0"
                className="pr-10"
                autoFocus
                required
              />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                ₫
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="staple-purchase-date">{t('Ngày mua')}</Label>
            <Input
              id="staple-purchase-date"
              name="purchasedAt"
              type="date"
              defaultValue={today}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="staple-purchase-store">{t('Nơi mua')}</Label>
            <Input id="staple-purchase-store" name="store" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="staple-purchase-note">{t('Ghi chú')}</Label>
            <Textarea
              id="staple-purchase-note"
              name="note"
              placeholder={t('Ghi chú thêm...')}
              rows={3}
            />
          </div>

          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              className="rounded-pill"
              onClick={() => onOpenChange(false)}
              disabled={saving}
            >
              {t('Huỷ')}
            </Button>
            <Button type="submit" className="rounded-pill" disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {saving ? t('Đang lưu…') : t('Lưu')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
