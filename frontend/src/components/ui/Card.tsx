import React from 'react';
import { cn } from '../../lib/cn';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  noPadding?: boolean;
}

/**
 * Card padrao do portal — fundo branco/slate-800, borda, rounded-xl, sombra sutil.
 * Padding default: p-3 (mobile) -> sm:p-4 (desktop). Use noPadding pra zerar.
 */
export const Card: React.FC<CardProps> = ({ className, noPadding = false, children, ...rest }) => (
  <div
    className={cn(
      'bg-white dark:bg-slate-800',
      'border border-slate-200 dark:border-slate-700',
      'rounded-xl shadow-sm',
      !noPadding && 'p-3 sm:p-4',
      className
    )}
    {...rest}
  >
    {children}
  </div>
);

export default Card;
