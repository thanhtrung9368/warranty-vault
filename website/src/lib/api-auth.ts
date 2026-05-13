import crypto from 'node:crypto';
import { headers } from 'next/headers';
import { prisma } from '@/lib/prisma';

// 30 days. Mobile clients re-authenticate after this; lastSeenAt sliding
// means tokens stay alive as long as the app is being used.
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_TTL_SLIDING_MS = 7 * 24 * 60 * 60 * 1000;

export type IssuedToken = {
  accessToken: string;
  expiresAt: Date;
  sessionId: string;
};

export type Platform = 'ios' | 'android' | 'web';

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

export async function issueToken(
  userId: string,
  opts: { deviceLabel?: string | null; platform?: Platform | null } = {},
): Promise<IssuedToken> {
  const raw = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      deviceLabel: opts.deviceLabel ?? null,
      platform: opts.platform ?? null,
      expiresAt,
    },
    select: { id: true },
  });
  return { accessToken: raw, expiresAt, sessionId: session.id };
}

export async function revokeToken(rawToken: string): Promise<boolean> {
  const tokenHash = hashToken(rawToken);
  const res = await prisma.session.updateMany({
    where: { tokenHash, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count > 0;
}

export async function revokeAllForUser(userId: string): Promise<number> {
  const res = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count;
}

export type SessionUser = {
  id: string;
  email: string;
  name: string | null;
  sessionId: string;
};

// Read Authorization: Bearer <token> from the current request.
// Returns null if header is missing, malformed, or the token is invalid /
// expired / revoked. On a hit, slides expiresAt forward (within reason)
// and bumps lastSeenAt.
export async function getBearerUser(): Promise<SessionUser | null> {
  const h = await headers();
  const auth = h.get('authorization') ?? h.get('Authorization');
  if (!auth) return null;
  const m = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!m) return null;
  const raw = m[1].trim();
  if (!raw) return null;

  const tokenHash = hashToken(raw);
  const session = await prisma.session.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      revokedAt: true,
      user: { select: { id: true, email: true, name: true, passwordChangedAt: true } },
    },
  });
  if (!session || session.revokedAt) return null;
  if (session.expiresAt.getTime() <= Date.now()) return null;
  // Sessions issued before the user's last password change are stale.
  if (session.user.passwordChangedAt.getTime() > session.createdAt.getTime()) return null;

  // Sliding renewal: if the token expires within SESSION_TTL_SLIDING_MS,
  // push expiresAt forward to a fresh full TTL. Cheap update; same trip.
  const now = new Date();
  const remainingMs = session.expiresAt.getTime() - now.getTime();
  const data: { lastSeenAt: Date; expiresAt?: Date } = { lastSeenAt: now };
  if (remainingMs < SESSION_TTL_SLIDING_MS) {
    data.expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  }
  await prisma.session
    .update({ where: { id: session.id }, data, select: { id: true } })
    .catch(() => void 0);

  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    sessionId: session.id,
  };
}

// Garbage-collect expired/revoked sessions. Call from cron or on-demand;
// not required for correctness (verify checks expiresAt).
export async function pruneExpiredSessions(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const res = await prisma.session.deleteMany({
    where: {
      OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }],
    },
  });
  return res.count;
}
