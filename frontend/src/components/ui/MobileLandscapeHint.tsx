import React, { useState, useEffect } from 'react';
import { Smartphone } from 'lucide-react';

// Garante que so um banner aparece por pagina (mesmo se varias tabelas tiverem o hint)
let mountedInstances = 0;

/**
 * Banner aparece apenas em telas pequenas (<md) em modo retrato, sugerindo
 * girar pra paisagem (com botao que tenta travar orientacao).
 * Some quando o usuario gira ou em viewports >= md.
 * Apenas o PRIMEIRO instance na pagina renderiza — os demais ficam silenciosos.
 */
export const MobileLandscapeHint: React.FC<{ message?: string }> = ({
  message = 'Esta tabela funciona melhor em paisagem ou no desktop.',
}) => {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [isPrimary, setIsPrimary] = useState(false);

  useEffect(() => {
    // So o primeiro a montar mostra o banner
    if (mountedInstances === 0) {
      setIsPrimary(true);
    }
    mountedInstances += 1;
    return () => {
      mountedInstances = Math.max(0, mountedInstances - 1);
    };
  }, []);

  useEffect(() => {
    if (!isPrimary) return;
    const check = () => {
      if (dismissed) {
        setShow(false);
        return;
      }
      const isMobile = window.innerWidth < 768; // md breakpoint
      const isPortrait = window.innerHeight > window.innerWidth;
      setShow(isMobile && isPortrait);
    };
    check();
    window.addEventListener('resize', check);
    window.addEventListener('orientationchange', check);
    return () => {
      window.removeEventListener('resize', check);
      window.removeEventListener('orientationchange', check);
    };
  }, [dismissed, isPrimary]);

  if (!isPrimary || !show) return null;

  return (
    <div className="md:hidden mb-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-2.5 flex items-start gap-2">
      <Smartphone className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
      <p className="text-xs text-amber-800 dark:text-amber-200 leading-snug flex-1 min-w-0">
        💡 Gire o celular para <strong>paisagem</strong> para visualizar melhor.{' '}
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="font-bold text-amber-700 dark:text-amber-300 hover:underline"
        >
          Ocultar
        </button>
      </p>
    </div>
  );
};

export default MobileLandscapeHint;
