import { AuthForm } from '@/components/auth-form';
import { requireGuest } from '@/lib/auth';
import { safeNextPath } from '@/lib/next-path';

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const sp = await searchParams;
  const next = safeNextPath(sp.next);
  await requireGuest(next);
  return <AuthForm mode="register" next={next} />;
}
