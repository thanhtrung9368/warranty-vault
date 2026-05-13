import Link from 'next/link';
import { PackageOpen, Plus, type LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type Tone = 'primary' | 'amber' | 'emerald' | 'rose' | 'sky' | 'violet';

const TONE_CLASSES: Record<Tone, string> = {
  primary: 'bg-primary/10 text-primary',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  rose: 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
  sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  violet: 'bg-violet-500/10 text-violet-600 dark:text-violet-400',
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
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed bg-card/40 px-6 py-16 text-center">
      <div className={cn('mb-5 rounded-full p-5', TONE_CLASSES[tone])}>
        <Icon className="h-12 w-12" strokeWidth={1.75} />
      </div>
      <h3 className="mb-1.5 text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mb-6 max-w-sm text-sm text-muted-foreground">{description}</p>
      {cta && (
        <Button
          asChild
          size="lg"
          className="rounded-full transition-transform hover:scale-[1.02]"
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
