import { KeyRound } from 'lucide-react';

const TEST_EMAIL = 'test@local.test';
const TEST_PASSWORD = 'test1234';

export function DevCredentialsHint() {
  if (process.env.NODE_ENV === 'production') return null;

  return (
    <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
      <div className="mb-1 flex items-center gap-2 font-medium">
        <KeyRound className="h-4 w-4" />
        Tài khoản test (chỉ hiện ở dev)
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 font-mono text-xs">
        <dt className="opacity-70">Email</dt>
        <dd className="select-all">{TEST_EMAIL}</dd>
        <dt className="opacity-70">Mật khẩu</dt>
        <dd className="select-all">{TEST_PASSWORD}</dd>
      </dl>
    </div>
  );
}
