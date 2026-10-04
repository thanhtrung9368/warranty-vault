import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasMessage, translate } from '@/lib/i18n/catalog';
import { CATEGORY_LABELS, STATUS_LABELS, WARRANTY_TYPE_LABELS } from '@/lib/types';
import {
  BILLING_CYCLE_LABELS,
  SUBSCRIPTION_STATUS_LABELS,
} from '@/lib/subscription-types';
import {
  WISHLIST_PRIORITY_LABELS,
  WISHLIST_STATUS_LABELS,
} from '@/lib/wishlist-types';
import { SEARCH_GROUP_LABELS } from '@/lib/search';
import { PASTE_FIELD_LABELS } from '@/lib/device-paste';

// Every string that is WRAPPED must also be REGISTERED.
//
// `i18n.test.ts` pins the dictionary's internal consistency: both languages
// carry the same keys, no key is blank, the English never contains Vietnamese
// characters. None of that catches the failure that actually matters at
// runtime, because `translate()` degrades silently by design — an unregistered
// key returns the Vietnamese sentence in BOTH languages (which is the safe
// fallback: the screen stays readable and visibly Vietnamese).
//
// The consequence is that a screen can be "fully converted" — every literal
// wrapped in `t(...)` — and still render Vietnamese to an English reader, with
// a green test suite and no warning anywhere. This file closes that hole by
// reading the source: every literal passed as the first argument of
// `t('…')` / `translate(<locale>, '…')` must exist in the catalog.
//
// It is a source scan rather than a runtime check on purpose. A runtime check
// would only cover the screens a test happens to render; the scan covers the
// 180-odd files of the app whether or not anything imports them.
//
// Two limits, stated so nobody trusts it further than it goes:
//
//   * Only LITERAL first arguments are visible. `t(section.title)` and
//     `t(FIELD_META[k].label)` are resolved at render time and cannot be
//     checked here — those rely on the value being a catalog key by
//     construction (the pattern is documented in I18N.md).
//   * The scan reads raw text, so a `t('…')` inside a COMMENT is treated as a
//     real call. That is the conservative direction (it demands a registration
//     that may be unnecessary, rather than missing one that is), and the fix is
//     to reword the comment.

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(ts|tsx)$/.test(path)) out.push(path);
  }
  return out;
}

// The dictionary itself is excluded (it is all keys), and so are the tests
// (they pass Vietnamese literals as expected values, not as keys).
function sourceFiles(): string[] {
  return walk(SRC).filter(
    (f) => !f.includes('__tests__') && !relative(SRC, f).startsWith('lib/i18n/messages'),
  );
}

// `t('key')` and `translate(locale, 'key')`, with a negative lookbehind so
// `format('…')` / `obj.t('…')` are not mistaken for the translator.
const KEY_CALL =
  /(?<![\w.$])t\(\s*'((?:[^'\\]|\\.)*)'|\btranslate\(\s*[A-Za-z_$][\w.$]*\s*,\s*'((?:[^'\\]|\\.)*)'/g;

function referencedKeys(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles()) {
    const rel = relative(SRC, file);
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        KEY_CALL.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = KEY_CALL.exec(line))) {
          const raw = match[1] ?? match[2] ?? '';
          if (!raw) continue;
          const key = raw.replace(/\\'/g, "'").replace(/\\\\/g, '\\');
          const where = `${rel}:${index + 1}`;
          found.set(key, [...(found.get(key) ?? []), where]);
        }
      });
  }
  return found;
}

describe('every wrapped string is registered', () => {
  const referenced = referencedKeys();

  it('scans a plausible number of files and keys', () => {
    // Guards the scanner itself: a regex that stopped matching would make the
    // assertion below vacuously true, which is the one way this file could lie.
    expect(sourceFiles().length).toBeGreaterThan(100);
    expect(referenced.size).toBeGreaterThan(500);
  });

  it('has no key that would silently fall back to Vietnamese', () => {
    const unregistered = [...referenced.entries()]
      .filter(([key]) => !hasMessage(key))
      .map(([key, where]) => `${JSON.stringify(key)} at ${where.slice(0, 3).join(', ')}`)
      .sort();
    expect(unregistered).toEqual([]);
  });

  it('resolves every referenced key to a real English sentence', () => {
    // The scan above proves each key EXISTS. This pins the other half, through
    // the real translator rather than by peeking at the catalog: the English a
    // user would actually see is non-empty and is not still Vietnamese.
    //
    // A key with no entry would return itself, so an unregistered key with
    // diacritics fails here too — the two tests overlap on purpose, and this is
    // the one that describes the user-visible outcome.
    const VIETNAMESE_ONLY = /[ăâđêôơưĂÂĐÊÔƠƯẠ-ỹ]/;
    const bad = [...referenced.keys()]
      .map((key) => ({ key, english: translate('en', key) }))
      .filter(({ english }) => !english.trim() || VIETNAMESE_ONLY.test(english))
      .map(({ key, english }) => `${JSON.stringify(key)} → ${JSON.stringify(english)}`)
      .sort();
    expect(bad).toEqual([]);
  });
});

// ── The label maps ────────────────────────────────────────────────────────
//
// The scan above only sees LITERAL keys. Most enum copy does not reach `t()` as
// a literal — it arrives as a map lookup:
//
//     statusLabel(device.status, locale)  →  labelOf(STATUS_LABELS, code, locale)
//                                         →  translate(locale, STATUS_LABELS[code])
//
// `labelOf` degrades exactly like `translate` does: an unregistered value comes
// back as the Vietnamese label, in both languages, with nothing raised. A
// device list rendered entirely in English can therefore still say "Đang dùng"
// on every row, and this is not hypothetical — the warranty-type labels were
// missing from the dictionary when this assertion was written, so `/devices`
// and `/stats` showed "Tiêu chuẩn" to English readers.
//
// Every map that feeds `labelOf` is listed here, so the fix for the next one is
// "add an entry", not "notice it in a screenshot".
describe('every enum/option label is registered', () => {
  const maps: Record<string, Record<string, string>> = {
    CATEGORY_LABELS,
    STATUS_LABELS,
    WARRANTY_TYPE_LABELS,
    BILLING_CYCLE_LABELS,
    SUBSCRIPTION_STATUS_LABELS,
    WISHLIST_PRIORITY_LABELS,
    WISHLIST_STATUS_LABELS,
    SEARCH_GROUP_LABELS,
    PASTE_FIELD_LABELS,
  };

  it('registers every value of every label map', () => {
    const missing: string[] = [];
    for (const [name, map] of Object.entries(maps)) {
      for (const [code, label] of Object.entries(map)) {
        if (!hasMessage(label)) missing.push(`${name}.${code} = ${JSON.stringify(label)}`);
      }
    }
    expect(missing.sort()).toEqual([]);
  });

  it('renders every label in English without Vietnamese characters left', () => {
    const VIETNAMESE_ONLY = /[ăâđêôơưĂÂĐÊÔƠƯẠ-ỹ]/;
    const bad: string[] = [];
    for (const [name, map] of Object.entries(maps)) {
      for (const [code, label] of Object.entries(map)) {
        const english = translate('en', label);
        if (!english.trim() || VIETNAMESE_ONLY.test(english)) {
          bad.push(`${name}.${code}: ${JSON.stringify(label)} → ${JSON.stringify(english)}`);
        }
      }
    }
    expect(bad.sort()).toEqual([]);
  });
});
