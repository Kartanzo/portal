import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, ChevronRight, ChevronLeft, ChevronDown, ChevronUp, Clock, Calendar, UserPlus, UserMinus, X } from 'lucide-react';
import { api } from '../../../app_api';
import { hasRhPermission } from '../_shared/rhAuth';

type Pendencia = {
    tipo: 'bh' | 'ferias' | 'mov';
    sub_tipo?: string;
    id: number;
    tema: string;
    quem: string;
    quando: string;
    resumo: string;
    rota: string;
};

const fmtRelative = (s?: string) => {
    if (!s) return '';
    try {
        const d = new Date(s);
        const dif = Math.floor((Date.now() - d.getTime()) / 60000);
        if (dif < 60) return `${dif}m atrás`;
        if (dif < 1440) return `${Math.floor(dif / 60)}h atrás`;
        return `${Math.floor(dif / 1440)}d atrás`;
    } catch { return ''; }
};
const fmtDate = (s?: string) => {
    if (!s) return '';
    try { return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR'); } catch { return s; }
};

type Categoria = 'admissao' | 'desligamento' | 'bh' | 'ferias';

const AvisosDrawer: React.FC = () => {
    const nav = useNavigate();
    const [aberto, setAberto] = useState(true);
    const [pendencias, setPendencias] = useState<Pendencia[]>([]);
    const [loading, setLoading] = useState(false);
    const [expandido, setExpandido] = useState<Record<Categoria, boolean>>({
        admissao: false, desligamento: false, bh: false, ferias: false,
    });

    const carregar = async () => {
        setLoading(true);
        try {
            const [bh, fer, mov] = await Promise.all([
                hasRhPermission('rh_jornada') ? api.rhBHListar({ status: 'pendente' }).catch(() => ({ itens: [] })) : Promise.resolve({ itens: [] }),
                hasRhPermission('rh_jornada') ? api.rhFeriasListar({ status: 'pendente' }).catch(() => ({ ferias: [] })) : Promise.resolve({ ferias: [] }),
                hasRhPermission('rh_movimentacoes') ? api.rhMovListar({ status: 'pendente' }).catch(() => ({ movimentacoes: [] })) : Promise.resolve({ movimentacoes: [] }),
            ]);
            const lista: Pendencia[] = [];
            (bh.itens || []).forEach((i: any) => {
                lista.push({
                    tipo: 'bh', id: i.id,
                    tema: `Banco de Horas · ${i.tipo === 'extra' ? 'Hora Extra' : i.tipo === 'bh+' ? 'BH Positivo' : 'BH Negativo'}`,
                    quem: i.colaborador_nome || '—',
                    quando: i.created_at,
                    resumo: `${i.horas?.toFixed(1)}h em ${fmtDate(i.data)} — ${i.motivo || 'sem motivo'}`,
                    rota: `/rh/jornada?open=bh:${i.id}`,
                });
            });
            (fer.ferias || []).forEach((f: any) => {
                lista.push({
                    tipo: 'ferias', id: f.id,
                    tema: 'Férias',
                    quem: f.colaborador_nome || '—',
                    quando: f.created_at,
                    resumo: `${f.dias || '?'} dias · ${fmtDate(f.data_inicio)} → ${fmtDate(f.data_fim)}`,
                    rota: `/rh/jornada?open=fer:${f.id}`,
                });
            });
            (mov.movimentacoes || []).forEach((m: any) => {
                lista.push({
                    tipo: 'mov', id: m.id, sub_tipo: m.tipo,
                    tema: m.tipo === 'admissao' ? 'Requisição de Contratação' : 'Requisição de Desligamento',
                    quem: m.titulo || m.colaborador_nome || '—',
                    quando: m.created_at,
                    resumo: `${m.cargo || '—'} · ${m.setor || '—'} · urgência ${m.urgencia || 'normal'}`,
                    rota: `/rh/movimentacoes?open=${m.id}`,
                });
            });
            lista.sort((a, b) => (b.quando || '').localeCompare(a.quando || ''));
            setPendencias(lista);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { carregar(); }, []);

    const total = pendencias.length;
    const irPara = (p: Pendencia) => {
        if (p.tipo === 'mov' && !hasRhPermission('rh_movimentacoes')) return;
        if ((p.tipo === 'bh' || p.tipo === 'ferias') && !hasRhPermission('rh_jornada')) return;
        nav(p.rota);
    };

    const grupos: { key: Categoria; titulo: string; icon: any; cor: string; itens: Pendencia[] }[] = [
        {
            key: 'admissao', titulo: 'Requisição de Contratação', icon: UserPlus, cor: 'emerald',
            itens: pendencias.filter(p => p.tipo === 'mov' && p.sub_tipo === 'admissao'),
        },
        {
            key: 'desligamento', titulo: 'Requisição de Desligamento', icon: UserMinus, cor: 'red',
            itens: pendencias.filter(p => p.tipo === 'mov' && p.sub_tipo === 'desligamento'),
        },
        {
            key: 'bh', titulo: 'Banco de Horas', icon: Clock, cor: 'blue',
            itens: pendencias.filter(p => p.tipo === 'bh'),
        },
        {
            key: 'ferias', titulo: 'Férias', icon: Calendar, cor: 'amber',
            itens: pendencias.filter(p => p.tipo === 'ferias'),
        },
    ];
    const corMap: Record<string, { bg: string; text: string; badge: string }> = {
        emerald: { bg: 'bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100', text: 'text-emerald-700 dark:text-emerald-300', badge: 'bg-emerald-600' },
        red: { bg: 'bg-red-50 dark:bg-red-900/20 hover:bg-red-100', text: 'text-red-700 dark:text-red-300', badge: 'bg-red-600' },
        blue: { bg: 'bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100', text: 'text-blue-700 dark:text-blue-300', badge: 'bg-blue-600' },
        amber: { bg: 'bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100', text: 'text-amber-700 dark:text-amber-300', badge: 'bg-amber-600' },
    };

    if (!aberto) {
        return (
            <button onClick={() => setAberto(true)}
                className="fixed right-4 top-24 z-30 bg-rose-600 hover:bg-rose-700 text-white rounded-l-xl rounded-r-xl shadow-lg shadow-rose-500/30 px-2 py-3 flex flex-col items-center gap-1"
                title="Abrir avisos">
                <Bell className="w-4 h-4" />
                {total > 0 && <span className="text-[10px] font-black bg-white text-rose-600 rounded-full px-1.5 min-w-[18px] text-center">{total}</span>}
                <ChevronLeft className="w-3.5 h-3.5" />
            </button>
        );
    }

    return (
        <aside className="w-72 flex-shrink-0">
            <div className="sticky top-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-rose-50 to-pink-50 dark:from-rose-900/20 dark:to-pink-900/20 flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        <Bell className="w-3.5 h-3.5 text-rose-600" />
                        <span className="text-xs font-bold">Avisos · {total}</span>
                    </div>
                    <button onClick={() => setAberto(false)} className="text-slate-400 hover:text-slate-700" title="Recolher">
                        <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                </div>
                <div className="max-h-[70vh] overflow-y-auto">
                    {loading ? <p className="p-4 text-center text-xs text-slate-400">Carregando…</p> :
                        total === 0 ? <p className="p-4 text-center text-xs text-emerald-600">Sem avisos pendentes</p> : (
                            <div className="divide-y divide-slate-100 dark:divide-slate-700">
                                {grupos.map((g) => {
                                    const Ic = g.icon;
                                    const cores = corMap[g.cor];
                                    const open = expandido[g.key];
                                    return (
                                        <div key={g.key}>
                                            <button
                                                onClick={() => setExpandido(s => ({ ...s, [g.key]: !s[g.key] }))}
                                                className={`w-full px-3 py-2 flex items-center gap-2 transition ${cores.bg}`}>
                                                <Ic className={`w-3.5 h-3.5 ${cores.text}`} />
                                                <span className={`text-xs font-bold flex-1 text-left ${cores.text}`}>{g.titulo}</span>
                                                <span className={`text-[10px] font-black text-white ${cores.badge} rounded-full px-1.5 min-w-[20px] text-center`}>{g.itens.length}</span>
                                                {open ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
                                            </button>
                                            {open && (
                                                g.itens.length === 0 ? (
                                                    <p className="px-3 py-2 text-[11px] text-slate-400 italic">Nenhum nesta categoria.</p>
                                                ) : (
                                                    <ul className="divide-y divide-slate-100 dark:divide-slate-700 bg-slate-50/50 dark:bg-slate-900/20">
                                                        {g.itens.map((p) => (
                                                            <li key={`${p.tipo}-${p.id}`}>
                                                                <button onClick={() => irPara(p)}
                                                                    className="w-full p-2.5 text-left hover:bg-white dark:hover:bg-slate-800 transition">
                                                                    <p className="text-[11px] font-bold text-slate-700 dark:text-slate-100">{p.quem}</p>
                                                                    <p className="text-[10px] text-slate-500 truncate" title={p.resumo}>{p.resumo}</p>
                                                                    <p className="text-[10px] text-slate-400 mt-0.5">{fmtRelative(p.quando)}</p>
                                                                </button>
                                                            </li>
                                                        ))}
                                                    </ul>
                                                )
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                </div>
            </div>
        </aside>
    );
};

export default AvisosDrawer;
