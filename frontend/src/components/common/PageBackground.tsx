import React from 'react';

// Background azul padrão do portal (gradiente + blobs + grade).
// Use em todas as páginas, EXCETO as de RH.
// Uso: <PageBackground><...conteúdo da página...></PageBackground>
const PageBackground: React.FC<{ children: React.ReactNode; maxWidth?: string }> = ({ children, maxWidth = 'max-w-[1400px]' }) => (
  <div className="-m-4 md:-m-6 lg:-m-8 min-h-[calc(100vh-2rem)] relative overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50/60 to-indigo-50 dark:from-slate-900 dark:via-blue-950/40 dark:to-indigo-950/40">
    <div className="pointer-events-none absolute -top-32 -left-32 w-[480px] h-[480px] rounded-full bg-blue-300/40 blur-3xl dark:bg-blue-700/20" />
    <div className="pointer-events-none absolute top-1/3 -right-40 w-[520px] h-[520px] rounded-full bg-indigo-300/40 blur-3xl dark:bg-indigo-700/20" />
    <div className="pointer-events-none absolute bottom-0 left-1/3 w-[480px] h-[480px] rounded-full bg-sky-300/30 blur-3xl dark:bg-sky-800/20" />
    <div className="pointer-events-none absolute inset-0 opacity-[0.04] dark:opacity-[0.08]" style={{ backgroundImage: 'linear-gradient(rgb(30,58,138) 1px, transparent 1px), linear-gradient(90deg, rgb(30,58,138) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
    <div className={`relative p-4 sm:p-6 ${maxWidth} mx-auto`}>{children}</div>
  </div>
);

export default PageBackground;
