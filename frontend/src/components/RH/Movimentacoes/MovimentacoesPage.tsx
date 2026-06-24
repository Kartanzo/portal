import React, { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, Plus, X, Save, Check, Pencil, Trash2, ExternalLink, UserPlus, UserMinus, ChevronDown, ChevronUp } from 'lucide-react';
import { api } from '../../../app_api';
import { useToast } from '../../../contexts/ToastContext';
import VoltarDashboardRH from '../_shared/VoltarDashboardRH';
import ChipsPorSetor from '../_shared/ChipsPorSetor';
import RhPageBg from '../_shared/RhPageBg';

const STATUS_LABEL: Record<string, string> = {
    pendente: 'Pendente',
    aprovado: 'Aprovado',
    rejeitado: 'Rejeitado',
    concluido: 'Concluído',
};
const STATUS_COR: Record<string, string> = {
    pendente: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
    aprovado: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
    rejeitado: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
    concluido: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
};
const URG_LABEL: Record<string, string> = {
    normal: '🟢 Normal (30d)',
    importante: '🟡 Importante (15d)',
    urgente: '🔴 Urgente (até 7d)',
};

const EQUIP_OPCOES = ['Notebook básico (Office)', 'Notebook médio (i5/8GB)', 'Notebook performance (i7/16GB+)', 'Notebook workstation', 'Desktop', 'Monitor adicional', '2 monitores adicionais', 'Teclado/Mouse', 'Headset com microfone', 'Celular corporativo', 'Linha telefônica/ramal', 'Token/SmartCard'];
const ACESSO_OPCOES = ['Email @empresa.com.br', 'Office 365', 'Google Workspace', 'VPN', 'Acesso remoto/RDP', 'CFTV', 'Controle de ponto', 'GitHub/GitLab'];
const SISTEMAS_EXTERNOS = ['4Bis', 'Chatwoot', 'StarSoft', 'Krayin (CRM)', 'WAHA (WhatsApp)', 'BigQuery', 'Looker Studio', 'Conta Azul', 'WMS', 'PCP', 'AutoCAD', 'SolidWorks'];
const MODULOS_PORTAL = ['Dashboard', 'Chamados (T.I)', 'Plano de Ação', 'Implementação de Projetos', 'Importação', 'Importação V2 · Análise de Ruptura', 'Financeiro · DRE', 'Financeiro · Base', 'Financeiro · Orçado', 'SAC', 'Metas de Faturamento', 'S&OP Dashboard', 'Otimizador de Produção', 'RH / DP'];
const PERM_OPCOES = ['Acesso administrativo a plataforma', 'Acesso a dados sensíveis', 'Aprovação de despesas', 'Assinatura em documentos legais'];
const FIS_OPCOES = ['Crachá / Cartão de proximidade', 'Sala/área restrita', 'Vaga de estacionamento', 'Chave de armário'];
const DEV_OPCOES = ['Notebook', 'Celular corporativo', 'Token/SmartCard', 'Crachá', 'Chave de armário', 'Veículo da empresa', 'Monitor adicional', 'Headset'];
const BLOQ_OPCOES = ['Email corporativo', 'Portal EMPRESA', 'Office 365', 'VPN', 'Acesso remoto', 'CFTV', 'Controle de ponto', 'Bancos de dados', '4Bis', 'Chatwoot', 'StarSoft'];

const fmtDate = (s?: string) => {
    if (!s) return '—';
    try { return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR'); } catch { return s; }
};

const MovimentacoesPage: React.FC = () => {
    const toast = useToast();
    const [searchParams, setSearchParams] = useSearchParams();
    const [itens, setItens] = useState<any[]>([]);
    const [colabs, setColabs] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [busca, setBusca] = useState('');
    const [filtroTipo, setFiltroTipo] = useState('');
    const [filtroStatus, setFiltroStatus] = useState('');
    const [filtroSetor, setFiltroSetor] = useState('');

    const [modalOpen, setModalOpen] = useState(false);
    const [editId, setEditId] = useState<number | null>(null);
    const [form, setForm] = useState<any>({});
    const [salvando, setSalvando] = useState(false);

    const carregar = async () => {
        setLoading(true);
        try {
            const params: any = {};
            if (busca) params.search = busca;
            if (filtroTipo) params.tipo = filtroTipo;
            if (filtroStatus) params.status = filtroStatus;
            const r = await api.rhMovListar(params);
            setItens(r.movimentacoes || []);
        } catch (e: any) {
            toast.showToast(e.message || 'Erro', 'error');
        } finally { setLoading(false); }
    };
    useEffect(() => { (async () => { try { setColabs((await api.rhColaboradoresListar()).colaboradores || []); } catch {} })(); carregar(); }, []);
    useEffect(() => { const t = setTimeout(carregar, 300); return () => clearTimeout(t); }, [busca, filtroTipo, filtroStatus]);

    // Detecta ?open=<id> e abre modal de edição da movimentação
    useEffect(() => {
        const open = searchParams.get('open');
        if (!open) return;
        const id = parseInt(open, 10);
        if (!id) return;
        abrirEditar(id);
        const sp = new URLSearchParams(searchParams);
        sp.delete('open');
        setSearchParams(sp, { replace: true });
    }, []);

    const abrirAdmissao = () => {
        setEditId(null);
        setForm({ tipo: 'admissao', status: 'pendente', urgencia: 'normal', dados: { equipamentos: [], acessos: [], permissoes: [], fisicos: [] } });
        setModalOpen(true);
    };
    const abrirDesligamento = () => {
        setEditId(null);
        setForm({ tipo: 'desligamento', status: 'pendente', urgencia: 'normal', dados: { devolucao_equipamentos: [], bloqueios: [] } });
        setModalOpen(true);
    };
    const abrirEditar = async (id: number) => {
        try {
            const m = await api.rhMovObter(id);
            setEditId(id);
            setForm(m);
            setModalOpen(true);
        } catch (e: any) { toast.showToast(e.message, 'error'); }
    };
    const salvar = async () => {
        if (!form.titulo || !form.titulo.trim()) {
            toast.showToast('Título é obrigatório', 'error');
            return;
        }
        setSalvando(true);
        try {
            const payload: any = {};
            ['tipo', 'colaborador_id', 'titulo', 'setor', 'cargo', 'motivo', 'urgencia', 'data_prevista', 'data_efetivacao', 'status', 'solicitante_id', 'dados', 'observacoes'].forEach((k) => { payload[k] = form[k] === '' ? null : form[k]; });
            if (editId) await api.rhMovAtualizar(editId, payload);
            else await api.rhMovCriar(payload);
            toast.showToast('Salvo', 'success');
            setModalOpen(false);
            carregar();
        } catch (e: any) { toast.showToast(e.message || 'Erro', 'error'); }
        finally { setSalvando(false); }
    };
    const aprovar = async (m: any) => {
        try {
            const r = await api.rhMovAprovar(m.id);
            toast.showToast(r.ticket_id ? `Aprovado · Ticket TI #${String(r.ticket_id).slice(0, 8)} criado` : 'Aprovado', 'success');
            carregar();
        } catch (e: any) { toast.showToast(e.message, 'error'); }
    };
    const rejeitar = async (m: any) => { try { await api.rhMovRejeitar(m.id); toast.showToast('Rejeitado', 'success'); carregar(); } catch (e: any) { toast.showToast(e.message, 'error'); } };
    const remover = async (m: any) => { if (!confirm(`Remover "${m.titulo}"?`)) return; try { await api.rhMovRemover(m.id); carregar(); } catch (e: any) { toast.showToast(e.message, 'error'); } };

    return (
        <RhPageBg tema="rose">
                <header className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg shadow-rose-500/30">
                            <ArrowLeftRight className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black bg-gradient-to-r from-rose-600 to-pink-600 dark:from-rose-400 dark:to-pink-400 bg-clip-text text-transparent">
                                Movimentações
                            </h1>
                            <p className="text-xs text-slate-500 mt-0.5">Requisições de contratação e desligamento · gera ticket TI ao aprovar</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <VoltarDashboardRH />
                        <button onClick={abrirAdmissao} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700">
                            <UserPlus className="w-3.5 h-3.5" /> Contratação
                        </button>
                        <button onClick={abrirDesligamento} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700">
                            <UserMinus className="w-3.5 h-3.5" /> Desligamento
                        </button>
                    </div>
                </header>

                <ChipsPorSetor items={itens} setorKey="setor" value={filtroSetor} onChange={setFiltroSetor} />

                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-3 flex flex-wrap gap-2 items-center">
                    <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar título, setor, cargo…"
                        className="flex-1 min-w-[200px] px-3 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                    <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900">
                        <option value="">Tipo (todos)</option>
                        <option value="admissao">Admissão</option>
                        <option value="desligamento">Desligamento</option>
                    </select>
                    <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900">
                        <option value="">Status (todos)</option>
                        {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                </div>

                {loading ? <p className="p-6 text-center text-slate-500 text-sm">Carregando…</p> : itens.length === 0 ? (
                    <div className="p-10 text-center text-slate-400 bg-white dark:bg-slate-800 rounded-xl">
                        <ArrowLeftRight className="w-10 h-10 mx-auto mb-2 opacity-40" />
                        <p className="text-sm">Nenhuma movimentação</p>
                    </div>
                ) : (
                    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-slate-50 dark:bg-slate-900/40 text-slate-500 uppercase text-[10px]">
                                    <tr>
                                        <th className="px-3 py-2 text-left">Tipo</th>
                                        <th className="px-3 py-2 text-left">Título</th>
                                        <th className="px-3 py-2 text-left">Cargo / Setor</th>
                                        <th className="px-3 py-2 text-left">Urgência</th>
                                        <th className="px-3 py-2 text-left">Data prevista</th>
                                        <th className="px-3 py-2 text-center">Ticket TI</th>
                                        <th className="px-3 py-2 text-center">Status</th>
                                        <th className="px-3 py-2 text-right">Ações</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                    {itens.filter(m => !filtroSetor || (m.setor || 'Sem setor') === filtroSetor).map((m) => (
                                        <tr key={m.id} className="hover:bg-rose-50/40 dark:hover:bg-rose-900/10">
                                            <td className="px-3 py-2">
                                                {m.tipo === 'admissao' ? <span className="inline-flex items-center gap-1 text-emerald-600 font-bold"><UserPlus className="w-3 h-3" /> Admissão</span>
                                                    : <span className="inline-flex items-center gap-1 text-red-600 font-bold"><UserMinus className="w-3 h-3" /> Desligamento</span>}
                                            </td>
                                            <td className="px-3 py-2 font-bold">{m.titulo}</td>
                                            <td className="px-3 py-2 text-slate-600">{m.cargo || '—'} {m.setor && <span className="text-slate-400">· {m.setor}</span>}</td>
                                            <td className="px-3 py-2">{URG_LABEL[m.urgencia || 'normal']}</td>
                                            <td className="px-3 py-2">{fmtDate(m.data_prevista)}</td>
                                            <td className="px-3 py-2 text-center">
                                                {m.ticket_id ? (
                                                    <Link to={`/tickets/${m.ticket_id}`} className="text-rose-600 hover:underline inline-flex items-center gap-1">
                                                        <ExternalLink className="w-3 h-3" /> {String(m.ticket_id).slice(0, 8)}
                                                    </Link>
                                                ) : <span className="text-slate-300">—</span>}
                                            </td>
                                            <td className="px-3 py-2 text-center">
                                                <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COR[m.status]}`}>{STATUS_LABEL[m.status]}</span>
                                            </td>
                                            <td className="px-3 py-2 text-right whitespace-nowrap">
                                                {m.status === 'pendente' && (
                                                    <>
                                                        <button onClick={() => aprovar(m)} className="text-emerald-600 hover:bg-emerald-50 p-1 rounded" title="Aprovar e gerar ticket TI"><Check className="w-3.5 h-3.5" /></button>
                                                        <button onClick={() => rejeitar(m)} className="text-red-600 hover:bg-red-50 p-1 rounded" title="Rejeitar"><X className="w-3.5 h-3.5" /></button>
                                                    </>
                                                )}
                                                <button onClick={() => abrirEditar(m.id)} className="text-slate-400 hover:text-rose-600 p-1" title="Editar"><Pencil className="w-3.5 h-3.5" /></button>
                                                <button onClick={() => remover(m)} className="text-slate-400 hover:text-red-600 p-1" title="Remover"><Trash2 className="w-3.5 h-3.5" /></button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

            {modalOpen && (
                <MovimentacaoModal
                    form={form} setForm={setForm}
                    colabs={colabs}
                    onClose={() => setModalOpen(false)}
                    onSalvar={salvar}
                    salvando={salvando}
                    editId={editId}
                />
            )}
        </RhPageBg>
    );
};

// =============== MODAL ===============

const MovimentacaoModal: React.FC<{
    form: any; setForm: any; colabs: any[];
    onClose: () => void; onSalvar: () => void;
    salvando: boolean; editId: number | null;
}> = ({ form, setForm, colabs, onClose, onSalvar, salvando, editId }) => {
    const isAdmissao = form.tipo === 'admissao';
    const dados = form.dados || {};
    const setDados = (patch: any) => setForm({ ...form, dados: { ...dados, ...patch } });
    const toggleArr = (key: string, val: string) => {
        const arr: string[] = dados[key] || [];
        const newArr = arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val];
        setDados({ [key]: newArr });
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-20 pb-4 px-4 overflow-y-auto" onClick={() => !salvando && onClose()}>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                    <h3 className="font-bold flex items-center gap-2">
                        {isAdmissao ? <UserPlus className="w-4 h-4 text-emerald-600" /> : <UserMinus className="w-4 h-4 text-red-600" />}
                        {editId ? 'Editar' : 'Nova'} {isAdmissao ? 'requisição de contratação' : 'requisição de desligamento'}
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
                    {/* Identificação */}
                    <Secao titulo="Identificação">
                        <I label="Título / Cargo a contratar *" value={form.titulo || ''} onChange={(v) => setForm({ ...form, titulo: v })}
                            placeholder={isAdmissao ? 'Ex: Analista de DP' : 'Ex: João Silva (matrícula 0247)'} />
                        {!isAdmissao && (
                            <label className="block mt-2">
                                <span className="text-[10px] text-slate-500 font-semibold">Colaborador a desligar *</span>
                                <select value={form.colaborador_id || ''} onChange={(e) => setForm({ ...form, colaborador_id: e.target.value ? parseInt(e.target.value, 10) : null })}
                                    className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs">
                                    <option value="">— Selecione —</option>
                                    {colabs.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                                </select>
                            </label>
                        )}
                        <div className="grid grid-cols-2 gap-2 mt-2">
                            <I label="Cargo" value={form.cargo || ''} onChange={(v) => setForm({ ...form, cargo: v })} />
                            <I label="Setor" value={form.setor || ''} onChange={(v) => setForm({ ...form, setor: v })} />
                            <S label="Urgência" value={form.urgencia || 'normal'} onChange={(v) => setForm({ ...form, urgencia: v })} options={Object.entries(URG_LABEL).map(([v, l]) => ({ v, l }))} />
                            <I label={isAdmissao ? 'Data prevista de início' : 'Data prevista de desligamento'} type="date" value={form.data_prevista || ''} onChange={(v) => setForm({ ...form, data_prevista: v })} />
                        </div>
                        <label className="block mt-2">
                            <span className="text-[10px] text-slate-500 font-semibold">Motivo</span>
                            <textarea value={form.motivo || ''} onChange={(e) => setForm({ ...form, motivo: e.target.value })}
                                rows={2} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs"
                                placeholder={isAdmissao ? 'Aumento de quadro / Substituição / Vaga sazonal…' : 'Pedido / Sem justa causa / Acordo…'} />
                        </label>
                    </Secao>

                    {isAdmissao ? (
                        <>
                            <Secao titulo="🖥️ Equipamentos a solicitar">
                                <Chips opcoes={EQUIP_OPCOES} selecionadas={dados.equipamentos || []} onToggle={(v) => toggleArr('equipamentos', v)} />
                            </Secao>
                            <Secao titulo="🔑 Acessos do portal EMPRESA">
                                <p className="text-[10px] text-slate-500 mb-1">Quais módulos do portal o usuário precisa acessar?</p>
                                <Chips opcoes={MODULOS_PORTAL} selecionadas={dados.modulos_portal || []} onToggle={(v) => toggleArr('modulos_portal', v)} />
                            </Secao>
                            <Secao titulo="🌐 Sistemas externos">
                                <p className="text-[10px] text-slate-500 mb-1">4Bis, Chatwoot, StarSoft, etc.</p>
                                <Chips opcoes={SISTEMAS_EXTERNOS} selecionadas={dados.sistemas_externos || []} onToggle={(v) => toggleArr('sistemas_externos', v)} />
                            </Secao>
                            <Secao titulo="🔐 Acessos genéricos (TI)">
                                <Chips opcoes={ACESSO_OPCOES} selecionadas={dados.acessos || []} onToggle={(v) => toggleArr('acessos', v)} />
                            </Secao>
                            <Secao titulo="📁 Pastas de rede">
                                <label className="block">
                                    <span className="text-[10px] text-slate-500 font-semibold">Liste as pastas que precisa acessar (uma por linha)</span>
                                    <textarea
                                        value={(dados.pastas_rede || []).join('\n')}
                                        onChange={(e) => setDados({ pastas_rede: e.target.value.split('\n').map((s: string) => s.trim()).filter(Boolean) })}
                                        rows={3} placeholder={"\\\\servidor\\Financeiro\n\\\\servidor\\Comercial\\Carteira"}
                                        className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs font-mono"
                                    />
                                </label>
                            </Secao>
                            <Secao titulo="⚙️ Permissões especiais">
                                <Chips opcoes={PERM_OPCOES} selecionadas={dados.permissoes || []} onToggle={(v) => toggleArr('permissoes', v)} />
                            </Secao>
                            <Secao titulo="🚪 Acessos físicos">
                                <Chips opcoes={FIS_OPCOES} selecionadas={dados.fisicos || []} onToggle={(v) => toggleArr('fisicos', v)} />
                            </Secao>
                            <Secao titulo="🛠️ Detalhes do equipamento (TI preenche)">
                                <p className="text-[10px] text-slate-500 mb-2">Modelos exatos e patrimônio — preenchido pelo TI após aprovação.</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <I label="Modelo do notebook/desktop" value={(dados.ti_equipamentos || {}).modelo_computador || ''} onChange={(v) => setDados({ ti_equipamentos: { ...(dados.ti_equipamentos || {}), modelo_computador: v } })} />
                                    <I label="Patrimônio computador" value={(dados.ti_equipamentos || {}).patrimonio_computador || ''} onChange={(v) => setDados({ ti_equipamentos: { ...(dados.ti_equipamentos || {}), patrimonio_computador: v } })} />
                                    <I label="Modelo do celular" value={(dados.ti_equipamentos || {}).modelo_celular || ''} onChange={(v) => setDados({ ti_equipamentos: { ...(dados.ti_equipamentos || {}), modelo_celular: v } })} />
                                    <I label="IMEI / patrimônio celular" value={(dados.ti_equipamentos || {}).patrimonio_celular || ''} onChange={(v) => setDados({ ti_equipamentos: { ...(dados.ti_equipamentos || {}), patrimonio_celular: v } })} />
                                    <I label="Monitor(es)" value={(dados.ti_equipamentos || {}).monitor || ''} onChange={(v) => setDados({ ti_equipamentos: { ...(dados.ti_equipamentos || {}), monitor: v } })} placeholder="Dell P2422H · 2 unidades" />
                                    <I label="Número do crachá" value={(dados.ti_equipamentos || {}).cracha || ''} onChange={(v) => setDados({ ti_equipamentos: { ...(dados.ti_equipamentos || {}), cracha: v } })} />
                                </div>
                                <label className="block mt-2">
                                    <span className="text-[10px] text-slate-500 font-semibold">Outros equipamentos / observações TI</span>
                                    <textarea value={(dados.ti_equipamentos || {}).outros || ''}
                                        onChange={(e) => setDados({ ti_equipamentos: { ...(dados.ti_equipamentos || {}), outros: e.target.value } })}
                                        rows={2} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
                                </label>
                            </Secao>
                        </>
                    ) : (
                        <>
                            <EquipamentosVinculadosLoader colaboradorId={form.colaborador_id} dados={dados} setDados={setDados} />
                            <Secao titulo="🔒 Bloqueios necessários (para TI)">
                                <Chips opcoes={BLOQ_OPCOES} selecionadas={dados.bloqueios || []} onToggle={(v) => toggleArr('bloqueios', v)} />
                            </Secao>
                            <Secao titulo="📦 Equipamentos a devolver">
                                <Chips opcoes={DEV_OPCOES} selecionadas={dados.devolucao_equipamentos || []} onToggle={(v) => toggleArr('devolucao_equipamentos', v)} />
                            </Secao>
                        </>
                    )}

                    <Secao titulo="Observações">
                        <label className="block">
                            <span className="text-[10px] text-slate-500 font-semibold">Observações para a TI</span>
                            <textarea value={dados.observacoes_ti || ''} onChange={(e) => setDados({ observacoes_ti: e.target.value })}
                                rows={2} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
                        </label>
                        <label className="block mt-2">
                            <span className="text-[10px] text-slate-500 font-semibold">Observações gerais</span>
                            <textarea value={form.observacoes || ''} onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
                                rows={2} className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
                        </label>
                    </Secao>

                    <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-2 text-[11px] text-blue-700 dark:text-blue-200">
                        ℹ️ Ao <strong>Aprovar</strong>, um ticket é criado automaticamente no módulo de TI com tudo o que está marcado acima.
                    </div>
                </div>
                <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                    <button onClick={onClose} disabled={salvando} className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg">Cancelar</button>
                    <button onClick={onSalvar} disabled={salvando} className="inline-flex items-center gap-1 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg disabled:opacity-50">
                        <Save className="w-3.5 h-3.5" /> {salvando ? '…' : 'Salvar'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const EquipamentosVinculadosLoader: React.FC<{ colaboradorId: any; dados: any; setDados: (p: any) => void }> = ({ colaboradorId, dados, setDados }) => {
    const [info, setInfo] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    useEffect(() => {
        if (!colaboradorId) { setInfo(null); return; }
        setLoading(true);
        api.rhMovEquipamentosColab(colaboradorId)
            .then((r) => setInfo(r))
            .catch(() => setInfo(null))
            .finally(() => setLoading(false));
    }, [colaboradorId]);

    const importarDaAdmissao = () => {
        if (!info?.encontrado) return;
        setDados({
            devolucao_equipamentos: [...(info.equipamentos || []), ...(info.fisicos || [])],
            bloqueios: [...(info.acessos || []), ...(info.sistemas_externos || [])],
            ti_equipamentos: info.ti_equipamentos || {},
        });
    };

    if (!colaboradorId) {
        return (
            <Secao titulo="🔍 Equipamentos vinculados ao colaborador">
                <p className="text-xs text-slate-400 italic">Selecione o colaborador acima para carregar equipamentos/acessos vinculados.</p>
            </Secao>
        );
    }
    if (loading) {
        return <Secao titulo="🔍 Equipamentos vinculados"><p className="text-xs text-slate-400">Carregando…</p></Secao>;
    }
    if (!info?.encontrado) {
        return (
            <Secao titulo="🔍 Equipamentos vinculados">
                <p className="text-xs text-amber-600">Não encontramos uma admissão aprovada para este colaborador. Preencha manualmente os bloqueios e devoluções abaixo.</p>
            </Secao>
        );
    }
    return (
        <Secao titulo={`🔍 Equipamentos vinculados — origem: ${info.movimentacao_origem?.titulo || '—'}`}>
            <div className="text-[11px] space-y-1.5">
                {info.ti_equipamentos && Object.keys(info.ti_equipamentos).length > 0 && (
                    <div className="bg-slate-50 dark:bg-slate-900/40 rounded p-2 grid grid-cols-2 gap-1">
                        {Object.entries(info.ti_equipamentos).map(([k, v]) => v ? (
                            <div key={k}><strong className="text-slate-500">{k.replace(/_/g, ' ')}:</strong> {String(v)}</div>
                        ) : null)}
                    </div>
                )}
                {info.equipamentos?.length > 0 && (<div><strong>Equipamentos:</strong> {info.equipamentos.join(', ')}</div>)}
                {info.acessos?.length > 0 && (<div><strong>Acessos:</strong> {info.acessos.join(', ')}</div>)}
                {info.sistemas_externos?.length > 0 && (<div><strong>Sistemas externos:</strong> {info.sistemas_externos.join(', ')}</div>)}
                {info.modulos_portal?.length > 0 && (<div><strong>Módulos do portal:</strong> {info.modulos_portal.join(', ')}</div>)}
                {info.pastas_rede?.length > 0 && (<div><strong>Pastas:</strong> {info.pastas_rede.join(', ')}</div>)}
                {info.fisicos?.length > 0 && (<div><strong>Físicos:</strong> {info.fisicos.join(', ')}</div>)}
                <button type="button" onClick={importarDaAdmissao}
                    className="mt-2 inline-flex items-center gap-1 px-2 py-1 rounded bg-emerald-600 text-white text-[11px] font-bold hover:bg-emerald-700">
                    Pré-preencher bloqueios e devoluções a partir da admissão
                </button>
            </div>
        </Secao>
    );
};

const Secao: React.FC<{ titulo: string; children: React.ReactNode }> = ({ titulo, children }) => {
    const [open, setOpen] = useState(true);
    return (
        <div className="border border-slate-200 dark:border-slate-700 rounded-lg">
            <button type="button" onClick={() => setOpen(!open)} className="w-full px-3 py-2 flex items-center justify-between text-[11px] uppercase tracking-wider font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-900/40">
                <span>{titulo}</span>
                {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
            {open && <div className="px-3 pb-3">{children}</div>}
        </div>
    );
};

const Chips: React.FC<{ opcoes: string[]; selecionadas: string[]; onToggle: (v: string) => void }> = ({ opcoes, selecionadas, onToggle }) => (
    <div className="flex flex-wrap gap-1">
        {opcoes.map((o) => {
            const sel = selecionadas.includes(o);
            return (
                <button key={o} type="button" onClick={() => onToggle(o)}
                    className={`px-2 py-1 rounded-full text-[10px] font-semibold border transition ${sel
                        ? 'bg-rose-600 text-white border-rose-600'
                        : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 dark:border-slate-600 hover:border-rose-400'}`}>
                    {sel ? '✓ ' : ''}{o}
                </button>
            );
        })}
    </div>
);

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

export default MovimentacoesPage;
