import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Clock, Calendar, Plus, X, Save, Check, Pencil, Trash2, AlertTriangle } from 'lucide-react';
import { api } from '../../../app_api';
import { useToast } from '../../../contexts/ToastContext';
import VoltarDashboardRH from '../_shared/VoltarDashboardRH';
import ChipsPorSetor from '../_shared/ChipsPorSetor';
import CalendarioFerias from './CalendarioFerias';
import RhPageBg from '../_shared/RhPageBg';
import KpiCard, { KpiGrid } from '../../common/KpiCard';

const STATUS_LABEL: Record<string, string> = {
    pendente: 'Pendente',
    aprovado: 'Aprovado',
    rejeitado: 'Rejeitado',
};
const STATUS_COR: Record<string, string> = {
    pendente: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    aprovado: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    rejeitado: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const fmtDate = (s?: string) => {
    if (!s) return '—';
    try { return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR'); } catch { return s; }
};
const fmtHoras = (h?: number | null) => h == null ? '—' : `${h.toString().padStart(2, '0')}h`;

type Tab = 'bh' | 'ferias';

const JornadaPage: React.FC = () => {
    const [searchParams] = useSearchParams();
    const openParam = searchParams.get('open');
    const initialTab: Tab = openParam?.startsWith('fer:') ? 'ferias' : 'bh';
    const [aba, setAba] = useState<Tab>(initialTab);
    return (
        <RhPageBg tema="rose">
                <header className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg shadow-rose-500/30">
                            <Clock className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black bg-gradient-to-r from-rose-600 to-pink-600 dark:from-rose-400 dark:to-pink-400 bg-clip-text text-transparent">
                                Jornada
                            </h1>
                            <p className="text-xs text-slate-500 mt-0.5">Banco de Horas (F 101.00) e Férias</p>
                        </div>
                    </div>
                    <VoltarDashboardRH />
                </header>

                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="border-b border-slate-200 dark:border-slate-700 flex text-xs">
                        {([
                            { k: 'bh', l: 'Banco de Horas', icon: Clock },
                            { k: 'ferias', l: 'Férias', icon: Calendar },
                        ] as { k: Tab; l: string; icon: any }[]).map((t) => {
                            const Ic = t.icon;
                            const active = aba === t.k;
                            return (
                                <button key={t.k} onClick={() => setAba(t.k)}
                                    className={`px-4 py-2 inline-flex items-center gap-1.5 border-b-2 transition ${active ? 'border-rose-600 text-rose-600 dark:text-rose-300 font-bold' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                                    <Ic className="w-3.5 h-3.5" /> {t.l}
                                </button>
                            );
                        })}
                    </div>
                    <div className="p-4">{aba === 'bh' ? <AbaBH /> : <AbaFerias />}</div>
                </div>
            </RhPageBg>
    );
};

// ============ ABA BH ============

const AbaBH: React.FC = () => {
    const toast = useToast();
    const [searchParams, setSearchParams] = useSearchParams();
    const [itens, setItens] = useState<any[]>([]);
    const [colabs, setColabs] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [mes, setMes] = useState(new Date().toISOString().slice(0, 7));
    const [filtroColab, setFiltroColab] = useState('');
    const [filtroStatus, setFiltroStatus] = useState('');
    const [filtroTipo, setFiltroTipo] = useState('');
    const [filtroSetor, setFiltroSetor] = useState('');

    const [modalOpen, setModalOpen] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState<any>({});
    const [salvando, setSalvando] = useState(false);

    const carregar = async () => {
        setLoading(true);
        try {
            const params: any = {};
            if (mes) params.mes = mes;
            if (filtroColab) params.colaborador_id = parseInt(filtroColab, 10);
            if (filtroStatus) params.status = filtroStatus;
            if (filtroTipo) params.tipo = filtroTipo;
            const r = await api.rhBHListar(params);
            setItens(r.itens || []);
        } catch (e: any) {
            toast.showToast(e.message || 'Erro', 'error');
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { (async () => { try { setColabs((await api.rhColaboradoresListar()).colaboradores || []); } catch {} })(); carregar(); }, []);
    useEffect(() => { const t = setTimeout(carregar, 200); return () => clearTimeout(t); }, [mes, filtroColab, filtroStatus, filtroTipo]);

    // Detecta ?open=bh:<id> e abre modal de edição
    useEffect(() => {
        const open = searchParams.get('open');
        if (!open || !open.startsWith('bh:')) return;
        const id = parseInt(open.slice(3), 10);
        if (!id) return;
        (async () => {
            try {
                // Garante que a lista do mês contem o item; senão busca via filtros amplos
                const r = await api.rhBHListar({});
                const i = (r.itens || []).find((x: any) => x.id === id);
                if (i) {
                    setEditId(i.id); setForm({ ...i }); setModalOpen(true);
                }
            } catch {}
            const sp = new URLSearchParams(searchParams);
            sp.delete('open');
            setSearchParams(sp, { replace: true });
        })();
    }, []);

    const totais = useMemo(() => {
        let pos = 0, neg = 0, extra = 0;
        itens.filter(i => i.status === 'aprovado').forEach((i) => {
            const h = parseFloat(i.horas) || 0;
            if (i.tipo === 'bh+') pos += h;
            else if (i.tipo === 'bh-') neg += h;
            else if (i.tipo === 'extra') extra += h;
        });
        return { pos, neg, extra };
    }, [itens]);

    const abrirNovo = () => {
        setEditId(null);
        setForm({ tipo: 'extra', status: 'pendente', data: new Date().toISOString().slice(0, 10) });
        setModalOpen(true);
    };
    const abrirEditar = (i: any) => { setEditId(i.id); setForm({ ...i }); setModalOpen(true); };
    const salvar = async () => {
        if (!form.colaborador_id || !form.data || !form.horas || !form.tipo) {
            toast.showToast('Colaborador, data, horas e tipo são obrigatórios', 'error');
            return;
        }
        setSalvando(true);
        try {
            const payload: any = {};
            ['colaborador_id', 'data', 'horas', 'tipo', 'motivo', 'status', 'observacoes', 'solicitante_id'].forEach((k) => { payload[k] = form[k] === '' ? null : form[k]; });
            payload.horas = parseFloat(payload.horas);
            if (editId) {
                await api.rhBHAtualizar(editId, payload);
            } else {
                await api.rhBHCriar(payload);
            }
            toast.showToast('Salvo', 'success');
            setModalOpen(false);
            carregar();
        } catch (e: any) {
            toast.showToast(e.message || 'Erro', 'error');
        } finally {
            setSalvando(false);
        }
    };
    const aprovar = async (i: any) => { try { await api.rhBHAprovar(i.id); toast.showToast('Aprovado', 'success'); carregar(); } catch (e: any) { toast.showToast(e.message, 'error'); } };
    const rejeitar = async (i: any) => { try { await api.rhBHRejeitar(i.id); toast.showToast('Rejeitado', 'success'); carregar(); } catch (e: any) { toast.showToast(e.message, 'error'); } };
    const remover = async (i: any) => { if (!confirm('Remover este registro?')) return; try { await api.rhBHRemover(i.id); carregar(); } catch (e: any) { toast.showToast(e.message, 'error'); } };

    return (
        <>
            <div className="mb-2"><ChipsPorSetor items={itens} setorKey="colaborador_setor" value={filtroSetor} onChange={setFiltroSetor} /></div>
            <KpiGrid className="grid sm:grid-cols-3 gap-2 mb-3">
                <KpiCard label="BH Positivo (aprovado)" value={`+${totais.pos.toFixed(1)}h`} color="emerald" />
                <KpiCard label="BH Negativo (aprovado)" value={`-${totais.neg.toFixed(1)}h`} color="amber" />
                <KpiCard label="Hora Extra (aprovado)" value={`${totais.extra.toFixed(1)}h`} color="blue" />
            </KpiGrid>

            <div className="flex flex-wrap gap-2 items-center mb-3">
                <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                <select value={filtroColab} onChange={(e) => setFiltroColab(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900">
                    <option value="">Colaborador (todos)</option>
                    {colabs.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
                <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900">
                    <option value="">Tipo (todos)</option>
                    <option value="extra">Hora Extra</option>
                    <option value="bh+">BH Positivo</option>
                    <option value="bh-">BH Negativo</option>
                </select>
                <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900">
                    <option value="">Status (todos)</option>
                    {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <button onClick={abrirNovo} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 ml-auto">
                    <Plus className="w-3.5 h-3.5" /> Nova autorização
                </button>
            </div>

            {loading ? <p className="p-6 text-center text-sm text-slate-500">Carregando…</p> : itens.length === 0 ? (
                <div className="p-10 text-center text-slate-400"><Clock className="w-10 h-10 mx-auto mb-2 opacity-40" /><p className="text-sm">Nenhum registro no período</p></div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-900/40 text-slate-500 uppercase text-[10px]">
                            <tr>
                                <th className="px-3 py-2 text-left">Colaborador</th>
                                <th className="px-3 py-2 text-left">Data</th>
                                <th className="px-3 py-2 text-right">Horas</th>
                                <th className="px-3 py-2 text-left">Tipo</th>
                                <th className="px-3 py-2 text-left">Motivo</th>
                                <th className="px-3 py-2 text-center">Status</th>
                                <th className="px-3 py-2 text-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                            {itens.filter(i => !filtroSetor || (i.colaborador_setor || 'Sem setor') === filtroSetor).map((i) => (
                                <tr key={i.id} className="hover:bg-rose-50/40 dark:hover:bg-rose-900/10">
                                    <td className="px-3 py-2 font-bold">{i.colaborador_nome || '—'}</td>
                                    <td className="px-3 py-2">{fmtDate(i.data)}</td>
                                    <td className="px-3 py-2 text-right font-mono">{i.horas?.toFixed(1)}h</td>
                                    <td className="px-3 py-2">{i.tipo}</td>
                                    <td className="px-3 py-2 truncate max-w-[200px]">{i.motivo || '—'}</td>
                                    <td className="px-3 py-2 text-center">
                                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COR[i.status]}`}>{STATUS_LABEL[i.status]}</span>
                                    </td>
                                    <td className="px-3 py-2 text-right whitespace-nowrap">
                                        {i.status === 'pendente' && (
                                            <>
                                                <button onClick={() => aprovar(i)} className="text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 p-1 rounded" title="Aprovar"><Check className="w-3.5 h-3.5" /></button>
                                                <button onClick={() => rejeitar(i)} className="text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 p-1 rounded" title="Rejeitar"><X className="w-3.5 h-3.5" /></button>
                                            </>
                                        )}
                                        <button onClick={() => abrirEditar(i)} className="text-slate-400 hover:text-rose-600 p-1" title="Editar"><Pencil className="w-3.5 h-3.5" /></button>
                                        <button onClick={() => remover(i)} className="text-slate-400 hover:text-red-600 p-1" title="Remover"><Trash2 className="w-3.5 h-3.5" /></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {modalOpen && (
                <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-20 pb-4 px-4 overflow-y-auto" onClick={() => !salvando && setModalOpen(false)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                            <h3 className="font-bold">{editId ? 'Editar registro' : 'Nova autorização BH/Extra'}</h3>
                            <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="p-4 space-y-2 text-xs">
                            <label className="block">
                                <span className="text-[10px] text-slate-500 font-semibold">Colaborador *</span>
                                <select value={form.colaborador_id || ''} onChange={(e) => setForm({ ...form, colaborador_id: e.target.value ? parseInt(e.target.value, 10) : null })}
                                    className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs">
                                    <option value="">— Selecione —</option>
                                    {colabs.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                                </select>
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <I label="Data *" type="date" value={form.data || ''} onChange={(v) => setForm({ ...form, data: v })} />
                                <I label="Horas *" type="number" step="0.5" value={form.horas ?? ''} onChange={(v) => setForm({ ...form, horas: v })} placeholder="2.5" />
                                <S label="Tipo *" value={form.tipo || ''} onChange={(v) => setForm({ ...form, tipo: v })} options={[{ v: 'extra', l: 'Hora Extra' }, { v: 'bh+', l: 'BH Positivo' }, { v: 'bh-', l: 'BH Negativo' }]} />
                                <S label="Status" value={form.status || 'pendente'} onChange={(v) => setForm({ ...form, status: v })} options={Object.entries(STATUS_LABEL).map(([v, l]) => ({ v, l }))} />
                            </div>
                            <label className="block">
                                <span className="text-[10px] text-slate-500 font-semibold">Motivo</span>
                                <textarea value={form.motivo || ''} onChange={(e) => setForm({ ...form, motivo: e.target.value })}
                                    rows={2} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
                            </label>
                        </div>
                        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                            <button onClick={() => setModalOpen(false)} disabled={salvando} className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">Cancelar</button>
                            <button onClick={salvar} disabled={salvando} className="inline-flex items-center gap-1 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg disabled:opacity-50">
                                <Save className="w-3.5 h-3.5" /> {salvando ? '…' : 'Salvar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

// ============ ABA FÉRIAS ============

const AbaFerias: React.FC = () => {
    const toast = useToast();
    const [searchParams, setSearchParams] = useSearchParams();
    const [itens, setItens] = useState<any[]>([]);
    const [colabs, setColabs] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [ano, setAno] = useState<number>(new Date().getFullYear());
    const [filtroColab, setFiltroColab] = useState('');
    const [filtroStatus, setFiltroStatus] = useState('');
    const [filtroSetor, setFiltroSetor] = useState('');
    const [vista, setVista] = useState<'lista' | 'calendario'>('lista');

    const [modalOpen, setModalOpen] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState<any>({});
    const [salvando, setSalvando] = useState(false);

    const carregar = async () => {
        setLoading(true);
        try {
            const params: any = { ano };
            if (filtroColab) params.colaborador_id = parseInt(filtroColab, 10);
            if (filtroStatus) params.status = filtroStatus;
            const r = await api.rhFeriasListar(params);
            setItens(r.ferias || []);
        } catch (e: any) {
            toast.showToast(e.message || 'Erro', 'error');
        } finally { setLoading(false); }
    };
    useEffect(() => { (async () => { try { setColabs((await api.rhColaboradoresListar()).colaboradores || []); } catch {} })(); carregar(); }, []);
    useEffect(() => { const t = setTimeout(carregar, 200); return () => clearTimeout(t); }, [ano, filtroColab, filtroStatus]);

    // Detecta ?open=fer:<id> e abre modal
    useEffect(() => {
        const open = searchParams.get('open');
        if (!open || !open.startsWith('fer:')) return;
        const id = parseInt(open.slice(4), 10);
        if (!id) return;
        (async () => {
            try {
                const r = await api.rhFeriasListar({});
                const f = (r.ferias || []).find((x: any) => x.id === id);
                if (f) { setEditId(f.id); setForm({ ...f }); setModalOpen(true); }
            } catch {}
            const sp = new URLSearchParams(searchParams);
            sp.delete('open');
            setSearchParams(sp, { replace: true });
        })();
    }, []);

    const abrirNovo = () => { setEditId(null); setForm({ status: 'pendente' }); setModalOpen(true); };
    const abrirEditar = (f: any) => { setEditId(f.id); setForm({ ...f }); setModalOpen(true); };
    const salvar = async () => {
        if (!form.colaborador_id || !form.data_inicio || !form.data_fim) {
            toast.showToast('Colaborador, data início e fim são obrigatórios', 'error');
            return;
        }
        setSalvando(true);
        try {
            const payload: any = {};
            ['colaborador_id', 'data_inicio', 'data_fim', 'dias', 'periodo_aquisitivo_inicio', 'periodo_aquisitivo_fim', 'status', 'abono_pecuniario', 'abono_dias', 'adiantamento_13', 'observacoes'].forEach((k) => { payload[k] = form[k] === '' ? null : form[k]; });
            if (editId) await api.rhFeriasAtualizar(editId, payload);
            else await api.rhFeriasCriar(payload);
            toast.showToast('Salvo', 'success');
            setModalOpen(false);
            carregar();
        } catch (e: any) { toast.showToast(e.message || 'Erro', 'error'); } finally { setSalvando(false); }
    };
    const aprovar = async (f: any) => { try { await api.rhFeriasAprovar(f.id); toast.showToast('Aprovado', 'success'); carregar(); } catch (e: any) { toast.showToast(e.message, 'error'); } };
    const rejeitar = async (f: any) => { try { await api.rhFeriasRejeitar(f.id); toast.showToast('Rejeitado', 'success'); carregar(); } catch (e: any) { toast.showToast(e.message, 'error'); } };
    const remover = async (f: any) => { if (!confirm('Remover essas férias?')) return; try { await api.rhFeriasRemover(f.id); carregar(); } catch (e: any) { toast.showToast(e.message, 'error'); } };

    return (
        <>
            <div className="mb-2"><ChipsPorSetor items={itens} setorKey="colaborador_setor" value={filtroSetor} onChange={setFiltroSetor} /></div>
            <div className="flex flex-wrap gap-2 items-center mb-3">
                <input type="number" value={ano} onChange={(e) => setAno(parseInt(e.target.value || '2026', 10))} className="text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 w-20" />
                <select value={filtroColab} onChange={(e) => setFiltroColab(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900">
                    <option value="">Colaborador (todos)</option>
                    {colabs.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
                <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900">
                    <option value="">Status (todos)</option>
                    {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <div className="ml-auto inline-flex bg-slate-100 dark:bg-slate-700 rounded-lg p-0.5">
                    <button onClick={() => setVista('lista')} className={`px-2.5 py-1 text-[11px] font-bold rounded ${vista === 'lista' ? 'bg-white dark:bg-slate-800 shadow' : 'text-slate-500'}`}>Lista</button>
                    <button onClick={() => setVista('calendario')} className={`px-2.5 py-1 text-[11px] font-bold rounded ${vista === 'calendario' ? 'bg-white dark:bg-slate-800 shadow' : 'text-slate-500'}`}>Calendário</button>
                </div>
                <button onClick={abrirNovo} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700">
                    <Plus className="w-3.5 h-3.5" /> Nova solicitação
                </button>
            </div>

            {vista === 'calendario' ? (
                <CalendarioFerias itens={itens.filter(f => !filtroSetor || (f.colaborador_setor || 'Sem setor') === filtroSetor)} />
            ) : loading ? <p className="p-6 text-center text-sm text-slate-500">Carregando…</p> : itens.length === 0 ? (
                <div className="p-10 text-center text-slate-400"><Calendar className="w-10 h-10 mx-auto mb-2 opacity-40" /><p className="text-sm">Nenhuma solicitação</p></div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-900/40 text-slate-500 uppercase text-[10px]">
                            <tr>
                                <th className="px-3 py-2 text-left">Colaborador</th>
                                <th className="px-3 py-2 text-left">Início</th>
                                <th className="px-3 py-2 text-left">Fim</th>
                                <th className="px-3 py-2 text-right">Dias</th>
                                <th className="px-3 py-2 text-center">Abono</th>
                                <th className="px-3 py-2 text-center">13º adiant.</th>
                                <th className="px-3 py-2 text-center">Status</th>
                                <th className="px-3 py-2 text-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                            {itens.filter(f => !filtroSetor || (f.colaborador_setor || 'Sem setor') === filtroSetor).map((f) => (
                                <tr key={f.id} className="hover:bg-rose-50/40 dark:hover:bg-rose-900/10">
                                    <td className="px-3 py-2 font-bold">{f.colaborador_nome || '—'}</td>
                                    <td className="px-3 py-2">{fmtDate(f.data_inicio)}</td>
                                    <td className="px-3 py-2">{fmtDate(f.data_fim)}</td>
                                    <td className="px-3 py-2 text-right">{f.dias || '—'}</td>
                                    <td className="px-3 py-2 text-center">{f.abono_pecuniario ? `${f.abono_dias || '?'}d` : '—'}</td>
                                    <td className="px-3 py-2 text-center">{f.adiantamento_13 ? '✓' : '—'}</td>
                                    <td className="px-3 py-2 text-center">
                                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COR[f.status]}`}>{STATUS_LABEL[f.status]}</span>
                                    </td>
                                    <td className="px-3 py-2 text-right whitespace-nowrap">
                                        {f.status === 'pendente' && (
                                            <>
                                                <button onClick={() => aprovar(f)} className="text-emerald-600 hover:bg-emerald-50 p-1 rounded" title="Aprovar"><Check className="w-3.5 h-3.5" /></button>
                                                <button onClick={() => rejeitar(f)} className="text-red-600 hover:bg-red-50 p-1 rounded" title="Rejeitar"><X className="w-3.5 h-3.5" /></button>
                                            </>
                                        )}
                                        <button onClick={() => abrirEditar(f)} className="text-slate-400 hover:text-rose-600 p-1" title="Editar"><Pencil className="w-3.5 h-3.5" /></button>
                                        <button onClick={() => remover(f)} className="text-slate-400 hover:text-red-600 p-1" title="Remover"><Trash2 className="w-3.5 h-3.5" /></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {modalOpen && (
                <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-20 pb-4 px-4 overflow-y-auto" onClick={() => !salvando && setModalOpen(false)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                            <h3 className="font-bold">{editId ? 'Editar férias' : 'Nova solicitação de férias'}</h3>
                            <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="p-4 space-y-2 text-xs">
                            <label className="block">
                                <span className="text-[10px] text-slate-500 font-semibold">Colaborador *</span>
                                <select value={form.colaborador_id || ''} onChange={(e) => setForm({ ...form, colaborador_id: e.target.value ? parseInt(e.target.value, 10) : null })}
                                    className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs">
                                    <option value="">— Selecione —</option>
                                    {colabs.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                                </select>
                            </label>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <I label="Data início *" type="date" value={form.data_inicio || ''} onChange={(v) => setForm({ ...form, data_inicio: v })} />
                                <I label="Data fim *" type="date" value={form.data_fim || ''} onChange={(v) => setForm({ ...form, data_fim: v })} />
                                <I label="Aquisitivo início" type="date" value={form.periodo_aquisitivo_inicio || ''} onChange={(v) => setForm({ ...form, periodo_aquisitivo_inicio: v })} />
                                <I label="Aquisitivo fim" type="date" value={form.periodo_aquisitivo_fim || ''} onChange={(v) => setForm({ ...form, periodo_aquisitivo_fim: v })} />
                            </div>
                            <label className="flex items-center gap-2">
                                <input type="checkbox" checked={!!form.abono_pecuniario} onChange={(e) => setForm({ ...form, abono_pecuniario: e.target.checked })} />
                                <span>Abono pecuniário (1/3)</span>
                            </label>
                            {form.abono_pecuniario && (
                                <I label="Dias de abono" type="number" value={form.abono_dias ?? ''} onChange={(v) => setForm({ ...form, abono_dias: v ? parseInt(v, 10) : null })} />
                            )}
                            <label className="flex items-center gap-2">
                                <input type="checkbox" checked={!!form.adiantamento_13} onChange={(e) => setForm({ ...form, adiantamento_13: e.target.checked })} />
                                <span>Adiantamento de 13º</span>
                            </label>
                            <S label="Status" value={form.status || 'pendente'} onChange={(v) => setForm({ ...form, status: v })} options={Object.entries(STATUS_LABEL).map(([v, l]) => ({ v, l }))} />
                            <label className="block">
                                <span className="text-[10px] text-slate-500 font-semibold">Observações</span>
                                <textarea value={form.observacoes || ''} onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                                    rows={2} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
                            </label>
                        </div>
                        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                            <button onClick={() => setModalOpen(false)} disabled={salvando} className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">Cancelar</button>
                            <button onClick={salvar} disabled={salvando} className="inline-flex items-center gap-1 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg disabled:opacity-50">
                                <Save className="w-3.5 h-3.5" /> {salvando ? '…' : 'Salvar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

const I: React.FC<{ label: string; value: any; onChange: (v: string) => void; type?: string; step?: string; placeholder?: string }> = ({ label, value, onChange, type = 'text', step, placeholder }) => (
    <label className="block">
        <span className="text-[10px] text-slate-500 font-semibold">{label}</span>
        <input type={type} step={step} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
            className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
    </label>
);
const S: React.FC<{ label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }> = ({ label, value, onChange, options }) => (
    <label className="block">
        <span className="text-[10px] text-slate-500 font-semibold">{label}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)}
            className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs">
            {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
    </label>
);

export default JornadaPage;
