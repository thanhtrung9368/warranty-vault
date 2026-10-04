'use client';

// The language switcher.
//
// Two renderings of the same control:
//
//   * `variant="settings"` — the full row in Cài đặt, with the explanation that
//     the choice also governs push notifications and email.
//   * `variant="compact"` — the two-letter toggle in the public and auth
//     headers. Those pages have no session, and without a control there a
//     first-time visitor could never choose: their language would be whatever
//     their browser's `Accept-Language` happened to say.
//
// Both are plain React over one Server Action — no form library, no optimistic
// client state. The action writes the `wv_locale` cookie, persists `User.locale`
// when there is a user, and `revalidatePath('/', 'layout')` brings the whole
// shell back in the new language.

import * as React from 'react';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, Languages, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { setLocaleAction, type LocaleFormState } from '@/app/actions/locale';
import { useT } from '@/lib/i18n/client';
import { LOCALES, LOCALE_LABELS, LOCALE_SHORT_LABELS, type Locale } from '@/lib/i18n/locale';

function OptionButton({
  locale,
  current,
  compact,
}: {
  locale: Locale;
  current: Locale;
  compact: boolean;
}) {
  const { pending } = useFormStatus();
  const active = locale === current;

  if (compact) {
    return (
      <button
        type="submit"
        name="locale"
        value={locale}
        disabled={pending}
        aria-pressed={active}
        aria-label={LOCALE_LABELS[locale]}
        className={cn(
          'rounded-pill px-2.5 py-1 text-xs font-bold uppercase tracking-wide transition-colors',
          active ? 'bg-primary text-primary-foreground' : 'text-ink-2 hover:bg-secondary',
          pending && 'opacity-60',
        )}
      >
        {LOCALE_SHORT_LABELS[locale]}
      </button>
    );
  }

  return (
    <button
      type="submit"
      name="locale"
      value={locale}
      disabled={pending}
      aria-pressed={active}
      className={cn(
        'flex items-center gap-2 rounded-pill border-[1.5px] px-4 py-2 text-sm font-semibold transition-colors',
        active
          ? 'border-primary bg-primary-soft text-primary-ink'
          : 'border-border bg-card text-ink-2 hover:bg-secondary',
        pending && 'opacity-60',
      )}
    >
      {active ? <Check className="h-4 w-4" /> : <Languages className="h-4 w-4 opacity-60" />}
      {LOCALE_LABELS[locale]}
    </button>
  );
}

export function LocaleSwitcher({
  current,
  variant = 'settings',
}: {
  current: Locale;
  variant?: 'settings' | 'compact';
}) {
  const t = useT();
  const [state, formAction] = useActionState<LocaleFormState, FormData>(setLocaleAction, {});

  // Only announce a failure or a save that did NOT take effect everywhere. The
  // success case re-renders every string on the screen, which is its own
  // feedback — a toast there would be noise, and in the compact header it would
  // cover the page it just changed.
  const seen = React.useRef<LocaleFormState | null>(null);
  React.useEffect(() => {
    if (!state || seen.current === state) return;
    seen.current = state;
    if (!state.ok && state.message) toast.error(state.message);
  }, [state]);

  if (variant === 'compact') {
    return (
      <form action={formAction} className="flex items-center gap-1 rounded-pill border-[1.5px] border-border bg-card p-0.5">
        {LOCALES.map((locale) => (
          <OptionButton key={locale} locale={locale} current={current} compact />
        ))}
      </form>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <div>
        <p className="text-sm font-semibold text-ink">{t('Ngôn ngữ hiển thị')}</p>
        <p className="text-xs text-muted-foreground">
          {t('Chọn ngôn ngữ cho giao diện, thông báo đẩy và email.')}
        </p>
      </div>
      <form action={formAction} className="flex flex-wrap items-center gap-2">
        {LOCALES.map((locale) => (
          <OptionButton key={locale} locale={locale} current={current} compact={false} />
        ))}
        <Pending />
      </form>
    </div>
  );
}

function Pending() {
  const { pending } = useFormStatus();
  if (!pending) return null;
  return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-hidden />;
}
