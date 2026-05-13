import crypto from 'node:crypto';

// Firebase Cloud Messaging HTTP v1 sender. Auth is OAuth2 access token
// minted from a service-account JSON (see Firebase console → Project
// Settings → Service Accounts → "Generate new private key").
//
// Env required (absent => sendFcmPush returns ok:false):
//   FCM_SERVICE_ACCOUNT_JSON  — full service account JSON, single line
// Optional:
//   FCM_PROJECT_ID  — defaults to project_id field from the JSON

type ServiceAccount = {
  client_email: string;
  private_key: string;
  project_id: string;
  token_uri: string;
};

function readConfig(): ServiceAccount | null {
  const raw = process.env.FCM_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as ServiceAccount;
    if (!parsed.client_email || !parsed.private_key || !parsed.project_id) return null;
    parsed.token_uri = parsed.token_uri || 'https://oauth2.googleapis.com/token';
    return parsed;
  } catch {
    return null;
  }
}

let cachedToken: { token: string; expiresAt: number } | null = null;

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

async function getAccessToken(sa: ServiceAccount): Promise<string | null> {
  if (cachedToken && cachedToken.expiresAt - Date.now() > 60_000) return cachedToken.token;

  const now = Math.floor(Date.now() / 1000);
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const claims = b64url(
    Buffer.from(
      JSON.stringify({
        iss: sa.client_email,
        scope: 'https://www.googleapis.com/auth/firebase.messaging',
        aud: sa.token_uri,
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const signingInput = `${header}.${claims}`;
  const sig = crypto.createSign('RSA-SHA256').update(signingInput).sign(sa.private_key);
  const assertion = `${signingInput}.${b64url(sig)}`;

  const res = await fetch(sa.token_uri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!json.access_token) return null;
  cachedToken = {
    token: json.access_token,
    expiresAt: Date.now() + (json.expires_in ?? 3500) * 1000,
  };
  return cachedToken.token;
}

export type FcmPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

export async function sendFcmPush(
  registrationToken: string,
  payload: FcmPayload,
): Promise<{ ok: boolean; gone?: boolean; error?: string }> {
  const sa = readConfig();
  if (!sa) return { ok: false, error: 'fcm not configured' };
  const projectId = process.env.FCM_PROJECT_ID || sa.project_id;

  const accessToken = await getAccessToken(sa);
  if (!accessToken) return { ok: false, error: 'fcm token mint failed' };

  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const body = JSON.stringify({
    message: {
      token: registrationToken,
      notification: { title: payload.title, body: payload.body },
      data: payload.url ? { url: payload.url } : undefined,
      android: { priority: 'HIGH', notification: { tag: payload.tag } },
      apns: { payload: { aps: { sound: 'default' } } },
    },
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body,
  });

  if (res.ok) return { ok: true };
  const errText = await res.text().catch(() => '');
  // Per FCM v1 docs: NOT_FOUND or UNREGISTERED => token no longer valid.
  if (res.status === 404 || /UNREGISTERED|NOT_FOUND/.test(errText)) {
    return { ok: false, gone: true, error: errText };
  }
  return { ok: false, error: `FCM ${res.status}: ${errText}` };
}
