import React from 'react';
import { cn } from '../../lib/cn';

interface FieldBoxProps extends React.HTMLAttributes<HTMLDivElement> {
  label: string;
  value?: React.ReactNode;
}

/**
 * Caixinha cinza com label uppercase + valor.
 * Usado em telas de detalhe (SAC, Importacao). Substitui a duplicacao de classes.
 */
export const FieldBox: React.FC<FieldBoxProps> = ({ label, value, className, children, ...rest }) => (
  <div
    className={cn(
      'bg-slate-50 dark:bg-slate-900/40',
      'border border-slate-200 dark:border-slate-700',
      'rounded-lg px-3 py-2',
      className
    )}
    {...rest}
  >
    <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 block mb-0.5">
      {label}
    </span>
    <span className="text-sm font-medium text-slate-800 dark:text-slate-100 break-words block">
      {value ?? children ?? '—'}
    </span>
  </div>
);

export default FieldBox;
