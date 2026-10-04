import { Info } from 'lucide-react';
import { getI18n } from '@/lib/i18n/server';

const TEST_EMAIL = 'test@local.test';
const TEST_PASSWORD = 'test1234';

// Renders `chunk` as a plain string, or as the monospace chip the original used
// when the chunk is one of the credentials. The credentials themselves are
// constants (not copy) and are interpolated into the translated sentence, so the
// English column keeps the same two highlighted values.
function chunk(value: string) {
  if (value !== TEST_EMAIL && value !== TEST_PASSWORD) return value;
  return (
    <code className="rounded bg-card px-1.5 py-0.5 font-mono text-[12px]">{value}</code>
  );
}

// Server Component: it renders inline on the login page and holds no state, so
// the locale comes from `getI18n()` rather than a client hook.
export async function DevCredentialsHint() {
  if (process.env.NODE_ENV === 'production') return null;

  const { t } = await getI18n();
  const sentence = t('dùng {email} / {password} để vào nhanh.', {
    email: TEST_EMAIL,
    password: TEST_PASSWORD,
  });

  return (
    <div className="mx-auto mt-4 flex max-w-md items-start gap-2.5 rounded-md border-[1.5px] border-primary-soft-2 bg-primary-soft/50 px-4 py-3 text-sm text-primary-ink shadow-soft">
      <Info className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <div className="leading-snug">
        <strong className="font-bold">Dev only:</strong>{' '}
        {/* Split on the credentials rather than on translated words: the chips
            mark the two values, and neither language can move them out of
            place because they are matched literally. */}
        {sentence
          .split(new RegExp(`(${TEST_EMAIL}|${TEST_PASSWORD})`))
          .map((part, i) => (
            <span key={i}>{chunk(part)}</span>
          ))}
      </div>
    </div>
  );
}
