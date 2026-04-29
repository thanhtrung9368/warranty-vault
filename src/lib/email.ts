import { Resend } from 'resend';

export type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

export async function sendEmail(msg: EmailMessage): Promise<{ ok: boolean; via: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM ?? 'AssetVault <onboarding@resend.dev>';

  if (!apiKey) {
    // Dev/local fallback: log to console so the developer can grab the reset link
    console.log('\n==================== EMAIL (no RESEND_API_KEY) ====================');
    console.log(`To:      ${msg.to}`);
    console.log(`Subject: ${msg.subject}`);
    console.log(`Body:    ${msg.text}`);
    console.log('===================================================================\n');
    return { ok: true, via: 'console' };
  }

  const resend = new Resend(apiKey);
  const res = await resend.emails.send({
    from,
    to: msg.to,
    subject: msg.subject,
    html: msg.html,
    text: msg.text,
  });
  return { ok: !res.error, via: 'resend' };
}
