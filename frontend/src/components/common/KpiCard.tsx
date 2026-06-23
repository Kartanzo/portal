import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, useId, useCallback } from 'react';

// Card/KPI padrão do portal. Use em todas as páginas (exceto Visão Geral e Dashboard RH).
export type KpiColor = 'blue' | 'indigo' | 'emerald' | 'orange' | 'red' | 'amber' | 'slate';

const TONES: Record<KpiColor, { icon: string; bar: string }> = {
  blue: { icon: 'bg-blue-100 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300', bar: 'from-blue-500 to-blue-600' },
  indigo: { icon: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-950/50 dark:text-indigo-300', bar: 'from-indigo-500 to-indigo-600' },
  emerald: { icon: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300', bar: 'from-emerald-500 to-emerald-600' },
  orange: { icon: 'bg-orange-100 text-orange-600 dark:bg-orange-950/50 dark:text-orange-300', bar: 'from-orange-500 to-orange-600' },
  red: { icon: 'bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-300', bar: 'from-red-500 to-red-600' },
  amber: { icon: 'bg-amber-100 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300', bar: 'from-amber-500 to-amber-600' },
  slate: { icon: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300', bar: 'from-slate-500 to-slate-600' },
};

const BASE_PX = 24; // tamanho máximo (≈ text-2xl)
const FLOOR_PX = 12; // piso de legibilidade

// Contexto de grupo: coordena UMA fonte única (a menor que cabe entre todos os cards do grid).
interface KpiGroup { report: (id: string, px: number) => void; remove: (id: string) => void; groupPx: number | null; }
const KpiGroupCtx = createContext<KpiGroup | null>(null);

// Envolve um grid de KpiCard para padronizar (uniformizar) o tamanho da fonte do valor.
// Uso: <KpiGrid className="grid grid-cols-... gap-...">...<KpiCard/>...</KpiGrid>
export const KpiGrid: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => {
  const [sizes, setSizes] = useState<Record<string, number>>({});
  const report = useCallback((id: string, px: number) => {
    setSizes(prev => (prev[id] === px ? prev : { ...prev, [id]: px }));
  }, []);
  const remove = useCallback((id: string) => {
    setSizes(prev => { if (!(id in prev)) return prev; const n = { ...prev }; delete n[id]; return n; });
  }, []);
  const arr = Object.values(sizes);
  const groupPx = arr.length ? Math.min(...arr) : null;
  const ctx = useMemo<KpiGroup>(() => ({ report, remove, groupPx }), [report, remove, groupPx]);
  return (
    <KpiGroupCtx.Provider value={ctx}>
      <div className={className}>{children}</div>
    </KpiGroupCtx.Provider>
  );
};

interface KpiCardProps {
  label: string;
  value: React.ReactNode;
  Icon?: React.ComponentType<{ className?: string }>;
  color?: KpiColor;
  sub?: React.ReactNode;
  onClick?: () => void;
  className?: string;
  action?: React.ReactNode; // ação no canto superior direito (ex.: botão "detalhar")
  trend?: React.ReactNode;  // badge ao lado do valor (ex.: tendência)
}

const KpiCard: React.FC<KpiCardProps> = ({ label, value, Icon, color = 'blue', sub, onClick, className, action, trend }) => {
  const t = TONES[color];
  const id = useId();
  const group = useContext(KpiGroupCtx);
  const valueRef = useRef<HTMLDivElement>(null);
  const [ownPx, setOwnPx] = useState<number>(BASE_PX);

  // Mede o texto na fonte base e calcula o maior tamanho que cabe (compacta de verdade).
  useLayoutEffect(() => {
    const el = valueRef.current;
    if (!el) return;
    const measure = () => {
      el.style.fontSize = `${BASE_PX}px`;
      const avail = el.clientWidth;
      const natural = el.scrollWidth;
      let fit = BASE_PX;
      if (natural > avail && avail > 0) fit = Math.max(FLOOR_PX, Math.floor((BASE_PX * avail) / natural));
      setOwnPx(fit);
      group?.report(id, fit);
      // aplica o tamanho do grupo (se houver) já neste frame para evitar flicker
      el.style.fontSize = `${group?.groupPx ?? fit}px`;
    };
    measure();
    const target = el.parentElement || el;
    const ro = new ResizeObserver(measure);
    ro.observe(target);
    return () => { ro.disconnect(); group?.remove(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, group, id]);

  // Aplica o tamanho uniforme do grupo quando ele muda (sem re-medir).
  const displayPx = group?.groupPx ?? ownPx;
  useEffect(() => {
    const el = valueRef.current;
    if (el) el.style.fontSize = `${displayPx}px`;
  }, [displayPx]);

  return (
    <div
      onClick={onClick}
      className={`relative overflow-hidden bg-white dark:bg-slate-800/90 rounded-2xl shadow-sm ring-1 ring-slate-200/70 dark:ring-slate-700 p-4 flex items-center gap-3 ${onClick ? 'cursor-pointer hover:ring-blue-300 transition-colors' : ''} ${className || ''}`}
    >
      <div className={`absolute left-0 top-0 bottom-0 w-1.5 bg-gradient-to-b ${t.bar}`} />
      {Icon && <div className={`grid place-items-center w-12 h-12 rounded-xl shrink-0 ${t.icon}`}><Icon className="w-6 h-6" /></div>}
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 truncate">{label}</div>
        <div className="flex items-baseline gap-2 min-w-0">
          <div
            ref={valueRef}
            style={{ fontSize: `${displayPx}px` }}
            className="flex-1 min-w-0 overflow-hidden font-bold text-slate-800 dark:text-slate-100 tabular-nums leading-tight whitespace-nowrap"
          >{value}</div>
          {trend && <div className="shrink-0">{trend}</div>}
        </div>
        {sub && <div className="text-[11px] text-slate-400 truncate">{sub}</div>}
      </div>
      {action && <div className="shrink-0 self-start">{action}</div>}
    </div>
  );
};

export default KpiCard;
