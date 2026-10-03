import { ForgotPasswordForm } from '@/components/forgot-password-form';
import { requireGuest } from '@/lib/auth';

export default async function ForgotPage() {
  await requireGuest();
  return <ForgotPasswordForm />;
}
