import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CONFIRM_EMAIL_COPY,
  EMAIL_CHANGE_NEUTRAL_FALLBACK,
  EMAIL_CHANGE_SUCCESS_HINT,
  describeConfirmEmailChangeFailure,
  emailChangeRequestMessage,
  newEmailInboxHint,
} from '@/lib/email-change';

// The email-change flow (roadmap #10). The contract these tests pin:
//
//   1. Step 1 is neutral. The server answers 200 with ONE message whether the
//      new address is free or already belongs to another account, so the client
//      passes whatever arrived through and never claims an address is taken.
//   2. Step 2 cannot distinguish "expired" from "already used" — both collapse
//      into `invalid_email_change_token`, so the UI explains both possibilities
//      rather than inventing a distinction.

// api/internal/handlers/auth.go::emailChangeNeutralMessage, verbatim.
const GO_NEUTRAL_MESSAGE =
  'Nếu địa chỉ mới hợp lệ và chưa được dùng cho tài khoản khác, một email xác nhận đã được gửi tới địa chỉ mới. Địa chỉ cũ vẫn dùng được cho tới khi bạn xác nhận.';

describe('emailChangeRequestMessage', () => {
  it('passes the neutral server message through byte-for-byte', () => {
    expect(emailChangeRequestMessage(GO_NEUTRAL_MESSAGE)).toBe(GO_NEUTRAL_MESSAGE);
  });

  it('does not rewrite a different server message either', () => {
    // Whatever Go decides to say is what the user reads — there is no
    // client-side interpretation step that could turn it into "email đã tồn tại".
    const other = 'Đã ghi nhận yêu cầu đổi email.';
    expect(emailChangeRequestMessage(other)).toBe(other);
  });

  it('only falls back when the server sent nothing usable', () => {
    expect(emailChangeRequestMessage(undefined)).toBe(EMAIL_CHANGE_NEUTRAL_FALLBACK);
    expect(emailChangeRequestMessage(null)).toBe(EMAIL_CHANGE_NEUTRAL_FALLBACK);
    expect(emailChangeRequestMessage('   ')).toBe(EMAIL_CHANGE_NEUTRAL_FALLBACK);
  });

  it('mirrors the server wording in the fallback, conditional and all', () => {
    expect(EMAIL_CHANGE_NEUTRAL_FALLBACK).toBe(GO_NEUTRAL_MESSAGE);
    // "Nếu …" — it must not read as a promise that an email was delivered.
    expect(EMAIL_CHANGE_NEUTRAL_FALLBACK.startsWith('Nếu ')).toBe(true);
    // …and it must still say the old address keeps working.
    expect(EMAIL_CHANGE_NEUTRAL_FALLBACK).toContain('Địa chỉ cũ vẫn dùng được');
  });
});

describe('newEmailInboxHint', () => {
  it('names the NEW inbox, spam folder and both limits of the token', () => {
    const hint = newEmailInboxHint('moi@vidu.com');
    expect(hint).toContain('moi@vidu.com');
    expect(hint).toContain('Spam');
    expect(hint).toContain('một lần');
    expect(hint).toContain('30 phút');
    // The old address keeps working until step 2 succeeds.
    expect(hint).toContain('vẫn đăng nhập được');
  });

  it('stays readable when the typed address is empty', () => {
    const hint = newEmailInboxHint('   ');
    expect(hint).not.toContain('  ');
    expect(hint).toContain('địa chỉ mới');
  });
});

describe('describeConfirmEmailChangeFailure', () => {
  it('surfaces the server message for an unusable token', () => {
    const copy = describeConfirmEmailChangeFailure({
      status: 400,
      error: 'invalid_email_change_token',
      message: 'Link xác nhận không hợp lệ hoặc đã hết hạn. Yêu cầu link mới.',
    });
    expect(copy.message).toBe('Link xác nhận không hợp lệ hoặc đã hết hạn. Yêu cầu link mới.');
    expect(copy.title).toBe('Link không dùng được');
  });

  it('explains expired AND already-used, because the server conflates them', () => {
    // `GetEmailChangeByTokenHash` filters usedAt + expiresAt in one query, so a
    // replayed token and an expired one are the same 400 to the client.
    const copy = describeConfirmEmailChangeFailure({
      status: 400,
      error: 'invalid_email_change_token',
    });
    expect(copy.hint).toContain('hết hạn');
    expect(copy.hint).toContain('đã dùng');
    // …and tells the user how to get a usable link.
    expect(copy.hint).toContain('Cài đặt');
  });

  it('mirrors Go wording when the invalid-token response carries no message', () => {
    const copy = describeConfirmEmailChangeFailure({
      status: 400,
      error: 'invalid_email_change_token',
    });
    expect(copy.message).toBe('Link xác nhận không hợp lệ hoặc đã hết hạn. Yêu cầu link mới.');
  });

  it('reports the address being taken at confirm time', () => {
    const copy = describeConfirmEmailChangeFailure({
      status: 400,
      error: 'email_in_use',
      message: 'Email này đã được dùng cho một tài khoản khác. Yêu cầu đổi sang địa chỉ khác.',
    });
    expect(copy.title).toBe('Email đã có người dùng');
    expect(copy.message).toContain('đã được dùng cho một tài khoản khác');
    expect(copy.hint).toContain('địa chỉ khác');
  });

  it('prefers the error code over the bare 400 branch', () => {
    // A 400 with a token field error AND an error code is not "missing token".
    const copy = describeConfirmEmailChangeFailure({
      status: 400,
      error: 'email_in_use',
      fieldErrors: { token: ['Thiếu token'] },
    });
    expect(copy.title).toBe('Email đã có người dùng');
  });

  it('reports a missing token from the server field error', () => {
    const copy = describeConfirmEmailChangeFailure({
      status: 400,
      error: 'bad_input',
      fieldErrors: { token: ['Thiếu token'] },
    });
    expect(copy.title).toBe('Thiếu token xác nhận');
    expect(copy.message).toBe('Thiếu token');
  });

  it('maps rate limiting to retry-later copy', () => {
    const copy = describeConfirmEmailChangeFailure({
      status: 429,
      error: 'rate_limited',
      message: 'Quá nhiều yêu cầu',
    });
    expect(copy.title).toBe('Thử lại sau');
    expect(copy.message).toBe('Quá nhiều yêu cầu');
    expect(copy.hint).toContain('giới hạn');
  });

  it('falls back to retry-later wording when the 429 body is empty', () => {
    const copy = describeConfirmEmailChangeFailure({ status: 429, error: 'rate_limited' });
    expect(copy.message).toContain('Thao tác quá nhanh');
  });

  it('maps a transport failure to a connection message, never a token verdict', () => {
    const copy = describeConfirmEmailChangeFailure({
      status: 0,
      error: 'network_error',
      message: 'Mất kết nối tới máy chủ, thử lại sau nhé.',
    });
    expect(copy.title).toBe('Mất kết nối');
    expect(copy.hint).toBeUndefined();
  });

  it('maps an internal error to a generic failure but keeps the server message', () => {
    const copy = describeConfirmEmailChangeFailure({
      status: 500,
      error: 'internal_error',
      message: 'Lỗi hệ thống',
    });
    expect(copy.title).toBe('Không xác nhận được');
    expect(copy.message).toBe('Lỗi hệ thống');
  });

  it('keeps the server message for an unknown error code', () => {
    const copy = describeConfirmEmailChangeFailure({
      status: 418,
      error: 'teapot',
      message: 'Thông báo lạ',
    });
    expect(copy.message).toBe('Thông báo lạ');
    expect(copy.title).toBe('Không xác nhận được');
  });
});

describe('confirm page copy', () => {
  it('stays Vietnamese and does not claim success before the POST', () => {
    expect(CONFIRM_EMAIL_COPY.title).toBe('Xác nhận đổi email');
    expect(CONFIRM_EMAIL_COPY.button).not.toMatch(/thành công/i);
  });

  it('warns that every session is revoked on success', () => {
    expect(EMAIL_CHANGE_SUCCESS_HINT).toContain('thu hồi');
    expect(EMAIL_CHANGE_SUCCESS_HINT).toContain('đăng nhập lại');
  });
});

// Drift guard for the Vietnamese strings this module mirrors from the Go
// handler. They are only fallbacks (the live server always sends its own
// message), but a fallback that no longer matches the server would be a lie
// told exactly when something has already gone wrong. Skipped if the Go
// checkout is absent.
const authGoSource = (() => {
  try {
    return readFileSync(
      fileURLToPath(new URL('../../../../api/internal/handlers/auth.go', import.meta.url)),
      'utf8',
    );
  } catch {
    return null;
  }
})();

const describeWithGo = authGoSource ? describe : describe.skip;

describeWithGo('mirror of api/internal/handlers/auth.go', () => {
  it('mirrors the neutral request message', () => {
    expect(authGoSource).toContain(EMAIL_CHANGE_NEUTRAL_FALLBACK);
  });

  it('mirrors the invalid/expired/used token message', () => {
    expect(authGoSource).toContain(
      describeConfirmEmailChangeFailure({ status: 400, error: 'invalid_email_change_token' }).message,
    );
  });

  it('mirrors the address-taken-at-confirm message', () => {
    expect(authGoSource).toContain(
      describeConfirmEmailChangeFailure({ status: 400, error: 'email_in_use' }).message,
    );
  });

  it('keeps the success message the page surfaces', () => {
    expect(authGoSource).toContain('Đã đổi email. Vào /login để đăng nhập lại bằng địa chỉ mới.');
  });
});
