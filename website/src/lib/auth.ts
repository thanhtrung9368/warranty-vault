// Web auth resolver. After Phase E the source-of-truth for user identity
// is the Go service. This module:
//   1) reads the bearer token from the iron-session cookie,
//   2) calls `GET /v1/auth/me` (deduped per request via React `cache()`),
//   3) returns the same `CurrentUser` shape callers used pre-cutover so
//      pages, layouts and server actions don't need to change signatures.

import { cache } from 'react';
import { redirect } from 'next/navigation';
import { api } from '@/lib/api';
import { getAuthCookie } from '@/lib/auth-cookie';

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  aiOptIn: boolean;
};

// React `cache()` dedupes within a single request — multiple RSCs calling
// `requireUser()` produce a single `/v1/auth/me` round-trip.
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const c = await getAuthCookie();
  if (!c.accessToken) return null;
  if (c.expiresAt && c.expiresAt <= Date.now()) return null;

  const res = await api.auth.me();
  if (!res.ok) return null;
  const u = res.data.user;
  return { id: u.id, email: u.email, name: u.name, aiOptIn: Boolean(u.aiOptIn) };
});

// For server components / server actions invoked from the web. Redirects
// to /login on miss.
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}

// Guest-only pages (login / register / forgot / reset): a signed-in visitor is
// sent to the dashboard instead of being shown the form again.
//
// This used to live in the `(auth)` layout, which made every route under it
// guest-only — including `/confirm-email/<token>`, the link the email-change
// flow mails to the NEW address. That link is routinely opened in the browser
// where the user is still signed in (they requested the change from Cài đặt),
// and the layout would bounce them to /dashboard with the token never consumed.
// Keeping the check on the guest-only pages instead lets the confirm page be
// public for both audiences while preserving the old behaviour everywhere else.
export async function requireGuest(): Promise<void> {
  const user = await getCurrentUser();
  if (user) redirect('/dashboard');
}
