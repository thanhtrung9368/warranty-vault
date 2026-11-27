'use client';

import * as React from 'react';
import Link from 'next/link';
import { AlertTriangle, Loader2, ScanLine, Sparkles } from 'lucide-react';
import { extractWarrantyCard } from '@/app/actions/ai';
import { useLocale, useT } from '@/lib/i18n/client';
import { SCAN_INBOX_HREF } from '@/lib/receipt-scan';
import type { AttachmentMeta } from '@/lib/api/devices';
import {
  mergeWarrantyCardDraft,
  warrantyCardDraftHeading,
  warrantyCardDraftSummary,
  warrantyCardFailureNotice,
  warrantyCardInboxNotice,
  warrantyCardUnmatchedLabels,
  type WarrantyCardDraft,
  type WarrantyCardMerge,
  type WarrantyCardValues,
} from '@/lib/warranty-card-scan';

// Upload-first warranty-card scan (FEATURE_RESEARCH_2026-11 §6.3).
//
// One tap uploads the photo/PDF to the inbox (no deviceId) and asks the Go
// endpoint to read the nine contract terms. It NEVER creates a Warranty or a
// Device; the user reviews this panel, taps "Điền vào biểu mẫu", and the form
// merges only the fields that were still empty. A field the user already filled
// is kept and reported as "Trên thẻ: …" by the form.
//
// The file stays in the inbox on every path, including a failed extraction:
// it is the thing the user cannot re-create, so the copy links there instead of
// pretending the pick was lost.
export function WarrantyCardScan({
  getCurrent,
  onMerged,
}: {
  /** The form's current nine values, read at apply time so the merge compares
   *  against what the user has actually typed (not a stale render snapshot). */
  getCurrent: () => WarrantyCardValues;
  /** Receives the merge result; the form writes the filled fields and renders
   *  the mismatches. Nothing is saved here. */
  onMerged: (merge: WarrantyCardMerge) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const inputRef = React.useRef<HTMLInputElement>(null);

  const [busy, setBusy] = React.useState(false);
  const [draft, setDraft] = React.useState<WarrantyCardDraft | null>(null);
  const [attachment, setAttachment] = React.useState<AttachmentMeta | null>(null);
  const [failure, setFailure] = React.useState<{
    message: string;
    gate?: 'ai_optin_required' | 'premium_required' | 'feature_disabled';
  } | null>(null);
  const [appliedNotice, setAppliedNotice] = React.useState<string | null>(null);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Allow re-picking the same file after a failure.
    event.target.value = '';
    if (!file) return;

    setBusy(true);
    setDraft(null);
    setFailure(null);
    setAppliedNotice(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await extractWarrantyCard(fd);
      if (res.ok) {
        setDraft(res.draft);
        setAttachment(res.attachment);
      } else {
        setFailure({ message: res.message, gate: res.gate });
        setAttachment(res.attachment ?? null);
      }
    } catch {
      setFailure({ message: t('Không đọc được thẻ bảo hành, thử lại nhé') });
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    if (!draft) return;
    const merge = mergeWarrantyCardDraft(draft, getCurrent(), locale);
    onMerged(merge);
    setAppliedNotice(
      merge.filled && Object.keys(merge.filled).length > 0
        ? t('Đã điền các ô còn trống từ thẻ. Các ô bạn đã nhập được giữ nguyên.')
        : merge.mismatches.length > 0
          ? t('Không điền thêm ô nào: thẻ chỉ có các giá trị bạn đã nhập, nhưng có chỗ khác nhau.')
          : t('Không đọc được điều khoản nào mới từ thẻ này.'),
    );
    setDraft(null);
  }

  const summary = draft ? warrantyCardDraftSummary(draft, locale) : [];
  const unmatched = draft ? warrantyCardUnmatchedLabels(draft, locale) : [];

  return (
    <div className="space-y-3 rounded-xl border-[1.5px] border-dashed border-primary/40 bg-primary/5 px-3.5 py-3">
      <input
        ref={inputRef}
        type="file"
        // The endpoint accepts JPEG/PNG/WEBP + PDF. No `capture="environment"`:
        // it would force the camera on Android and make a PDF impossible to
        // pick; the chooser still offers Camera.
        accept="image/jpeg,image/png,image/webp,application/pdf"
        className="hidden"
        onChange={handleFile}
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="flex w-full items-center gap-3 text-left disabled:opacity-60"
      >
        {busy ? (
          <Loader2 className="h-5 w-5 shrink-0 animate-spin text-primary" />
        ) : (
          <ScanLine className="h-5 w-5 shrink-0 text-primary" />
        )}
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-foreground">
            {busy ? t('Đang đọc thẻ bảo hành…') : t('Đọc thẻ bảo hành')}
          </span>
          <span className="block text-xs text-muted-foreground">
            {t(
              'Chụp hoặc chọn ảnh/PDF thẻ bảo hành để tự điền 9 điều khoản — chỉ điền ô bạn còn để trống, bạn vẫn phải bấm lưu',
            )}
          </span>
        </span>
      </button>

      {appliedNotice && (
        <p className="text-xs text-muted-foreground">{appliedNotice}</p>
      )}

      {/* The upload landed but extraction did not. The file is in the inbox;
          say that and link there instead of a dead-end error. */}
      {failure && (
        <div
          role="alert"
          className="rounded-xl border-[1.5px] border-rose-ink/20 bg-rose-soft px-3 py-2 text-xs text-rose-ink"
        >
          <p className="flex items-start gap-1.5 font-semibold">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{failure.message}</span>
          </p>
          {failure.gate === 'ai_optin_required' && (
            <p className="mt-1 pl-5">
              {t('Bật Trợ lý AI trong Cài đặt để dùng tính năng này.')}{' '}
              <Link href="/settings" className="font-semibold underline underline-offset-2">
                {t('Mở Cài đặt')} →
              </Link>
            </p>
          )}
          {failure.gate === 'premium_required' && (
            <p className="mt-1 pl-5">{t('Đọc thẻ bảo hành là tính năng Premium.')}</p>
          )}
          {failure.gate === 'feature_disabled' && (
            <p className="mt-1 pl-5">{t('Tính năng đọc thẻ bảo hành chưa khả dụng.')}</p>
          )}
          {attachment && (
            <p className="mt-1 pl-5">
              {warrantyCardFailureNotice(locale)}{' '}
              <Link
                href={SCAN_INBOX_HREF}
                className="font-semibold underline underline-offset-2"
              >
                {t('Mở hộp thư')} →
              </Link>
            </p>
          )}
        </div>
      )}

      {draft && (
        <div className="space-y-2 rounded-xl bg-surface-2 px-3 py-2 text-xs">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <p className="font-medium text-foreground">
              {warrantyCardDraftHeading(draft.confidence, locale)}
            </p>
          </div>

          {summary.length > 0 && (
            <ul className="space-y-1">
              {summary.map((row) => (
                <li key={row.field}>
                  <span className="text-muted-foreground">{row.label}: </span>
                  <span className="text-foreground">{row.value}</span>
                </li>
              ))}
            </ul>
          )}

          {unmatched.length > 0 && (
            <p className="text-muted-foreground">
              {t('Không đọc được: {fields} — bạn tự nhập các ô này.', {
                fields: unmatched.join(', '),
              })}
            </p>
          )}

          {draft.warnings.length > 0 && (
            <div className="rounded-lg border-[1.5px] border-amber-200 bg-amber-soft px-3 py-2 text-amber-ink dark:border-amber-900">
              <p className="flex items-center gap-1.5 font-semibold">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {t('Lưu ý về các giá trị đọc được')}
              </p>
              <ul className="mt-1 space-y-1">
                {draft.warnings.map((w) => (
                  <li key={`${w.code}-${w.field}-${w.message}`}>{w.message}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="border-t border-border pt-2 text-muted-foreground">
            {warrantyCardInboxNotice(draft.extractedTextStored, locale)}{' '}
            <Link
              href={SCAN_INBOX_HREF}
              className="font-semibold text-primary-text underline underline-offset-2"
            >
              {t('Mở hộp thư')} →
            </Link>
          </p>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              onClick={apply}
              className="rounded-pill bg-primary px-3.5 py-1.5 text-xs font-semibold text-white transition hover:opacity-90"
            >
              {t('Điền vào biểu mẫu')}
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(null);
                setAttachment(null);
              }}
              className="text-xs font-medium text-muted-foreground underline underline-offset-2"
            >
              {t('Bỏ qua')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
