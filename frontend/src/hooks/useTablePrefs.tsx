import React, { useState, useCallback, useEffect } from 'react';
import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react';

// Ordenação + redimensionamento de colunas, persistido por usuário no localStorage.
export type SortDir = 'asc' | 'desc';
export interface SortState { key: string | null; dir: SortDir; }
export interface TablePrefs { widths: Record<string, number>; sort: SortState; }

function userKey(): string {
  try { const s = sessionStorage.getItem('blackd_user'); if (s) return String(JSON.parse(s)?.id ?? 'anon'); } catch { /* noop */ }
  return 'anon';
}

export function useTablePrefs(tableId: string, defaultWidths: Record<string, number> = {}) {
  const storageKey = `tablePrefs:${userKey()}:${tableId}`;
  const [prefs, setPrefs] = useState<TablePrefs>(() => {
    try { const raw = localStorage.getItem(storageKey); if (raw) return JSON.parse(raw); } catch { /* noop */ }
    return { widths: { ...defaultWidths }, sort: { key: null, dir: 'asc' } };
  });
  useEffect(() => { try { localStorage.setItem(storageKey, JSON.stringify(prefs)); } catch { /* noop */ } }, [storageKey, prefs]);

  const setWidth = useCallback((key: string, w: number) => {
    setPrefs(p => ({ ...p, widths: { ...p.widths, [key]: Math.max(60, Math.round(w)) } }));
  }, []);
  const toggleSort = useCallback((key: string) => {
    setPrefs(p => {
      if (p.sort.key !== key) return { ...p, sort: { key, dir: 'asc' } };
      if (p.sort.dir === 'asc') return { ...p, sort: { key, dir: 'desc' } };
      return { ...p, sort: { key: null, dir: 'asc' } };
    });
  }, []);
  return { prefs, setWidth, toggleSort };
}

export function sortRows<T>(rows: T[], sort: SortState, accessor: (row: T, key: string) => any): T[] {
  if (!sort.key) return rows;
  const k = sort.key, mul = sort.dir === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const va = accessor(a, k), vb = accessor(b, k);
    if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * mul;
    return String(va ?? '').localeCompare(String(vb ?? ''), 'pt', { numeric: true, sensitivity: 'base' }) * mul;
  });
}

// Cabeçalho clicável (ordena) com alça de redimensionamento.
export const SortHeader: React.FC<{
  label: string; col: string; sort: SortState; onSort: (c: string) => void;
  onResize: (c: string, w: number) => void; align?: 'left' | 'right';
}> = ({ label, col, sort, onSort, onResize, align = 'left' }) => {
  const active = sort.key === col;
  const startResize = (e: React.MouseEvent<HTMLSpanElement>) => {
    e.preventDefault(); e.stopPropagation();
    const thEl = (e.currentTarget.parentElement as HTMLElement);
    const startX = e.clientX;
    const startW = thEl?.offsetWidth ?? 120;
    const move = (ev: MouseEvent) => onResize(col, startW + (ev.clientX - startX));
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };
  return (
    <th className="relative select-none px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap">
      <button onClick={() => onSort(col)} className={`inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200 ${align === 'right' ? 'flex-row-reverse w-full justify-start' : ''}`}>
        <span>{label}</span>
        {active ? (sort.dir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-blue-600" /> : <ChevronDown className="w-3.5 h-3.5 text-blue-600" />)
          : <ChevronsUpDown className="w-3.5 h-3.5 opacity-30" />}
      </button>
      <span onMouseDown={startResize} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400/60" title="Arraste para redimensionar" />
    </th>
  );
};
