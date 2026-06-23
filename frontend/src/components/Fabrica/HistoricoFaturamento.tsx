// 18/06: Histórico de Faturamento (Auditoria). Mostra notas STATUS=5/6 do BQ
// no período, com flag "Estava no plano de produção?" cruzando com plano oficial
// vigente na data da NF. Sem filtros do Configurador — só data de NOTA_FISCAL_EMISSAO.
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { History, Calendar, ChevronDown, ChevronRight, Search, FileText, Layers } from 'lucide-react';
import { api } from '../../app_api';
import { useToast } from '../../contexts/ToastContext';

const card = "bg-white dark:bg-slate-800/90 rounded-2xl shadow-sm ring-1 ring-slate-200/70 dark:ring-slate-700";

const fmtMoney = (v: number | null | undefined): string =>
    (v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtInt = (v: number | null | undefined): string => (v ?? 0).toLocaleString('pt-BR');
const fmtData = (s: string | null | undefined): string => {
    if (!s) return '—';
    const d = String(s).slice(0, 10);
    const m = d.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[3]}/${m[2]}/${m[1]}` : d;
};

const inicioMes = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
};
const hojeIso = (): string => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

interface ItemNF { sku: string; descricao: string; qtd: number; valor_item: number; }
interface PedidoHist {
    pedido: string; cliente: string; tipo: string;
    nota_fiscal: string; nf_emissao: string | null;
    emissao_pedido: string | null; entrega: string | null;
    status_pedido: string; valor_total_pedido: number;
    itens: ItemNF[]; estava_no_plano: boolean;
}
interface TotaisHist {
    n_pedidos: number; n_itens: number; valor_total: number;
    n_no_plano: number; n_direto: number;
    valor_no_plano: number; valor_direto: number;
}

const HistoricoFaturamento: React.FC = () => {
    const { showToast } = useToast();
    const [de, setDe] = useState(inicioMes());
    const [ate, setAte] = useState(hojeIso());
    const [loading, setLoading] = useState(false);
    const [data, setData] = useState<{ totais: TotaisHist; pedidos: PedidoHist[] } | null>(null);
    const [busca, setBusca] = useState('');
    const [filtroPlano, setFiltroPlano] = useState<'todos' | 'no_plano' | 'direto'>('todos');
    const [colapsados, setColapsados] = useState<Set<string>>(new Set());

    const carregar = useCallback(async () => {
        setLoading(true);
        try {
            const { data: r } = await api.get('/otimizador-faturamento/historico', { params: { de, ate } });
            setData(r);
        } catch (e: any) {
            showToast(e?.response?.data?.detail || 'Erro ao buscar histórico', 'error');
        } finally { setLoading(false); }
    }, [de, ate]); // eslint-disable-line

    useEffect(() => { carregar(); }, []); // eslint-disable-line

    const filtrado = useMemo(() => {
        if (!data) return [];
        const termo = busca.trim().toLowerCase();
        return data.pedidos.filter(p => {
            if (filtroPlano === 'no_plano' && !p.estava_no_plano) return false;
            if (filtroPlano === 'direto' && p.estava_no_plano) return false;
            if (termo) {
                const txt = `${p.pedido} ${p.cliente} ${p.nota_fiscal} ${p.itens.map(i => i.sku + ' ' + i.descricao).join(' ')}`.toLowerCase();
                if (!txt.includes(termo)) return false;
            }
            return true;
        });
    }, [data, busca, filtroPlano]);

    const toggleColapso = (ped: string) => setColapsados(s => {
        const n = new Set(s); n.has(ped) ? n.delete(ped) : n.add(ped); return n;
    });

    return (
        <div className="space-y-4">
            <div className="flex items-center gap-3 mb-2">
                <div className="grid place-items-center w-12 h-12 rounded-2xl bg-gradient-to-br from-violet-600 to-purple-700 text-white shadow-lg shadow-violet-600/25">
                    <History className="w-6 h-6" />
                </div>
                <div>
                    <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">Histórico de Faturamento</h1>
                    <p className="text-xs text-slate-500">Auditoria: notas faturadas (STATUS 5/6) por data de emissão · cruza com plano de produção vigente</p>
                </div>
            </div>

            {/* Filtros de data */}
            <div className={`${card} p-4 flex flex-wrap items-end gap-3`}>
                <div className="flex flex-col">
                    <label className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">Data emissão NF — de</label>
                    <div className="relative">
                        <Calendar className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input type="date" value={de} onChange={e => setDe(e.target.value)}
                            className="pl-8 pr-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm" />
                    </div>
                </div>
                <div className="flex flex-col">
                    <label className="text-[10px] uppercase tracking-wide text-slate-500 font-semibold mb-1">até</label>
                    <input type="date" value={ate} onChange={e => setAte(e.target.value)}
                        className="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm" />
                </div>
                <button onClick={carregar} disabled={loading}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-violet-600 text-white hover:bg-violet-700 disabled:opacity-50">
                    <FileText className="w-4 h-4" />{loading ? 'Buscando…' : 'Buscar'}
                </button>
            </div>

            {/* KPIs */}
            {data && (
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                    {[
                        ['Notas', data.totais.n_pedidos, 'slate'],
                        ['Itens', data.totais.n_itens, 'indigo'],
                        ['Valor total', fmtMoney(data.totais.valor_total), 'emerald'],
                        ['No plano', `${fmtInt(data.totais.n_no_plano)} · ${fmtMoney(data.totais.valor_no_plano)}`, 'emerald-dark'],
                        ['Direto', `${fmtInt(data.totais.n_direto)} · ${fmtMoney(data.totais.valor_direto)}`, 'sky'],
                    ].map(([l, v]: any, i) => (
                        <div key={i} className={`${card} p-3`}>
                            <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">{l}</div>
                            <div className="text-base font-bold text-slate-800 dark:text-slate-100 tabular-nums mt-0.5 truncate" title={String(v)}>{v}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* Busca + filtro plano */}
            {data && (
                <div className="flex flex-wrap items-center gap-2">
                    <div className="relative flex-1 min-w-[200px]">
                        <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input value={busca} onChange={e => setBusca(e.target.value)}
                            placeholder="Buscar por pedido, cliente, NF, SKU ou descrição…"
                            className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm" />
                    </div>
                    <div className="inline-flex rounded-lg border border-slate-300 dark:border-slate-600 overflow-hidden">
                        {(['todos', 'no_plano', 'direto'] as const).map(v => (
                            <button key={v} onClick={() => setFiltroPlano(v)}
                                className={`px-3 py-1.5 text-xs font-semibold ${filtroPlano === v ? 'bg-violet-600 text-white' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'}`}>
                                {v === 'todos' ? 'Todos' : v === 'no_plano' ? 'No plano' : 'Direto'}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Lista */}
            {data && (
                <div className={`${card} overflow-hidden`}>
                    {loading && <div className="p-8 text-center text-slate-400 text-sm">Carregando…</div>}
                    {!loading && filtrado.length === 0 && <div className="p-8 text-center text-slate-400 text-sm">Sem registros no período.</div>}
                    {!loading && filtrado.length > 0 && (
                        <table className="w-full text-sm">
                            <thead className="bg-slate-50 dark:bg-slate-800/50 text-[10px] uppercase tracking-wide text-slate-500">
                                <tr>
                                    <th className="px-3 py-2 text-left">Pedido / NF / Cliente</th>
                                    <th className="px-3 py-2 text-right">Valor pedido</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtrado.map(p => (
                                    <React.Fragment key={p.pedido}>
                                        <tr className="border-t border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                                            <td className="px-3 py-2 align-top">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    <button onClick={() => toggleColapso(p.pedido)} className="text-slate-400 hover:text-slate-600">
                                                        {colapsados.has(p.pedido) ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                                                    </button>
                                                    <span className="font-bold text-slate-800 dark:text-slate-100">#{p.pedido}</span>
                                                    <span className="text-slate-600 dark:text-slate-300 text-xs">{p.cliente}</span>
                                                    {p.estava_no_plano ? (
                                                        <span title="Pedido estava no plano de produção oficial vigente na data da NF" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-bold"><Layers className="w-2.5 h-2.5" />NO PLANO</span>
                                                    ) : (
                                                        <span title="Faturado sem passar pelo plano de produção (entrou depois ou via estoque direto)" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-800 text-[10px] font-bold">DIRETO</span>
                                                    )}
                                                </div>
                                                <div className="flex items-center gap-3 mt-1 text-[11px] text-slate-500">
                                                    <span>NF <b>{p.nota_fiscal}</b></span>
                                                    <span>· Emissão NF: <b>{fmtData(p.nf_emissao)}</b></span>
                                                    {p.entrega && <span>· Entrega: {fmtData(p.entrega)}</span>}
                                                    {p.tipo && <span>· {p.tipo}</span>}
                                                </div>
                                            </td>
                                            <td className="px-3 py-2 text-right align-top">
                                                <span className="block text-[9px] uppercase text-slate-400">Total NF</span>
                                                <span className="inline-block mt-0.5 px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold text-sm tabular-nums">{fmtMoney(p.valor_total_pedido)}</span>
                                            </td>
                                        </tr>
                                        {!colapsados.has(p.pedido) && p.itens.map((it, j) => (
                                            <tr key={`${p.pedido}-${it.sku}-${j}`} className="bg-slate-50/40 dark:bg-slate-900/20">
                                                <td className="px-3 py-1.5 pl-12">
                                                    <span className="font-mono text-[11px] text-slate-700 dark:text-slate-200">{it.sku}</span>
                                                    <span className="ml-2 text-[11px] text-slate-500">{it.descricao}</span>
                                                    <span className="ml-2 text-[11px] text-slate-400">· qtd <b>{fmtInt(it.qtd)}</b></span>
                                                </td>
                                                <td className="px-3 py-1.5 text-right tabular-nums text-slate-600 dark:text-slate-300">{fmtMoney(it.valor_item)}</td>
                                            </tr>
                                        ))}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
            )}
        </div>
    );
};

export default HistoricoFaturamento;
