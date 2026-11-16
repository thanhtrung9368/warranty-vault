'use client';

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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useT } from '@/lib/i18n/client';
import { dayToInputValue } from '@/lib/api-day';
import type { Staple, StapleState } from '@/lib/api/staples';
import { createStaple, updateStaple } from '@/app/actions/staples';

const STATES: StapleState[] = ['ENOUGH', 'LOW', 'OUT'];

export function StapleFormDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Staple;
  onSaved: () => void;
}) {
  const t = useT();
  const [state, setState] = React.useState<StapleState>(initial?.state ?? 'ENOUGH');
  const [useCadence, setUseCadence] = React.useState(initial?.cadenceDays != null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  const stateLabel = (value: StapleState) =>
    value === 'ENOUGH' ? t('Đủ dùng') : value === 'LOW' ? t('Sắp hết') : t('Đã hết');

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const form = event.currentTarget;
    const formData = new FormData(form);
    const name = String(formData.get('name') ?? '').trim();
    if (!name) {
      setError(t('Tên đồ dùng là bắt buộc'));
      return;
    }
    if (useCadence) {
      const days = Number(formData.get('cadenceDays'));
      if (!Number.isInteger(days) || days < 1 || days > 3650) {
        setError(t('Số ngày phải từ 1 đến 3650'));
        return;
      }
    } else {
      formData.delete('cadenceDays');
    }
    setSaving(true);
    try {
      const res = initial
        ? await updateStaple(initial.id, formData)
        : await createStaple(formData);
      if (res.ok) {
        onSaved();
        return;
      }
      setError(
        res.errors?.name?.[0] ??
          res.errors?.cadenceDays?.[0] ??
          res.errors?.lastBoughtAt?.[0] ??
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
          <DialogTitle>{initial ? t('Sửa đồ dùng') : t('Thêm đồ dùng')}</DialogTitle>
          <DialogDescription>
            {t('Nhắc mua lại khi sắp hết — theo chu kỳ hoặc thủ công.')}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="staple-name">{t('Tên')}</Label>
            <Input
              id="staple-name"
              name="name"
              defaultValue={initial?.name ?? ''}
              placeholder={t('Dầu gội, kem đánh răng...')}
              required
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="staple-category">{t('Nhóm')}</Label>
              <Input
                id="staple-category"
                name="category"
                defaultValue={initial?.category ?? ''}
                placeholder={t('Đồ dùng cá nhân...')}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="staple-unit">{t('Đơn vị')}</Label>
              <Input
                id="staple-unit"
                name="unit"
                defaultValue={initial?.unit ?? ''}
                placeholder={t('chai, tuýp, gói...')}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="staple-state">{t('Trạng thái')}</Label>
            <Select value={state} onValueChange={(v) => setState(v as StapleState)}>
              <SelectTrigger id="staple-state">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {stateLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <input type="hidden" name="state" value={state} />
          </div>

          <div className="space-y-3 rounded-lg border border-border bg-surface-2/50 p-3">
            <label className="flex items-center gap-2 text-sm font-medium text-ink">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border-strong accent-primary"
                checked={useCadence}
                onChange={(e) => setUseCadence(e.target.checked)}
              />
              {t('Nhắc theo tần suất')}
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label htmlFor="staple-cadence">{t('Số ngày')}</Label>
                <Input
                  id="staple-cadence"
                  name="cadenceDays"
                  type="number"
                  min={1}
                  max={3650}
                  defaultValue={initial?.cadenceDays ?? 30}
                  disabled={!useCadence}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="staple-last-bought">{t('Lần mua gần nhất')}</Label>
                <Input
                  id="staple-last-bought"
                  name="lastBoughtAt"
                  type="date"
                  defaultValue={
                    initial?.lastBoughtAt ?? dayToInputValue(new Date())
                  }
                />
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="staple-notes">{t('Ghi chú')}</Label>
            <Textarea
              id="staple-notes"
              name="notes"
              defaultValue={initial?.notes ?? ''}
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
