import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

/**
 * The one card surface.
 *
 * Before this, six recipes coexisted — `Card` (22/1.5), dashboard
 * `SectionCard` (22/1), quick-add (22/2 + chunky), `.stat-card` (22/1.5, no
 * shadow), detail cards (16/1.5, p-6/md:p-8) and the landing cards (28/1.5).
 * Every app-shell one of them is now this component (the landing page keeps its
 * own display cards by scope):
 *
 *   surface   rounded-lg (= var(--radius)) + 1.5px border + shadow-soft
 *   padding   `padding` prop, in --pad / --pad-sm units (density-aware)
 *   colour    `tone` prop for the handful of intentional tints
 *
 * `asChild` exists so a card that is a link (subscription / wishlist tiles)
 * still uses this surface instead of restating the classes on `<Link>`.
 *
 * `padding` defaults to `none` because the composed cards (`CardHeader` +
 * `CardContent`) supply their own padding. A card without those children
 * passes `padding="md"`. Both paths use the same --pad token, so the density
 * setting reaches every card.
 */
const cardVariants = cva(
  'rounded-lg border-[1.5px] border-border bg-card text-card-foreground shadow-soft',
  {
    variants: {
      padding: {
        none: '',
        sm: 'p-card-sm',
        md: 'p-card',
      },
      tone: {
        default: '',
        muted: 'bg-surface-2',
        primary: 'border-primary/30 bg-primary-soft/50',
        gradient: 'border-border bg-gradient-to-br from-primary-soft to-primary-soft-2',
        accent:
          'border-ink bg-gradient-to-br from-primary-soft to-primary-soft-2 shadow-chunky',
        warning: 'border-amber-ink/25 bg-amber-soft',
        danger: 'border-destructive/30 bg-destructive-soft/40',
      },
    },
    defaultVariants: { padding: 'none', tone: 'default' },
  },
);

export type CardPadding = NonNullable<VariantProps<typeof cardVariants>['padding']>;
export type CardTone = NonNullable<VariantProps<typeof cardVariants>['tone']>;

export interface CardProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {
  asChild?: boolean;
}

const Card = React.forwardRef<HTMLDivElement, CardProps>(
  ({ className, padding, tone, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'div';
    return (
      <Comp
        ref={ref}
        className={cn(cardVariants({ padding, tone }), className)}
        {...props}
      />
    );
  },
);
Card.displayName = 'Card';

const CardHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('flex flex-col space-y-1.5 p-card', className)}
      {...props}
    />
  ),
);
CardHeader.displayName = 'CardHeader';

const CardTitle = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn('font-display text-lg font-bold tracking-tight', className)}
      {...props}
    />
  ),
);
CardTitle.displayName = 'CardTitle';

const CardDescription = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('text-sm text-muted-foreground', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

const CardContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('p-card pt-0', className)} {...props} />
  ),
);
CardContent.displayName = 'CardContent';

const CardFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center p-card pt-0', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent };
