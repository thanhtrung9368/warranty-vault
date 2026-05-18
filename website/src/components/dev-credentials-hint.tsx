import { Info } from 'lucide-react';

const TEST_EMAIL = 'test@local.test';
const TEST_PASSWORD = 'test1234';

export function DevCredentialsHint() {
  if (process.env.NODE_ENV === 'production') return null;

  return (
    <div className="mx-auto mt-4 flex max-w-md items-start gap-2.5 rounded-md border-[1.5px] border-primary-soft-2 bg-primary-soft/50 px-4 py-3 text-sm text-primary-ink shadow-soft">
      <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <div className="leading-snug">
        <strong className="font-bold">Dev only:</strong> dùng{' '}
        <code className="rounded bg-card px-1.5 py-0.5 font-mono text-[12px]">{TEST_EMAIL}</code>{' '}
        /{' '}
        <code className="rounded bg-card px-1.5 py-0.5 font-mono text-[12px]">{TEST_PASSWORD}</code>{' '}
        để vào nhanh.
      </div>
    </div>
  );
}
