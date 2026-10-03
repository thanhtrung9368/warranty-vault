'use server';

// Thin proxies over the two-step email-change flow (roadmap #10):
//
//   requestEmailChange  → POST /v1/auth/change-email         (authenticated)
//   confirmEmailChange  → POST /v1/auth/confirm-email-change (UNAUTHENTICATED)
//
// The confirm half is the one action in this app that must NOT call
// `requireUser()`: the mailed link points at `<APP_URL>/confirm-email/<token>`
// and is meant to work for a logged-out visitor (someone confirming on their
// phone, or after the change already revoked every session). The token is the
// credential — Go authenticates it, we just forward it.

import { z } from 'zod';
import { api, toFormState } from '@/lib/api';
import { requireUser } from '@/lib/auth';
import {
  describeConfirmEmailChangeFailure,
  emailChangeRequestMessage,
  EMAIL_CHANGE_SUCCESS_HINT,
} from '@/lib/email-change';

export type EmailChangeFormState = {
  ok?: boolean;
  message?: string;
  errors?: Record<string, string[]>;
};

export type ConfirmEmailChangeState = {
  ok?: boolean;
  message?: string;
  /** Heading of the failure block (see `describeConfirmEmailChangeFailure`). */
  title?: string;
  /** Extra guidance for the failure (expired vs. reused token, next step). */
  hint?: string;
};

// Shape/emptiness only. The address-format rule and the password check live in
// Go; its Vietnamese `fieldErrors` are surfaced unchanged (`Email không hợp lệ`,
// `Mật khẩu hiện tại không đúng`, `Email mới trùng với email hiện tại`).
const changeEmailSchema = z.object({
  newEmail: z.string().trim().toLowerCase().email('Email không hợp lệ'),
  currentPassword: z.string().min(1, 'Nhập mật khẩu hiện tại'),
});

// Step 1/2. Requires the current password, then mails a single-use token to the
// NEW address. The account email is unchanged until step 2.
//
// The success message is passed through VERBATIM: Go answers with the same
// neutral 200 whether the token was sent or the address already belongs to
// another account. There is deliberately no client-side "email taken" handling
// — the client cannot know, and must not guess.
export async function requestEmailChange(
  _prev: EmailChangeFormState,
  formData: FormData,
): Promise<EmailChangeFormState> {
  await requireUser();

  const parsed = changeEmailSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.flatten().fieldErrors };
  }

  const res = await api.auth.changeEmail(parsed.data.newEmail, parsed.data.currentPassword);
  if (!res.ok) {
    // 400 (invalid address / wrong password / same address) carries Go's
    // fieldErrors; 429 is rate limiting. Both are surfaced unchanged.
    return toFormState(res);
  }

  return { ok: true, message: emailChangeRequestMessage(res.data.message) };
}

const confirmSchema = z.object({
  token: z.string().min(1),
});

// Step 2/2 — the token from the mailed link. Unauthenticated by design; see the
// file header. Never reads or requires the session cookie.
export async function confirmEmailChange(
  _prev: ConfirmEmailChangeState,
  formData: FormData,
): Promise<ConfirmEmailChangeState> {
  const parsed = confirmSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    return describeConfirmEmailChangeFailure({
      status: 400,
      error: 'bad_input',
      fieldErrors: { token: ['Thiếu token'] },
    });
  }

  const res = await api.auth.confirmEmailChange(parsed.data.token);
  if (!res.ok) {
    return describeConfirmEmailChangeFailure(res);
  }

  return {
    ok: true,
    message: res.data.message ?? 'Đã đổi email. Vào /login để đăng nhập lại bằng địa chỉ mới.',
    hint: EMAIL_CHANGE_SUCCESS_HINT,
  };
}
