import { redirect } from 'next/navigation';
import { prisma } from '@/lib/prisma';
import { getSession } from '@/lib/session';

// bcrypt-ts is pure-JS; 12 rounds is ~1s on a modern CPU.
// Balances brute-force cost vs login latency for a personal app.
export const BCRYPT_ROUNDS = 12;

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getSession();
  if (!session.userId) return null;
  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: { id: true, email: true, name: true, passwordChangedAt: true },
  });
  if (!user) return null;

  // If the user changed their password (on this device or another), all cookies
  // older than that timestamp are stale. Destroy and force re-login.
  const cookieIssuedAt = session.passwordChangedAt ?? 0;
  if (user.passwordChangedAt.getTime() > cookieIssuedAt) {
    session.destroy();
    return null;
  }

  return { id: user.id, email: user.email, name: user.name };
}

export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  return user;
}
