import React, { useState, useEffect, useRef } from 'react';
import { Search, X, Loader2 } from 'lucide-react';
import { api } from '../../app_api';

interface Produto {
  codigo: string;
  descricao: string;
}

interface SacProdutoLookupProps {
  value: { codigo: string; descricao: string };
  onChange: (v: { codigo: string; descricao: string }) => void;
  disabled?: boolean;
}

const SacProdutoLookup: React.FC<SacProdutoLookupProps> = ({ value, onChange, disabled }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Produto[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const handleInput = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const resp = await api.get('/sac/produto', { params: { q: val, limit: 15 } });
        const data = (resp as any)?.data ?? resp;
        setResults(Array.isArray(data) ? data : []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setLoading(false);
      }
    }, 500);
  };

  const handleSelect = (p: Produto) => {
    onChange(p);
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  const handleClear = () => {
    onChange({ codigo: '', descricao: '' });
    setQuery('');
  };

  return (
    <div ref={containerRef} className="relative w-full">
      {value.codigo ? (
        <div className="flex items-center gap-2 p-2.5 border border-slate-300 rounded-lg bg-slate-50 text-sm">
          <span className="font-mono font-semibold text-slate-700">{value.codigo}</span>
          <span className="text-slate-500">—</span>
          <span className="text-slate-700 flex-1 truncate">{value.descricao || 'Sem descrição'}</span>
          {!disabled && (
            <button type="button" onClick={handleClear} className="text-slate-400 hover:text-red-500 transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      ) : (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={query}
            onChange={e => handleInput(e.target.value)}
            disabled={disabled}
            placeholder="Buscar por código ou nome do produto..."
            className="w-full pl-9 pr-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent disabled:bg-slate-50 disabled:text-slate-400"
          />
          {loading && (
            <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 animate-spin" />
          )}
        </div>
      )}

      {open && results.length > 0 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
          {results.map(p => (
            <button
              key={p.codigo}
              type="button"
              onClick={() => handleSelect(p)}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-left hover:bg-indigo-50 transition-colors border-b border-slate-100 last:border-0"
            >
              <span className="font-mono font-semibold text-indigo-700 w-20 flex-shrink-0">{p.codigo}</span>
              <span className="text-slate-700 truncate">{p.descricao}</span>
            </button>
          ))}
        </div>
      )}

      {open && !loading && results.length === 0 && query.length >= 2 && (
        <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg px-4 py-3 text-sm text-slate-500">
          Nenhum produto encontrado
        </div>
      )}
    </div>
  );
};

export default SacProdutoLookup;
