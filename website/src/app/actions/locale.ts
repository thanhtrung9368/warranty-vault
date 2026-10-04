'use server';

// The language switcher's action.
//
// It writes TWO places, on purpose, and they are not redundant:
//
//   * `PATCH /v1/auth/me { locale }` — the account. This is the value the Go
//     service reads when it renders a push notification or an email, where
//     there is no request to take an `Accept-Language` from. The brief is
//     explicit that the choice has to be saved server-side, and it is: without
//     this call the switcher would only change what this browser renders.
//   * the `wv_locale` cookie — the browser. It is what a *signed-out* visitor
//     has, and it is what decides the language before `/auth/me` has answered.
//     It also makes the choice survive the round trip through the action itself,
//     which is what lets the revalidated render come back in the new language.
//
// An anonymous visitor gets the cookie only — there is no account to write to,
// and the Go responses their pages trigger (login, register, password reset)
// still come back in the chosen language because `apiFetch` sends `?lang=`.

import { revalidatePath } from 'next/cache';
import { api } from '@/lib/api';
import { getCurrentUser } from '@/lib/auth';
import { translatorFor } from '@/lib/i18n/catalog';
import { normalizeLocale, type Locale } from '@/lib/i18n/locale';
import { setLocaleCookie } from '@/lib/i18n/request';
import { getI18n } from '@/lib/i18n/server';

export type LocaleFormState = {
  ok?: boolean;
  locale?: Locale;
  message?: string;
};

export async function setLocaleAction(
  _prev: LocaleFormState,
  formData: FormData,
): Promise<LocaleFormState> {
  // Nothing reads the cookie before this point on the happy path. That matters:
  // `getCookieLocale()` is `cache()`d for the request, so a read that happened
  // BEFORE `setLocaleCookie` would pin the old language for the rest of it —
  // including the revalidated render.
  const locale = normalizeLocale(formData.get('locale'));
  if (!locale) {
    const { t } = await getI18n();
    return { ok: false, message: t('Ngôn ngữ không hợp lệ') };
  }

  await setLocaleCookie(locale);

  // `getCurrentUser()` reads the cookie AFTER the write above, so the API call
  // below and the re-render that follows both see the new language.
  const user = await getCurrentUser();
  const t = translatorFor(locale);

  if (user) {
    const res = await api.auth.updateLocale(locale);
    if (!res.ok) {
      // The cookie is already written, so the UI did change. Say so honestly
      // rather than reporting a total failure: what did not happen is the part
      // that reaches push and email.
      return {
        ok: false,
        locale,
        message: res.message ?? t('Không lưu được lựa chọn ngôn ngữ'),
      };
    }
  }

  // The whole shell changes language, so revalidate the root layout — the same
  // broad call the login/logout flows use.
  revalidatePath('/', 'layout');

  return { ok: true, locale, message: t('Đã đổi ngôn ngữ') };
}
