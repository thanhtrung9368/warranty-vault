// Typed wrapper around `GET /v1/devices/{id}/service-directory`
// (FEATURE_IDEAS #15).
//
// The response is a read-only bundle for ONE device the caller owns; the
// matching rule (free text → brand / warranty-provider catalog row, including
// the "ambiguous ⇒ null" case) lives in Go on purpose, so all clients agree.
// This module only fetches it and normalises the shape defensively — the
// normaliser is what keeps `phoneSource` honest (see
// `@/lib/service-directory`).

import { apiFetch, type ApiResult } from './client';
import { translate } from '@/lib/i18n/catalog';
import { getLocale } from '@/lib/i18n/server';
import { normalizeServiceDirectory, type ServiceDirectory } from '@/lib/service-directory';

export type {
  BrandServiceInfo,
  DirectoryProviderRef,
  PhoneSource,
  PhoneSourceValue,
  ServiceDirectory,
  WarrantyCentre,
} from '@/lib/service-directory';

export async function get(deviceId: string): Promise<ApiResult<ServiceDirectory>> {
  const res = await apiFetch<{ directory: unknown }>(
    'GET',
    `/v1/devices/${encodeURIComponent(deviceId)}/service-directory`,
  );
  if (!res.ok) return res;

  const directory = normalizeServiceDirectory(res.data?.directory);
  if (!directory) {
    return {
      ok: false,
      // The HTTP call succeeded; the body is what we cannot use. Same shape the
      // client uses for an unparseable JSON body.
      status: 200,
      error: 'bad_response',
      // Our own sentence, not the server's — so it is rendered in the request's
      // language here rather than passed through.
      message: translate(await getLocale(), 'Danh bạ bảo hành trả về không hợp lệ'),
    };
  }
  return { ok: true, data: directory };
}
