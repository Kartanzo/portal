import React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/cn';

const buttonVariants = cva(
  // Base: touch-friendly (min 44px no mobile, recomendacao Apple HIG)
  'inline-flex items-center justify-center gap-2 font-bold transition-all rounded-lg ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 ' +
  'disabled:opacity-50 disabled:pointer-events-none ' +
  'whitespace-nowrap select-none',
  {
    variants: {
      variant: {
        primary:
          'bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white shadow-sm ' +
          'focus-visible:ring-indigo-500',
        secondary:
          'bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 ' +
          'text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 ' +
          'focus-visible:ring-slate-400',
        ghost:
          'bg-transparent text-slate-700 dark:text-slate-200 ' +
          'hover:bg-slate-100 dark:hover:bg-slate-700 ' +
          'focus-visible:ring-slate-400',
        danger:
          'bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white shadow-sm ' +
          'focus-visible:ring-rose-500',
        success:
          'bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-sm ' +
          'focus-visible:ring-emerald-500',
        whatsapp:
          'bg-green-600 hover:bg-green-700 active:bg-green-800 text-white border border-green-500 shadow-sm ' +
          'focus-visible:ring-green-500',
      },
      size: {
        sm: 'min-h-[36px] px-3 text-xs',
        md: 'min-h-[44px] px-4 text-sm',  // default — atende touch-target de 44px
        lg: 'min-h-[48px] px-5 text-base',
        icon: 'min-h-[44px] w-11 p-0',     // botao quadrado so com icone
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, children, ...rest }, ref) => (
    <button
      ref={ref}
      className={cn(buttonVariants({ variant, size }), className)}
      {...rest}
    >
      {children}
    </button>
  )
);
Button.displayName = 'Button';

export default Button;
