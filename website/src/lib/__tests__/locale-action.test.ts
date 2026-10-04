// The language switcher's Server Action, end to end inside the process.
//
// `setLocaleAction` is the only place the app writes a language, and it writes
// TWO of them — the `wv_locale` cookie that this browser renders from, and
// `User.locale` on the server, which is what the cron job reads when it renders
// a push notification or an email (there is no request to take a language from
// there). A regression that dropped either write would still leave a UI that
// looks right in the tab it was changed in, so neither half is observable from
// a screenshot. This pins both.
//
// The mocks are deliberately thin: `next/headers` becomes a real in-memory
// cookie jar (so `setLocaleCookie` runs its own code), `revalidatePath` is
// recorded, and the Go call is a stub whose result the test controls.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({
  jar: new Map<string, string>(),
  revalidated: [] as string[],
  user: null as null | { id: string; email: string; name: string | null; aiOptIn: boolean; locale: string | null },
  updateLocale: vi.fn(async (_locale: string) => ({ ok: true as const, data: { user: {} } })),
}));

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (env.jar.has(name) ? { name, value: env.jar.get(name)! } : undefined),
    set: (options: { name: string; value: string } | string, value?: string) => {
      if (typeof options === 'string') env.jar.set(options, String(value));
      else env.jar.set(options.name, options.value);
    },
    delete: (options: { name: string } | string) => {
      env.jar.delete(typeof options === 'string' ? options : options.name);
    },
  }),
  headers: async () => ({ get: () => null }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: (path: string) => {
    env.revalidated.push(path);
  },
}));

vi.mock('@/lib/auth', () => ({
  getCurrentUser: async () => env.user,
  requireUser: async () => env.user,
  requireGuest: async () => undefined,
}));

vi.mock('@/lib/api', () => ({
  api: { auth: { updateLocale: (locale: string) => env.updateLocale(locale) } },
  toFormState: async () => ({ ok: false }),
}));

const { setLocaleAction } = await import('@/app/actions/locale');

function form(locale: string): FormData {
  const data = new FormData();
  data.set('locale', locale);
  return data;
}

beforeEach(() => {
  env.jar.clear();
  env.revalidated.length = 0;
  env.updateLocale.mockClear();
  env.user = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('setLocaleAction', () => {
  it('writes the cookie so this browser renders the new language', async () => {
    const state = await setLocaleAction({}, form('en'));
    expect(env.jar.get('wv_locale')).toBe('en');
    expect(state).toEqual({ ok: true, locale: 'en', message: 'Language changed' });
  });

  it('revalidates the root layout so the whole shell comes back translated', async () => {
    await setLocaleAction({}, form('vi'));
    expect(env.revalidated).toEqual(['/']);
  });

  it('persists to the account when there is a signed-in user', async () => {
    env.user = { id: 'u1', email: 'a@b.test', name: null, aiOptIn: false, locale: null };
    await setLocaleAction({}, form('vi'));

    // The server-side value is what push notifications and emails use; a cookie
    // alone would leave those in the old language forever.
    expect(env.updateLocale).toHaveBeenCalledTimes(1);
    expect(env.updateLocale).toHaveBeenCalledWith('vi');
  });

  it('does not call the API for an anonymous visitor on a public page', async () => {
    // No account to write to — and the Go responses their pages trigger still
    // follow the choice, because `apiFetch` sends `?lang=` from the cookie.
    await setLocaleAction({}, form('en'));
    expect(env.updateLocale).not.toHaveBeenCalled();
    expect(env.jar.get('wv_locale')).toBe('en');
  });

  it('refuses anything that is not vi/en and leaves the cookie alone', async () => {
    env.jar.set('wv_locale', 'vi');
    const state = await setLocaleAction({}, form('fr'));
    expect(state.ok).toBe(false);
    expect(env.jar.get('wv_locale')).toBe('vi');
    expect(env.updateLocale).not.toHaveBeenCalled();
    expect(env.revalidated).toEqual([]);
  });

  it('keeps the tab language and says so honestly when the API write fails', async () => {
    env.user = { id: 'u1', email: 'a@b.test', name: null, aiOptIn: false, locale: null };
    env.updateLocale.mockResolvedValueOnce({
      ok: false,
      status: 429,
      error: 'rate_limited',
      message: 'Thao tác quá nhanh, thử lại sau',
    } as never);

    const state = await setLocaleAction({}, form('en'));

    // The cookie IS written — the UI really did change — and the failure is
    // reported rather than swallowed, because what did not happen is the part
    // that reaches push and email.
    expect(env.jar.get('wv_locale')).toBe('en');
    expect(state.ok).toBe(false);
    expect(state.locale).toBe('en');
    expect(state.message).toBe('Thao tác quá nhanh, thử lại sau');
  });
});
