import React, { createContext, useContext, useState, useCallback } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
}

type ConfirmFn = (opts: ConfirmOptions | string) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface State extends ConfirmOptions {
  open: boolean;
  resolve?: (value: boolean) => void;
}

export const ConfirmProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<State>({ open: false, message: '' });

  const confirm: ConfirmFn = useCallback((opts) => {
    const options: ConfirmOptions = typeof opts === 'string' ? { message: opts } : opts;
    return new Promise<boolean>((resolve) => {
      setState({ open: true, ...options, resolve });
    });
  }, []);

  const close = useCallback((result: boolean) => {
    setState((s) => {
      s.resolve?.(result);
      return { ...s, open: false, resolve: undefined };
    });
  }, []);

  const variantStyles = {
    danger: { bg: 'bg-rose-100 dark:bg-rose-950/40', icon: 'text-rose-600 dark:text-rose-400', btn: 'bg-rose-600 hover:bg-rose-700 focus-visible:ring-rose-500' },
    warning: { bg: 'bg-amber-100 dark:bg-amber-950/40', icon: 'text-amber-600 dark:text-amber-400', btn: 'bg-amber-600 hover:bg-amber-700 focus-visible:ring-amber-500' },
    info: { bg: 'bg-indigo-100 dark:bg-indigo-950/40', icon: 'text-indigo-600 dark:text-indigo-400', btn: 'bg-indigo-600 hover:bg-indigo-700 focus-visible:ring-indigo-500' },
  };
  const v = variantStyles[state.variant ?? 'danger'];

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <AnimatePresence>
        {state.open && (
          <motion.div
            key="confirm-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm"
            onClick={() => close(false)}
          >
            <motion.div
              key="confirm-dialog"
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 4 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden border border-slate-200 dark:border-slate-700"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-5 sm:p-6">
                <div className="flex items-start gap-4">
                  <div className={`flex-shrink-0 ${v.bg} p-3 rounded-full`}>
                    <AlertTriangle className={`w-6 h-6 ${v.icon}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 mb-1.5">
                      {state.title ?? 'Confirmação'}
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed whitespace-pre-line">
                      {state.message}
                    </p>
                  </div>
                  <button
                    onClick={() => close(false)}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors flex-shrink-0"
                    aria-label="Fechar"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
              <div className="bg-slate-50 dark:bg-slate-900/40 px-5 py-3 flex flex-col-reverse sm:flex-row justify-end gap-2 sm:gap-3 border-t border-slate-200 dark:border-slate-700">
                <button
                  onClick={() => close(false)}
                  className="min-h-[44px] px-4 text-sm font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 transition-colors"
                >
                  {state.cancelText ?? 'Cancelar'}
                </button>
                <button
                  onClick={() => close(true)}
                  autoFocus
                  className={`min-h-[44px] px-4 text-sm font-semibold text-white rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 transition-colors shadow-sm ${v.btn}`}
                >
                  {state.confirmText ?? 'Confirmar'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </ConfirmContext.Provider>
  );
};

/**
 * Hook que retorna uma funcao `confirm()` promise-based.
 *
 * Uso:
 * ```ts
 * const confirm = useConfirm();
 * const ok = await confirm('Tem certeza?');
 * if (!ok) return;
 * // ... acao confirmada
 * ```
 *
 * Ou com opcoes:
 * ```ts
 * const ok = await confirm({
 *   title: 'Excluir chamado',
 *   message: 'Esta acao e irreversivel.',
 *   confirmText: 'Excluir',
 *   variant: 'danger',
 * });
 * ```
 */
export function useConfirm(): ConfirmFn {
  const fn = useContext(ConfirmContext);
  if (!fn) throw new Error('useConfirm precisa de <ConfirmProvider> no App');
  return fn;
}
