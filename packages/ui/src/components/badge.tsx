import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';

import { cn } from '../lib/utils';

export const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2',
  {
    variants: {
      variant: {
        default: 'border-transparent bg-primary text-primary-foreground',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive: 'border-transparent bg-destructive text-destructive-foreground',
        success: 'border-transparent bg-success text-success-foreground',
        warning: 'border-transparent bg-warning text-warning-foreground',
        outline: 'text-foreground',
        // --- Gaming badges (additive) -------------------------------------
        neon: 'border-transparent bg-card text-accent shadow-glow-neon ring-1 ring-inset ring-accent/40',
        gold: 'border-transparent bg-gradient-gold text-gold-foreground shadow-glow-gold',
        hot: 'border-transparent bg-gradient-to-r from-destructive to-gold text-white shadow-glow-pink',
        live: 'border-transparent bg-card text-destructive ring-1 ring-inset ring-destructive/50',
        new: 'border-transparent bg-card text-emerald ring-1 ring-inset ring-emerald/45',
        jackpot:
          'border-transparent bg-gradient-to-r from-gold via-destructive to-pink text-white shadow-glow-gold',
        featured:
          'border-transparent bg-gradient-to-r from-primary to-violet text-white shadow-glow-sm',
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

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
