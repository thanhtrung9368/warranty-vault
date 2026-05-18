import * as React from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill text-sm font-semibold ring-offset-background transition-[transform,background-color,box-shadow,border-color] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 active:translate-y-px disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default:
          'bg-primary text-primary-foreground border-[1.5px] border-primary shadow-[0_2px_0_rgba(120,40,15,0.25),0_6px_18px_-6px_hsl(var(--primary))] hover:bg-primary-2 hover:border-primary-2',
        destructive:
          'bg-destructive text-destructive-foreground border-[1.5px] border-destructive shadow-[0_2px_0_rgba(120,20,20,0.25)] hover:brightness-105',
        outline:
          'border-[1.5px] border-border-strong bg-transparent text-ink hover:bg-surface-2',
        secondary:
          'bg-surface-2 text-ink border-[1.5px] border-border hover:bg-surface-3',
        ghost: 'text-ink hover:bg-surface-2',
        link: 'text-primary underline-offset-4 hover:underline',
        warning:
          'bg-warning text-warning-foreground border-[1.5px] border-warning hover:brightness-105',
      },
      size: {
        default: 'h-[42px] px-[18px] py-2',
        sm: 'h-8 px-3 text-[13px] gap-1.5',
        lg: 'h-12 px-7 text-[15px]',
        icon: 'h-[38px] w-[38px] p-0',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button';
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';

export { Button, buttonVariants };
