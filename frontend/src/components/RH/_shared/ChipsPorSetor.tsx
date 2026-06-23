import React, { useMemo } from 'react';
import { Building2, X } from 'lucide-react';

interface Props {
    items: any[];
    setorKey: string;
    value: string;
    onChange: (setor: string) => void;
    label?: string;
}

// Exibe chips clicáveis com a contagem de itens por setor. O setor selecionado
// fica destacado e quando clicado de novo, limpa o filtro.
const ChipsPorSetor: React.FC<Props> = ({ items, setorKey, value, onChange, label }) => {
    const contagem = useMemo(() => {
        const m: Record<string, number> = {};
        items.forEach((i) => {
            const s = (i[setorKey] || '').toString().trim() || 'Sem setor';
            m[s] = (m[s] || 0) + 1;
        });
        return Object.entries(m).sort((a, b) => b[1] - a[1]);
    }, [items, setorKey]);

    if (contagem.length === 0) return null;

    return (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-2 flex flex-wrap items-center gap-1.5">
            <div className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider text-slate-500 font-bold mr-1">
                <Building2 className="w-3 h-3" /> {label || 'Por setor'}:
            </div>
            {contagem.map(([s, n]) => {
                const ativo = value === s;
                return (
                    <button
                        key={s}
                        onClick={() => onChange(ativo ? '' : s)}
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border transition ${
                            ativo
                                ? 'bg-rose-600 text-white border-rose-600'
                                : 'bg-slate-100 dark:bg-slate-900/40 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-rose-300'
                        }`}>
                        {s}
                        <span className={`inline-block px-1 rounded-full text-[10px] font-black ${ativo ? 'bg-white/20' : 'bg-rose-600 text-white'}`}>{n}</span>
                    </button>
                );
            })}
            {value && (
                <button onClick={() => onChange('')} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20 rounded">
                    <X className="w-3 h-3" /> limpar
                </button>
            )}
        </div>
    );
};

export default ChipsPorSetor;
