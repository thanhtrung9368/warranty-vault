import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-pill border-[1.5px] h-6 px-2.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground hover:bg-primary/80',
        secondary:
          'border-border bg-surface-2 text-ink',
        destructive:
          'border-transparent bg-destructive-soft text-destructive hover:bg-destructive-soft/80',
        outline:
          'border-border text-ink bg-transparent',
        // Tinted variants — soft background + colored text. Match the
        // `--success / --warning / --info / --expiring` tokens in globals.css
        // so they re-tone correctly in dark mode.
        success:
          'border-transparent bg-success/15 text-success dark:bg-success/20 dark:text-emerald-300',
        warning:
          'border-transparent bg-warning/15 text-amber-700 dark:bg-warning/20 dark:text-amber-300',
        expiring:
          'border-transparent bg-expiring/15 text-orange-700 dark:bg-expiring/20 dark:text-orange-300',
        info:
          'border-transparent bg-info/15 text-sky-700 dark:bg-info/20 dark:text-sky-300',
        // Playful tone helpers — pair with the *-soft / *-ink palette tokens.
        primary:
          'border-transparent bg-primary-soft text-primary-ink',
        emerald:
          'border-transparent bg-emerald-soft text-emerald-ink',
        amber:
          'border-transparent bg-amber-soft text-amber-ink',
        rose:
          'border-transparent bg-rose-soft text-rose-ink',
        violet:
          'border-transparent bg-violet-soft text-violet-ink',
        sky:
          'border-transparent bg-sky-soft text-sky-ink',
        zinc:
          'border-transparent bg-zinc-soft text-ink-2',
      },
    },
    defaultVariants: {
      variant: 'default',
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
