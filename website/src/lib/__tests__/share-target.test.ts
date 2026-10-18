import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { hasMessage, translate } from '@/lib/i18n/catalog';
import {
  SHARE_FAILURE_MESSAGES,
  SHARE_FAILURE_REASONS,
  SHARE_FILE_FIELD,
  SHARE_TARGET_ACTION,
  mapShareUploadFailure,
  parseShareFailureReason,
  shareResultPath,
  shareSuccessPath,
  selectSharedFile,
} from '@/lib/share-target';

// The pure half of the Web Share Target entry point: the manifest contract,
// the failure→copy mapping, and the redirect URLs. The route itself needs a
// Next request/response and Go, so it is exercised only by lint/tsc/build — but
// every decision it makes before/after the network call lives here.

const WEBSITE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

type Manifest = {
  scope?: string;
  share_target?: {
    action?: string;
    method?: string;
    enctype?: string;
    params?: { files?: Array<{ name?: string; accept?: string[] }> };
  };
};

function readManifest(): Manifest {
  return JSON.parse(
    readFileSync(join(WEBSITE_ROOT, 'public', 'manifest.webmanifest'), 'utf8'),
  ) as Manifest;
}

describe('manifest share_target', () => {
  const manifest = readManifest();
  const target = manifest.share_target;

  it('declares the share target at all', () => {
    expect(target).toBeDefined();
  });

  it('uses POST + multipart, the only shape a browser sends files with', () => {
    expect(target?.method).toBe('POST');
    expect(target?.enctype).toBe('multipart/form-data');
  });

  it('points at a same-origin action inside the manifest scope', () => {
    expect(target?.action).toBe(SHARE_TARGET_ACTION);
    expect(SHARE_TARGET_ACTION.startsWith('/')).toBe(true);
    expect(manifest.scope ?? '/').toBe('/');
  });

  it('accepts exactly image/* and application/pdf', () => {
    const files = target?.params?.files ?? [];
    expect(files).toHaveLength(1);
    expect(files[0]?.name).toBe(SHARE_FILE_FIELD);
    expect(files[0]?.accept).toEqual(['image/*', 'application/pdf']);
  });

  it('names a file field the route actually reads', () => {
    // The manifest field name and the route's `form.get(SHARE_FILE_FIELD)` are
    // two independent literals; this is the assertion that keeps them equal
    // without running a browser.
    expect(SHARE_FILE_FIELD).toBe('file');
  });

  it('has a route handler at the declared action', () => {
    // A manifest action that 404s is worse than no share target: the OS would
    // offer Warrly and then lose the file. `src/app/share-target/route.ts`
    // maps to `/share-target` (route groups do not affect the URL).
    expect(existsSync(join(WEBSITE_ROOT, 'src', 'app', 'share-target', 'route.ts'))).toBe(true);
  });
});

describe('share upload failure mapping', () => {
  it('maps auth failures', () => {
    expect(mapShareUploadFailure({ status: 401, error: 'unauthorized' })).toBe('auth');
  });

  it('maps the 5 MB ceiling', () => {
    expect(mapShareUploadFailure({ status: 413, error: 'bad_input' })).toBe('too_large');
  });

  it('maps the per-user write limiter', () => {
    expect(mapShareUploadFailure({ status: 429, error: 'rate_limited' })).toBe('rate_limited');
  });

  it('maps the account storage ceiling as its own reason', () => {
    // The upload path answers 400 `limit_reached` for the 100 MB per-user cap;
    // the 5-file-per-device 409 cannot happen on an inbox upload (no device).
    expect(mapShareUploadFailure({ status: 400, error: 'limit_reached' })).toBe('user_quota');
    // Both spellings: the wire is lower-case, the domain constant is not.
    expect(mapShareUploadFailure({ status: 400, error: 'LIMIT_REACHED' })).toBe('user_quota');
  });

  it('maps a transport failure (status 0) to network', () => {
    expect(mapShareUploadFailure({ status: 0, error: 'network_error' })).toBe('network');
    expect(mapShareUploadFailure({ status: 500, error: 'network_error' })).toBe('network');
  });

  it('maps a generic server refusal to rejected, not to a type claim', () => {
    // Go uses 400 bad_input for empty/corrupt files too, so the result page
    // says "the server did not accept this file", not "this is not an image".
    expect(mapShareUploadFailure({ status: 400, error: 'bad_input' })).toBe('rejected');
  });

  it('maps everything else to failed', () => {
    expect(mapShareUploadFailure({ status: 500, error: 'internal_error' })).toBe('failed');
    expect(mapShareUploadFailure({ status: 502, error: 'http_502' })).toBe('failed');
    expect(mapShareUploadFailure({ status: 404, error: 'not_found' })).toBe('failed');
    // A 2xx whose body we could not parse may still have been persisted; the
    // result screen says "may not have been saved", so `failed` is honest.
    expect(mapShareUploadFailure({ status: 201, error: 'bad_response' })).toBe('failed');
  });
});

describe('share redirect URLs', () => {
  it('sends every failure reason to the confirmation screen', () => {
    for (const reason of SHARE_FAILURE_REASONS) {
      expect(shareResultPath(reason)).toBe(`/share/result?reason=${reason}`);
      const parsed = parseShareFailureReason(
        new URL(shareResultPath(reason), 'https://warrly.test').searchParams.get('reason'),
      );
      expect(parsed).toBe(reason);
    }
  });

  it('falls back to failed for missing or crafted reasons', () => {
    // The result page is public; an attacker-controlled query value must not
    // become copy on our domain.
    expect(parseShareFailureReason(undefined)).toBe('failed');
    expect(parseShareFailureReason('')).toBe('failed');
    expect(parseShareFailureReason('auth ')).toBe('failed');
    expect(parseShareFailureReason('AUTH')).toBe('failed');
    expect(parseShareFailureReason('<script>')).toBe('failed');
  });

  it('sends success to the inbox with the confirmation flag', () => {
    expect(shareSuccessPath()).toBe('/inbox?shared=1');
    expect(shareSuccessPath().startsWith('/inbox')).toBe(true);
  });
});

describe('share failure copy', () => {
  const VIETNAMESE_ONLY = /[ăâđêôơưĂÂĐÊÔƠƯẠ-ỹ]/;

  it('covers every reason exactly once', () => {
    expect(new Set(SHARE_FAILURE_REASONS).size).toBe(SHARE_FAILURE_REASONS.length);
    expect(Object.keys(SHARE_FAILURE_MESSAGES).sort()).toEqual(
      [...SHARE_FAILURE_REASONS].sort(),
    );
  });

  it('registers a Vietnamese key and a real English sentence for every reason', () => {
    for (const reason of SHARE_FAILURE_REASONS) {
      const key = SHARE_FAILURE_MESSAGES[reason];
      expect(hasMessage(key), reason).toBe(true);
      const english = translate('en', key);
      expect(english.trim(), reason).not.toBe('');
      expect(VIETNAMESE_ONLY.test(english), `${reason}: ${english}`).toBe(false);
    }
  });

  it('never claims "nothing was saved" when the outcome is unknown', () => {
    // A lost response can hide a successful upload. Both unknown-outcome
    // reasons must hedge ("may not have been saved"), not assert loss.
    expect(translate('en', SHARE_FAILURE_MESSAGES.network)).toMatch(/may not have been saved/i);
    expect(translate('en', SHARE_FAILURE_MESSAGES.failed)).toMatch(/may not have been saved/i);
  });
});

describe('single-file selection', () => {
  const sharedFile = (name = 'receipt.png') =>
    new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' });

  it('accepts exactly one File', () => {
    const file = sharedFile();
    expect(selectSharedFile([file])).toEqual({ ok: true, file });
  });

  it('ignores non-File values that share the field name', () => {
    const file = sharedFile();
    expect(selectSharedFile(['not-a-file', file])).toEqual({ ok: true, file });
  });

  it('reports a missing file when no File part was posted', () => {
    expect(selectSharedFile([])).toEqual({ ok: false, reason: 'missing_file' });
    expect(selectSharedFile(['only text'])).toEqual({ ok: false, reason: 'missing_file' });
  });

  it('refuses a multi-file share instead of silently keeping the first', () => {
    // Android's multi-select can put several parts under the same field name.
    // Taking the first and dropping the rest would lose files without saying so.
    expect(selectSharedFile([sharedFile('a.png'), sharedFile('b.pdf')])).toEqual({
      ok: false,
      reason: 'too_many_files',
    });
  });
});
