// Cookie consent — the gate, not the ads.
//
// This repo has no ad code and no consent library, so this module is deliberately
// small: it records a choice, makes the default "advertising off", and gives any
// future ad/third-party loader one function to check before it injects anything.
//
//     if (!canLoadCategory('advertising')) return;
//     loadAdScript(); // must only run after the check
//
// The choice lives in localStorage, not in a cookie: no cookie has to be set
// before the visitor has decided anything. The record itself is strictly
// necessary — without it there is no way to remember the answer — and the cookie
// policy describes it that way.
//
// A record is versioned. Bumping `CONSENT_VERSION` invalidates every stored
// choice, so a future category (analytics, for example) cannot be silently
// inherited from an older "accept" that never mentioned it. Adding a category
// means: add it to `ConsentCategories`, map it in `readConsent`/`saveConsent`,
// add it to the banner, and bump the version.

export const CONSENT_STORAGE_KEY = 'wv_consent';
export const CONSENT_VERSION = 1;

/**
 * How long a decision is remembered before the banner asks again.
 *
 * The cookie policy publishes this number, so keep the two in sync.
 */
export const CONSENT_MAX_AGE_DAYS = 365;
const CONSENT_MAX_AGE_MS = CONSENT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;

/** The categories a visitor can say no to. Necessary is not a choice. */
export type ConsentCategory = 'advertising';

export type ConsentCategories = {
  /** Always on: the site cannot sign you in without its session cookie. */
  necessary: true;
  advertising: boolean;
};

export type ConsentState = {
  /** False until the visitor has accepted or rejected. */
  decided: boolean;
  categories: ConsentCategories;
  /** ISO timestamp of the stored decision, or null before one exists. */
  decidedAt: string | null;
};

/** The state before any decision: everything optional is off. */
export const DEFAULT_CONSENT: ConsentState = {
  decided: false,
  categories: { necessary: true, advertising: false },
  decidedAt: null,
};

/** The subset of `Storage` this module needs; tests pass a small fake. */
export type ConsentStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

type StoredConsent = {
  version: number;
  decidedAt: string;
  categories: { advertising: boolean };
};

export const CONSENT_OPEN_EVENT = 'wv:consent-open';
export const CONSENT_CHANGE_EVENT = 'wv:consent-change';

function defaultStorage(): ConsentStorage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function freshDefault(): ConsentState {
  return {
    decided: false,
    categories: { necessary: true, advertising: false },
    decidedAt: null,
  };
}

function emit(name: string, detail?: ConsentState): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, detail ? { detail } : undefined));
}

/**
 * Read the stored decision, falling back to "nothing decided, advertising off".
 *
 * Expired, malformed, wrong-version and unreadable records all collapse to the
 * same default. That direction matters: a broken record must never be read as
 * consent.
 */
export function readConsent(storage: ConsentStorage | null = defaultStorage()): ConsentState {
  if (!storage) return freshDefault();

  try {
    const raw = storage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return freshDefault();

    const parsed = JSON.parse(raw) as Partial<StoredConsent> | null;
    if (!parsed || parsed.version !== CONSENT_VERSION) return freshDefault();
    if (typeof parsed.decidedAt !== 'string') return freshDefault();

    const decidedAt = Date.parse(parsed.decidedAt);
    if (!Number.isFinite(decidedAt)) return freshDefault();
    if (Date.now() - decidedAt > CONSENT_MAX_AGE_MS) return freshDefault();

    const advertising = parsed.categories?.advertising;
    if (typeof advertising !== 'boolean') return freshDefault();

    return {
      decided: true,
      categories: { necessary: true, advertising },
      decidedAt: parsed.decidedAt,
    };
  } catch {
    return freshDefault();
  }
}

/**
 * Persist one decision and notify anyone gating a script on it.
 *
 * Writing can fail (private browsing, full storage). The returned state still
 * reflects the decision for this page, so the banner closes and the user is not
 * trapped; the next reload may ask again.
 */
export function saveConsent(
  advertising: boolean,
  storage: ConsentStorage | null = defaultStorage(),
): ConsentState {
  const decidedAt = new Date().toISOString();
  const record: StoredConsent = {
    version: CONSENT_VERSION,
    decidedAt,
    categories: { advertising },
  };

  if (storage) {
    try {
      storage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(record));
    } catch {
      // See the note above: the in-page decision still stands.
    }
  }

  const state: ConsentState = {
    decided: true,
    categories: { necessary: true, advertising },
    decidedAt,
  };
  emit(CONSENT_CHANGE_EVENT, state);
  return state;
}

/** Accept everything optional. */
export function acceptAllConsent(
  storage: ConsentStorage | null = defaultStorage(),
): ConsentState {
  return saveConsent(true, storage);
}

/** Reject everything optional. This is a complete, valid decision. */
export function rejectNonEssentialConsent(
  storage: ConsentStorage | null = defaultStorage(),
): ConsentState {
  return saveConsent(false, storage);
}

/**
 * Withdraw advertising consent while keeping a decision on record.
 *
 * Deliberately separate from "reject" in name only: both end with advertising
 * off, but this entry point documents the withdrawal path the cookie policy
 * promises. Withdrawal is one call, exactly like giving consent.
 */
export function withdrawAdvertisingConsent(
  storage: ConsentStorage | null = defaultStorage(),
): ConsentState {
  return saveConsent(false, storage);
}

/** The gate a future ad loader must call before injecting anything. */
export function canLoadCategory(
  category: ConsentCategory,
  storage: ConsentStorage | null = defaultStorage(),
): boolean {
  return readConsent(storage).categories[category] === true;
}

/** True once the visitor has answered the banner (accept or reject). */
export function isConsentDecided(
  storage: ConsentStorage | null = defaultStorage(),
): boolean {
  return readConsent(storage).decided;
}

/**
 * Notification hook for an ad loader mounted later in the page.
 *
 * It is not used today (there is no ad script); it exists so the first loader
 * does not have to poll or re-invent the plumbing.
 */
export function onConsentChange(
  listener: (state: ConsentState) => void,
): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => listener(readConsent());
  window.addEventListener(CONSENT_CHANGE_EVENT, handler);
  return () => window.removeEventListener(CONSENT_CHANGE_EVENT, handler);
}

/** Ask the mounted banner to reopen, from a footer link. */
export function openConsentSettings(): void {
  emit(CONSENT_OPEN_EVENT);
}

// ─────────────────────────────────────────────────────────────────────────
// APP-SIDE AD CONSENT — what the native clients must do. NOT implemented here.
//
// This module gates the WEB only. Ads ship in the iOS and Android apps; the web
// carries none yet, which is why the self-built banner is still the whole web
// story. That stops being sufficient the moment a web ad loads: the web would
// then need Google UMP, the same TCF v2.2-certified CMP the apps use, before any
// personalised ad. A hand-rolled banner is not a TCF-certified CMP, so do not
// wire an ad script into the web app on the strength of `canLoadCategory`
// alone.
//
// The app-side requirements, written down because the next person to touch this
// will otherwise rediscover them from a store rejection:
//
// 1. CMP — Google UMP, not a hand-rolled dialog. Since 2024-01-16 a
//    Google-certified CMP integrated with IAB TCF is required to serve
//    personalised ads in the EEA/UK; 2024-07-31 extended that to Switzerland.
//    UMP ships inside the Google Mobile Ads SDK. Order is: consent info update
//    → form if required → and only THEN start the ads SDK. UMP is geo-gated, so
//    a Vietnam-only user normally sees no form at all.
//
// 2. ATT ORDERING IS ENFORCED BY STATE, NOT BY A TIMEOUT. This has been
//    rejected twice:
//      * 2.1 (2026-07-27) — ATT sat behind a UMP call with no bound and no
//        retry, so the reviewer never saw the prompt.
//      * 5.1.1(iv) (2026-10-12) — the "fix" was a flat 6-second bound, and it
//        was rejected as well: the ATT alert went up while UMP could still
//        present its GDPR form. No number, short or long, can express "after".
//    The rule that passes: request ATT only once UMP has ANSWERED, and close
//    the form window once ATT is asked. A small state machine over
//    (UMP status, ATT status, foreground count) with unit tests is the shape
//    that passed review; re-attempt ATT on every foreground, because offline
//    UMP's gather() can hang and a hung gather must not swallow the prompt.
//    Android has no ATT, so only iOS has this ordering problem — but both
//    platforms need the GDPR form.
//
// 3. PRIVACY MANIFEST (iOS), once AdMob is integrated: set
//    `NSPrivacyTracking = true` AND list at least one domain in
//    `NSPrivacyTrackingDomains`. The app shows ATT and uses the IDFA for
//    personalised ads, and the App Store privacy answers already declare Device
//    ID + Advertising Data with tracking = YES — the manifest has to agree.
//
//    THE ITMS-91064 TRAP: Apple's prose reads "NSPrivacyTracking must be true
//    if NSPrivacyTrackingDomains isn't empty", which is the CONVERSE of what
//    App Store Connect enforces. The enforced rule is: if you set
//    NSPrivacyTracking to true, you must provide at least one internet domain
//    in NSPrivacyTrackingDomains, or the upload is rejected with ITMS-91064.
//    `true` with an empty array is the failing shape.
//
//    Runtime consequence — intended, not a bug: iOS blocks connections to the
//    listed domains while ATT has not been granted, so a user who declines ATT
//    may see no ads at all rather than non-personalised ones. Watch fill rate
//    after it ships.
//
// 4. NON-PERSONALISED IS THE DEFAULT. `npa=1` (or the UMP equivalent) is the
//    fallback when consent is absent — it is not the posture. Personalisation
//    follows only an explicit yes: ATT on iOS, UMP in the EEA/UK/CH.
//
// 5. NEVER click a live ad. Use Google's sample ad units in debug builds and
//    register test devices; clicking your own inventory is a bannable policy
//    violation. The app id uses a tilde (`ca-app-pub-…~…`) and an ad unit uses a
//    slash (`ca-app-pub-…/…`) — mixing them is the classic setup bug, and
//    neither belongs in this repo.
// ─────────────────────────────────────────────────────────────────────────
