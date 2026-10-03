import { ConfirmEmailChange } from '@/components/confirm-email-change';

// Public confirmation page for the email-change flow (roadmap #10). The link
// mailed to the NEW address is `<APP_URL>/confirm-email/<token>`, so this route
// is the missing half of `POST /api/v1/auth/change-email` — without it the
// account stays half-migrated: the token is never consumed and the address
// never changes.
//
// The page itself does no work beyond handing the token to the client
// component; the POST is unauthenticated (the token is the credential), so it
// works for a logged-out visitor too.
export default async function ConfirmEmailPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <ConfirmEmailChange token={token} />;
}
