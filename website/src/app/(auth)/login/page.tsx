import { AuthForm } from '@/components/auth-form';
import { DevCredentialsHint } from '@/components/dev-credentials-hint';
import { requireGuest } from '@/lib/auth';
import { safeNextPath } from '@/lib/next-path';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const sp = await searchParams;
  // Validate before it reaches the form (and before `requireGuest` can redirect
  // a signed-in visitor); the server action validates the hidden field again.
  const next = safeNextPath(sp.next);
  await requireGuest(next);
  return (
    <>
      <AuthForm mode="login" next={next} />
      <DevCredentialsHint />
    </>
  );
}
