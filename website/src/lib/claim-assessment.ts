// AI claim assessment (roadmap gap #7) — the pure half.
//
// `POST /v1/ai/assess-claim` answers three things that must never be
// conflated:
//
//   * `coverage` — a HINT, not a verdict. `LIKELY_COVERED` does not mean
//     "approved" and `LIKELY_NOT_COVERED` does not mean "rejected". Only the
//     service centre inspects the device and decides; an overconfident screen
//     costs the user a wasted trip. Every label below is worded as advice, and
//     every result MUST render `claimAssessmentDisclaimer()` as well.
//   * `confidence` — attached to the advice, never hidden. The same hint at
//     LOW confidence must not read like a HIGH-confidence one.
//   * `draftLetter` — ALWAYS Vietnamese, because it is read by a Vietnamese
//     service centre even when the rest of the page is English. It is labelled
//     deliberately (`claimLetterLanguageLabel`/`Notice`), never translated by
//     the app.
//
// This module is free of React, `next/*` and the API client so the server
// action, the client component and the unit tests share exactly one set of
// rules. The wire types live here for that reason; `lib/api/ai.ts` re-exports
// them.

import { translate } from '@/lib/i18n/catalog';
import type { Locale } from '@/lib/i18n/locale';

// ---- Wire vocabulary -------------------------------------------------------

export const CLAIM_ASSESSMENT_COVERAGES = [
  'LIKELY_COVERED',
  'UNCLEAR',
  'LIKELY_NOT_COVERED',
] as const;

export type ClaimAssessmentCoverage = (typeof CLAIM_ASSESSMENT_COVERAGES)[number];

export const CLAIM_ASSESSMENT_CONFIDENCES = ['LOW', 'MEDIUM', 'HIGH'] as const;

export type ClaimAssessmentConfidence =
  (typeof CLAIM_ASSESSMENT_CONFIDENCES)[number];

/**
 * The exact response body of `POST /v1/ai/assess-claim`.
 *
 * `reasoning` and `questions` are in the REQUEST's language (`?lang=`);
 * `draftLetter` is always Vietnamese. `generatedAt` is an ISO-ish string from
 * the server (Go serialises timestamps without a `Z`).
 */
export type ClaimAssessment = {
  claimId: string;
  coverage: ClaimAssessmentCoverage;
  confidence: ClaimAssessmentConfidence;
  reasoning: string;
  questions: string[];
  draftLetter: string;
  generatedAt: string;
  model: string;
};

export function isClaimAssessmentCoverage(
  value: unknown,
): value is ClaimAssessmentCoverage {
  return (
    typeof value === 'string' &&
    (CLAIM_ASSESSMENT_COVERAGES as readonly string[]).includes(value)
  );
}

export function isClaimAssessmentConfidence(
  value: unknown,
): value is ClaimAssessmentConfidence {
  return (
    typeof value === 'string' &&
    (CLAIM_ASSESSMENT_CONFIDENCES as readonly string[]).includes(value)
  );
}

/**
 * Make a response safe to render without inventing certainty.
 *
 * An unknown `coverage` becomes `UNCLEAR` (the honest answer) and an unknown
 * confidence becomes `LOW` — never `HIGH`. Missing arrays become empty arrays
 * so one malformed field cannot crash the claim card. `claimId` falls back to
 * the id we asked about.
 */
export function normalizeClaimAssessment(
  raw: unknown,
  claimId = '',
): ClaimAssessment {
  const value =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const questions = Array.isArray(value.questions)
    ? value.questions.filter(
        (question): question is string =>
          typeof question === 'string' && question.trim() !== '',
      )
    : [];
  return {
    claimId:
      typeof value.claimId === 'string' && value.claimId
        ? value.claimId
        : claimId,
    coverage: isClaimAssessmentCoverage(value.coverage)
      ? value.coverage
      : 'UNCLEAR',
    confidence: isClaimAssessmentConfidence(value.confidence)
      ? value.confidence
      : 'LOW',
    reasoning: typeof value.reasoning === 'string' ? value.reasoning : '',
    questions,
    draftLetter:
      typeof value.draftLetter === 'string' ? value.draftLetter : '',
    generatedAt:
      typeof value.generatedAt === 'string' ? value.generatedAt : '',
    model: typeof value.model === 'string' ? value.model : '',
  };
}

// ---- Coverage + confidence labels -----------------------------------------

/**
 * Vietnamese catalog keys. The wording is the design constraint: "likely
 * covered", never "covered"; "not enough information", never "unclear" as a
 * failure. The coverage test forces every value into both languages.
 */
export const CLAIM_ASSESSMENT_COVERAGE_LABELS: Record<
  ClaimAssessmentCoverage,
  string
> = {
  LIKELY_COVERED: 'Có khả năng được bảo hành',
  UNCLEAR: 'Chưa đủ thông tin',
  LIKELY_NOT_COVERED: 'Có khả năng không được bảo hành',
};

export const CLAIM_ASSESSMENT_CONFIDENCE_LABELS: Record<
  ClaimAssessmentConfidence,
  string
> = {
  LOW: 'Thấp',
  MEDIUM: 'Trung bình',
  HIGH: 'Cao',
};

export function claimAssessmentCoverageLabel(
  coverage: ClaimAssessmentCoverage | string,
  locale: Locale,
): string {
  const key =
    (CLAIM_ASSESSMENT_COVERAGE_LABELS as Record<string, string>)[coverage] ??
    coverage;
  return translate(locale, key);
}

export function claimAssessmentConfidenceLabel(
  confidence: ClaimAssessmentConfidence | string,
  locale: Locale,
): string {
  const key =
    (CLAIM_ASSESSMENT_CONFIDENCE_LABELS as Record<string, string>)[
      confidence
    ] ?? confidence;
  return translate(locale, key);
}

/** What the confidence level actually changes about the advice. */
export const CLAIM_ASSESSMENT_CONFIDENCE_NOTES: Record<
  ClaimAssessmentConfidence,
  string
> = {
  LOW: 'Mô hình chỉ suy đoán từ hồ sơ hiện có — đừng coi đây là câu trả lời chắc chắn.',
  MEDIUM: 'Dựa trên hồ sơ hiện có; trung tâm có thể hỏi thêm giấy tờ.',
  HIGH: 'Hồ sơ khá rõ, nhưng trung tâm vẫn là bên quyết định.',
};

export function claimAssessmentConfidenceNote(
  confidence: ClaimAssessmentConfidence | string,
  locale: Locale,
): string {
  const key =
    (CLAIM_ASSESSMENT_CONFIDENCE_NOTES as Record<string, string>)[confidence] ??
    CLAIM_ASSESSMENT_CONFIDENCE_NOTES.LOW;
  return translate(locale, key);
}

// ---- Advice (not a verdict) -----------------------------------------------

/**
 * The body copy that keeps each coverage hint on the advice side of the line.
 *
 * Every sentence names the service centre as the decision-maker (or, for
 * `UNCLEAR`, tells the reader the questions are the useful output). The unit
 * tests assert both properties in both languages — this is the single most
 * important copy constraint in the feature.
 */
export const CLAIM_ASSESSMENT_ADVICE_BODIES: Record<
  ClaimAssessmentCoverage,
  string
> = {
  LIKELY_COVERED:
    'Hồ sơ có dấu hiệu nằm trong phạm vi bảo hành, nhưng đây chỉ là gợi ý. Trung tâm sẽ kiểm tra máy và quyết định.',
  UNCLEAR:
    'Hồ sơ chưa cho thấy rõ có được bảo hành hay không. Đây không phải ngõ cụt: mang các câu hỏi bên dưới tới trung tâm để hỏi cho rõ.',
  LIKELY_NOT_COVERED:
    'Hồ sơ có vài dấu hiệu nằm ngoài phạm vi bảo hành, nhưng trung tâm vẫn là bên quyết định. Dùng các câu hỏi bên dưới để hỏi cho rõ trước khi đi.',
};

export type ClaimAdvice = {
  /** The coverage label, phrased as a hint. */
  headline: string;
  /** Why that hint, and who actually decides. */
  body: string;
};

/**
 * The result panel's copy selector.
 *
 * A code a newer server added is treated as `UNCLEAR` rather than guessed at;
 * the honest fallback is "we do not know yet", never "covered".
 */
export function claimAssessmentAdvice(
  coverage: ClaimAssessmentCoverage | string,
  locale: Locale,
): ClaimAdvice {
  const known = isClaimAssessmentCoverage(coverage) ? coverage : 'UNCLEAR';
  return {
    headline: translate(locale, CLAIM_ASSESSMENT_COVERAGE_LABELS[known]),
    body: translate(locale, CLAIM_ASSESSMENT_ADVICE_BODIES[known]),
  };
}

/**
 * The sentence that must be on every result: the service centre decides, and
 * this screen neither approves nor rejects a claim.
 */
export function claimAssessmentDisclaimer(locale: Locale): string {
  return translate(
    locale,
    'Trung tâm bảo hành là bên kiểm tra máy và quyết định cuối cùng. Màn hình này không phê duyệt hay từ chối bảo hành.',
  );
}

/** Questions are an output, not a consolation prize — say so. */
export function claimAssessmentQuestionsLead(locale: Locale): string {
  return translate(
    locale,
    'Mang các câu hỏi này tới trung tâm — hỏi trước khi gửi máy.',
  );
}

// ---- The draft letter ------------------------------------------------------

/**
 * `draftLetter` is Vietnamese on purpose: the service centre reads Vietnamese,
 * and translating it would defeat the point of a letter the user can send.
 * These two helpers are what tell the user that, rather than silently showing
 * Vietnamese text under an English UI.
 */
export function claimLetterLanguageLabel(locale: Locale): string {
  return translate(locale, 'Tiếng Việt — để trung tâm đọc');
}

export function claimLetterLanguageNotice(locale: Locale): string {
  return translate(
    locale,
    'Thư luôn viết bằng tiếng Việt, kể cả khi bạn dùng giao diện tiếng Anh. Trung tâm bảo hành đọc tiếng Việt, nên app không tự dịch thư.',
  );
}

// ---- Gate state machine ----------------------------------------------------

/**
 * Every state `POST /v1/ai/assess-claim` can leave the UI in.
 *
 * `ai_optin_required` (403) and `feature_disabled` (503) are NORMAL product
 * states, not failures: the first offers the opt-in, the second explains the
 * service setting without an error tone. Only `failed` is an error.
 */
export const CLAIM_ASSESSMENT_GATES = [
  'ready',
  'ai_optin_required',
  'feature_disabled',
  'failed',
] as const;

export type ClaimAssessmentGate = (typeof CLAIM_ASSESSMENT_GATES)[number];

export type ClaimAssessmentFailure = {
  status: number;
  error?: string | null;
};

/**
 * Map the wire failure to the UI state.
 *
 * The codes are compared case-insensitively for the same reason
 * `isClaimLimitReached` is: a server serialising an enum in another case must
 * not turn "turn on AI" into a generic error. A 403/503 with a DIFFERENT code
 * is deliberately `failed`, not that gate — the status alone is not proof of
 * the cause.
 */
export function claimAssessmentGateFromFailure(
  failure: ClaimAssessmentFailure,
): Exclude<ClaimAssessmentGate, 'ready'> {
  const code = (failure.error ?? '').trim().toLowerCase();
  if (failure.status === 503 && code === 'feature_disabled') {
    return 'feature_disabled';
  }
  if (failure.status === 403 && code === 'ai_optin_required') {
    return 'ai_optin_required';
  }
  return 'failed';
}

export const CLAIM_ASSESSMENT_GATE_TITLES = {
  ai_optin_required: 'Đánh giá AI đang tắt',
  feature_disabled: 'Đánh giá AI chưa khả dụng',
} as const;

export const CLAIM_ASSESSMENT_GATE_BODIES: Record<
  'ai_optin_required' | 'feature_disabled',
  string
> = {
  ai_optin_required:
    'Bật đánh giá AI để dùng tính năng này. Khi bật, nội dung phiếu và điều khoản bảo hành sẽ được gửi tới dịch vụ AI bên thứ ba để phân tích. App không thay đổi phiếu của bạn.',
  feature_disabled:
    'Dịch vụ chưa bật tính năng đánh giá bằng AI. Đây là cấu hình của hệ thống, không phải lỗi từ phía bạn — phiếu sửa chữa của bạn không bị ảnh hưởng. Bạn vẫn có thể dùng checklist chuẩn bị đi bảo hành.',
};

/**
 * Copy for the two normal gates, or `null` when there is nothing to explain
 * (`ready`, `failed` — the latter uses the server's message instead).
 */
export function claimAssessmentGateCopy(
  gate: ClaimAssessmentGate,
  locale: Locale,
): { title: string; body: string } | null {
  if (gate !== 'ai_optin_required' && gate !== 'feature_disabled') return null;
  return {
    title: translate(locale, CLAIM_ASSESSMENT_GATE_TITLES[gate]),
    body: translate(locale, CLAIM_ASSESSMENT_GATE_BODIES[gate]),
  };
}
