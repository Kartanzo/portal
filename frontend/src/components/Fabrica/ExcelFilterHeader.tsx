import React, { useState, useMemo, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronUp, ChevronDown, ChevronsUpDown, Filter, Search, X } from 'lucide-react';
import { SortState } from '../../hooks/useTablePrefs';

/**
 * Cabeçalho de coluna estilo Excel:
 *  - clique no label: ordena (asc → desc → off)
 *  - clique no funil: abre dropdown com valores distintos + checkbox
 *  - busca dentro do dropdown refina SÓ a lista do dropdown (não a tabela)
 *  - "Selecionar todos" / "Limpar"
 *  - alça de redimensionamento à direita do <th>
 *
 * Convenção do filtro:
 *  - selected === null ou selected.size === values.length → sem filtro (passa tudo)
 *  - selected.size < values.length → só passa os valores no set
 */
export interface ExcelFilterHeaderProps {
  label: string;
  col: string;
  sort: SortState;
  onSort: (c: string) => void;
  onResize: (c: string, w: number) => void;
  align?: 'left' | 'right';
  /** Valores distintos disponíveis na coluna (já calculado pelo pai). */
  values: string[];
  /** Selecionados ativos. null = todos. */
  selected: Set<string> | null;
  /** Pai recebe o novo set. null = limpar filtro (todos). */
  onFilterChange: (s: Set<string> | null) => void;
}

type OperadorCriterio = 'contem' | 'comeca' | 'termina' | 'igual' | 'nao_contem';

const OPERADOR_LABELS: Record<OperadorCriterio, string> = {
  contem: 'Contém',
  comeca: 'Começa com',
  termina: 'Termina com',
  igual: 'Igual a',
  nao_contem: 'Não contém',
};

export const ExcelFilterHeader: React.FC<ExcelFilterHeaderProps> = ({
  label, col, sort, onSort, onResize, align = 'left',
  values, selected, onFilterChange,
}) => {
  const active = sort.key === col;
  const filterActive = selected !== null && selected.size < values.length;
  const [open, setOpen] = useState(false);
  const [busca, setBusca] = useState('');
  const [operador, setOperador] = useState<OperadorCriterio>('comeca');
  const [criterio, setCriterio] = useState('');
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [draft, setDraft] = useState<Set<string>>(() => new Set(selected ?? values));
  const btnRef = useRef<HTMLButtonElement | null>(null);

  // Quando abre, sincroniza draft com selected atual
  useEffect(() => {
    if (!open) return;
    setDraft(new Set(selected ?? values));
    setBusca('');
    setCriterio('');
  }, [open, selected, values]);

  // Posiciona dropdown abaixo do botão (portal)
  useEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const dropdownW = 280;
    let left = r.left;
    if (left + dropdownW > window.innerWidth - 8) left = window.innerWidth - dropdownW - 8;
    setPos({ top: r.bottom + 4, left: Math.max(8, left) });
  }, [open]);

  // Fecha ao clicar fora / Esc
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const startResize = (e: React.MouseEvent<HTMLSpanElement>) => {
    e.preventDefault(); e.stopPropagation();
    const thEl = (e.currentTarget.parentElement as HTMLElement);
    const startX = e.clientX;
    const startW = thEl?.offsetWidth ?? 120;
    const move = (ev: MouseEvent) => onResize(col, startW + (ev.clientX - startX));
    const up = () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up);
  };

  const valoresFiltrados = useMemo(() => {
    if (!busca.trim()) return values;
    const t = busca.trim().toUpperCase();
    return values.filter(v => String(v).toUpperCase().includes(t));
  }, [busca, values]);

  const aplicarCriterio = (modo: 'substitui' | 'soma' | 'remove') => {
    const t = criterio.trim().toUpperCase();
    if (!t) return;
    const matches = new Set<string>();
    values.forEach(v => {
      const vu = String(v).toUpperCase();
      let ok = false;
      switch (operador) {
        case 'contem':     ok = vu.includes(t); break;
        case 'comeca':     ok = vu.startsWith(t); break;
        case 'termina':    ok = vu.endsWith(t); break;
        case 'igual':      ok = vu === t; break;
        case 'nao_contem': ok = !vu.includes(t); break;
      }
      if (ok) matches.add(v);
    });
    setDraft(prev => {
      if (modo === 'substitui') return matches;
      const n = new Set(prev);
      if (modo === 'soma') matches.forEach(v => n.add(v));
      else matches.forEach(v => n.delete(v));
      return n;
    });
  };

  const todosMarcadosNoDropdown = valoresFiltrados.length > 0 && valoresFiltrados.every(v => draft.has(v));
  const toggleAllDropdown = () => {
    setDraft(prev => {
      const next = new Set(prev);
      if (todosMarcadosNoDropdown) valoresFiltrados.forEach(v => next.delete(v));
      else valoresFiltrados.forEach(v => next.add(v));
      return next;
    });
  };

  const toggle = (v: string) => setDraft(prev => {
    const n = new Set(prev);
    n.has(v) ? n.delete(v) : n.add(v);
    return n;
  });

  const aplicar = () => {
    if (draft.size === values.length) onFilterChange(null);
    else onFilterChange(new Set(draft));
    setOpen(false);
  };

  const limpar = () => {
    onFilterChange(null);
    setOpen(false);
  };

  return (
    <th className="relative select-none px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap">
      <div className={`inline-flex items-center gap-1 ${align === 'right' ? 'flex-row-reverse w-full justify-start' : ''}`}>
        <button onClick={() => onSort(col)} className="inline-flex items-center gap-1 hover:text-slate-700 dark:hover:text-slate-200">
          <span>{label}</span>
          {active ? (sort.dir === 'asc' ? <ChevronUp className="w-3.5 h-3.5 text-blue-600" /> : <ChevronDown className="w-3.5 h-3.5 text-blue-600" />)
            : <ChevronsUpDown className="w-3.5 h-3.5 opacity-30" />}
        </button>
        <button
          ref={btnRef}
          onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
          title={filterActive ? `Filtro ativo (${selected!.size} de ${values.length})` : 'Filtrar'}
          className={`p-0.5 rounded hover:bg-slate-200 dark:hover:bg-slate-600 ${filterActive ? 'text-blue-600' : 'text-slate-400'}`}
        >
          <Filter className={`w-3.5 h-3.5 ${filterActive ? 'fill-blue-600' : ''}`} />
        </button>
      </div>
      <span onMouseDown={startResize} className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400/60" title="Arraste para redimensionar" />

      {open && pos && createPortal(
        <>
          <div className="fixed inset-0 z-[1100]" onClick={() => setOpen(false)} />
          <div
            className="fixed z-[1101] w-[320px] bg-white dark:bg-slate-800 rounded-xl shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700 p-3"
            style={{ top: pos.top, left: pos.left }}
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-600 dark:text-slate-300 uppercase tracking-wide">Filtrar {label}</span>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
            </div>

            {/* Filtro por critério (Excel-style: começa com / termina com / contém / igual a / não contém) */}
            <div className="mb-3 p-2 rounded-lg bg-slate-50 dark:bg-slate-900/40 ring-1 ring-slate-100 dark:ring-slate-700">
              <label className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-1.5 block">Critério</label>
              <div className="flex gap-1.5 mb-1.5">
                <select
                  value={operador}
                  onChange={e => setOperador(e.target.value as OperadorCriterio)}
                  className="px-2 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
                >
                  {(Object.keys(OPERADOR_LABELS) as OperadorCriterio[]).map(op => (
                    <option key={op} value={op}>{OPERADOR_LABELS[op]}</option>
                  ))}
                </select>
                <input
                  autoFocus
                  value={criterio}
                  onChange={e => setCriterio(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') aplicarCriterio('substitui'); }}
                  placeholder="ex.: 104002"
                  className="flex-1 px-2 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
                />
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => aplicarCriterio('substitui')}
                  disabled={!criterio.trim()}
                  title="Marca apenas os valores que casam (substitui seleção)"
                  className="flex-1 px-2 py-1 text-[11px] font-medium rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Aplicar
                </button>
                <button
                  onClick={() => aplicarCriterio('soma')}
                  disabled={!criterio.trim()}
                  title="Adiciona à seleção atual"
                  className="px-2 py-1 text-[11px] font-medium rounded-md text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  + Somar
                </button>
                <button
                  onClick={() => aplicarCriterio('remove')}
                  disabled={!criterio.trim()}
                  title="Remove os que casam da seleção"
                  className="px-2 py-1 text-[11px] font-medium rounded-md text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  − Tirar
                </button>
              </div>
            </div>

            <label className="text-[10px] uppercase tracking-wide font-semibold text-slate-500 mb-1 block">Valores</label>
            <div className="relative mb-2">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
              <input
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar na lista abaixo…"
                className="w-full pl-8 pr-2 py-1.5 text-sm rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/60"
              />
            </div>
            <label className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer border-b border-slate-100 dark:border-slate-700 mb-1">
              <input type="checkbox" checked={todosMarcadosNoDropdown} onChange={toggleAllDropdown} />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {todosMarcadosNoDropdown ? 'Desmarcar todos' : 'Selecionar todos'}
                {busca && <span className="text-xs text-slate-400 ml-1">({valoresFiltrados.length})</span>}
              </span>
            </label>
            <div className="max-h-[240px] overflow-auto pr-1">
              {valoresFiltrados.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-3">Nenhum valor.</p>
              ) : valoresFiltrados.map(v => (
                <label key={v} className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700/40 cursor-pointer">
                  <input type="checkbox" checked={draft.has(v)} onChange={() => toggle(v)} />
                  <span className="text-sm text-slate-700 dark:text-slate-200 truncate" title={v}>
                    {v === '' ? <em className="text-slate-400">(vazio)</em> : v}
                  </span>
                </label>
              ))}
            </div>
            <div className="flex items-center justify-between gap-2 mt-3 pt-2 border-t border-slate-100 dark:border-slate-700">
              <button onClick={limpar} className="text-xs text-slate-500 hover:text-slate-700 dark:hover:text-slate-200">Limpar filtro</button>
              <div className="flex gap-2">
                <button onClick={() => setOpen(false)} className="px-3 py-1.5 text-sm rounded-md text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700">Cancelar</button>
                <button onClick={aplicar} className="px-3 py-1.5 text-sm rounded-md bg-blue-600 text-white hover:bg-blue-700">Aplicar</button>
              </div>
            </div>
          </div>
        </>,
        document.body
      )}
    </th>
  );
};

/**
 * Aplica os filtros (Record<col, Set<string>>) sobre as linhas.
 * accessor retorna o valor "human-readable" da célula para filtrar.
 * Para colunas que são arrays (ex: máquinas), accessor pode retornar string[] e o filtro
 * passa se QUALQUER valor da célula está no set selecionado (OR dentro da célula).
 */
export function applyFilters<T>(
  rows: T[],
  filters: Record<string, Set<string>>,
  accessor: (row: T, key: string) => string | string[]
): T[] {
  const cols = Object.keys(filters).filter(k => filters[k] && filters[k].size > 0);
  if (cols.length === 0) return rows;
  return rows.filter(row => cols.every(k => {
    const val = accessor(row, k);
    const sel = filters[k];
    if (Array.isArray(val)) {
      if (val.length === 0) return sel.has('');
      return val.some(v => sel.has(String(v)));
    }
    return sel.has(String(val ?? ''));
  }));
}

/**
 * Calcula valores distintos de uma coluna a partir das linhas + accessor.
 * Para arrays, "flattens" — cada item vira valor.
 * Sempre ordena alfanumericamente (pt, numeric).
 */
export function distinctValues<T>(
  rows: T[],
  key: string,
  accessor: (row: T, key: string) => string | string[]
): string[] {
  const set = new Set<string>();
  rows.forEach(r => {
    const v = accessor(r, key);
    if (Array.isArray(v)) {
      if (v.length === 0) set.add('');
      else v.forEach(x => set.add(String(x ?? '')));
    } else {
      set.add(String(v ?? ''));
    }
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, 'pt', { numeric: true, sensitivity: 'base' }));
}
