import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Combina classes Tailwind condicionalmente e resolve conflitos.
 * Ex: cn('p-2', isActive && 'bg-red-500', 'p-4') → 'bg-red-500 p-4'
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
