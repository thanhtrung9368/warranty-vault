import Link from 'next/link';
import { ArrowRight, PackageOpen, Plus, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getI18n } from '@/lib/i18n/server';
import { emptyStateCopy, type EmptyReason } from '@/lib/empty-state';
import { EmptyStateArt } from '@/components/empty-state-art';

type Tone = 'primary' | 'amber' | 'emerald' | 'rose' | 'sky' | 'violet' | 'zinc';

// Soft tint backgrounds drawn from the design system tokens.
const TONE_CLASSES: Record<Tone, string> = {
  primary: 'bg-primary-soft text-primary-ink',
  amber: 'bg-amber-soft text-amber-ink',
  emerald: 'bg-emerald-soft text-emerald-ink',
  rose: 'bg-rose-soft text-rose-ink',
  sky: 'bg-sky-soft text-sky-ink',
  violet: 'bg-violet-soft text-violet-ink',
  zinc: 'bg-zinc-soft text-ink-2',
};

/**
 * The app's empty state.
 *
 * `emptyReason` is the important prop. The same visual (a green tick, "nothing
 * is waiting") means two different things:
 *
 *   * `'nothing-due'` — we read data the user entered and nothing needs them.
 *     Reassuring, and legitimately so.
 *   * `'no-data'`     — the account has no devices, so we read NOTHING. A tick
 *     here is a lie; the copy says so and the CTA starts the loop.
 *
 * The two copy sets live in `lib/empty-state.ts` (one place, tested). A page
 * that wants its own words for the genuine nothing-due case passes
 * `title`/`description`; for `'no-data'` it should pass nothing and let the
 * preset speak, or its own honest wording if it has context.
 *
 * A CTA is always rendered for these two states. `cta={false}` remains for a
 * FILTERED list ("no rows match this filter"), which is not an empty account and
 * whose right action is "clear the filter", not "add a device" — the call sites
 * that use it (`/subscriptions`, `/wishlist`, `/devices`) are exactly those.
 *
 * The copy props default to `undefined` rather than to `t(...)` in the parameter
 * list because a default parameter cannot await `getI18n()` — hence the preset
 * lookup and the `??` fallbacks below.
 */
export async function EmptyState({
  title,
  description,
  icon: Icon = PackageOpen,
  tone = 'primary',
  cta = true,
  ctaHref,
  ctaLabel,
  emptyReason = 'nothing-due',
}: {
  title?: string;
  description?: string;
  icon?: LucideIcon;
  tone?: Tone;
  cta?: boolean;
  ctaHref?: string;
  ctaLabel?: string;
  emptyReason?: EmptyReason;
}) {
  const { t } = await getI18n();
  const copy = emptyStateCopy(emptyReason);
  const resolvedTitle = title ?? t(copy.title);
  const resolvedDescription = description ?? t(copy.description);
  const resolvedCtaHref = ctaHref ?? copy.ctaHref;
  const resolvedCtaLabel = ctaLabel ?? t(copy.ctaLabel);
  // The first-run CTA adds something; the nothing-due CTA goes somewhere. Using
  // a plus sign for "View your devices" would promise the wrong action.
  const CtaIcon = emptyReason === 'no-data' ? Plus : ArrowRight;

  return (
    <div className="flex flex-col items-center justify-center rounded-lg border-[1.5px] border-dashed border-border-strong bg-card/60 px-6 py-16 text-center">
      {emptyReason === 'no-data' ? (
        // Cold start: a receipt with a date dot and a soft plus. The copy/CTA
        // below are untouched — this only replaces the tinted icon chip on the
        // one state where the app is asking for a first device.
        <div className="mb-3 flex justify-center">
          <EmptyStateArt label={t('Sổ bảo hành và hoá đơn')} />
        </div>
      ) : (
        <div
          className={cn(
            'mb-5 flex h-24 w-24 items-center justify-center rounded-full',
            TONE_CLASSES[tone],
          )}
        >
          <Icon className="h-10 w-10" strokeWidth={1.75} />
        </div>
      )}
      <h3 className="display mb-2 text-2xl !leading-tight text-ink">{resolvedTitle}</h3>
      <p className="mb-6 max-w-sm text-sm text-muted-foreground">{resolvedDescription}</p>
      {cta && (
        <Button
          asChild
          size="lg"
          className="rounded-pill transition-transform hover:scale-[1.02]"
        >
          <Link href={resolvedCtaHref}>
            <CtaIcon className="mr-1.5 h-4 w-4" />
            {resolvedCtaLabel}
          </Link>
        </Button>
      )}
    </div>
  );
}
