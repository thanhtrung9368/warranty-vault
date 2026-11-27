// The device-detail "Trả góp" card (FEATURE_RESEARCH_2026-11 §6.5, migration
// 0031).
//
// Three jobs, in reading order:
//
//   1. show what the plan actually is — progress (paid/total payments), the
//      money still owed, the next due day, and who financed it;
//   2. say plainly when the figures are a LOWER BOUND because a fee was never
//      declared (`hasUnknownFees`) — the app must not present an incomplete
//      total as a fact;
//   3. let the owner record or clear the plan in a form that is its OWN form.
//
// ## Why a separate form
//
// `PATCH /api/v1/devices/{id}` replaces the whole device and knows nothing about
// the plan; a client that predates the field would erase it. The plan therefore
// has its own endpoint (`PUT`/`DELETE /devices/{id}/installment`) and its own
// `useActionState` form, so a device edit can never touch it — and a device edit
// cannot be blocked by a validation error in the plan form.
//
// ## No reminder, no "quá hạn"
//
// `paidCount` is what the USER says they have paid; the app cannot see a bank
// transaction. Wave 1 ships no reminder and no push for exactly that reason, and
// the card never claims a payment is late — it shows the NEXT DUE date and lets
// the reader judge. The copy follows `lib/installment.ts`.

'use client';

import * as React from 'react';
import { useActionState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2, PencilLine, Save, Trash2, Wallet } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/ui/field-error';
import { Progress } from '@/components/ui/progress';
import { useLocale, useT } from '@/lib/i18n/client';
import { formatMoney } from '@/lib/currency';
import {
  firstDueInputValue,
  installmentFeeCaveat,
  installmentNextDueLabel,
  installmentProgressLabel,
  installmentProgressPercent,
  installmentRemainingLabel,
  installmentSpanLabel,
  installmentTotalLabel,
  todayInputValue,
} from '@/lib/installment';
import type { InstallmentPlan } from '@/lib/api/devices';
import {
  clearInstallment,
  saveInstallment,
  type DeviceFormState,
} from '@/app/actions/devices';

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending} className="rounded-pill">
      {pending ? (
        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
      ) : (
        <Save className="mr-1.5 h-4 w-4" />
      )}
      {label}
    </Button>
  );
}

/**
 * Prefill one money input from the stored amount. A blank string is "the user
 * did not declare this fee" (`null`), which the form keeps distinct from `0` —
 * the contract treats the two differently (lower bound vs. a known fee).
 */
function moneyInputValue(amount: number | null | undefined): string {
  return amount == null ? '' : String(amount);
}

export function InstallmentCard({
  deviceId,
  plan,
  currency,
}: {
  deviceId: string;
  /** `Device.installment` exactly as the server returned it; null = no plan. */
  plan: InstallmentPlan | null;
  /** `Device.currency` — the plan's amounts are in this unit, not always VND. */
  currency: string;
}) {
  const t = useT();
  const locale = useLocale();
  const [open, setOpen] = React.useState(false);
  const [removing, startRemoving] = useTransition();

  const [state, formAction] = useActionState<DeviceFormState, FormData>(
    saveInstallment.bind(null, deviceId),
    {},
  );
  const errors = state?.errors ?? {};

  // Re-seed every time the form opens so a successful save (or a clear) cannot
  // leave the fields showing values that are no longer stored.
  const [downPayment, setDownPayment] = React.useState(
    moneyInputValue(plan?.downPayment),
  );
  const [months, setMonths] = React.useState(plan ? String(plan.months) : '12');
  const [monthlyAmount, setMonthlyAmount] = React.useState(
    moneyInputValue(plan?.monthlyAmount),
  );
  const [firstDueAt, setFirstDueAt] = React.useState(
    plan ? firstDueInputValue(plan) : todayInputValue(),
  );
  const [fileFee, setFileFee] = React.useState(moneyInputValue(plan?.fileFee));
  const [monthlyFee, setMonthlyFee] = React.useState(
    moneyInputValue(plan?.monthlyFee),
  );
  const [paidCount, setPaidCount] = React.useState(
    plan ? String(plan.paidCount) : '0',
  );
  const [lender, setLender] = React.useState(plan?.lender ?? '');

  function reseedFromPlan() {
    setDownPayment(moneyInputValue(plan?.downPayment));
    setMonths(plan ? String(plan.months) : '12');
    setMonthlyAmount(moneyInputValue(plan?.monthlyAmount));
    setFirstDueAt(plan ? firstDueInputValue(plan) : todayInputValue());
    setFileFee(moneyInputValue(plan?.fileFee));
    setMonthlyFee(moneyInputValue(plan?.monthlyFee));
    setPaidCount(plan ? String(plan.paidCount) : '0');
    setLender(plan?.lender ?? '');
  }

  const percent = plan ? installmentProgressPercent(plan) : 0;
  // Money in the device's own currency: a USD device must never print a ₫ sign
  // beside a dollar amount.
  const perMonth =
    plan != null
      ? t('{amount}/kỳ', {
          amount: formatMoney(plan.monthlyAmount, currency, locale),
        })
      : '';

  return (
    <Card id="installment" className="scroll-mt-24">
      <CardHeader className="flex flex-row items-start justify-between space-y-0 gap-3">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5 text-primary" />
            {t('Trả góp')}
          </CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(
              'Kế hoạch bạn tự ghi: trả trước, số kỳ và số tiền mỗi kỳ. Đây không phải sổ giao dịch ngân hàng — app không biết ngân hàng đã trừ hay chưa.',
            )}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant={open ? 'outline' : 'default'}
          className="shrink-0 rounded-pill"
          onClick={() => {
            if (!open) reseedFromPlan();
            setOpen((v) => !v);
          }}
        >
          <PencilLine className="mr-1.5 h-4 w-4" />
          {plan ? t('Sửa kế hoạch') : t('Ghi kế hoạch')}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4">
        {plan ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-sm font-semibold text-ink">
                  {installmentProgressLabel(plan, locale)}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {percent}%
                </span>
              </div>
              <Progress value={percent} aria-label={installmentProgressLabel(plan, locale)} />
            </div>

            <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
              <div>
                <p className="info-row-label">{t('Còn nợ')}</p>
                <p className="text-sm font-semibold tabular-nums">
                  {installmentRemainingLabel(plan, currency, locale)}
                </p>
              </div>
              <div>
                <p className="info-row-label">{t('Tổng chi phí sở hữu')}</p>
                <p className="text-sm font-semibold tabular-nums">
                  {installmentTotalLabel(plan, currency, locale)}
                </p>
              </div>
              <div>
                <p className="info-row-label">{t('Kỳ tới')}</p>
                <p className="text-sm tabular-nums">{installmentNextDueLabel(plan, locale)}</p>
              </div>
              <div>
                <p className="info-row-label">{t('Mỗi kỳ')}</p>
                <p className="text-sm tabular-nums">{perMonth}</p>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              {[installmentSpanLabel(plan, locale), plan.lender ?? '']
                .filter(Boolean)
                .join(' • ')}
            </p>

            {plan.hasUnknownFees && (
              <p className="rounded-xl border-[1.5px] border-dashed border-border bg-surface-2 p-3 text-xs leading-relaxed text-muted-foreground">
                {installmentFeeCaveat(plan, locale)}
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {t(
              'Thiết bị này chưa ghi trả góp. Ghi kế hoạch để chi phí sở hữu, lãi/lỗ khi bán lại và thống kê tính đúng số tiền bạn thật sự trả.',
            )}
          </p>
        )}

        {open && (
          <form
            action={formAction}
            className="space-y-4 border-t border-dashed border-border pt-4"
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="installmentDownPayment">
                  {t('Trả trước')} ({currency})
                </Label>
                <Input
                  id="installmentDownPayment"
                  name="downPayment"
                  inputMode="numeric"
                  value={downPayment}
                  onChange={(e) => {
                    setDownPayment(e.target.value);
                  }}
                  aria-invalid={Boolean(errors.downPayment?.length)}
                  aria-describedby={
                    errors.downPayment?.length ? 'installmentDownPayment-error' : undefined
                  }
                />
                <FieldError id="installmentDownPayment-error" errors={errors.downPayment} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="installmentMonths">
                  {t('Số kỳ (tháng)')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="installmentMonths"
                  name="months"
                  type="number"
                  min={1}
                  max={60}
                  inputMode="numeric"
                  value={months}
                  onChange={(e) => {
                    setMonths(e.target.value);
                  }}
                  aria-invalid={Boolean(errors.months?.length)}
                  aria-describedby={
                    errors.months?.length ? 'installmentMonths-error' : undefined
                  }
                />
                <FieldError id="installmentMonths-error" errors={errors.months} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="installmentMonthlyAmount">
                  {t('Mỗi kỳ trả')} ({currency}) <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="installmentMonthlyAmount"
                  name="monthlyAmount"
                  inputMode="numeric"
                  value={monthlyAmount}
                  onChange={(e) => {
                    setMonthlyAmount(e.target.value);
                  }}
                  aria-invalid={Boolean(errors.monthlyAmount?.length)}
                  aria-describedby={
                    errors.monthlyAmount?.length ? 'installmentMonthlyAmount-error' : undefined
                  }
                />
                <FieldError id="installmentMonthlyAmount-error" errors={errors.monthlyAmount} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="installmentFirstDueAt">
                  {t('Ngày kỳ đầu')} <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="installmentFirstDueAt"
                  name="firstDueAt"
                  type="date"
                  value={firstDueAt}
                  onChange={(e) => {
                    setFirstDueAt(e.target.value);
                  }}
                  aria-invalid={Boolean(errors.firstDueAt?.length)}
                  aria-describedby={
                    errors.firstDueAt?.length ? 'installmentFirstDueAt-error' : undefined
                  }
                />
                <FieldError id="installmentFirstDueAt-error" errors={errors.firstDueAt} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="installmentFileFee">
                  {t('Phí hồ sơ')} ({currency})
                </Label>
                <Input
                  id="installmentFileFee"
                  name="fileFee"
                  inputMode="numeric"
                  placeholder={t('Chưa biết — để trống')}
                  value={fileFee}
                  onChange={(e) => {
                    setFileFee(e.target.value);
                  }}
                  aria-invalid={Boolean(errors.fileFee?.length)}
                  aria-describedby={
                    errors.fileFee?.length ? 'installmentFileFee-error' : undefined
                  }
                />
                <FieldError id="installmentFileFee-error" errors={errors.fileFee} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="installmentMonthlyFee">
                  {t('Phí mỗi kỳ')} ({currency})
                </Label>
                <Input
                  id="installmentMonthlyFee"
                  name="monthlyFee"
                  inputMode="numeric"
                  placeholder={t('Chưa biết — để trống')}
                  value={monthlyFee}
                  onChange={(e) => {
                    setMonthlyFee(e.target.value);
                  }}
                  aria-invalid={Boolean(errors.monthlyFee?.length)}
                  aria-describedby={
                    errors.monthlyFee?.length ? 'installmentMonthlyFee-error' : undefined
                  }
                />
                <FieldError id="installmentMonthlyFee-error" errors={errors.monthlyFee} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="installmentPaidCount">{t('Đã trả (số kỳ)')}</Label>
                <Input
                  id="installmentPaidCount"
                  name="paidCount"
                  type="number"
                  min={0}
                  max={60}
                  inputMode="numeric"
                  value={paidCount}
                  onChange={(e) => {
                    setPaidCount(e.target.value);
                  }}
                  aria-invalid={Boolean(errors.paidCount?.length)}
                  aria-describedby={
                    errors.paidCount?.length ? 'installmentPaidCount-error' : undefined
                  }
                />
                <FieldError id="installmentPaidCount-error" errors={errors.paidCount} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="installmentLender">{t('Nơi trả góp')}</Label>
                <Input
                  id="installmentLender"
                  name="lender"
                  maxLength={100}
                  value={lender}
                  onChange={(e) => setLender(e.target.value)}
                  aria-invalid={Boolean(errors.lender?.length)}
                  aria-describedby={
                    errors.lender?.length ? 'installmentLender-error' : undefined
                  }
                />
                <FieldError id="installmentLender-error" errors={errors.lender} />
              </div>
            </div>

            <p className="text-xs leading-relaxed text-muted-foreground">
              {t(
                'Để trống phí nghĩa là “chưa biết”, không phải 0. Khi thiếu phí, tổng chi phí chỉ là mức tối thiểu.',
              )}
            </p>

            <div className="flex flex-wrap items-center gap-2">
              <SubmitButton label={t('Lưu kế hoạch')} />
              {plan && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="rounded-pill text-destructive hover:bg-destructive/10 hover:text-destructive"
                  disabled={removing}
                  onClick={() =>
                    startRemoving(async () => {
                      const res = await clearInstallment(deviceId);
                      if (res.ok === false) {
                        toast.error(res.message ?? t('Không xoá được, thử lại sau'));
                        return;
                      }
                      setOpen(false);
                      toast.success(t('Đã xoá kế hoạch trả góp.'));
                    })
                  }
                >
                  {removing ? (
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="mr-1.5 h-4 w-4" />
                  )}
                  {t('Xoá kế hoạch')}
                </Button>
              )}
              {state?.message && state.ok !== false && (
                <span className="text-xs font-medium text-primary-text">{state.message}</span>
              )}
              {state?.message && state.ok === false && (
                <span className="text-xs font-medium text-destructive">{state.message}</span>
              )}
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
