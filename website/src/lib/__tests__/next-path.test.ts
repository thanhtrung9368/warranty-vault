// `?next=` is a redirect target taken from the URL, so the validator is the
// security boundary. These cases are the ones that turn a convenience into an
// open redirect if the check is loosened.

import { describe, expect, it } from 'vitest';
import { loginHref, safeNextPath, withNext } from '@/lib/next-path';

describe('safeNextPath', () => {
  it('accepts ordinary same-origin paths', () => {
    for (const path of [
      '/',
      '/dashboard',
      '/subscriptions',
      '/devices?status=BROKEN',
      '/devices/abc-123#claims',
      '/stats?year=2026',
    ]) {
      expect(safeNextPath(path), path).toBe(path);
    }
  });

  it('rejects absolute URLs and schemes', () => {
    for (const value of [
      'https://evil.example',
      'http://evil.example/path',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      '//evil.example',
      '///evil.example',
      '/\\evil.example',
      '\\\\evil.example',
      'evil.example',
      'login',
    ]) {
      expect(safeNextPath(value), value).toBeNull();
    }
  });

  it('rejects encoded and control-character bypasses', () => {
    for (const value of [
      '/%2F%2Fevil.example',
      '/%2f%2fevil.example',
      '/%5Cevil.example',
      '/%5cevil.example',
      '/\tevil.example',
      '/\n/evil.example',
      '/dash\u0000board',
    ]) {
      expect(safeNextPath(value), JSON.stringify(value)).toBeNull();
    }
  });

  it('rejects missing and non-string values', () => {
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(42)).toBeNull();
    expect(safeNextPath({ next: '/dashboard' })).toBeNull();
    expect(safeNextPath('')).toBeNull();
  });

  it('does not bounce back into the auth pages', () => {
    expect(safeNextPath('/login')).toBeNull();
    expect(safeNextPath('/login?next=/dashboard')).toBeNull();
    expect(safeNextPath('/register')).toBeNull();
    expect(safeNextPath('/register/verify')).toBeNull();
    // A path that merely starts with the same letters is not the auth page.
    expect(safeNextPath('/login-help')).toBe('/login-help');
  });

  it('trims surrounding whitespace but otherwise preserves the value', () => {
    expect(safeNextPath('  /dashboard  ')).toBe('/dashboard');
  });
});

describe('withNext / loginHref', () => {
  it('adds a single encoded next parameter', () => {
    expect(loginHref('/subscriptions')).toBe(
      '/login?next=%2Fsubscriptions',
    );
    expect(withNext('/register', '/devices?status=BROKEN')).toBe(
      '/register?next=%2Fdevices%3Fstatus%3DBROKEN',
    );
  });

  it('leaves the path alone for an invalid destination', () => {
    expect(loginHref('https://evil.example')).toBe('/login');
    expect(loginHref('//evil.example')).toBe('/login');
    expect(withNext('/register', null)).toBe('/register');
  });

  it('works for a path that already has a query string', () => {
    expect(withNext('/login?lang=vi', '/dashboard')).toBe(
      '/login?lang=vi&next=%2Fdashboard',
    );
  });
});
