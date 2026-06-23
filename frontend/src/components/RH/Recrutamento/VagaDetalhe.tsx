import React, { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Plus, X, Save, Pencil, Trash2, ClipboardList, Lock, Mail, Phone, Calendar } from 'lucide-react';
import { api } from '../../../app_api';
import { useToast } from '../../../contexts/ToastContext';
import VoltarDashboardRH from '../_shared/VoltarDashboardRH';
import RhPageBg from '../_shared/RhPageBg';

interface Candidato {
    id: number;
    vaga_id: number;
    nome: string;
    cpf?: string;
    email?: string;
    telefone?: string;
    cv_url?: string;
    status?: string;
    observacoes?: string;
    entrevista_data?: string;
    parecer?: string;
}

const COLUNAS: { k: string; l: string; cor: string }[] = [
    { k: 'triagem', l: 'Triagem', cor: 'bg-slate-100 dark:bg-slate-700' },
    { k: 'entrevista', l: 'Entrevista', cor: 'bg-amber-50 dark:bg-amber-900/20' },
    { k: 'parecer', l: 'Parecer', cor: 'bg-violet-50 dark:bg-violet-900/20' },
    { k: 'aprovado', l: 'Aprovado', cor: 'bg-emerald-50 dark:bg-emerald-900/20' },
    { k: 'rejeitado', l: 'Rejeitado', cor: 'bg-red-50 dark:bg-red-900/20' },
];

const fmtDate = (s?: string) => {
    if (!s) return '—';
    try { return new Date(s).toLocaleDateString('pt-BR'); } catch { return s; }
};
const fmtMoney = (v?: number | null) =>
    v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const VagaDetalhe: React.FC = () => {
    const { id } = useParams<{ id: string }>();
    const nav = useNavigate();
    const toast = useToast();
    const [vaga, setVaga] = useState<any>(null);
    const [cands, setCands] = useState<Candidato[]>([]);
    const [loading, setLoading] = useState(true);

    const [modalCand, setModalCand] = useState(false);
    const [editCand, setEditCand] = useState<Candidato | null>(null);
    const [form, setForm] = useState<any>({});
    const [salvando, setSalvando] = useState(false);

    const carregar = async () => {
        if (!id) return;
        setLoading(true);
        try {
            const [v, c] = await Promise.all([
                api.rhVagaObter(parseInt(id, 10)),
                api.rhCandidatosListar(parseInt(id, 10)),
            ]);
            setVaga(v);
            setCands(c.candidatos || []);
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao carregar vaga', 'error');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { carregar(); }, [id]);

    const abrirNovoCand = () => {
        setEditCand(null);
        setForm({ vaga_id: parseInt(id || '0', 10), status: 'triagem' });
        setModalCand(true);
    };
    const abrirEditarCand = (c: Candidato) => {
        setEditCand(c);
        setForm({ ...c });
        setModalCand(true);
    };

    const salvarCand = async () => {
        if (!form.nome || !form.nome.trim()) {
            toast.showToast('Nome é obrigatório', 'error');
            return;
        }
        setSalvando(true);
        try {
            const payload: any = {};
            Object.entries(form).forEach(([k, v]) => {
                if (['id', 'created_at', 'updated_at'].includes(k)) return;
                payload[k] = v === '' ? null : v;
            });
            if (editCand) {
                await api.rhCandidatoAtualizar(editCand.id, payload);
                toast.showToast('Candidato atualizado', 'success');
            } else {
                await api.rhCandidatoCriar(payload);
                toast.showToast('Candidato adicionado', 'success');
            }
            setModalCand(false);
            carregar();
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao salvar', 'error');
        } finally {
            setSalvando(false);
        }
    };

    const removerCand = async (c: Candidato) => {
        if (!confirm(`Remover candidato "${c.nome}"?`)) return;
        try {
            await api.rhCandidatoRemover(c.id);
            toast.showToast('Removido', 'success');
            carregar();
        } catch (e: any) {
            toast.showToast(e.message || 'Erro', 'error');
        }
    };

    const moverStatus = async (c: Candidato, novo: string) => {
        try {
            await api.rhCandidatoAtualizar(c.id, { ...c, status: novo });
            carregar();
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao atualizar status', 'error');
        }
    };

    const fecharVaga = async () => {
        const motivo = prompt('Motivo do fechamento (opcional):') || undefined;
        if (motivo === null) return;
        try {
            await api.rhVagaFechar(parseInt(id || '0', 10), motivo);
            toast.showToast('Vaga fechada', 'success');
            carregar();
        } catch (e: any) {
            toast.showToast(e.message || 'Erro', 'error');
        }
    };

    if (loading) return <div className="p-8 text-center text-slate-500 text-sm">Carregando…</div>;
    if (!vaga) {
        return (
            <div className="p-8 text-center">
                <p className="text-slate-500">Vaga não encontrada.</p>
                <Link to="/rh/recrutamento" className="text-rose-600 hover:underline text-sm mt-2 inline-block">← Voltar</Link>
            </div>
        );
    }

    const isFechada = vaga.status === 'fechada' || vaga.status === 'cancelada';

    return (
        <RhPageBg tema="rose">
                <div className="flex items-center gap-2">
                    <button onClick={() => nav('/rh/recrutamento')} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-rose-600">
                        <ArrowLeft className="w-3.5 h-3.5" /> Voltar para vagas
                    </button>
                    <VoltarDashboardRH />
                </div>

                {/* Header */}
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-4 flex items-start gap-4 flex-wrap">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 text-white flex items-center justify-center shadow-lg shadow-rose-500/30">
                        <ClipboardList className="w-6 h-6" />
                    </div>
                    <div className="flex-1 min-w-[200px]">
                        <h1 className="text-xl font-black text-slate-800 dark:text-slate-100">{vaga.titulo}</h1>
                        <p className="text-sm text-slate-500">{vaga.setor || '—'} {vaga.tipo && <>· {vaga.tipo}</>} · {vaga.n_posicoes || 1} posição{(vaga.n_posicoes || 1) === 1 ? '' : 'es'}</p>
                        <div className="mt-1 text-xs text-slate-500 flex flex-wrap gap-3">
                            <span>Aberta em <strong>{fmtDate(vaga.data_abertura)}</strong></span>
                            {vaga.prazo && <span>Prazo <strong>{fmtDate(vaga.prazo)}</strong></span>}
                            {vaga.salario_min != null && <span>{fmtMoney(vaga.salario_min)} – {fmtMoney(vaga.salario_max)}</span>}
                            {vaga.jornada && <span>{vaga.jornada}</span>}
                        </div>
                    </div>
                    {!isFechada && (
                        <button onClick={fecharVaga} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-200 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-700">
                            <Lock className="w-3.5 h-3.5" /> Fechar vaga
                        </button>
                    )}
                </div>

                {(vaga.descricao || vaga.requisitos) && (
                    <div className="grid md:grid-cols-2 gap-3">
                        {vaga.descricao && (
                            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Descrição</p>
                                <p className="text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-200">{vaga.descricao}</p>
                            </div>
                        )}
                        {vaga.requisitos && (
                            <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Requisitos</p>
                                <p className="text-sm whitespace-pre-wrap text-slate-700 dark:text-slate-200">{vaga.requisitos}</p>
                            </div>
                        )}
                    </div>
                )}

                {/* Kanban */}
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3">
                    <div className="flex items-center justify-between mb-3">
                        <h2 className="text-sm font-bold text-slate-700 dark:text-slate-200">Candidatos · {cands.length}</h2>
                        <button onClick={abrirNovoCand} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700">
                            <Plus className="w-3.5 h-3.5" /> Adicionar
                        </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-2">
                        {COLUNAS.map((col) => {
                            const items = cands.filter((c) => (c.status || 'triagem') === col.k);
                            return (
                                <div key={col.k} className={`rounded-lg ${col.cor} p-2 min-h-[180px]`}>
                                    <p className="text-[10px] uppercase tracking-wider font-bold text-slate-600 dark:text-slate-300 mb-2">
                                        {col.l} · {items.length}
                                    </p>
                                    <div className="space-y-2">
                                        {items.map((c) => (
                                            <div key={c.id} className="bg-white dark:bg-slate-800 rounded-md p-2 border border-slate-200 dark:border-slate-700 shadow-sm">
                                                <div className="flex items-start justify-between gap-1">
                                                    <p className="font-bold text-xs text-slate-800 dark:text-slate-100 flex-1">{c.nome}</p>
                                                    <div className="flex gap-0.5">
                                                        <button onClick={() => abrirEditarCand(c)} className="text-slate-400 hover:text-rose-600 p-0.5" title="Editar"><Pencil className="w-3 h-3" /></button>
                                                        <button onClick={() => removerCand(c)} className="text-slate-400 hover:text-red-600 p-0.5" title="Remover"><Trash2 className="w-3 h-3" /></button>
                                                    </div>
                                                </div>
                                                <div className="text-[10px] text-slate-500 space-y-0.5 mt-1">
                                                    {c.email && <p><Mail className="w-2.5 h-2.5 inline mr-0.5" />{c.email}</p>}
                                                    {c.telefone && <p><Phone className="w-2.5 h-2.5 inline mr-0.5" />{c.telefone}</p>}
                                                    {c.entrevista_data && <p><Calendar className="w-2.5 h-2.5 inline mr-0.5" />{fmtDate(c.entrevista_data)}</p>}
                                                </div>
                                                <select
                                                    value={c.status || 'triagem'}
                                                    onChange={(e) => moverStatus(c, e.target.value)}
                                                    className="mt-1.5 w-full text-[10px] px-1 py-0.5 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-900"
                                                >
                                                    {COLUNAS.map((o) => <option key={o.k} value={o.k}>{o.l}</option>)}
                                                </select>
                                            </div>
                                        ))}
                                        {items.length === 0 && (
                                            <p className="text-[10px] text-slate-400 italic">Vazio</p>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>

            {modalCand && (
                <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-20 pb-4 px-4 overflow-y-auto" onClick={() => !salvando && setModalCand(false)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                            <h3 className="font-bold text-slate-800 dark:text-slate-100">{editCand ? 'Editar candidato' : 'Adicionar candidato'}</h3>
                            <button onClick={() => setModalCand(false)} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-2 text-xs">
                            <I label="Nome *" value={form.nome || ''} onChange={(v) => setForm({ ...form, nome: v })} />
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <I label="CPF" value={form.cpf || ''} onChange={(v) => setForm({ ...form, cpf: v })} />
                                <I label="Telefone" value={form.telefone || ''} onChange={(v) => setForm({ ...form, telefone: v })} />
                                <I label="E-mail" type="email" value={form.email || ''} onChange={(v) => setForm({ ...form, email: v })} />
                                <I label="URL do CV" value={form.cv_url || ''} onChange={(v) => setForm({ ...form, cv_url: v })} />
                                <S label="Status" value={form.status || 'triagem'} onChange={(v) => setForm({ ...form, status: v })} options={COLUNAS.map(c => ({ v: c.k, l: c.l }))} />
                                <I label="Data da entrevista" type="datetime-local" value={form.entrevista_data ? form.entrevista_data.slice(0, 16) : ''} onChange={(v) => setForm({ ...form, entrevista_data: v ? v + ':00' : null })} />
                            </div>
                            <label className="block">
                                <span className="text-[10px] text-slate-500 font-semibold">Parecer</span>
                                <textarea value={form.parecer || ''} onChange={(e) => setForm({ ...form, parecer: e.target.value })}
                                    rows={2} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
                            </label>
                            <label className="block">
                                <span className="text-[10px] text-slate-500 font-semibold">Observações</span>
                                <textarea value={form.observacoes || ''} onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                                    rows={2} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
                            </label>
                        </div>
                        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                            <button onClick={() => setModalCand(false)} disabled={salvando} className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">Cancelar</button>
                            <button onClick={salvarCand} disabled={salvando} className="inline-flex items-center gap-1 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg disabled:opacity-50">
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
const S: React.FC<{ label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }> = ({ label, value, onChange, options }) => (
    <label className="block">
        <span className="text-[10px] text-slate-500 font-semibold">{label}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)}
            className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs">
            {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
    </label>
);

export default VagaDetalhe;
