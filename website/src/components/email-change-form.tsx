'use client';

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Loader2, MailPlus, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { requestEmailChange, type EmailChangeFormState } from '@/app/actions/email-change';
import { newEmailInboxHint } from '@/lib/email-change';

function FieldError({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null;
  return <p className="text-xs font-medium text-destructive">{errors[0]}</p>;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending} variant="outline" className="rounded-pill">
      {pending ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <MailPlus className="mr-2 h-4 w-4" />
      )}
      Gửi link xác nhận
    </Button>
  );
}

// Step 1/2 of the email-change flow (roadmap #10): "đổi email" request form for
// the Hồ sơ section in Cài đặt.
//
// What the UI may and may not claim:
//   - It asks for the new address + the CURRENT password (Go verifies it, so a
//     stolen session alone cannot move the account).
//   - The success block shows the server's message EXACTLY as returned. That
//     message is intentionally neutral: it is identical when the address is
//     free and when it already belongs to another account, and no email is sent
//     in the second case. The client cannot tell the two apart, so it never
//     says "email đã tồn tại" and never promises an email was delivered — it
//     tells the user which inbox to check.
//   - With no RESEND_API_KEY on the server the mail is only written to the log.
//     Nothing in the response reveals that, so the UI does not pretend to know.
export function EmailChangeForm({ currentEmail }: { currentEmail: string }) {
  const [state, formAction] = useActionState<EmailChangeFormState, FormData>(
    requestEmailChange,
    {},
  );
  const errors = state?.errors ?? {};
  const formRef = React.useRef<HTMLFormElement>(null);
  const [newEmail, setNewEmail] = React.useState('');

  React.useEffect(() => {
    if (!state?.ok) return;
    toast.success('Đã ghi nhận yêu cầu đổi email');
    // Only clear on success: a rejected address (wrong password, invalid
    // address, same as the current one) stays in the input for correction.
    formRef.current?.reset();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNewEmail('');
  }, [state]);

  return (
    <div className="rounded-lg border-[1.5px] border-dashed border-border-strong bg-surface-2 p-4">
      <h3 className="font-display text-sm font-bold text-ink">Đổi email đăng nhập</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Bước 1/2: nhập địa chỉ mới và mật khẩu hiện tại. Hệ thống gửi một link xác nhận tới{' '}
        <b>địa chỉ mới</b>; email hiện tại{' '}
        <code className="rounded bg-card px-1 py-0.5 font-mono text-[11px]">{currentEmail}</code> vẫn
        dùng được cho tới khi bạn bấm link đó.
      </p>

      <form ref={formRef} action={formAction} className="mt-4 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="newEmail">Email mới</Label>
          <Input
            id="newEmail"
            name="newEmail"
            type="email"
            inputMode="email"
            autoComplete="email"
            placeholder="vd: trung@vidu.com"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
            required
          />
          <FieldError errors={errors.newEmail} />
        </div>

        <div className="space-y-2">
          <Label htmlFor="changeEmailPassword">Mật khẩu hiện tại</Label>
          <Input
            id="changeEmailPassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
          />
          <FieldError errors={errors.currentPassword} />
          <p className="text-xs text-muted-foreground">
            Cần mật khẩu để một phiên đăng nhập bị đánh cắp không thể tự chuyển tài khoản sang địa
            chỉ khác.
          </p>
        </div>

        {state?.ok && (
          <div className="flex items-start gap-2 rounded-md border-[1.5px] border-emerald-soft bg-emerald-soft/60 px-3 py-2 text-sm font-medium text-emerald-ink">
            <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div className="space-y-1">
              <p>{state.message}</p>
              <p className="font-normal">{newEmailInboxHint(newEmail)}</p>
            </div>
          </div>
        )}

        {state?.message && !state.ok && (
          <p className="rounded-md border-[1.5px] border-destructive/30 bg-destructive-soft/60 px-3 py-2 text-sm font-medium text-destructive">
            {state.message}
          </p>
        )}

        <SubmitButton />
      </form>
    </div>
  );
}
