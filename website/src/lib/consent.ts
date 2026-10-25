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
