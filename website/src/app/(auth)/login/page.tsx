import { AuthForm } from '@/components/auth-form';
import { DevCredentialsHint } from '@/components/dev-credentials-hint';

export default function LoginPage() {
  return (
    <>
      <AuthForm mode="login" />
      <DevCredentialsHint />
    </>
  );
}
