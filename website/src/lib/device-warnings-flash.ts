// Short-lived "flash" cookie that carries the non-blocking serial warnings from
// the write action to the device page it redirects to.
//
// Why a cookie: `POST/PATCH /v1/devices` answers with `warnings` and the action
// then redirects to `/devices/{id}` — a redirect cannot carry a response body, and
// the warnings are not part of any later read (they are computed at write time
// only), so there is nothing for the destination page to fetch. A flash cookie is
// how the API's exact Vietnamese messages reach the page that renders them.
//
// Shape: the same `DeviceWarning[]` the API returned, percent-encoded JSON
// (codec in `lib/device-warnings`, capped so it can never exceed the ~4KB cookie
// limit). Scoped to `/devices` — the only place it is read — httpOnly, and
// expiring in minutes: it is a notification, not state.

import { cookies } from 'next/headers';
import type { DeviceWarning } from '@/lib/api/devices';
import {
  decodeDeviceWarningsFlash,
  encodeDeviceWarningsFlash,
  warningsForDevice,
} from '@/lib/device-warnings';

const FLASH_COOKIE = 'wv_device_warnings';
const FLASH_MAX_AGE_SEC = 10 * 60;
const FLASH_PATH = '/devices';

// Settable only from a Server Action / Route Handler (Next throws when a RSC
// render tries to write a cookie), which is exactly where the write actions are.
export async function setDeviceWarningsFlash(
  deviceId: string,
  warnings: DeviceWarning[],
): Promise<void> {
  const value = encodeDeviceWarningsFlash({ deviceId, warnings });
  if (value === '') return;
  const c = await cookies();
  c.set(FLASH_COOKIE, value, {
    path: FLASH_PATH,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: FLASH_MAX_AGE_SEC,
  });
}

// Read-only: safe from a Server Component render, so the device page can render
// the banner in its first paint (no client round trip, no flash of empty state).
// Scoped to `deviceId`, so a flash left by one save can never surface on another
// device's page (e.g. via a prefetched sibling link).
export async function readDeviceWarningsFlash(deviceId: string): Promise<DeviceWarning[]> {
  const c = await cookies();
  return warningsForDevice(decodeDeviceWarningsFlash(c.get(FLASH_COOKIE)?.value), deviceId);
}

// Called from a Server Action by the banner once it has been displayed, so the
// warning is shown once and does not reappear on every later visit to the page.
export async function clearDeviceWarningsFlash(): Promise<void> {
  const c = await cookies();
  c.set(FLASH_COOKIE, '', {
    path: FLASH_PATH,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 0,
  });
}
