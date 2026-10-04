import Link from 'next/link';
import { PackageOpen, Plus, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getI18n } from '@/lib/i18n/server';

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
 * The three copy props default to the Vietnamese originals, resolved through the
 * dictionary. They are defaults and not `t(...)` calls in the parameter list
 * because a default parameter cannot await `getI18n()` — hence the `async`
 * component and the `??` fallbacks below. Every call site keeps working
 * unchanged, whether it passes `title`/`description`/`ctaLabel` or nothing.
 *
 * Which dictionary: `Chưa có thiết bị nào, mày` and `Thêm thiết bị` are
 * registered by `messages/devices.ts` (this component is generic, those
 * sentences are not), and the description by `messages/common.ts`.
 */
export async function EmptyState({
  title,
  description,
  icon: Icon = PackageOpen,
  tone = 'primary',
  cta = true,
  ctaHref = '/devices/new',
  ctaLabel,
}: {
  title?: string;
  description?: string;
  icon?: LucideIcon;
  tone?: Tone;
  cta?: boolean;
  ctaHref?: string;
  ctaLabel?: string;
}) {
  const { t } = await getI18n();
  const resolvedTitle = title ?? t('Chưa có thiết bị nào, mày');
  const resolvedDescription =
    description ?? t('Bắt đầu bằng cách thêm thiết bị đầu tiên để theo dõi bảo hành.');
  const resolvedCtaLabel = ctaLabel ?? t('Thêm thiết bị');

  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border-[1.5px] border-dashed border-border-strong bg-card/60 px-6 py-16 text-center">
      <div
        className={cn(
          'mb-5 flex h-24 w-24 items-center justify-center rounded-full',
          TONE_CLASSES[tone],
        )}
      >
        <Icon className="h-10 w-10" strokeWidth={1.75} />
      </div>
      <h3 className="display mb-2 text-2xl text-ink">{resolvedTitle}</h3>
      <p className="mb-6 max-w-sm text-sm text-muted-foreground">{resolvedDescription}</p>
      {cta && (
        <Button
          asChild
          size="lg"
          className="rounded-pill transition-transform hover:scale-[1.02]"
        >
          <Link href={ctaHref}>
            <Plus className="mr-1.5 h-4 w-4" />
            {resolvedCtaLabel}
          </Link>
        </Button>
      )}
    </div>
  );
}
