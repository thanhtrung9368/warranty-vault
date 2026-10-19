'use client';

import * as React from 'react';
import { formatDate } from '@/lib/format';
import { useLocale } from '@/lib/i18n/client';
import { renewalCountdownLabel } from '@/lib/subscription-audit';

/**
 * The subscription-audit renewal countdown, computed on the reader's clock.
 *
 * The panel around it is a Server Component; `new Date()` there is the WEB
 * HOST's clock, which is the same class of bug as the Go server's count one
 * layer down. A countdown is the one thing a date-only prop cannot be rendered
 * correctly on a server, so this tiny island computes it after mount:
 *
 *   * the server-rendered HTML (and a browser with JS disabled) shows the date
 *     alone — correct, just without the "· N days left" suffix;
 *   * after hydration the reader's calendar decides "today" and the suffix
 *     appears. Computing it in an effect rather than during render avoids a
 *     hydration mismatch when the two clocks are on different calendar days.
 *
 * `renewalCountdownLabel` is the tested pure part (see
 * `lib/__tests__/subscription-audit.test.ts`); this component only supplies the
 * clock.
 */
export function RenewalCountdown({ nextRenewalAt }: { nextRenewalAt: string }) {
  const locale = useLocale();
  const [now, setNow] = React.useState<Date | null>(null);

  React.useEffect(() => {
    // After mount, on purpose: the first render must match the server HTML
    // (date only), and the countdown may then use the reader's calendar day.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reader-clock hydration
    setNow(new Date());
  }, []);

  const label = now ? renewalCountdownLabel({ nextRenewalAt }, locale, now) : null;
  return <>{label ?? formatDate(nextRenewalAt, locale)}</>;
}
