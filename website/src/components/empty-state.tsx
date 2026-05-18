import Link from 'next/link';
import { PackageOpen, Plus, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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

export function EmptyState({
  title = 'Chưa có thiết bị nào, mày',
  description = 'Bắt đầu bằng cách thêm thiết bị đầu tiên để theo dõi bảo hành.',
  icon: Icon = PackageOpen,
  tone = 'primary',
  cta = true,
  ctaHref = '/devices/new',
  ctaLabel = 'Thêm thiết bị',
}: {
  title?: string;
  description?: string;
  icon?: LucideIcon;
  tone?: Tone;
  cta?: boolean;
  ctaHref?: string;
  ctaLabel?: string;
}) {
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
      <h3 className="display mb-2 text-2xl text-ink">{title}</h3>
      <p className="mb-6 max-w-sm text-sm text-muted-foreground">{description}</p>
      {cta && (
        <Button
          asChild
          size="lg"
          className="rounded-pill transition-transform hover:scale-[1.02]"
        >
          <Link href={ctaHref}>
            <Plus className="mr-1.5 h-4 w-4" />
            {ctaLabel}
          </Link>
        </Button>
      )}
    </div>
  );
}
