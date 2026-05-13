import { NextResponse } from 'next/server';

// Shared JSON helpers for /api/v1/* routes. Web uses server actions and
// returns plain objects; mobile clients expect a consistent JSON envelope.

export type ApiErrorBody = {
  error: string;
  message?: string;
  fieldErrors?: Record<string, string[]>;
};

export function apiError(
  status: number,
  error: string,
  extras: Omit<ApiErrorBody, 'error'> = {},
): NextResponse {
  return NextResponse.json<ApiErrorBody>({ error, ...extras }, { status });
}

export function apiOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}

export const apiUnauthorized = () => apiError(401, 'unauthorized', { message: 'Bạn chưa đăng nhập' });

export const apiNotFound = (msg = 'Không tìm thấy') =>
  apiError(404, 'not_found', { message: msg });

export const apiRateLimited = (retryAfterSec: number) =>
  apiError(429, 'rate_limited', {
    message: `Thao tác quá nhanh. Đợi ${retryAfterSec >= 60 ? `${Math.ceil(retryAfterSec / 60)} phút` : `${retryAfterSec} giây`}.`,
  });

export const apiBadInput = (
  fieldErrors?: Record<string, string[]>,
  message = 'Dữ liệu không hợp lệ',
) => apiError(400, 'bad_input', { message, fieldErrors });
