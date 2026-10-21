// The `/vi` proxy contract, exercised by calling `proxy()` itself.
//
// The important properties are negative ones: the rewrite must not change the
// query string or the cookies, the unprefixed path must be left alone, and a
// client-supplied `x-wv-locale` must never reach the app. A browser test later
// proves the page renders Vietnamese; these assertions prove WHY (`x-wv-locale`
// is on the rewritten request and absent everywhere else).

import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { proxy } from '@/proxy';

function request(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(`https://warrly.test${path}`, { headers });
}

function rewrittenTo(response: Response): string | null {
  return response.headers.get('x-middleware-rewrite');
}

function overriddenHeaders(response: Response): Map<string, string> {
  const names = (response.headers.get('x-middleware-override-headers') ?? '')
    .split(',')
    .filter(Boolean);
  const values = new Map<string, string>();
  for (const name of names) {
    values.set(name, response.headers.get(`x-middleware-request-${name}`) ?? '');
  }
  return values;
}

describe('proxy /vi', () => {
  it('rewrites `/vi` to `/` with the Vietnamese request header', () => {
    const response = proxy(request('/vi'));
    expect(rewrittenTo(response)).toBe('https://warrly.test/');
    expect(overriddenHeaders(response).get('x-wv-locale')).toBe('vi');
  });

  it('rewrites `/vi/privacy` to `/privacy`, keeping the query string', () => {
    const response = proxy(request('/vi/privacy?from=email'));
    expect(rewrittenTo(response)).toBe('https://warrly.test/privacy?from=email');
    expect(overriddenHeaders(response).get('x-wv-locale')).toBe('vi');
  });

  it('treats `/vi/` as the Vietnamese home page', () => {
    const response = proxy(request('/vi/'));
    expect(rewrittenTo(response)).toBe('https://warrly.test/');
    expect(overriddenHeaders(response).get('x-wv-locale')).toBe('vi');
  });

  it('leaves the unprefixed path alone and removes a spoofed header', () => {
    const response = proxy(request('/privacy', { 'x-wv-locale': 'vi' }));
    expect(rewrittenTo(response)).toBeNull();
    expect(response.headers.get('x-middleware-next')).toBe('1');
    // The client sent `vi`; the proxy must not forward it, or `/privacy` would
    // render Vietnamese from a header the visitor controls.
    expect(overriddenHeaders(response).has('x-wv-locale')).toBe(false);
  });

  it('keeps English unprefixed even when a cookie says Vietnamese', () => {
    // The proxy does not read or rewrite cookies at all. The cookie is handled
    // by `getLocale()`; this test documents that the proxy never turns an
    // unprefixed URL into a `/vi` redirect (which would be one URL per visitor,
    // not one URL per language).
    const response = proxy(request('/', { cookie: 'wv_locale=vi' }));
    expect(rewrittenTo(response)).toBeNull();
    expect(response.headers.get('location')).toBeNull();
  });

  it('does not treat `/vietnamese` as a /vi URL', () => {
    const response = proxy(request('/vietnamese'));
    expect(rewrittenTo(response)).toBeNull();
    expect(overriddenHeaders(response).has('x-wv-locale')).toBe(false);
  });

  it('preserves the auth cookie on a rewrite', () => {
    // The session cookie is forwarded untouched; only an x- header is added.
    const response = proxy(request('/vi/dashboard', { cookie: 'wv_session=abc' }));
    expect(rewrittenTo(response)).toBe('https://warrly.test/dashboard');
    expect(overriddenHeaders(response).get('cookie')).toBe('wv_session=abc');
  });
});
