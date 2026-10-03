import { AuthForm } from '@/components/auth-form';
import { DevCredentialsHint } from '@/components/dev-credentials-hint';
import { requireGuest } from '@/lib/auth';

export default async function LoginPage() {
  await requireGuest();
  return (
    <>
      <AuthForm mode="login" />
      <DevCredentialsHint />
    </>
  );
}
