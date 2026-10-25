import { describe, expect, it } from 'vitest';
import {
  CONSENT_MAX_AGE_DAYS,
  CONSENT_STORAGE_KEY,
  CONSENT_VERSION,
  DEFAULT_CONSENT,
  acceptAllConsent,
  canLoadCategory,
  isConsentDecided,
  readConsent,
  rejectNonEssentialConsent,
  saveConsent,
  withdrawAdvertisingConsent,
  type ConsentStorage,
} from '@/lib/consent';

// A localStorage stand-in with the three methods the module uses. Keeping it in
// memory is what lets the "survives a reload" case be a real second read rather
// than a mock of the read function itself.
class MemoryStorage implements ConsentStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function ageRecord(storage: ConsentStorage, days: number): void {
  storage.setItem(
    CONSENT_STORAGE_KEY,
    JSON.stringify({
      version: CONSENT_VERSION,
      decidedAt: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
      categories: { advertising: true },
    }),
  );
}

describe('cookie consent — default state', () => {
  it('is undecided with advertising off when nothing is stored', () => {
    const storage = new MemoryStorage();
    const state = readConsent(storage);

    expect(state.decided).toBe(false);
    expect(state.categories.necessary).toBe(true);
    expect(state.categories.advertising).toBe(false);
    expect(canLoadCategory('advertising', storage)).toBe(false);
    expect(DEFAULT_CONSENT.categories.advertising).toBe(false);
  });

  it('never treats a missing or malformed record as consent', () => {
    const storage = new MemoryStorage();

    for (const raw of [
      'not json',
      '{}',
      'null',
      JSON.stringify({ version: 999, categories: { advertising: true } }),
      JSON.stringify({ version: CONSENT_VERSION, decidedAt: 'yesterday', categories: { advertising: true } }),
      JSON.stringify({ version: CONSENT_VERSION, decidedAt: new Date().toISOString() }),
    ]) {
      storage.setItem(CONSENT_STORAGE_KEY, raw);
      const state = readConsent(storage);
      expect(state.decided).toBe(false);
      expect(canLoadCategory('advertising', storage)).toBe(false);
    }
  });

  it('re-prompts after the published maximum age instead of honouring it forever', () => {
    const storage = new MemoryStorage();
    ageRecord(storage, CONSENT_MAX_AGE_DAYS + 1);

    expect(readConsent(storage).decided).toBe(false);
    expect(canLoadCategory('advertising', storage)).toBe(false);
  });

  it('still honours a record inside the maximum age', () => {
    const storage = new MemoryStorage();
    ageRecord(storage, CONSENT_MAX_AGE_DAYS - 1);

    expect(readConsent(storage).decided).toBe(true);
    expect(canLoadCategory('advertising', storage)).toBe(true);
  });
});

describe('cookie consent — decisions', () => {
  it('accept sets every category, including advertising', () => {
    const storage = new MemoryStorage();
    const state = acceptAllConsent(storage);

    expect(state.decided).toBe(true);
    expect(state.categories).toEqual({ necessary: true, advertising: true });
    expect(state.decidedAt).not.toBeNull();
    expect(canLoadCategory('advertising', storage)).toBe(true);
    expect(isConsentDecided(storage)).toBe(true);
  });

  it('reject is a real decision that leaves advertising off', () => {
    const storage = new MemoryStorage();
    const state = rejectNonEssentialConsent(storage);

    expect(state.decided).toBe(true);
    expect(state.categories.necessary).toBe(true);
    expect(state.categories.advertising).toBe(false);
    expect(canLoadCategory('advertising', storage)).toBe(false);
    expect(isConsentDecided(storage)).toBe(true);
  });

  it('withdrawing consent turns advertising off again', () => {
    const storage = new MemoryStorage();
    acceptAllConsent(storage);
    expect(canLoadCategory('advertising', storage)).toBe(true);

    const withdrawn = withdrawAdvertisingConsent(storage);
    expect(withdrawn.decided).toBe(true);
    expect(withdrawn.categories.advertising).toBe(false);
    expect(canLoadCategory('advertising', storage)).toBe(false);

    // Withdrawal is durable, not just a state in the panel.
    expect(readConsent(storage).categories.advertising).toBe(false);
  });

  it('stores the choice so it survives a reload', () => {
    const storage = new MemoryStorage();
    acceptAllConsent(storage);

    // A new page reads the same store; no module memory is involved.
    const reloaded = readConsent(storage);
    expect(reloaded.decided).toBe(true);
    expect(reloaded.categories.advertising).toBe(true);
    expect(canLoadCategory('advertising', storage)).toBe(true);
  });

  it('saves the per-category choice the manage panel passes', () => {
    const storage = new MemoryStorage();
    saveConsent(false, storage);
    expect(readConsent(storage).categories.advertising).toBe(false);

    saveConsent(true, storage);
    expect(readConsent(storage).categories.advertising).toBe(true);
  });
});
