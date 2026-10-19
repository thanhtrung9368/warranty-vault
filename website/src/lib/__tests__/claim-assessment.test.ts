import { describe, expect, it } from 'vitest';
import { hasMessage, translate } from '@/lib/i18n/catalog';
import {
  CLAIM_ASSESSMENT_ADVICE_BODIES,
  CLAIM_ASSESSMENT_CONFIDENCES,
  CLAIM_ASSESSMENT_CONFIDENCE_LABELS,
  CLAIM_ASSESSMENT_CONFIDENCE_NOTES,
  CLAIM_ASSESSMENT_COVERAGES,
  CLAIM_ASSESSMENT_COVERAGE_LABELS,
  CLAIM_ASSESSMENT_GATES,
  CLAIM_ASSESSMENT_GATE_BODIES,
  CLAIM_ASSESSMENT_GATE_TITLES,
  claimAssessmentAdvice,
  claimAssessmentConfidenceLabel,
  claimAssessmentConfidenceNote,
  claimAssessmentCoverageLabel,
  claimAssessmentDisclaimer,
  claimAssessmentGateCopy,
  claimAssessmentGateFromFailure,
  claimAssessmentQuestionsLead,
  claimLetterLanguageLabel,
  claimLetterLanguageNotice,
  isClaimAssessmentConfidence,
  isClaimAssessmentCoverage,
  normalizeClaimAssessment,
} from '@/lib/claim-assessment';

// AI claim assessment is built against a frozen contract while the Go handler
// lands in parallel. These tests pin the web's pure half, and in particular the
// three things that can hurt a user standing at a service counter:
//
//   1. the coverage hint must read as ADVICE, never as an approval/refusal;
//   2. confidence must be attached, not implied away;
//   3. `draftLetter` must stay Vietnamese and be LABELLED as such — the reader's
//      UI language does not translate a letter the service centre reads.
//
// No test calls the API: the endpoint does not exist while this is written.

const VIETNAMESE_ONLY = /[ăâđêôơưĂÂĐÊÔƠƯẠ-ỹ]/;

// Words that turn a hint into an outcome. The disclaimer is allowed to contain
// them only inside a negation ("does not approve or reject"), which the
// disclaimer test pins separately.
const VERDICT_WORDING =
  /phê duyệt|được duyệt|từ chối|chấp nhận|approved|rejected|denied|accepted/i;

describe('coverage labels', () => {
  it('ships exactly the three coverage values in the contract', () => {
    expect([...CLAIM_ASSESSMENT_COVERAGES]).toEqual([
      'LIKELY_COVERED',
      'UNCLEAR',
      'LIKELY_NOT_COVERED',
    ]);
  });

  it('labels every coverage as a hint, in both languages', () => {
    expect(claimAssessmentCoverageLabel('LIKELY_COVERED', 'en')).toBe(
      'Likely covered',
    );
    expect(claimAssessmentCoverageLabel('UNCLEAR', 'en')).toBe(
      'Not enough information',
    );
    expect(claimAssessmentCoverageLabel('LIKELY_NOT_COVERED', 'en')).toBe(
      'Likely not covered',
    );
    expect(claimAssessmentCoverageLabel('LIKELY_COVERED', 'vi')).toBe(
      'Có khả năng được bảo hành',
    );
    expect(claimAssessmentCoverageLabel('UNCLEAR', 'vi')).toBe(
      'Chưa đủ thông tin',
    );
    expect(claimAssessmentCoverageLabel('LIKELY_NOT_COVERED', 'vi')).toBe(
      'Có khả năng không được bảo hành',
    );
  });

  it('never uses approve/reject wording in a coverage label', () => {
    for (const coverage of CLAIM_ASSESSMENT_COVERAGES) {
      for (const locale of ['vi', 'en'] as const) {
        expect(
          VERDICT_WORDING.test(claimAssessmentCoverageLabel(coverage, locale)),
        ).toBe(false);
      }
    }
  });

  it('falls back to the code (not to a guessed answer) for a newer server value', () => {
    expect(claimAssessmentCoverageLabel('WAITING_PARTS', 'en')).toBe(
      'WAITING_PARTS',
    );
    expect(claimAssessmentCoverageLabel('WAITING_PARTS', 'vi')).toBe(
      'WAITING_PARTS',
    );
  });

  it('recognises only the three known coverage values', () => {
    for (const coverage of CLAIM_ASSESSMENT_COVERAGES) {
      expect(isClaimAssessmentCoverage(coverage)).toBe(true);
    }
    expect(isClaimAssessmentCoverage('likely_covered')).toBe(false);
    expect(isClaimAssessmentCoverage(undefined)).toBe(false);
  });
});

describe('confidence labels', () => {
  it('ships exactly the three confidence values in the contract', () => {
    expect([...CLAIM_ASSESSMENT_CONFIDENCES]).toEqual(['LOW', 'MEDIUM', 'HIGH']);
  });

  it('renders the confidence next to the advice in both languages', () => {
    expect(claimAssessmentConfidenceLabel('LOW', 'en')).toBe('Low');
    expect(claimAssessmentConfidenceLabel('MEDIUM', 'en')).toBe('Medium');
    expect(claimAssessmentConfidenceLabel('HIGH', 'en')).toBe('High');
    expect(claimAssessmentConfidenceLabel('LOW', 'vi')).toBe('Thấp');
    expect(claimAssessmentConfidenceLabel('MEDIUM', 'vi')).toBe('Trung bình');
    expect(claimAssessmentConfidenceLabel('HIGH', 'vi')).toBe('Cao');
  });

  it('explains what each level means, and never calls LOW certain', () => {
    const low = claimAssessmentConfidenceNote('LOW', 'en');
    const medium = claimAssessmentConfidenceNote('MEDIUM', 'en');
    const high = claimAssessmentConfidenceNote('HIGH', 'en');
    expect(low).toContain('do not treat this as a firm answer');
    expect(medium).toContain('service centre');
    expect(high).toContain('service centre still decides');
    expect(new Set([low, medium, high]).size).toBe(3);
  });

  it('falls back to LOW (never HIGH) for an unknown confidence', () => {
    expect(claimAssessmentConfidenceNote('CERTAIN', 'en')).toBe(
      claimAssessmentConfidenceNote('LOW', 'en'),
    );
    expect(isClaimAssessmentConfidence('CERTAIN')).toBe(false);
    expect(isClaimAssessmentConfidence('HIGH')).toBe(true);
  });
});

describe('advice, not a verdict', () => {
  it('returns a headline and a body for every coverage', () => {
    for (const coverage of CLAIM_ASSESSMENT_COVERAGES) {
      const advice = claimAssessmentAdvice(coverage, 'en');
      expect(advice.headline).toBe(claimAssessmentCoverageLabel(coverage, 'en'));
      expect(advice.body.trim()).not.toBe('');
      expect(VERDICT_WORDING.test(advice.headline)).toBe(false);
      expect(VERDICT_WORDING.test(advice.body)).toBe(false);
    }
  });

  it('names the service centre as the decider in every advice body', () => {
    for (const coverage of CLAIM_ASSESSMENT_COVERAGES) {
      expect(claimAssessmentAdvice(coverage, 'vi').body).toMatch(/trung tâm/i);
      expect(claimAssessmentAdvice(coverage, 'en').body).toMatch(
        /service centre/i,
      );
    }
  });

  it('gives each coverage different advice instead of one generic result', () => {
    const bodies = CLAIM_ASSESSMENT_COVERAGES.map(
      (coverage) => claimAssessmentAdvice(coverage, 'en').body,
    );
    expect(new Set(bodies).size).toBe(CLAIM_ASSESSMENT_COVERAGES.length);
  });

  it('treats an unknown coverage as UNCLEAR rather than inventing certainty', () => {
    expect(claimAssessmentAdvice('WAITING_PARTS', 'en')).toEqual(
      claimAssessmentAdvice('UNCLEAR', 'en'),
    );
  });

  it('always says plainly that the service centre decides, in both languages', () => {
    const vi = claimAssessmentDisclaimer('vi');
    const en = claimAssessmentDisclaimer('en');
    expect(vi).toContain('Trung tâm bảo hành');
    expect(vi).toContain('quyết định cuối cùng');
    expect(vi).toContain('không phê duyệt hay từ chối');
    expect(en).toContain('service centre');
    expect(en).toContain('final decision');
    expect(en).toContain('does not approve or reject');
    expect(VIETNAMESE_ONLY.test(en)).toBe(false);
  });

  it('makes the questions a useful output, not a dead end', () => {
    expect(claimAssessmentQuestionsLead('vi')).toContain('Mang các câu hỏi');
    expect(claimAssessmentQuestionsLead('en')).toContain(
      'Take these questions',
    );
    // UNCLEAR explicitly points at the questions as the way forward.
    expect(claimAssessmentAdvice('UNCLEAR', 'en').body).toContain(
      'questions below',
    );
    expect(claimAssessmentAdvice('UNCLEAR', 'vi').body).toContain(
      'câu hỏi bên dưới',
    );
  });
});

describe('gate state machine', () => {
  it('ships ready plus the two normal gates and the error state', () => {
    expect([...CLAIM_ASSESSMENT_GATES]).toEqual([
      'ready',
      'ai_optin_required',
      'feature_disabled',
      'failed',
    ]);
  });

  it('maps 503 feature_disabled to the calm disabled state', () => {
    expect(
      claimAssessmentGateFromFailure({
        status: 503,
        error: 'feature_disabled',
      }),
    ).toBe('feature_disabled');
  });

  it('maps 403 ai_optin_required to the opt-in state', () => {
    expect(
      claimAssessmentGateFromFailure({
        status: 403,
        error: 'ai_optin_required',
      }),
    ).toBe('ai_optin_required');
  });

  it('compares codes case-insensitively and tolerates whitespace', () => {
    expect(
      claimAssessmentGateFromFailure({
        status: 403,
        error: '  AI_OPTIN_REQUIRED ',
      }),
    ).toBe('ai_optin_required');
    expect(
      claimAssessmentGateFromFailure({
        status: 503,
        error: 'Feature_Disabled',
      }),
    ).toBe('feature_disabled');
  });

  it('does not treat a different 403/503 as either gate', () => {
    expect(
      claimAssessmentGateFromFailure({ status: 403, error: 'limit_reached' }),
    ).toBe('failed');
    expect(
      claimAssessmentGateFromFailure({ status: 503, error: 'ai_disabled' }),
    ).toBe('failed');
    expect(
      claimAssessmentGateFromFailure({ status: 500, error: 'feature_disabled' }),
    ).toBe('failed');
    expect(claimAssessmentGateFromFailure({ status: 403 })).toBe('failed');
    expect(claimAssessmentGateFromFailure({ status: 0 })).toBe('failed');
  });

  it('gives both normal gates their own copy in both languages', () => {
    for (const gate of ['ai_optin_required', 'feature_disabled'] as const) {
      const vi = claimAssessmentGateCopy(gate, 'vi');
      const en = claimAssessmentGateCopy(gate, 'en');
      expect(vi?.title.trim()).toBeTruthy();
      expect(vi?.body.trim()).toBeTruthy();
      expect(en?.title.trim()).toBeTruthy();
      expect(en?.body.trim()).toBeTruthy();
      expect(VIETNAMESE_ONLY.test(en?.title ?? '')).toBe(false);
      expect(VIETNAMESE_ONLY.test(en?.body ?? '')).toBe(false);
    }
    expect(claimAssessmentGateCopy('ready', 'en')).toBeNull();
    expect(claimAssessmentGateCopy('failed', 'en')).toBeNull();
  });

  it('offers a way to turn the opt-in on, and explains a disabled feature', () => {
    const optIn = claimAssessmentGateCopy('ai_optin_required', 'en');
    expect(optIn?.title).toBe('AI assessment is off');
    expect(optIn?.body).toContain('Turn on AI assessment');
    expect(optIn?.body).toContain('third-party');

    const disabled = claimAssessmentGateCopy('feature_disabled', 'en');
    expect(disabled?.title).toBe('AI assessment is not available yet');
    expect(disabled?.body).toContain('not something you did wrong');
    // It points somewhere useful instead of ending in an error.
    expect(disabled?.body).toContain('pre-service checklist');
  });
});

describe('the Vietnamese letter', () => {
  it('labels the letter as Vietnamese on purpose in both UI languages', () => {
    expect(claimLetterLanguageLabel('vi')).toBe('Tiếng Việt — để trung tâm đọc');
    expect(claimLetterLanguageLabel('en')).toBe(
      'Vietnamese — for the service centre to read',
    );
    expect(VIETNAMESE_ONLY.test(claimLetterLanguageLabel('en'))).toBe(false);
  });

  it('says the app does not translate it, in both languages', () => {
    const vi = claimLetterLanguageNotice('vi');
    const en = claimLetterLanguageNotice('en');
    expect(vi).toContain('tiếng Việt');
    expect(vi).toContain('không tự dịch');
    expect(en).toContain('Vietnamese');
    expect(en).toContain('does not translate');
    expect(VIETNAMESE_ONLY.test(en)).toBe(false);
  });
});

describe('normalisation', () => {
  const full = {
    claimId: 'claim-1',
    coverage: 'LIKELY_COVERED' as const,
    confidence: 'HIGH' as const,
    reasoning: 'Lý do bằng tiếng Việt hoặc tiếng Anh.',
    questions: ['Máy còn bảo hành không?', 'Có mất phí không?'],
    draftLetter: 'Kính gửi trung tâm bảo hành…',
    generatedAt: '2026-10-19T07:00:00',
    model: 'claude-haiku-4-5',
  };

  it('passes a complete assessment through unchanged', () => {
    expect(normalizeClaimAssessment(full)).toEqual(full);
  });

  it('degrades unknown enums honestly and filters unusable questions', () => {
    const normalized = normalizeClaimAssessment(
      {
        coverage: 'CERTAINLY_COVERED',
        confidence: 'VERY_HIGH',
        questions: ['real question', 42, '', '  ', 'second question'],
        reasoning: 'x',
      },
      'claim-9',
    );
    expect(normalized.coverage).toBe('UNCLEAR');
    expect(normalized.confidence).toBe('LOW');
    expect(normalized.questions).toEqual(['real question', 'second question']);
    expect(normalized.claimId).toBe('claim-9');
    expect(normalized.draftLetter).toBe('');
    expect(normalized.generatedAt).toBe('');
    expect(normalized.model).toBe('');
  });

  it('survives a missing or non-object body', () => {
    expect(normalizeClaimAssessment(null, 'claim-2')).toMatchObject({
      claimId: 'claim-2',
      coverage: 'UNCLEAR',
      confidence: 'LOW',
      questions: [],
    });
    expect(normalizeClaimAssessment('bad', 'claim-3').claimId).toBe('claim-3');
  });
});

describe('catalog coverage', () => {
  const maps: Record<string, Record<string, string>> = {
    CLAIM_ASSESSMENT_COVERAGE_LABELS,
    CLAIM_ASSESSMENT_CONFIDENCE_LABELS,
    CLAIM_ASSESSMENT_CONFIDENCE_NOTES,
    CLAIM_ASSESSMENT_ADVICE_BODIES,
    CLAIM_ASSESSMENT_GATE_TITLES,
    CLAIM_ASSESSMENT_GATE_BODIES,
  };

  it('registers every value in both languages', () => {
    const missing: string[] = [];
    for (const [name, map] of Object.entries(maps)) {
      for (const [code, key] of Object.entries(map)) {
        if (!hasMessage(key)) missing.push(`${name}.${code}`);
      }
    }
    expect(missing).toEqual([]);
    // The single-sentence helpers use literal keys; the source scan in
    // `i18n-coverage.test.ts` proves they are registered. Here we pin the
    // user-visible outcome: both languages render, and the English does not
    // silently fall back to Vietnamese.
    for (const render of [
      claimAssessmentDisclaimer,
      claimAssessmentQuestionsLead,
      claimLetterLanguageLabel,
      claimLetterLanguageNotice,
    ]) {
      expect(render('vi').trim()).not.toBe('');
      expect(render('en').trim()).not.toBe('');
      expect(VIETNAMESE_ONLY.test(render('en'))).toBe(false);
    }
  });

  it('renders every value in English without Vietnamese characters left', () => {
    const bad: string[] = [];
    for (const [name, map] of Object.entries(maps)) {
      for (const [code, key] of Object.entries(map)) {
        const english = translate('en', key);
        if (!english.trim() || VIETNAMESE_ONLY.test(english)) {
          bad.push(`${name}.${code}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('pins the label/value sets to the vocabulary (no missing entries)', () => {
    expect(Object.keys(CLAIM_ASSESSMENT_COVERAGE_LABELS).sort()).toEqual(
      [...CLAIM_ASSESSMENT_COVERAGES].sort(),
    );
    expect(Object.keys(CLAIM_ASSESSMENT_CONFIDENCE_LABELS).sort()).toEqual(
      [...CLAIM_ASSESSMENT_CONFIDENCES].sort(),
    );
    expect(Object.keys(CLAIM_ASSESSMENT_ADVICE_BODIES).sort()).toEqual(
      [...CLAIM_ASSESSMENT_COVERAGES].sort(),
    );
    expect(Object.keys(CLAIM_ASSESSMENT_CONFIDENCE_NOTES).sort()).toEqual(
      [...CLAIM_ASSESSMENT_CONFIDENCES].sort(),
    );
  });
});
