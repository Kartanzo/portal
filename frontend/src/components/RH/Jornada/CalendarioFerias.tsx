import React, { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, AlertTriangle, Calendar as CalIcon } from 'lucide-react';

interface Props {
    itens: any[];
}

const STATUS_BG: Record<string, string> = {
    aprovado: 'bg-emerald-500',
    pendente: 'bg-amber-400',
    rejeitado: 'bg-slate-400',
};

const fmtMonthLabel = (d: Date) => d.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
const ymd = (d: Date) => d.toISOString().slice(0, 10);

const CalendarioFerias: React.FC<Props> = ({ itens }) => {
    const hoje = new Date();
    const [mes, setMes] = useState(() => new Date(hoje.getFullYear(), hoje.getMonth(), 1));

    const inicioMes = useMemo(() => new Date(mes.getFullYear(), mes.getMonth(), 1), [mes]);
    const fimMes = useMemo(() => new Date(mes.getFullYear(), mes.getMonth() + 1, 0), [mes]);
    const nDias = daysInMonth(mes.getFullYear(), mes.getMonth());

    // Filtra itens que tocam o mês corrente
    const noMes = useMemo(() => {
        return (itens || []).filter((f) => {
            if (!f.data_inicio || !f.data_fim) return false;
            const ini = new Date(f.data_inicio + 'T00:00:00');
            const fim = new Date(f.data_fim + 'T00:00:00');
            return fim >= inicioMes && ini <= fimMes;
        });
    }, [itens, inicioMes, fimMes]);

    // Agrupa por setor → colaborador
    const grupos = useMemo(() => {
        const m: Record<string, Record<string, any[]>> = {};
        noMes.forEach((f) => {
            const setor = (f.colaborador_setor || 'Sem setor');
            const nome = (f.colaborador_nome || '—');
            if (!m[setor]) m[setor] = {};
            if (!m[setor][nome]) m[setor][nome] = [];
            m[setor][nome].push(f);
        });
        return Object.entries(m).sort(([a], [b]) => a.localeCompare(b));
    }, [noMes]);

    // Para cada dia, calcula quantos no mesmo setor estão de férias (pra alertar conflito)
    const conflitos = useMemo(() => {
        const conta: Record<string, Set<string>> = {}; // chave: setor|dia → set de nomes
        noMes.filter((f) => f.status === 'aprovado').forEach((f) => {
            const ini = new Date(f.data_inicio + 'T00:00:00');
            const fim = new Date(f.data_fim + 'T00:00:00');
            for (let d = new Date(ini); d <= fim; d.setDate(d.getDate() + 1)) {
                if (d < inicioMes || d > fimMes) continue;
                const key = `${f.colaborador_setor || 'Sem setor'}|${d.getDate()}`;
                if (!conta[key]) conta[key] = new Set();
                conta[key].add(f.colaborador_nome || '—');
            }
        });
        const out: Record<string, string[]> = {};
        Object.entries(conta).forEach(([k, set]) => { if (set.size >= 2) out[k] = Array.from(set); });
        return out;
    }, [noMes, inicioMes, fimMes]);

    const totalConflitos = Object.keys(conflitos).length;

    // posição da barra
    const barraStyle = (f: any) => {
        const ini = new Date(f.data_inicio + 'T00:00:00');
        const fim = new Date(f.data_fim + 'T00:00:00');
        const startDay = ini < inicioMes ? 1 : ini.getDate();
        const endDay = fim > fimMes ? nDias : fim.getDate();
        const startPct = ((startDay - 1) / nDias) * 100;
        const widthPct = ((endDay - startDay + 1) / nDias) * 100;
        return { left: `${startPct}%`, width: `${widthPct}%` };
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 px-3 py-2">
                <button onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() - 1, 1))} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded">
                    <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex items-center gap-2">
                    <CalIcon className="w-4 h-4 text-rose-600" />
                    <h3 className="font-bold capitalize">{fmtMonthLabel(mes)}</h3>
                    {totalConflitos > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold">
                            <AlertTriangle className="w-3 h-3" /> {totalConflitos} dia{totalConflitos > 1 ? 's' : ''} com conflito de setor
                        </span>
                    )}
                </div>
                <button onClick={() => setMes(new Date(mes.getFullYear(), mes.getMonth() + 1, 1))} className="p-1 hover:bg-slate-100 dark:hover:bg-slate-700 rounded">
                    <ChevronRight className="w-4 h-4" />
                </button>
            </div>

            <div className="flex flex-wrap gap-2 text-[11px]">
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-emerald-500" /> Aprovada</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-amber-400" /> Pendente</span>
                <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded bg-slate-400" /> Rejeitada</span>
                <span className="inline-flex items-center gap-1 ml-2 text-red-600"><AlertTriangle className="w-3 h-3" /> Vermelho destaca dias com 2+ no mesmo setor</span>
            </div>

            {grupos.length === 0 ? (
                <div className="p-10 text-center text-slate-400 bg-white dark:bg-slate-800 rounded-xl">
                    <CalIcon className="w-10 h-10 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Nenhuma férias nesse mês</p>
                </div>
            ) : (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    {/* Cabeçalho de dias */}
                    <div className="flex border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
                        <div className="w-44 px-2 py-1 text-[10px] uppercase tracking-wider text-slate-500 font-bold border-r border-slate-200 dark:border-slate-700">Colaborador</div>
                        <div className="flex-1 relative">
                            <div className="flex">
                                {Array.from({ length: nDias }, (_, i) => i + 1).map((d) => {
                                    const date = new Date(mes.getFullYear(), mes.getMonth(), d);
                                    const isFimSem = date.getDay() === 0 || date.getDay() === 6;
                                    return (
                                        <div key={d} className={`flex-1 text-center py-1 text-[9px] font-bold border-r border-slate-100 dark:border-slate-700 ${isFimSem ? 'text-slate-400 bg-slate-50/50 dark:bg-slate-900/20' : 'text-slate-600 dark:text-slate-300'}`}>
                                            {d}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {grupos.map(([setor, colabs]) => (
                        <div key={setor}>
                            <div className="px-2 py-1 bg-rose-50 dark:bg-rose-900/20 text-[10px] uppercase tracking-wider font-bold text-rose-700 dark:text-rose-300 flex items-center justify-between">
                                <span>{setor}</span>
                                <span className="text-rose-600">{Object.keys(colabs).length} pessoa{Object.keys(colabs).length > 1 ? 's' : ''}</span>
                            </div>
                            {Object.entries(colabs).map(([nome, periodos]) => {
                                const peds = periodos as any[];
                                const linhaH = 22; // altura de cada barra
                                const totalH = Math.max(32, peds.length * (linhaH + 4) + 4);
                                return (
                                    <div key={nome} className="flex border-b border-slate-100 dark:border-slate-700 hover:bg-rose-50/30 dark:hover:bg-rose-900/10">
                                        <div className="w-44 px-2 py-2 text-xs font-bold text-slate-700 dark:text-slate-200 border-r border-slate-200 dark:border-slate-700 truncate flex items-center" title={nome}>{nome}</div>
                                        <div className="flex-1 relative" style={{ minHeight: totalH }}>
                                            {/* Marca dias com conflito */}
                                            <div className="flex absolute inset-0">
                                                {Array.from({ length: nDias }, (_, i) => i + 1).map((d) => {
                                                    const conflito = conflitos[`${setor}|${d}`];
                                                    const isFimSem = (new Date(mes.getFullYear(), mes.getMonth(), d).getDay() % 6) === 0;
                                                    return (
                                                        <div key={d}
                                                            className={`flex-1 border-r border-slate-100 dark:border-slate-700 ${isFimSem ? 'bg-slate-50/30 dark:bg-slate-900/20' : ''} ${conflito ? 'bg-red-100/60 dark:bg-red-900/30' : ''}`}
                                                            title={conflito ? `⚠️ Conflito: ${conflito.join(', ')}` : ''} />
                                                    );
                                                })}
                                            </div>
                                            {/* Barras de férias — uma por linha dentro da row */}
                                            {peds.map((f, idx) => (
                                                <div key={f.id}
                                                    className={`absolute ${STATUS_BG[f.status] || 'bg-slate-400'} rounded text-white text-[9px] font-bold flex items-center justify-center px-1 overflow-hidden shadow`}
                                                    style={{ ...barraStyle(f), top: 4 + idx * (linhaH + 4), height: linhaH }}
                                                    title={`${f.data_inicio} → ${f.data_fim} · ${f.dias || ''}d · ${f.status}`}>
                                                    {f.dias ? `${f.dias}d` : ''}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default CalendarioFerias;
