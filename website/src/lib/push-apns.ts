import http2 from 'node:http2';
import crypto from 'node:crypto';

// APNs HTTP/2 sender. Authenticates with a token-based JWT (ES256) signed
// with a .p8 key downloaded from developer.apple.com. The JWT is reusable
// for up to 1 hour; we cache + refresh just before the hour mark.
//
// Env required (set in production; absent => sendApnsPush returns ok:false):
//   APNS_KEY_ID         — Key ID from the Apple Developer portal (10 chars)
//   APNS_TEAM_ID        — Team ID (10 chars)
//   APNS_BUNDLE_ID      — App bundle ID, e.g. com.warrantyvault.app
//   APNS_PRIVATE_KEY    — full .p8 contents (incl. BEGIN/END PRIVATE KEY)
//   APNS_PRODUCTION     — "1" for production gateway, anything else => sandbox

type ApnsConfig = {
  keyId: string;
  teamId: string;
  bundleId: string;
  privateKeyPem: string;
  production: boolean;
};

function readConfig(): ApnsConfig | null {
  const keyId = process.env.APNS_KEY_ID;
  const teamId = process.env.APNS_TEAM_ID;
  const bundleId = process.env.APNS_BUNDLE_ID;
  const privateKeyPem = process.env.APNS_PRIVATE_KEY;
  if (!keyId || !teamId || !bundleId || !privateKeyPem) return null;
  return {
    keyId,
    teamId,
    bundleId,
    privateKeyPem,
    production: process.env.APNS_PRODUCTION === '1',
  };
}

let cachedJwt: { token: string; issuedAt: number } | null = null;

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

function buildJwt(cfg: ApnsConfig): string {
  const now = cachedJwt?.issuedAt;
  // Reuse cached JWT for 50 minutes (Apple allows up to 60).
  if (cachedJwt && now && Date.now() - now < 50 * 60 * 1000) return cachedJwt.token;

  const header = b64url(Buffer.from(JSON.stringify({ alg: 'ES256', kid: cfg.keyId, typ: 'JWT' })));
  const claims = b64url(
    Buffer.from(JSON.stringify({ iss: cfg.teamId, iat: Math.floor(Date.now() / 1000) })),
  );
  const signingInput = `${header}.${claims}`;
  const sig = crypto
    .createSign('SHA256')
    .update(signingInput)
    .sign({ key: cfg.privateKeyPem, dsaEncoding: 'ieee-p1363' });
  const token = `${signingInput}.${b64url(sig)}`;
  cachedJwt = { token, issuedAt: Date.now() };
  return token;
}

export type ApnsPayload = {
  title: string;
  body: string;
  url?: string;
  tag?: string;
};

export async function sendApnsPush(
  deviceToken: string,
  payload: ApnsPayload,
): Promise<{ ok: boolean; gone?: boolean; error?: string }> {
  const cfg = readConfig();
  if (!cfg) return { ok: false, error: 'apns not configured' };
  const host = cfg.production ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';
  const jwt = buildJwt(cfg);

  const body = JSON.stringify({
    aps: {
      alert: { title: payload.title, body: payload.body },
      sound: 'default',
      'thread-id': payload.tag ?? 'default',
    },
    url: payload.url,
  });

  return new Promise((resolve) => {
    const client = http2.connect(`https://${host}`);
    let settled = false;
    const finish = (r: { ok: boolean; gone?: boolean; error?: string }) => {
      if (settled) return;
      settled = true;
      client.close();
      resolve(r);
    };
    client.on('error', (e) => finish({ ok: false, error: e.message }));

    const req = client.request({
      ':method': 'POST',
      ':path': `/3/device/${deviceToken}`,
      'apns-topic': cfg.bundleId,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      authorization: `bearer ${jwt}`,
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body),
    });

    let status = 0;
    let respBody = '';
    req.on('response', (h) => {
      status = Number(h[':status'] ?? 0);
    });
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => {
      respBody += chunk;
    });
    req.on('end', () => {
      if (status >= 200 && status < 300) return finish({ ok: true });
      // 410 = device token no longer valid (uninstalled/disabled).
      if (status === 410) return finish({ ok: false, gone: true, error: respBody });
      finish({ ok: false, error: `APNs ${status}: ${respBody}` });
    });
    req.on('error', (e) => finish({ ok: false, error: e.message }));
    req.end(body);
  });
}
