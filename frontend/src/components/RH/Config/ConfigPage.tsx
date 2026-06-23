import React, { useEffect, useState } from 'react';
import { Settings, Building2, Sliders, Plus, X, Save, Pencil, Trash2, ExternalLink } from 'lucide-react';
import { api } from '../../../app_api';
import { useToast } from '../../../contexts/ToastContext';
import VoltarDashboardRH from '../_shared/VoltarDashboardRH';
import RhPageBg from '../_shared/RhPageBg';

type Tab = 'sindicatos' | 'parametros';

const ConfigPage: React.FC = () => {
    const [aba, setAba] = useState<Tab>('parametros');
    return (
        <RhPageBg tema="navy">
                <header className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg shadow-rose-500/30">
                            <Settings className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black bg-gradient-to-r from-rose-600 to-pink-600 dark:from-rose-400 dark:to-pink-400 bg-clip-text text-transparent">
                                Configurações do RH
                            </h1>
                            <p className="text-xs text-slate-500 mt-0.5">Sindicatos, parâmetros de jornada e regras do módulo</p>
                        </div>
                    </div>
                    <VoltarDashboardRH />
                </header>

                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="border-b border-slate-200 dark:border-slate-700 flex text-xs">
                        {([
                            { k: 'parametros', l: 'Parâmetros', icon: Sliders },
                            { k: 'sindicatos', l: 'Sindicatos', icon: Building2 },
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
                    <div className="p-4">{aba === 'parametros' ? <AbaParametros /> : <AbaSindicatos />}</div>
                </div>
            </RhPageBg>
    );
};

// ============ PARÂMETROS ============

const AbaParametros: React.FC = () => {
    const toast = useToast();
    const [params, setParams] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [editKey, setEditKey] = useState<string | null>(null);
    const [tempValor, setTempValor] = useState('');

    const carregar = async () => {
        setLoading(true);
        try {
            const r = await api.rhParametrosListar();
            setParams(r.parametros || []);
        } catch (e: any) { toast.showToast(e.message, 'error'); }
        finally { setLoading(false); }
    };
    useEffect(() => { carregar(); }, []);

    const salvar = async (p: any) => {
        try {
            await api.rhParametroAtualizar(p.chave, { chave: p.chave, valor: tempValor, descricao: p.descricao });
            toast.showToast('Atualizado', 'success');
            setEditKey(null);
            carregar();
        } catch (e: any) { toast.showToast(e.message, 'error'); }
    };

    if (loading) return <p className="p-6 text-center text-slate-500 text-sm">Carregando…</p>;

    return (
        <div className="space-y-1">
            {params.map((p) => (
                <div key={p.chave} className="flex items-center gap-3 p-3 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/40 border border-transparent hover:border-slate-200 dark:hover:border-slate-700">
                    <div className="flex-1">
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-100">{p.descricao || p.chave}</p>
                        <code className="text-[10px] text-slate-400 font-mono">{p.chave}</code>
                    </div>
                    {editKey === p.chave ? (
                        <>
                            <input value={tempValor} onChange={(e) => setTempValor(e.target.value)}
                                className="w-32 px-2 py-1 border border-rose-500 rounded text-xs bg-white dark:bg-slate-900" autoFocus
                                onKeyDown={(e) => e.key === 'Enter' && salvar(p)} />
                            <button onClick={() => salvar(p)} className="text-emerald-600 hover:bg-emerald-50 p-1 rounded"><Save className="w-3.5 h-3.5" /></button>
                            <button onClick={() => setEditKey(null)} className="text-slate-400 hover:text-red-600 p-1"><X className="w-3.5 h-3.5" /></button>
                        </>
                    ) : (
                        <button onClick={() => { setEditKey(p.chave); setTempValor(p.valor || ''); }}
                            className="text-sm font-mono font-bold text-rose-600 dark:text-rose-300 px-3 py-1 rounded hover:bg-rose-50 dark:hover:bg-rose-900/20">
                            {p.valor || '—'} <Pencil className="w-3 h-3 inline ml-1" />
                        </button>
                    )}
                </div>
            ))}
        </div>
    );
};

// ============ SINDICATOS ============

const AbaSindicatos: React.FC = () => {
    const toast = useToast();
    const [itens, setItens] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [modalOpen, setModalOpen] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState<any>({ ativo: true });
    const [salvando, setSalvando] = useState(false);

    const carregar = async () => {
        setLoading(true);
        try {
            const r = await api.rhSindicatosListar();
            setItens(r.sindicatos || []);
        } catch (e: any) { toast.showToast(e.message, 'error'); }
        finally { setLoading(false); }
    };
    useEffect(() => { carregar(); }, []);

    const abrirNovo = () => { setEditId(null); setForm({ ativo: true }); setModalOpen(true); };
    const abrirEditar = (s: any) => { setEditId(s.id); setForm({ ...s }); setModalOpen(true); };
    const salvar = async () => {
        if (!form.nome) { toast.showToast('Nome é obrigatório', 'error'); return; }
        setSalvando(true);
        try {
            const payload: any = {};
            ['nome', 'cnpj', 'categoria', 'contato_email', 'contato_telefone', 'data_base', 'cct_url', 'ativo', 'observacoes'].forEach((k) => { payload[k] = form[k] === '' ? null : form[k]; });
            if (editId) await api.rhSindicatoAtualizar(editId, payload);
            else await api.rhSindicatoCriar(payload);
            toast.showToast('Salvo', 'success');
            setModalOpen(false);
            carregar();
        } catch (e: any) { toast.showToast(e.message, 'error'); }
        finally { setSalvando(false); }
    };
    const remover = async (s: any) => {
        if (!confirm(`Desativar "${s.nome}"?`)) return;
        try { await api.rhSindicatoRemover(s.id); carregar(); } catch (e: any) { toast.showToast(e.message, 'error'); }
    };

    return (
        <>
            <div className="flex justify-end mb-3">
                <button onClick={abrirNovo} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700">
                    <Plus className="w-3.5 h-3.5" /> Novo sindicato
                </button>
            </div>

            {loading ? <p className="p-6 text-center text-slate-500 text-sm">Carregando…</p> : itens.length === 0 ? (
                <div className="p-10 text-center text-slate-400">
                    <Building2 className="w-10 h-10 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Nenhum sindicato cadastrado</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {itens.map((s) => (
                        <div key={s.id} className={`bg-slate-50 dark:bg-slate-900/40 rounded-lg border p-3 ${s.ativo ? 'border-slate-200 dark:border-slate-700' : 'border-slate-200 dark:border-slate-700 opacity-50'}`}>
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                    <p className="font-bold text-sm">{s.nome} {!s.ativo && <span className="text-[10px] text-slate-400">(inativo)</span>}</p>
                                    {s.categoria && <p className="text-[11px] text-slate-500">{s.categoria}</p>}
                                    {s.cnpj && <p className="text-[10px] font-mono text-slate-400 mt-0.5">{s.cnpj}</p>}
                                </div>
                                <div className="flex gap-0.5">
                                    {s.cct_url && <a href={s.cct_url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-rose-600 p-1" title="CCT"><ExternalLink className="w-3.5 h-3.5" /></a>}
                                    <button onClick={() => abrirEditar(s)} className="text-slate-400 hover:text-rose-600 p-1"><Pencil className="w-3.5 h-3.5" /></button>
                                    <button onClick={() => remover(s)} className="text-slate-400 hover:text-red-600 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                                </div>
                            </div>
                            {(s.contato_email || s.contato_telefone) && (
                                <div className="mt-2 text-[11px] text-slate-500 space-y-0.5">
                                    {s.contato_email && <p>📧 {s.contato_email}</p>}
                                    {s.contato_telefone && <p>📞 {s.contato_telefone}</p>}
                                </div>
                            )}
                            {s.data_base && <p className="text-[11px] text-slate-500 mt-1">Data-base: <strong>{s.data_base}</strong></p>}
                        </div>
                    ))}
                </div>
            )}

            {modalOpen && (
                <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-20 pb-4 px-4 overflow-y-auto" onClick={() => !salvando && setModalOpen(false)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                            <h3 className="font-bold">{editId ? 'Editar' : 'Novo'} sindicato</h3>
                            <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="p-4 space-y-2 text-xs">
                            <I label="Nome *" value={form.nome || ''} onChange={(v) => setForm({ ...form, nome: v })} />
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <I label="CNPJ" value={form.cnpj || ''} onChange={(v) => setForm({ ...form, cnpj: v })} />
                                <I label="Categoria" value={form.categoria || ''} onChange={(v) => setForm({ ...form, categoria: v })} placeholder="Comerciários, Metalúrgicos…" />
                                <I label="E-mail de contato" value={form.contato_email || ''} onChange={(v) => setForm({ ...form, contato_email: v })} />
                                <I label="Telefone" value={form.contato_telefone || ''} onChange={(v) => setForm({ ...form, contato_telefone: v })} />
                                <I label="Data-base" value={form.data_base || ''} onChange={(v) => setForm({ ...form, data_base: v })} placeholder="Maio" />
                                <I label="URL da CCT" value={form.cct_url || ''} onChange={(v) => setForm({ ...form, cct_url: v })} />
                            </div>
                            <label className="block">
                                <span className="text-[10px] text-slate-500 font-semibold">Observações</span>
                                <textarea value={form.observacoes || ''} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} rows={2}
                                    className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
                            </label>
                            <label className="flex items-center gap-2">
                                <input type="checkbox" checked={form.ativo !== false} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />
                                <span>Ativo</span>
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

const I: React.FC<{ label: string; value: any; onChange: (v: string) => void; type?: string; placeholder?: string }> = ({ label, value, onChange, type = 'text', placeholder }) => (
    <label className="block">
        <span className="text-[10px] text-slate-500 font-semibold">{label}</span>
        <input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
            className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
    </label>
);

export default ConfigPage;
