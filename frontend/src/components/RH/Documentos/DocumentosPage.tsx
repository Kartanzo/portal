import React, { useEffect, useMemo, useState } from 'react';
import { FileText, Plus, Search, X, Save, Pencil, Trash2, ExternalLink, Files, Upload, Download } from 'lucide-react';
import { api } from '../../../app_api';
import { useToast } from '../../../contexts/ToastContext';
import VoltarDashboardRH from '../_shared/VoltarDashboardRH';
import RhPageBg from '../_shared/RhPageBg';

const STATUS_DOC_LABEL: Record<string, string> = {
    vigente: 'Vigente',
    vencido: 'Vencido',
    arquivado: 'Arquivado',
    pendente: 'Pendente',
};
const STATUS_DOC_COR: Record<string, string> = {
    vigente: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    vencido: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    arquivado: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
    pendente: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
};

const fmtDate = (s?: string) => {
    if (!s) return '—';
    try { return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR'); } catch { return s; }
};

type Tab = 'modelos' | 'documentos';

const DocumentosPage: React.FC = () => {
    const toast = useToast();
    const [aba, setAba] = useState<Tab>('documentos');

    return (
        <RhPageBg tema="navy">
                <header className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg shadow-rose-500/30">
                            <FileText className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black bg-gradient-to-r from-rose-600 to-pink-600 dark:from-rose-400 dark:to-pink-400 bg-clip-text text-transparent">
                                Documentos
                            </h1>
                            <p className="text-xs text-slate-500 mt-0.5">Modelos de formulários e documentos emitidos por colaborador</p>
                        </div>
                    </div>
                    <VoltarDashboardRH />
                </header>

                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="border-b border-slate-200 dark:border-slate-700 flex text-xs">
                        {([
                            { k: 'documentos', l: 'Documentos emitidos', icon: Files },
                            { k: 'modelos', l: 'Modelos de formulário', icon: FileText },
                        ] as { k: Tab; l: string; icon: any }[]).map((t) => {
                            const Ic = t.icon;
                            const active = aba === t.k;
                            return (
                                <button
                                    key={t.k}
                                    onClick={() => setAba(t.k)}
                                    className={`px-4 py-2 inline-flex items-center gap-1.5 border-b-2 transition ${
                                        active ? 'border-rose-600 text-rose-600 dark:text-rose-300 font-bold' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-200'
                                    }`}
                                >
                                    <Ic className="w-3.5 h-3.5" /> {t.l}
                                </button>
                            );
                        })}
                    </div>

                    <div className="p-4">
                        {aba === 'documentos' ? <AbaDocumentos /> : <AbaModelos />}
                    </div>
                </div>
            </RhPageBg>
    );
};

// ============== ABA DOCUMENTOS ==============

const AbaDocumentos: React.FC = () => {
    const toast = useToast();
    const [docs, setDocs] = useState<any[]>([]);
    const [modelos, setModelos] = useState<any[]>([]);
    const [colabs, setColabs] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [busca, setBusca] = useState('');
    const [filtroStatus, setFiltroStatus] = useState('');
    const [filtroModelo, setFiltroModelo] = useState('');

    const [modalOpen, setModalOpen] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState<any>({});
    const [salvando, setSalvando] = useState(false);

    const carregar = async () => {
        setLoading(true);
        try {
            const params: any = {};
            if (filtroStatus) params.status = filtroStatus;
            if (filtroModelo) params.modelo_id = parseInt(filtroModelo, 10);
            const r = await api.rhDocumentosListar(params);
            setDocs(r.documentos || []);
        } catch (e: any) {
            toast.showToast(e.message || 'Erro', 'error');
        } finally {
            setLoading(false);
        }
    };
    const carregarAux = async () => {
        try {
            const [m, c] = await Promise.all([
                api.rhModelosListar({ ativo: true }),
                api.rhColaboradoresListar(),
            ]);
            setModelos(m.modelos || []);
            setColabs(c.colaboradores || []);
        } catch {}
    };

    useEffect(() => { carregarAux(); carregar(); }, []);
    useEffect(() => { const t = setTimeout(carregar, 300); return () => clearTimeout(t); }, [filtroStatus, filtroModelo]);

    const docsFiltrados = useMemo(() => {
        if (!busca.trim()) return docs;
        const q = busca.toLowerCase();
        return docs.filter(d =>
            (d.colaborador_nome || '').toLowerCase().includes(q) ||
            (d.modelo_nome || '').toLowerCase().includes(q) ||
            (d.modelo_codigo || '').toLowerCase().includes(q) ||
            (d.titulo || '').toLowerCase().includes(q),
        );
    }, [docs, busca]);

    const abrirNovo = () => {
        setEditId(null);
        setForm({ status: 'vigente', data_emissao: new Date().toISOString().slice(0, 10) });
        setModalOpen(true);
    };
    const abrirEditar = (d: any) => {
        setEditId(d.id);
        setForm({ ...d });
        setModalOpen(true);
    };
    const salvar = async () => {
        if (!form.colaborador_id) {
            toast.showToast('Colaborador é obrigatório', 'error');
            return;
        }
        setSalvando(true);
        try {
            const payload: any = {};
            ['colaborador_id', 'modelo_id', 'titulo', 'file_url', 'data_emissao', 'data_validade', 'status', 'observacoes'].forEach((k) => {
                payload[k] = form[k] === '' ? null : form[k];
            });
            if (editId) {
                await api.rhDocumentoAtualizar(editId, payload);
                toast.showToast('Atualizado', 'success');
            } else {
                await api.rhDocumentoCriar(payload);
                toast.showToast('Criado', 'success');
            }
            setModalOpen(false);
            carregar();
        } catch (e: any) {
            toast.showToast(e.message || 'Erro', 'error');
        } finally {
            setSalvando(false);
        }
    };
    const remover = async (d: any) => {
        if (!confirm(`Remover documento "${d.modelo_codigo || d.titulo}"?`)) return;
        try {
            await api.rhDocumentoRemover(d.id);
            toast.showToast('Removido', 'success');
            carregar();
        } catch (e: any) {
            toast.showToast(e.message || 'Erro', 'error');
        }
    };

    return (
        <>
            <div className="flex flex-wrap gap-2 items-center mb-3">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                    <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por colaborador, modelo, código…"
                        className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                </div>
                <select value={filtroModelo} onChange={(e) => setFiltroModelo(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900">
                    <option value="">Modelo (todos)</option>
                    {modelos.map(m => <option key={m.id} value={m.id}>{m.codigo} — {m.nome}</option>)}
                </select>
                <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900">
                    <option value="">Status (todos)</option>
                    {Object.entries(STATUS_DOC_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <button onClick={abrirNovo} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700">
                    <Plus className="w-3.5 h-3.5" /> Novo Documento
                </button>
            </div>

            {loading ? (
                <div className="p-8 text-center text-slate-500 text-sm">Carregando…</div>
            ) : docsFiltrados.length === 0 ? (
                <div className="p-10 text-center text-slate-400">
                    <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Nenhum documento</p>
                </div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-900/40 text-slate-500 uppercase text-[10px]">
                            <tr>
                                <th className="px-3 py-2 text-left">Colaborador</th>
                                <th className="px-3 py-2 text-left">Modelo</th>
                                <th className="px-3 py-2 text-left">Categoria</th>
                                <th className="px-3 py-2 text-left">Emissão</th>
                                <th className="px-3 py-2 text-left">Validade</th>
                                <th className="px-3 py-2 text-center">Status</th>
                                <th className="px-3 py-2 text-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                            {docsFiltrados.map((d) => (
                                <tr key={d.id} className="hover:bg-rose-50/40 dark:hover:bg-rose-900/10">
                                    <td className="px-3 py-2 font-bold text-slate-800 dark:text-slate-100">{d.colaborador_nome || '—'}</td>
                                    <td className="px-3 py-2">
                                        <span className="font-mono text-[10px] text-slate-500">{d.modelo_codigo}</span>
                                        <div>{d.modelo_nome || d.titulo || '—'}</div>
                                    </td>
                                    <td className="px-3 py-2">{d.modelo_categoria || '—'}</td>
                                    <td className="px-3 py-2">{fmtDate(d.data_emissao)}</td>
                                    <td className="px-3 py-2">{fmtDate(d.data_validade)}</td>
                                    <td className="px-3 py-2 text-center">
                                        <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_DOC_COR[d.status || 'vigente']}`}>
                                            {STATUS_DOC_LABEL[d.status || 'vigente']}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2 text-right whitespace-nowrap">
                                        {d.file_url && (
                                            <a href={d.file_url} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-rose-600 p-1 inline-block" title="Abrir arquivo">
                                                <ExternalLink className="w-3.5 h-3.5" />
                                            </a>
                                        )}
                                        <button onClick={() => abrirEditar(d)} className="text-slate-400 hover:text-rose-600 p-1" title="Editar"><Pencil className="w-3.5 h-3.5" /></button>
                                        <button onClick={() => remover(d)} className="text-slate-400 hover:text-red-600 p-1" title="Remover"><Trash2 className="w-3.5 h-3.5" /></button>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {modalOpen && (
                <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-20 pb-4 px-4 overflow-y-auto" onClick={() => !salvando && setModalOpen(false)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                            <h3 className="font-bold text-slate-800 dark:text-slate-100">{editId ? 'Editar documento' : 'Novo documento'}</h3>
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
                            <label className="block">
                                <span className="text-[10px] text-slate-500 font-semibold">Modelo</span>
                                <select value={form.modelo_id || ''} onChange={(e) => setForm({ ...form, modelo_id: e.target.value ? parseInt(e.target.value, 10) : null })}
                                    className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs">
                                    <option value="">— Sem modelo (livre) —</option>
                                    {modelos.map(m => <option key={m.id} value={m.id}>{m.codigo} — {m.nome}</option>)}
                                </select>
                            </label>
                            <I label="Título (opcional, se sem modelo)" value={form.titulo || ''} onChange={(v) => setForm({ ...form, titulo: v })} />
                            <I label="URL do arquivo (Drive, SharePoint, etc.)" value={form.file_url || ''} onChange={(v) => setForm({ ...form, file_url: v })} />
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <I label="Data de emissão" type="date" value={form.data_emissao || ''} onChange={(v) => setForm({ ...form, data_emissao: v })} />
                                <I label="Data de validade" type="date" value={form.data_validade || ''} onChange={(v) => setForm({ ...form, data_validade: v })} />
                            </div>
                            <S label="Status" value={form.status || 'vigente'} onChange={(v) => setForm({ ...form, status: v })} options={Object.entries(STATUS_DOC_LABEL).map(([v, l]) => ({ v, l }))} />
                            <label className="block">
                                <span className="text-[10px] text-slate-500 font-semibold">Observações</span>
                                <textarea value={form.observacoes || ''} onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                                    rows={2} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
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
        </>
    );
};

// ============== ABA MODELOS ==============

const AbaModelos: React.FC = () => {
    const toast = useToast();
    const [modelos, setModelos] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [busca, setBusca] = useState('');
    const [filtroCat, setFiltroCat] = useState('');

    const [modalOpen, setModalOpen] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState<any>({});
    const [salvando, setSalvando] = useState(false);

    const carregar = async () => {
        setLoading(true);
        try {
            const r = await api.rhModelosListar({ search: busca, categoria: filtroCat });
            setModelos(r.modelos || []);
        } catch (e: any) {
            toast.showToast(e.message || 'Erro', 'error');
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => { carregar(); }, []);
    useEffect(() => { const t = setTimeout(carregar, 300); return () => clearTimeout(t); }, [busca, filtroCat]);

    const categorias = useMemo(() => [...new Set(modelos.map(m => m.categoria).filter(Boolean))], [modelos]);
    const porCategoria = useMemo(() => {
        const g: Record<string, any[]> = {};
        modelos.forEach((m) => { const k = m.categoria || 'Outros'; (g[k] = g[k] || []).push(m); });
        return g;
    }, [modelos]);

    const abrirNovo = () => { setEditId(null); setForm({ versao: '00', ativo: true }); setModalOpen(true); };
    const abrirEditar = (m: any) => { setEditId(m.id); setForm({ ...m }); setModalOpen(true); };
    const salvar = async () => {
        if (!form.codigo || !form.nome) {
            toast.showToast('Código e nome são obrigatórios', 'error');
            return;
        }
        setSalvando(true);
        try {
            const payload: any = {};
            ['codigo', 'nome', 'categoria', 'versao', 'file_url', 'descricao', 'ativo'].forEach((k) => {
                payload[k] = form[k] === '' ? null : form[k];
            });
            if (editId) {
                await api.rhModeloAtualizar(editId, payload);
                toast.showToast('Atualizado', 'success');
            } else {
                await api.rhModeloCriar(payload);
                toast.showToast('Modelo criado', 'success');
            }
            setModalOpen(false);
            carregar();
        } catch (e: any) {
            toast.showToast(e.message || 'Erro', 'error');
        } finally {
            setSalvando(false);
        }
    };
    const remover = async (m: any) => {
        if (!confirm(`Desativar modelo "${m.codigo} ${m.nome}"?`)) return;
        try {
            await api.rhModeloRemover(m.id);
            toast.showToast('Desativado', 'success');
            carregar();
        } catch (e: any) {
            toast.showToast(e.message || 'Erro', 'error');
        }
    };

    return (
        <>
            <div className="flex flex-wrap gap-2 items-center mb-3">
                <div className="relative flex-1 min-w-[200px]">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                    <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar código ou nome…"
                        className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                </div>
                <select value={filtroCat} onChange={(e) => setFiltroCat(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900">
                    <option value="">Categoria (todas)</option>
                    {categorias.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
                <UploadLoteButton onUploaded={carregar} />
                <button onClick={abrirNovo} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700">
                    <Plus className="w-3.5 h-3.5" /> Novo Modelo
                </button>
            </div>

            {loading ? (
                <div className="p-8 text-center text-slate-500 text-sm">Carregando…</div>
            ) : modelos.length === 0 ? (
                <div className="p-10 text-center text-slate-400">
                    <FileText className="w-10 h-10 mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Nenhum modelo cadastrado</p>
                </div>
            ) : (
                <div className="space-y-3">
                    {Object.entries(porCategoria).map(([cat, items]) => (
                        <div key={cat}>
                            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1.5 border-b border-slate-200 dark:border-slate-700 pb-1">{cat}</p>
                            <div className="grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                                {items.map((m: any) => (
                                    <div key={m.id} className={`bg-white dark:bg-slate-900/40 rounded-lg border ${m.ativo ? 'border-slate-200 dark:border-slate-700' : 'border-slate-200 dark:border-slate-700 opacity-50'} p-2.5 flex items-start justify-between gap-2`}>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-1 flex-wrap">
                                                <code className="text-[10px] text-rose-600 dark:text-rose-300 font-mono font-bold">{m.codigo}</code>
                                                <span className="text-[10px] text-slate-400">v{m.versao}</span>
                                                {!m.ativo && <span className="text-[10px] text-slate-400 italic">(inativo)</span>}
                                            </div>
                                            <p className="font-bold text-xs text-slate-800 dark:text-slate-100 leading-tight mt-0.5">{m.nome}</p>
                                            {m.descricao && <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-2">{m.descricao}</p>}
                                        </div>
                                        <div className="flex flex-row gap-0.5 flex-shrink-0">
                                            {m.file_url ? (
                                                <a href={api.rhModeloDownloadUrl(m.id)} className="text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 p-1 rounded" title="Baixar modelo"><Download className="w-3.5 h-3.5" /></a>
                                            ) : (
                                                <span className="text-slate-300 p-1" title="Sem arquivo"><Download className="w-3.5 h-3.5" /></span>
                                            )}
                                            <UploadButton modeloId={m.id} hasFile={!!m.file_url} onUploaded={carregar} />
                                            <button onClick={() => abrirEditar(m)} className="text-slate-400 hover:text-rose-600 p-1" title="Editar metadados"><Pencil className="w-3.5 h-3.5" /></button>
                                            <button onClick={() => remover(m)} className="text-slate-400 hover:text-red-600 p-1" title="Desativar"><Trash2 className="w-3.5 h-3.5" /></button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {modalOpen && (
                <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-20 pb-4 px-4 overflow-y-auto" onClick={() => !salvando && setModalOpen(false)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                            <h3 className="font-bold text-slate-800 dark:text-slate-100">{editId ? 'Editar modelo' : 'Novo modelo'}</h3>
                            <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="p-4 space-y-2 text-xs">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <I label="Código *" value={form.codigo || ''} onChange={(v) => setForm({ ...form, codigo: v })} placeholder="F 091.00" />
                                <I label="Versão" value={form.versao || '00'} onChange={(v) => setForm({ ...form, versao: v })} />
                            </div>
                            <I label="Nome *" value={form.nome || ''} onChange={(v) => setForm({ ...form, nome: v })} />
                            <I label="Categoria" value={form.categoria || ''} onChange={(v) => setForm({ ...form, categoria: v })} placeholder="Admissão, Avaliação…" />
                            <I label="URL do modelo (Drive, SharePoint…)" value={form.file_url || ''} onChange={(v) => setForm({ ...form, file_url: v })} />
                            <label className="block">
                                <span className="text-[10px] text-slate-500 font-semibold">Descrição</span>
                                <textarea value={form.descricao || ''} onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                                    rows={2} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
                            </label>
                            <label className="flex items-center gap-2">
                                <input type="checkbox" checked={form.ativo !== false} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />
                                <span className="text-xs">Ativo</span>
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
        </>
    );
};

const UploadLoteButton: React.FC<{ onUploaded: () => void }> = ({ onUploaded }) => {
    const toast = useToast();
    const inputRef = React.useRef<HTMLInputElement>(null);
    const [busy, setBusy] = React.useState(false);
    const [pendentes, setPendentes] = React.useState<File[]>([]);
    const handle = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        setBusy(true);
        try {
            const r = await api.rhModelosUploadLote(files);
            const falhas = (r.resultados || []).filter((x: any) => !x.ok);
            const sucessos = r.sucesso || 0;
            toast.showToast(`${sucessos}/${r.total} vinculados automaticamente${falhas.length ? ` · ${falhas.length} precisam de classificação manual` : ''}`, falhas.length ? 'info' : 'success');
            // Identifica os arquivos que falharam e abre modais sequenciais
            if (falhas.length > 0) {
                const nomesFalhos = new Set(falhas.map((f: any) => f.arquivo));
                const filesFalhos = files.filter(f => nomesFalhos.has(f.name));
                setPendentes(filesFalhos);
            }
            onUploaded();
        } catch (err: any) { toast.showToast(err.message || 'Erro', 'error'); }
        finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
    };
    return (
        <>
            <input ref={inputRef} type="file" multiple accept=".docx,.doc,.pdf" className="hidden" onChange={handle} />
            <button onClick={() => inputRef.current?.click()} disabled={busy}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-rose-300 text-rose-600 dark:text-rose-300 dark:border-rose-700 text-xs font-bold hover:bg-rose-50 dark:hover:bg-rose-900/20"
                title="Selecione vários arquivos de uma vez — o código do modelo é detectado pelo nome do arquivo">
                <Upload className="w-3.5 h-3.5" /> {busy ? 'Subindo…' : 'Subir lote'}
            </button>
            {pendentes.length > 0 && (
                <ClassificarArquivoModal
                    arquivo={pendentes[0]}
                    onSkip={() => setPendentes(pendentes.slice(1))}
                    onSalvo={() => { setPendentes(pendentes.slice(1)); onUploaded(); }}
                />
            )}
        </>
    );
};

const ClassificarArquivoModal: React.FC<{ arquivo: File; onSkip: () => void; onSalvo: () => void }> = ({ arquivo, onSkip, onSalvo }) => {
    const toast = useToast();
    const [form, setForm] = React.useState<any>(() => {
        // Tenta extrair sugestão de código F xxx.yy do nome
        const m = (arquivo.name || '').match(/F\s*(\d{3})[.\-]?(\d{0,2})/i);
        const cod = m ? `F ${m[1]}.${(m[2] || '00').padEnd(2, '0')}` : '';
        const nomeLimpo = (arquivo.name || '').replace(/F\s*\d{3}[.\-]?\d{0,2}\s*[-—–]?\s*/i, '').replace(/\.(docx?|pdf)$/i, '').trim().replace(/[_]/g, ' ');
        return { codigo: cod, nome: nomeLimpo, categoria: 'Outros', versao: '00' };
    });
    const [salvando, setSalvando] = React.useState(false);

    const salvar = async () => {
        if (!form.codigo?.trim() || !form.nome?.trim()) {
            toast.showToast('Código e nome obrigatórios', 'error');
            return;
        }
        setSalvando(true);
        try {
            // 1. Cria o modelo
            const novo = await api.rhModeloCriar({ ...form, ativo: true });
            // 2. Sobe o arquivo pra esse modelo
            await api.rhModeloUploadArquivo(novo.id, arquivo);
            toast.showToast(`"${arquivo.name}" classificado e enviado`, 'success');
            onSalvo();
        } catch (e: any) {
            toast.showToast(e.message || 'Erro', 'error');
        } finally { setSalvando(false); }
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-20 pb-4 px-4 overflow-y-auto" onClick={() => !salvando && onSkip()}>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-amber-50 dark:bg-amber-900/20">
                    <div>
                        <h3 className="font-bold text-amber-800 dark:text-amber-200">Arquivo precisa de classificação</h3>
                        <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5 truncate" title={arquivo.name}>{arquivo.name}</p>
                    </div>
                    <button onClick={onSkip} className="text-slate-400 hover:text-slate-700" title="Pular este arquivo"><X className="w-4 h-4" /></button>
                </div>
                <div className="p-4 space-y-2 text-xs">
                    <p className="text-[11px] text-slate-500 mb-2">Não conseguimos detectar o código pelo nome. Preencha os dados pra criar o modelo correspondente:</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label className="block">
                            <span className="text-[10px] text-slate-500 font-semibold">Código *</span>
                            <input value={form.codigo || ''} onChange={(e) => setForm({ ...form, codigo: e.target.value })} placeholder="F 091.00"
                                className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
                        </label>
                        <label className="block">
                            <span className="text-[10px] text-slate-500 font-semibold">Versão</span>
                            <input value={form.versao || '00'} onChange={(e) => setForm({ ...form, versao: e.target.value })}
                                className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
                        </label>
                    </div>
                    <label className="block">
                        <span className="text-[10px] text-slate-500 font-semibold">Nome *</span>
                        <input value={form.nome || ''} onChange={(e) => setForm({ ...form, nome: e.target.value })}
                            className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
                    </label>
                    <label className="block">
                        <span className="text-[10px] text-slate-500 font-semibold">Categoria</span>
                        <input list="cat-list" value={form.categoria || ''} onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                            className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
                        <datalist id="cat-list">
                            <option value="Recrutamento" />
                            <option value="Admissão" />
                            <option value="Avaliação" />
                            <option value="Jornada" />
                            <option value="Movimentação" />
                            <option value="Desligamento" />
                            <option value="Sindical" />
                            <option value="Outros" />
                        </datalist>
                    </label>
                </div>
                <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-between gap-2">
                    <button onClick={onSkip} disabled={salvando} className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg">Pular este</button>
                    <button onClick={salvar} disabled={salvando} className="inline-flex items-center gap-1 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg disabled:opacity-50">
                        <Save className="w-3.5 h-3.5" /> {salvando ? 'Salvando…' : 'Cadastrar e enviar'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const UploadButton: React.FC<{ modeloId: number; hasFile: boolean; onUploaded: () => void }> = ({ modeloId, hasFile, onUploaded }) => {
    const toast = useToast();
    const inputRef = React.useRef<HTMLInputElement>(null);
    const [busy, setBusy] = React.useState(false);
    const handle = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (!f) return;
        setBusy(true);
        try {
            await api.rhModeloUploadArquivo(modeloId, f);
            toast.showToast('Arquivo enviado', 'success');
            onUploaded();
        } catch (err: any) { toast.showToast(err.message || 'Erro', 'error'); }
        finally { setBusy(false); if (inputRef.current) inputRef.current.value = ''; }
    };
    return (
        <>
            <input ref={inputRef} type="file" accept=".docx,.doc,.pdf" className="hidden" onChange={handle} />
            <button onClick={() => inputRef.current?.click()} disabled={busy}
                className={`p-1 rounded ${hasFile ? 'text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20' : 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20'}`}
                title={hasFile ? 'Substituir arquivo' : 'Subir arquivo'}>
                <Upload className="w-3.5 h-3.5" />
            </button>
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
const S: React.FC<{ label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }> = ({ label, value, onChange, options }) => (
    <label className="block">
        <span className="text-[10px] text-slate-500 font-semibold">{label}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)}
            className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs">
            {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
    </label>
);

export default DocumentosPage;
