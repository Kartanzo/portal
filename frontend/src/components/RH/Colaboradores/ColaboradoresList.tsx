import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Users, Search, Plus, X, Save, Trash2, Pencil } from 'lucide-react';
import { api } from '../../../app_api';
import { useToast } from '../../../contexts/ToastContext';
import VoltarDashboardRH from '../_shared/VoltarDashboardRH';
import ChipsPorSetor from '../_shared/ChipsPorSetor';
import RhPageBg from '../_shared/RhPageBg';

interface Colaborador {
    id: number;
    nome: string;
    cpf?: string;
    email?: string;
    cargo?: string;
    setor?: string;
    tipo?: string;
    status?: string;
    data_admissao?: string;
    matricula?: string;
    foto_url?: string;
}

const STATUS_LABELS: Record<string, string> = {
    ativo: 'Ativo',
    afastado: 'Afastado',
    demitido: 'Desligado',
    experiencia: 'Em experiência',
};
const STATUS_COR: Record<string, string> = {
    ativo: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    afastado: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    demitido: 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
    experiencia: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
};

const fmtDate = (s?: string) => {
    if (!s) return '—';
    try { return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR'); } catch { return s; }
};

const ColaboradoresList: React.FC = () => {
    const toast = useToast();
    const [searchParams] = useSearchParams();
    const [items, setItems] = useState<Colaborador[]>([]);
    const [loading, setLoading] = useState(false);
    const [busca, setBusca] = useState('');
    const [filtroSetor, setFiltroSetor] = useState(searchParams.get('setor') || '');
    const [filtroStatus, setFiltroStatus] = useState(searchParams.get('status') || '');
    const [filtroTipo, setFiltroTipo] = useState('');
    const [meta, setMeta] = useState<{ setores: string[]; cargos: string[]; tipos: string[] }>({ setores: [], cargos: [], tipos: [] });

    // Modal
    const [modalOpen, setModalOpen] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState<any>({ status: 'ativo' });
    const [salvando, setSalvando] = useState(false);

    const carregar = async () => {
        setLoading(true);
        try {
            const r = await api.rhColaboradoresListar({ search: busca, setor: filtroSetor, status: filtroStatus, tipo: filtroTipo });
            setItems(r.colaboradores || []);
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao carregar', 'error');
        } finally {
            setLoading(false);
        }
    };

    const carregarMeta = async () => {
        try { setMeta(await api.rhColaboradoresDistinct()); } catch {}
    };

    useEffect(() => { carregar(); carregarMeta(); }, []);
    useEffect(() => { const t = setTimeout(carregar, 300); return () => clearTimeout(t); }, [busca, filtroSetor, filtroStatus, filtroTipo]);

    // Atalho do Dashboard: ?new=1 abre modal de cadastro
    useEffect(() => {
        if (searchParams.get('new') === '1') {
            setEditId(null);
            setForm({ status: 'ativo', tipo: 'CLT' });
            setModalOpen(true);
        }
    }, []);

    const abrirNovo = () => { setEditId(null); setForm({ status: 'ativo', tipo: 'CLT' }); setModalOpen(true); };
    const abrirEditar = async (id: number) => {
        try {
            const c = await api.rhColaboradorObter(id);
            setEditId(id);
            setForm(c);
            setModalOpen(true);
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao carregar colaborador', 'error');
        }
    };

    const salvar = async () => {
        if (!form.nome || !form.nome.trim()) {
            toast.showToast('Nome é obrigatório', 'error');
            return;
        }
        setSalvando(true);
        try {
            // Limpar strings vazias para null
            const payload: any = {};
            Object.entries(form).forEach(([k, v]) => { payload[k] = v === '' ? null : v; });
            if (editId) {
                await api.rhColaboradorAtualizar(editId, payload);
                toast.showToast('Colaborador atualizado', 'success');
            } else {
                await api.rhColaboradorCriar(payload);
                toast.showToast('Colaborador criado', 'success');
            }
            setModalOpen(false);
            carregar();
            carregarMeta();
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao salvar', 'error');
        } finally {
            setSalvando(false);
        }
    };

    const remover = async (id: number, nome: string) => {
        if (!confirm(`Marcar "${nome}" como desligado? O registro permanece no histórico.`)) return;
        try {
            await api.rhColaboradorRemover(id);
            toast.showToast('Colaborador desligado', 'success');
            carregar();
        } catch (e: any) {
            toast.showToast(e.message || 'Erro', 'error');
        }
    };

    const totaisPorStatus = useMemo(() => {
        const t: Record<string, number> = { ativo: 0, afastado: 0, demitido: 0, experiencia: 0 };
        items.forEach((c) => { if (c.status && c.status in t) t[c.status]++; });
        return t;
    }, [items]);

    return (
        <RhPageBg tema="rose">
                <header className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg shadow-rose-500/30">
                            <Users className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black bg-gradient-to-r from-rose-600 to-pink-600 dark:from-rose-400 dark:to-pink-400 bg-clip-text text-transparent">
                                Colaboradores
                            </h1>
                            <p className="text-xs text-slate-500 mt-0.5">
                                {items.length} no resultado · {totaisPorStatus.ativo} ativos · {totaisPorStatus.experiencia} em experiência · {totaisPorStatus.afastado} afastados
                            </p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <VoltarDashboardRH />
                        <button onClick={abrirNovo} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-sm font-bold hover:bg-rose-700 shadow shadow-rose-500/30">
                            <Plus className="w-4 h-4" /> Novo Colaborador
                        </button>
                    </div>
                </header>

                <ChipsPorSetor items={items} setorKey="setor" value={filtroSetor} onChange={setFiltroSetor} />

                {/* Filtros */}
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 flex flex-wrap gap-2 items-center">
                    <div className="relative flex-1 min-w-[200px]">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                        <input
                            value={busca}
                            onChange={(e) => setBusca(e.target.value)}
                            placeholder="Buscar por nome, CPF, e-mail, matrícula…"
                            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                        />
                    </div>
                    <select value={filtroSetor} onChange={(e) => setFiltroSetor(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900">
                        <option value="">Setor (todos)</option>
                        {meta.setores.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                    <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900">
                        <option value="">Status (todos)</option>
                        <option value="ativo">Ativo</option>
                        <option value="experiencia">Em experiência</option>
                        <option value="afastado">Afastado</option>
                        <option value="demitido">Desligado</option>
                    </select>
                    <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900">
                        <option value="">Tipo (todos)</option>
                        <option value="CLT">CLT</option>
                        <option value="PJ">PJ</option>
                        <option value="Temporario">Temporário</option>
                        <option value="Estagiario">Estagiário</option>
                    </select>
                    {(busca || filtroSetor || filtroStatus || filtroTipo) && (
                        <button onClick={() => { setBusca(''); setFiltroSetor(''); setFiltroStatus(''); setFiltroTipo(''); }}
                            className="text-xs px-2 py-1.5 text-rose-600 dark:text-rose-300 border border-rose-300 dark:border-rose-700 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-900/20">
                            <X className="w-3 h-3 inline" /> Limpar filtros
                        </button>
                    )}
                </div>

                {/* Tabela */}
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    {loading ? (
                        <div className="p-8 text-center text-slate-500 text-sm">Carregando…</div>
                    ) : items.length === 0 ? (
                        <div className="p-10 text-center text-slate-400">
                            <Users className="w-10 h-10 mx-auto mb-2 opacity-40" />
                            <p className="text-sm">Nenhum colaborador encontrado</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-slate-50 dark:bg-slate-900/40 text-slate-500 uppercase text-[10px]">
                                    <tr>
                                        <th className="px-3 py-2 text-left">Nome</th>
                                        <th className="px-3 py-2 text-left">Matrícula</th>
                                        <th className="px-3 py-2 text-left">Cargo</th>
                                        <th className="px-3 py-2 text-left">Setor</th>
                                        <th className="px-3 py-2 text-left">Tipo</th>
                                        <th className="px-3 py-2 text-left">Admissão</th>
                                        <th className="px-3 py-2 text-center">Status</th>
                                        <th className="px-3 py-2 text-right">Ações</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                    {items.map((c) => (
                                        <tr key={c.id} className="hover:bg-rose-50/40 dark:hover:bg-rose-900/10">
                                            <td className="px-3 py-2">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-rose-400 to-pink-500 text-white text-[10px] font-bold flex items-center justify-center overflow-hidden flex-shrink-0">
                                                        {c.foto_url ? <img src={c.foto_url} alt={c.nome} className="w-full h-full object-cover" /> : (c.nome || '?').slice(0, 2).toUpperCase()}
                                                    </div>
                                                    <div>
                                                        <Link to={`/rh/colaboradores/${c.id}`} className="font-bold text-slate-800 dark:text-slate-100 hover:text-rose-600 dark:hover:text-rose-300">{c.nome}</Link>
                                                        {c.email && <div className="text-[10px] text-slate-400">{c.email}</div>}
                                                    </div>
                                                </div>
                                            </td>
                                            <td className="px-3 py-2 font-mono">{c.matricula || '—'}</td>
                                            <td className="px-3 py-2">{c.cargo || '—'}</td>
                                            <td className="px-3 py-2">{c.setor || '—'}</td>
                                            <td className="px-3 py-2">{c.tipo || '—'}</td>
                                            <td className="px-3 py-2">{fmtDate(c.data_admissao)}</td>
                                            <td className="px-3 py-2 text-center">
                                                <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COR[c.status || 'ativo']}`}>
                                                    {STATUS_LABELS[c.status || 'ativo']}
                                                </span>
                                            </td>
                                            <td className="px-3 py-2 text-right whitespace-nowrap">
                                                <button onClick={() => abrirEditar(c.id)} className="text-slate-500 hover:text-rose-600 p-1" title="Editar">
                                                    <Pencil className="w-3.5 h-3.5" />
                                                </button>
                                                {c.status !== 'demitido' && (
                                                    <button onClick={() => remover(c.id, c.nome)} className="text-slate-400 hover:text-red-600 p-1" title="Desligar">
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

            {/* Modal Criar/Editar */}
            {modalOpen && (
                <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-20 pb-4 px-4 overflow-y-auto" onClick={() => !salvando && setModalOpen(false)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                            <h3 className="font-bold text-slate-800 dark:text-slate-100">{editId ? 'Editar colaborador' : 'Novo colaborador'}</h3>
                            <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
                            <section>
                                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1.5">Identificação</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <Input label="Nome completo *" value={form.nome || ''} onChange={(v) => setForm({ ...form, nome: v })} />
                                    <Input label="Matrícula" value={form.matricula || ''} onChange={(v) => setForm({ ...form, matricula: v })} />
                                    <Input label="CPF" value={form.cpf || ''} onChange={(v) => setForm({ ...form, cpf: v })} />
                                    <Input label="RG" value={form.rg || ''} onChange={(v) => setForm({ ...form, rg: v })} />
                                    <Input label="E-mail" type="email" value={form.email || ''} onChange={(v) => setForm({ ...form, email: v })} />
                                    <Input label="Telefone" value={form.telefone || ''} onChange={(v) => setForm({ ...form, telefone: v })} />
                                    <Input label="Data de nascimento" type="date" value={form.data_nascimento || ''} onChange={(v) => setForm({ ...form, data_nascimento: v })} />
                                </div>
                                <Input className="mt-2" label="Endereço" value={form.endereco || ''} onChange={(v) => setForm({ ...form, endereco: v })} />
                            </section>

                            <section>
                                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1.5">Contratuais</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <Input label="Cargo" value={form.cargo || ''} onChange={(v) => setForm({ ...form, cargo: v })} />
                                    <Input label="Setor" value={form.setor || ''} onChange={(v) => setForm({ ...form, setor: v })} />
                                    <Select label="Tipo" value={form.tipo || ''} onChange={(v) => setForm({ ...form, tipo: v })} options={['CLT', 'PJ', 'Temporario', 'Estagiario']} />
                                    <Select label="Status" value={form.status || 'ativo'} onChange={(v) => setForm({ ...form, status: v })} options={['ativo', 'experiencia', 'afastado', 'demitido']} />
                                    <Input label="CTPS" value={form.ctps || ''} onChange={(v) => setForm({ ...form, ctps: v })} />
                                    <Input label="Jornada" placeholder="44h semanais" value={form.jornada || ''} onChange={(v) => setForm({ ...form, jornada: v })} />
                                    <Input label="Salário (R$)" type="number" step="0.01" value={form.salario ?? ''} onChange={(v) => setForm({ ...form, salario: v === '' ? null : parseFloat(v) })} />
                                    <Input label="Data de admissão" type="date" value={form.data_admissao || ''} onChange={(v) => setForm({ ...form, data_admissao: v })} />
                                    <Input label="Data de desligamento" type="date" value={form.data_demissao || ''} onChange={(v) => setForm({ ...form, data_demissao: v })} />
                                </div>
                            </section>

                            <section>
                                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1.5">Banco</p>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                                    <Input label="Banco" value={form.banco_nome || ''} onChange={(v) => setForm({ ...form, banco_nome: v })} />
                                    <Input label="Agência" value={form.banco_agencia || ''} onChange={(v) => setForm({ ...form, banco_agencia: v })} />
                                    <Input label="Conta" value={form.banco_conta || ''} onChange={(v) => setForm({ ...form, banco_conta: v })} />
                                </div>
                            </section>

                            <section>
                                <p className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-1.5">Observações</p>
                                <textarea
                                    value={form.observacoes || ''}
                                    onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                                    className="w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs"
                                    rows={3}
                                />
                            </section>
                        </div>
                        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                            <button onClick={() => setModalOpen(false)} disabled={salvando} className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">
                                Cancelar
                            </button>
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

const Input: React.FC<{ label: string; value: string | number; onChange: (v: string) => void; type?: string; step?: string; placeholder?: string; className?: string }> = ({ label, value, onChange, type = 'text', step, placeholder, className = '' }) => (
    <label className={`block ${className}`}>
        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">{label}</span>
        <input
            type={type} step={step} value={value} placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs"
        />
    </label>
);

const Select: React.FC<{ label: string; value: string; onChange: (v: string) => void; options: string[] }> = ({ label, value, onChange, options }) => (
    <label className="block">
        <span className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">{label}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)}
            className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs">
            <option value="">—</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
    </label>
);

export default ColaboradoresList;
