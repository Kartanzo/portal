/**
 * Marketing — Setor Marketing
 * Tabs internas. Por enquanto: apenas a aba "Eventos" (gerenciar fotos do álbum).
 */
import React, { useState } from 'react';
import EventosManager from './EventosManager';
import CatalogoManager from './CatalogoManager';

type Aba = 'eventos' | 'catalogo';

const MarketingPage: React.FC = () => {
  const [aba, setAba] = useState<Aba>('eventos');

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Marketing</h1>
        <p className="text-sm text-slate-500 mt-1">Gestão de conteúdo do setor Marketing</p>
      </header>

      <div className="border-b border-slate-200 dark:border-slate-700 mb-6">
        <nav className="flex gap-2" aria-label="Tabs">
          <TabBtn ativo={aba === 'eventos'} onClick={() => setAba('eventos')}>
            Eventos
          </TabBtn>
          <TabBtn ativo={aba === 'catalogo'} onClick={() => setAba('catalogo')}>
            Ficha Técnica
          </TabBtn>
        </nav>
      </div>

      <section>
        {aba === 'eventos' && <EventosManager />}
        {aba === 'catalogo' && <CatalogoManager />}
      </section>
    </div>
  );
};

const TabBtn: React.FC<{ ativo: boolean; onClick: () => void; children: React.ReactNode }> = ({ ativo, onClick, children }) => (
  <button
    onClick={onClick}
    className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
      ativo
        ? 'border-blue-600 text-blue-700 dark:text-blue-300'
        : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
    }`}
  >
    {children}
  </button>
);

export default MarketingPage;
