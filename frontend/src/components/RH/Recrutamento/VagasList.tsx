import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ClipboardList, Search, Plus, X, Save, Eye, Calendar, Users as UsersIcon } from 'lucide-react';
import { api } from '../../../app_api';
import { useToast } from '../../../contexts/ToastContext';
import VoltarDashboardRH from '../_shared/VoltarDashboardRH';
import ChipsPorSetor from '../_shared/ChipsPorSetor';
import RhPageBg from '../_shared/RhPageBg';

interface Vaga {
    id: number;
    titulo: string;
    setor?: string;
    tipo?: string;
    n_posicoes?: number;
    status?: string;
    data_abertura?: string;
    prazo?: string;
    n_candidatos?: number;
}

const STATUS_COR: Record<string, string> = {
    aberta: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    em_entrevistas: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    fechada: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
    cancelada: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};
const STATUS_LABELS: Record<string, string> = {
    aberta: 'Aberta',
    em_entrevistas: 'Em entrevistas',
    fechada: 'Fechada',
    cancelada: 'Cancelada',
};

const fmtDate = (s?: string) => {
    if (!s) return '—';
    try { return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR'); } catch { return s; }
};

const diasDesde = (s?: string) => {
    if (!s) return '';
    try {
        const d = new Date(s + 'T00:00:00');
        const dif = Math.floor((Date.now() - d.getTime()) / 86400000);
        return `${dif}d`;
    } catch { return ''; }
};

const VagasList: React.FC = () => {
    const toast = useToast();
    const [vagas, setVagas] = useState<Vaga[]>([]);
    const [loading, setLoading] = useState(false);
    const [busca, setBusca] = useState('');
    const [filtroStatus, setFiltroStatus] = useState('aberta');
    const [filtroSetor, setFiltroSetor] = useState('');

    const [modalOpen, setModalOpen] = useState(false);
    const [form, setForm] = useState<any>({ status: 'aberta', n_posicoes: 1, data_abertura: new Date().toISOString().slice(0, 10) });
    const [salvando, setSalvando] = useState(false);

    const carregar = async () => {
        setLoading(true);
        try {
            const r = await api.rhVagasListar({ search: busca, status: filtroStatus });
            setVagas(r.vagas || []);
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao carregar', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { carregar(); }, []);
    useEffect(() => { const t = setTimeout(carregar, 300); return () => clearTimeout(t); }, [busca, filtroStatus]);

    const abrirNovo = () => {
        setForm({ status: 'aberta', n_posicoes: 1, tipo: 'CLT', data_abertura: new Date().toISOString().slice(0, 10) });
        setModalOpen(true);
    };

    const salvar = async () => {
        if (!form.titulo || !form.titulo.trim()) {
            toast.showToast('Título é obrigatório', 'error');
            return;
        }
        setSalvando(true);
        try {
            const payload: any = {};
            Object.entries(form).forEach(([k, v]) => { payload[k] = v === '' ? null : v; });
            await api.rhVagaCriar(payload);
            toast.showToast('Vaga criada', 'success');
            setModalOpen(false);
            carregar();
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao salvar', 'error');
        } finally {
            setSalvando(false);
        }
    };

    return (
        <RhPageBg tema="rose">
                <header className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg shadow-rose-500/30">
                            <ClipboardList className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black bg-gradient-to-r from-rose-600 to-pink-600 dark:from-rose-400 dark:to-pink-400 bg-clip-text text-transparent">
                                Recrutamento · Vagas
                            </h1>
                            <p className="text-xs text-slate-500 mt-0.5">{vagas.length} vaga{vagas.length === 1 ? '' : 's'} no resultado</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <VoltarDashboardRH />
                        <button onClick={abrirNovo} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 shadow shadow-rose-500/30">
                            <Plus className="w-4 h-4" /> Nova Vaga
                        </button>
                    </div>
                </header>

                <ChipsPorSetor items={vagas} setorKey="setor" value={filtroSetor} onChange={setFiltroSetor} />
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 flex flex-wrap gap-2 items-center">
                    <div className="relative flex-1 min-w-[200px]">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                        <input
                            value={busca}
                            onChange={(e) => setBusca(e.target.value)}
                            placeholder="Buscar título, setor, descrição…"
                            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                        />
                    </div>
                    <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900">
                        <option value="">Status (todos)</option>
                        <option value="aberta">Aberta</option>
                        <option value="em_entrevistas">Em entrevistas</option>
                        <option value="fechada">Fechada</option>
                        <option value="cancelada">Cancelada</option>
                    </select>
                </div>

                {loading ? (
                    <div className="p-8 text-center text-slate-500 text-sm">Carregando…</div>
                ) : vagas.length === 0 ? (
                    <div className="p-10 text-center text-slate-400 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                        <ClipboardList className="w-10 h-10 mx-auto mb-2 opacity-40" />
                        <p className="text-sm">Nenhuma vaga encontrada</p>
                    </div>
                ) : (
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {vagas.filter(v => !filtroSetor || (v.setor || 'Sem setor') === filtroSetor).map((v) => (
                            <Link key={v.id} to={`/rh/recrutamento/${v.id}`}
                                className="block bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 hover:shadow-lg hover:border-rose-300 dark:hover:border-rose-700 transition">
                                <div className="flex items-start justify-between gap-2 mb-2">
                                    <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COR[v.status || 'aberta']}`}>
                                        {STATUS_LABELS[v.status || 'aberta']}
                                    </span>
                                    {v.tipo && <span className="text-[10px] text-slate-400">{v.tipo}</span>}
                                </div>
                                <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">{v.titulo}</h3>
                                <p className="text-xs text-slate-500 mt-0.5">{v.setor || '—'}</p>
                                <div className="mt-2 text-[11px] text-slate-500 space-y-0.5">
                                    <p><Calendar className="w-3 h-3 inline mr-1" /> Aberta {diasDesde(v.data_abertura)} atrás · {fmtDate(v.data_abertura)}</p>
                                    {v.prazo && <p>Prazo: <strong>{fmtDate(v.prazo)}</strong></p>}
                                    <p><UsersIcon className="w-3 h-3 inline mr-1" /> {v.n_candidatos || 0} candidato{(v.n_candidatos || 0) === 1 ? '' : 's'} · {v.n_posicoes || 1} vaga{(v.n_posicoes || 1) === 1 ? '' : 's'}</p>
                                </div>
                                <div className="mt-2 inline-flex items-center gap-1 text-[11px] text-rose-600 dark:text-rose-300 font-bold">
                                    <Eye className="w-3 h-3" /> Ver detalhes
                                </div>
                            </Link>
                        ))}
                    </div>
                )}

            {modalOpen && (
                <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-20 pb-4 px-4 overflow-y-auto" onClick={() => !salvando && setModalOpen(false)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                            <h3 className="font-bold text-slate-800 dark:text-slate-100">Nova vaga</h3>
                            <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
                            <I label="Título *" value={form.titulo || ''} onChange={(v) => setForm({ ...form, titulo: v })} />
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <I label="Setor" value={form.setor || ''} onChange={(v) => setForm({ ...form, setor: v })} />
                                <S label="Tipo" value={form.tipo || ''} onChange={(v) => setForm({ ...form, tipo: v })} options={['CLT', 'PJ', 'Temporario', 'Estagiario']} />
                                <I label="Nº de posições" type="number" value={form.n_posicoes ?? 1} onChange={(v) => setForm({ ...form, n_posicoes: parseInt(v || '1', 10) })} />
                                <I label="Jornada" placeholder="44h semanais" value={form.jornada || ''} onChange={(v) => setForm({ ...form, jornada: v })} />
                                <I label="Local de trabalho" value={form.local_trabalho || ''} onChange={(v) => setForm({ ...form, local_trabalho: v })} />
                                <S label="Status" value={form.status || 'aberta'} onChange={(v) => setForm({ ...form, status: v })} options={['aberta', 'em_entrevistas', 'fechada', 'cancelada']} />
                                <I label="Salário mín. (R$)" type="number" step="0.01" value={form.salario_min ?? ''} onChange={(v) => setForm({ ...form, salario_min: v === '' ? null : parseFloat(v) })} />
                                <I label="Salário máx. (R$)" type="number" step="0.01" value={form.salario_max ?? ''} onChange={(v) => setForm({ ...form, salario_max: v === '' ? null : parseFloat(v) })} />
                                <I label="Data de abertura" type="date" value={form.data_abertura || ''} onChange={(v) => setForm({ ...form, data_abertura: v })} />
                                <I label="Prazo" type="date" value={form.prazo || ''} onChange={(v) => setForm({ ...form, prazo: v })} />
                            </div>
                            <label className="block">
                                <span className="text-[10px] text-slate-500 font-semibold">Descrição</span>
                                <textarea value={form.descricao || ''} onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                                    rows={3} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
                            </label>
                            <label className="block">
                                <span className="text-[10px] text-slate-500 font-semibold">Requisitos</span>
                                <textarea value={form.requisitos || ''} onChange={(e) => setForm({ ...form, requisitos: e.target.value })}
                                    rows={3} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
                            </label>
                        </div>
                        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                            <button onClick={() => setModalOpen(false)} disabled={salvando} className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">Cancelar</button>
                            <button onClick={salvar} disabled={salvando} className="inline-flex items-center gap-1 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg disabled:opacity-50">
                                <Save className="w-3.5 h-3.5" /> {salvando ? 'Salvando…' : 'Salvar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </RhPageBg>
    );
};

const I: React.FC<{ label: string; value: any; onChange: (v: string) => void; type?: string; step?: string; placeholder?: string }> = ({ label, value, onChange, type = 'text', step, placeholder }) => (
    <label className="block">
        <span className="text-[10px] text-slate-500 font-semibold">{label}</span>
        <input type={type} step={step} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
            className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
    </label>
);
const S: React.FC<{ label: string; value: string; onChange: (v: string) => void; options: string[] }> = ({ label, value, onChange, options }) => (
    <label className="block">
        <span className="text-[10px] text-slate-500 font-semibold">{label}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)}
            className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs">
            <option value="">—</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
    </label>
);

export default VagasList;
