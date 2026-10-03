import { AuthForm } from '@/components/auth-form';
import { requireGuest } from '@/lib/auth';

export default async function RegisterPage() {
  await requireGuest();
  return <AuthForm mode="register" />;
}
