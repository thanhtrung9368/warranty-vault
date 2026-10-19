// "The brand and your invoice disagree" — the informational block shown on the
// device detail page (and in the form once an answer exists).
//
// Design rules from the brief, encoded here rather than left to a reviewer:
//
//   * a non-null `warrantyMismatch` must be UNMISSABLE but NOT alarmist. It uses
//     the sky/info palette (never red/rose), an icon, the plain-language sentence
//     and BOTH dates. The accompanying note says it is information, not an error.
//   * no mismatch is ALSO information: when the server computed a null mismatch
//     and the brand gave a start date, the block says the two agree.
//   * `NOT_REGISTERED` is a third state with its own sentence — not agreement,
//     not disagreement.
//
// All three decisions come from `@/lib/brand-warranty` (pure, unit-tested); this
// component is only the layout. It is a client component so the copy follows the
// language provider, and it is render-testable with `renderToStaticMarkup`.

'use client';

import { Check, Info, Scale } from 'lucide-react';
import { useLocale, useT } from '@/lib/i18n/client';
import {
  brandAgreementLine,
  brandNotRegisteredLine,
  mismatchCopy,
  normalizeWarrantyMismatch,
  type BrandWarrantyAnswerSource,
} from '@/lib/brand-warranty';

export function BrandWarrantyNote({
  device,
}: {
  device: BrandWarrantyAnswerSource;
}) {
  const t = useT();
  const locale = useLocale();
  const mismatch = normalizeWarrantyMismatch(device.warrantyMismatch);

  if (mismatch) {
    const copy = mismatchCopy(mismatch, locale);
    return (
      <div
        // Sky, not red: this is a fact to act on, not a validation failure.
        className="rounded-xl border-[1.5px] border-sky-soft bg-sky-soft/50 p-4"
        role="note"
      >
        <p className="flex items-start gap-2 text-sm font-semibold leading-relaxed text-ink">
          <Scale className="mt-0.5 h-4 w-4 shrink-0 text-sky-ink" />
          <span>{copy.sentence}</span>
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2 pl-6 text-xs">
          <span className="rounded-pill bg-surface px-2.5 py-1 font-medium text-ink">
            {copy.brandDateLabel}
          </span>
          <span className="rounded-pill bg-surface px-2.5 py-1 font-medium text-ink">
            {copy.purchaseDateLabel}
          </span>
        </div>
        <p className="mt-2.5 pl-6 text-xs leading-relaxed text-ink-2">{copy.note}</p>
      </div>
    );
  }

  const agreement = brandAgreementLine(device, locale);
  if (agreement) {
    return (
      <p
        className="flex items-start gap-2 rounded-xl border-[1.5px] border-emerald-soft bg-emerald-soft/40 p-4 text-sm leading-relaxed text-ink-2"
        role="note"
      >
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-ink" />
        <span>{agreement}</span>
      </p>
    );
  }

  const notRegistered = brandNotRegisteredLine(device, locale);
  if (notRegistered) {
    return (
      <p
        className="flex items-start gap-2 rounded-xl border-[1.5px] border-border bg-surface-2 p-4 text-sm leading-relaxed text-ink-2"
        role="note"
      >
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <span>{notRegistered}</span>
      </p>
    );
  }

  // Not checked yet (or a payload with no answer): the card's own recorded-answer
  // line already says "chưa đối chiếu", so there is nothing extra to claim here.
  return (
    <p className="flex items-start gap-2 rounded-xl border-[1.5px] border-dashed border-border bg-surface-2 p-4 text-sm leading-relaxed text-muted-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        {t(
          'Chưa đối chiếu với hãng — khi có kết quả, ghi ngày hãng ghi để app so với hoá đơn của bạn.',
        )}
      </span>
    </p>
  );
}
