'use client';

// "Đánh giá bảo hành" — the AI claim assessment panel.
//
// This component is deliberately an ADVICE panel, not an outcome panel:
//
//   * the coverage hint is rendered with a confidence level and a plain
//     sentence that the service centre decides (see
//     `lib/claim-assessment.ts`; the wording is the product constraint);
//   * neither the gate states nor the result use an approve/reject colour —
//     the only red surface is a genuine transport/server failure;
//   * `draftLetter` is shown as a copyable Vietnamese block and labelled as
//     Vietnamese, because it is written for the service centre, not translated
//     for the reader;
//   * `UNCLEAR` with questions is treated as a successful answer: the questions
//     are the useful output, so they get their own block instead of a
//     "no result" dead end.
//
// Nothing here writes: the API contract stores no assessment and changes no
// claim status. The action is read-only too (no `revalidatePath`).

import * as React from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ArrowRight,
  Check,
  Copy,
  HelpCircle,
  Info,
  Lightbulb,
  Loader2,
  Scale,
  ShieldQuestion,
  Sparkles,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { assessClaim, setAIOptIn } from '@/app/actions/ai';
import type { ClaimAssessment } from '@/lib/api/ai';
import {
  claimAssessmentAdvice,
  claimAssessmentConfidenceLabel,
  claimAssessmentConfidenceNote,
  claimAssessmentDisclaimer,
  claimAssessmentGateCopy,
  claimAssessmentQuestionsLead,
  claimLetterLanguageLabel,
  claimLetterLanguageNotice,
  type ClaimAssessmentGate,
} from '@/lib/claim-assessment';
import { formatDate } from '@/lib/format';
import { useLocale, useT } from '@/lib/i18n/client';

type AssessmentView =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'result'; assessment: ClaimAssessment }
  | {
      kind: 'gate';
      gate: Extract<ClaimAssessmentGate, 'ai_optin_required' | 'feature_disabled'>;
    }
  | { kind: 'error'; message: string };

export function ClaimAssessmentPanel({
  claimId,
  deviceId,
  className,
}: {
  claimId: string;
  /** Only used by the feature-disabled state to offer the handover checklist. */
  deviceId?: string;
  className?: string;
}) {
  const t = useT();
  const locale = useLocale();
  const [view, setView] = React.useState<AssessmentView>({ kind: 'idle' });
  const [copied, setCopied] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const [enabling, startEnabling] = React.useTransition();

  const runAssessment = React.useCallback(async () => {
    setCopied(false);
    setView({ kind: 'loading' });
    try {
      const res = await assessClaim(claimId);
      if (res.ok) {
        setView({ kind: 'result', assessment: res.assessment });
        return;
      }
      if (res.gate === 'failed') {
        setView({
          kind: 'error',
          message: res.message ?? t('Không đánh giá được — thử lại sau.'),
        });
        return;
      }
      setView({ kind: 'gate', gate: res.gate });
    } catch {
      setView({
        kind: 'error',
        message: t('Không đánh giá được — thử lại sau.'),
      });
    }
  }, [claimId, t]);

  const onAssess = () => {
    startTransition(async () => {
      await runAssessment();
    });
  };

  const onEnable = () => {
    startEnabling(async () => {
      try {
        const res = await setAIOptIn(true);
        if (!res.ok) {
          // Stay on the opt-in gate (not the generic error panel): the useful
          // next action is to try enabling again, not to re-run an assessment
          // that would just 403.
          toast.error(res.message ?? t('Không bật được đánh giá AI'));
          setView({ kind: 'gate', gate: 'ai_optin_required' });
          return;
        }
        toast.success(t('Đã bật đánh giá AI'));
        await runAssessment();
      } catch {
        toast.error(t('Không bật được đánh giá AI'));
        setView({ kind: 'gate', gate: 'ai_optin_required' });
      }
    });
  };

  const copyLetter = async (letter: string) => {
    try {
      await navigator.clipboard.writeText(letter);
      setCopied(true);
      toast.success(t('Đã sao chép thư'));
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(t('Không sao chép được — chọn thư và sao chép thủ công.'));
    }
  };

  const busy = pending || enabling;

  return (
    <div className={className}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="rounded-pill"
        onClick={onAssess}
        disabled={busy}
        aria-expanded={view.kind === 'result' || view.kind === 'gate'}
      >
        {pending ? (
          <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="mr-1 h-3.5 w-3.5" />
        )}
        {pending
          ? t('Đang đánh giá…')
          : view.kind === 'result'
            ? t('Đánh giá lại')
            : t('Đánh giá bảo hành')}
      </Button>

      <div aria-live="polite">
        {view.kind === 'result' && (
          <AssessmentResult
            assessment={view.assessment}
            copied={copied}
            onCopy={copyLetter}
          />
        )}

        {view.kind === 'gate' && (
          <GateNotice
            gate={view.gate}
            deviceId={deviceId}
            enabling={enabling}
            onEnable={onEnable}
          />
        )}

        {view.kind === 'error' && (
          <div
            role="alert"
            className="mt-3 rounded-xl border border-rose-ink/20 bg-rose-soft px-4 py-3 text-sm text-rose-ink"
          >
            <p className="font-semibold">{view.message}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2 rounded-pill bg-card"
              onClick={onAssess}
              disabled={busy}
            >
              {t('Thử lại')}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function AssessmentResult({
  assessment,
  copied,
  onCopy,
}: {
  assessment: ClaimAssessment;
  copied: boolean;
  onCopy: (letter: string) => void;
}) {
  const t = useT();
  const locale = useLocale();
  const advice = claimAssessmentAdvice(assessment.coverage, locale);
  const confidence = claimAssessmentConfidenceLabel(
    assessment.confidence,
    locale,
  );
  const confidenceNote = claimAssessmentConfidenceNote(
    assessment.confidence,
    locale,
  );
  const generatedAt = Number.isFinite(Date.parse(assessment.generatedAt))
    ? formatDate(assessment.generatedAt, locale)
    : null;
  const questions = assessment.questions ?? [];
  const letter = assessment.draftLetter.trim();

  return (
    <div className="mt-3 rounded-2xl border-[1.5px] border-primary/25 bg-primary-soft/30 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2">
          <span className="icon-badge icon-badge-sm tint-primary mt-0.5">
            <Lightbulb className="h-4 w-4" />
          </span>
          <div>
            <p className="text-sm font-bold text-ink">{t('Gợi ý tham khảo')}</p>
            <p className="text-xs font-medium text-muted-foreground">
              {t('Dựa trên hồ sơ và điều khoản bảo hành')}
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-pill border border-border bg-card px-2.5 py-1 text-xs font-bold text-ink-2">
          <ShieldQuestion className="h-3.5 w-3.5" />
          {t('Độ tin cậy: {level}', { level: confidence })}
        </span>
      </div>

      {/* The hint itself. Deliberately no approve/reject colour: the wording
          carries "likely" and the disclaimer below carries "who decides". */}
      <p className="mt-3 font-display text-base font-bold text-ink">
        {advice.headline}
      </p>
      <p className="mt-1 text-sm leading-relaxed text-ink-2">{advice.body}</p>

      <div className="mt-3 flex items-start gap-2 rounded-xl border border-border bg-card/80 p-3 text-xs text-ink-2">
        <Scale className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div>
          <p className="font-bold text-ink">
            {t('Gợi ý, không phải quyết định')}
          </p>
          <p className="mt-0.5">{claimAssessmentDisclaimer(locale)}</p>
          <p className="mt-1 text-muted-foreground">{confidenceNote}</p>
        </div>
      </div>

      {assessment.reasoning.trim() && (
        <div className="mt-3">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            {t('Vì sao')}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink-2">
            {assessment.reasoning}
          </p>
        </div>
      )}

      {/* Questions are a first-class output. For UNCLEAR they are the whole
          point: something useful to take to the counter, not a dead end. */}
      {questions.length > 0 && (
        <div className="mt-3 rounded-xl border border-border bg-card p-3">
          <p className="flex items-center gap-1.5 text-sm font-bold text-ink">
            <HelpCircle className="h-4 w-4 text-primary" />
            {t('Câu hỏi nên hỏi trung tâm')}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {claimAssessmentQuestionsLead(locale)}
          </p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-ink-2">
            {questions.map((question, index) => (
              <li key={`${index}-${question}`}>{question}</li>
            ))}
          </ol>
        </div>
      )}

      <div className="mt-3 rounded-xl border-[1.5px] border-dashed border-border-strong bg-card p-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-bold text-ink">
              {t('Thư gửi trung tâm (tiếng Việt)')}
            </p>
            <p className="mt-0.5 text-xs font-bold text-primary-ink">
              {claimLetterLanguageLabel(locale)}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="rounded-pill"
            onClick={() => onCopy(assessment.draftLetter)}
            disabled={!letter}
          >
            {copied ? (
              <Check className="mr-1 h-3.5 w-3.5" />
            ) : (
              <Copy className="mr-1 h-3.5 w-3.5" />
            )}
            {copied ? t('Đã sao chép thư') : t('Sao chép thư')}
          </Button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {claimLetterLanguageNotice(locale)}
        </p>
        {letter ? (
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 font-mono text-xs leading-relaxed text-ink-2">
            {assessment.draftLetter}
          </pre>
        ) : (
          <p className="mt-2 text-xs text-muted-foreground">
            {t(
              'Chưa soạn được thư cho phiếu này — bạn vẫn có thể dùng các câu hỏi bên trên.',
            )}
          </p>
        )}
        {generatedAt && (
          <p className="mt-2 text-[11px] text-muted-foreground">
            {t('Tạo bằng {model} lúc {date}', {
              model: assessment.model || 'AI',
              date: generatedAt,
            })}
          </p>
        )}
      </div>
    </div>
  );
}

function GateNotice({
  gate,
  deviceId,
  enabling,
  onEnable,
}: {
  gate: Extract<ClaimAssessmentGate, 'ai_optin_required' | 'feature_disabled'>;
  deviceId?: string;
  enabling: boolean;
  onEnable: () => void;
}) {
  const t = useT();
  const locale = useLocale();
  const copy = claimAssessmentGateCopy(gate, locale);
  if (!copy) return null;

  return (
    <div className="mt-3 rounded-2xl border-[1.5px] border-primary/25 bg-primary-soft/30 p-4">
      <div className="flex items-start gap-2">
        <span className="icon-badge icon-badge-sm tint-primary mt-0.5">
          {gate === 'ai_optin_required' ? (
            <Sparkles className="h-4 w-4" />
          ) : (
            <Info className="h-4 w-4" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-ink">{copy.title}</p>
          <p className="mt-1 text-sm leading-relaxed text-ink-2">{copy.body}</p>

          {gate === 'ai_optin_required' ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                size="sm"
                className="rounded-pill"
                onClick={onEnable}
                disabled={enabling}
              >
                {enabling && (
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                )}
                {enabling ? t('Đang bật…') : t('Bật và đánh giá')}
              </Button>
              <Button asChild variant="ghost" size="sm" className="rounded-pill">
                <Link href="/settings">{t('Mở Cài đặt')}</Link>
              </Button>
            </div>
          ) : deviceId ? (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="mt-2 rounded-pill bg-card"
            >
              <Link href={`/devices/${deviceId}/handover`}>
                {t('Mở checklist bàn giao')}
                <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
