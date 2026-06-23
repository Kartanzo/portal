import React from 'react';
import { cn } from '../../lib/cn';

interface SectionTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {
  as?: 'h2' | 'h3' | 'h4';
}

/**
 * Titulo de secao: uppercase, tracking-widest, slate-400 — padrao visual do portal.
 */
export const SectionTitle: React.FC<SectionTitleProps> = ({ as = 'h3', className, children, ...rest }) => {
  const Tag = as;
  return (
    <Tag
      className={cn(
        'text-[10px] font-black uppercase tracking-widest text-slate-400 mb-3',
        className
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
};

export default SectionTitle;
