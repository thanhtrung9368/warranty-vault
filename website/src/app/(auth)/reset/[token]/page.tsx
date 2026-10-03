import { ResetPasswordForm } from '@/components/reset-password-form';
import { requireGuest } from '@/lib/auth';

export default async function ResetPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  // Guest-only, like login/register/forgot — this check moved out of the
  // `(auth)` layout so /confirm-email/<token> can stay public for signed-in
  // users too. Same redirect as before.
  await requireGuest();
  const { token } = await params;
  return <ResetPasswordForm token={token} />;
}
