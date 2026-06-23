// DARK_MODE_TEST — delete this file to revert dark mode
import { useState } from 'react';

function applyDark(next: boolean) {
  next
    ? document.documentElement.classList.add('dark')
    : document.documentElement.classList.remove('dark');
  localStorage.setItem('blackd_dark_mode', String(next));
}

export function useDarkMode() {
  // Lê localStorage na inicialização — classe já aplicada pelo script em index.html
  const [isDark, setIsDark] = useState(() => {
    return localStorage.getItem('blackd_dark_mode') === 'true';
  });

  const toggle = (x?: number, y?: number) => {
    const next = !isDark;
    const startTransition = (document as any).startViewTransition;

    if (!startTransition) {
      applyDark(next);
      setIsDark(next);
      return;
    }

    const cx = x ?? window.innerWidth / 2;
    const cy = y ?? window.innerHeight / 2;
    document.documentElement.style.setProperty('--vt-x', `${cx}px`);
    document.documentElement.style.setProperty('--vt-y', `${cy}px`);

    // Aplica a classe ANTES da transição capturar o estado novo (sem flushSync)
    // Isso evita re-render forçado do React que destruía estado de formulários
    startTransition.call(document, () => {
      applyDark(next);
    });

    // Atualiza estado React APÓS a transição (não força re-render síncrono)
    setIsDark(next);
  };

  return { isDark, toggle };
}
