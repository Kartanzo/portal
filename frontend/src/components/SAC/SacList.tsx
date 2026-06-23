import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { User } from '../../types';
import { api } from '../../app_api';
import { useToast } from '../../contexts/ToastContext';
import { Plus, Search, X, RefreshCw, EyeOff, Trash2 } from 'lucide-react';
import { useConfirm } from '../../contexts/ConfirmContext';
import { SacStatusBadge, SacPrioridadeBadge, STATUS_INVISIVEL_EXTERNO } from './SacStatusBadge';
import { formatDateBR } from '../dateUtils';

interface Props { user: User; }

const SacList: React.FC<Props> = ({ user }) => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const isExterno = user.role === 'externo';
  const isInternal = !isExterno;
  const isSuperUser = user.role === 'super_user';

  const confirmar = useConfirm();
  const handleExcluirTicket = async (e: React.MouseEvent, ticketId: any, protocolo: string) => {
    e.stopPropagation();
    const ok = await confirmar({
      title: `Excluir ${protocolo}`,
      message: 'O chamado será ocultado da lista. O registro permanece no banco e pode ser restaurado depois.',
      confirmText: 'Excluir',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const res = await fetch(`/api/sac/tickets/${ticketId}`, {
        method: 'DELETE',
        credentials: 'include',
        headers: { 'user-id': user.id },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || 'Erro ao excluir');
      }
      setTickets(prev => prev.filter(t => t.id !== ticketId));
      showToast(`Chamado ${protocolo} excluido.`, 'success');
    } catch (err: any) {
      showToast(`Falha: ${err.message || err}`, 'error');
    }
  };

  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSetor, setFilterSetor] = useState('');
  const [filterPrioridade, setFilterPrioridade] = useState('');

  const STATUS_OPTIONS = isExterno
    ? ['Aberto', 'Aguardando seu retorno', 'Em processamento', 'Concluído', 'Cancelado']
    : ['Aberto', 'Em Análise', 'Aguardando Retorno', 'Em Resolução', 'Concluído', 'Cancelado'];
  const SETOR_OPTIONS = ['SAC', 'Logística', 'Financeiro', 'Comercial', 'Qualidade'];
  const PRIORIDADE_OPTIONS = ['Baixa', 'Média', 'Alta', 'Urgente'];

  const load = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (filterStatus) params.status = filterStatus;
      if (filterSetor) params.setor = filterSetor;
      if (filterPrioridade) params.prioridade = filterPrioridade;
      if (search) params.q = search;
      const data = await api.get('/sac/tickets', { params });
      const list = data?.data ?? data;
      setTickets(Array.isArray(list) ? list : []);
    } catch {
      showToast('Erro ao carregar chamados SAC', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [filterStatus, filterSetor, filterPrioridade]);

  const filtered = useMemo(() => {
    if (!search) return tickets;
    const q = search.toLowerCase();
    return tickets.filter(t =>
      t.protocolo?.toLowerCase().includes(q) ||
      t.razao_social?.toLowerCase().includes(q) ||
      t.cnpj_cpf?.includes(q)
    );
  }, [tickets, search]);

  const hasActiveFilter = filterStatus || filterSetor || filterPrioridade;

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">SAC — Chamados</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {isExterno ? 'Seus chamados de atendimento' : 'Todos os chamados de clientes'}
          </p>
        </div>
        <button
          onClick={() => navigate('/sac/novo')}
          className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          Novo Chamado
        </button>
      </div>

      {/* Filtros */}
      <div className="bg-white border border-slate-200 rounded-xl p-4 mb-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Busca */}
          <div className="relative sm:flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por protocolo, razão social ou CNPJ..."
              className="w-full pl-9 pr-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
          <button onClick={load} className="flex items-center gap-1.5 px-3 py-2.5 border border-slate-300 rounded-lg text-slate-600 text-sm hover:bg-slate-50 transition-colors">
            <RefreshCw className="w-4 h-4" />
            Atualizar
          </button>
        </div>

        <div className="flex flex-wrap gap-2">
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
            <option value="">Todos os status</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>

          {isInternal && (
            <>
              <select value={filterSetor} onChange={e => setFilterSetor(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Todos os setores</option>
                {SETOR_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={filterPrioridade} onChange={e => setFilterPrioridade(e.target.value)} className="border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">Todas as prioridades</option>
                {PRIORIDADE_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </>
          )}

          {hasActiveFilter && (
            <button
              onClick={() => { setFilterStatus(''); setFilterSetor(''); setFilterPrioridade(''); }}
              className="flex items-center gap-1 px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
            >
              <X className="w-3.5 h-3.5" /> Limpar filtros
            </button>
          )}
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-6 h-6 text-indigo-500 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-slate-400">
          <p className="text-lg font-semibold">Nenhum chamado encontrado</p>
          <p className="text-sm mt-1">Tente ajustar os filtros ou abra um novo chamado</p>
        </div>
      ) : (
        <>
          {/* Desktop: tabela */}
          <div className="hidden md:block bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Protocolo</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Cliente</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Tipo</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Status</th>
                  {isInternal && <th className="text-left px-4 py-3 font-semibold text-slate-600">Prioridade</th>}
                  {isInternal && <th className="text-left px-4 py-3 font-semibold text-slate-600">Setor</th>}
                  {isInternal && <th className="text-left px-4 py-3 font-semibold text-slate-600">Aberto por</th>}
                  {isInternal && <th className="text-left px-4 py-3 font-semibold text-slate-600">Última interação</th>}
                  <th className="text-left px-4 py-3 font-semibold text-slate-600">Abertura</th>
                  {isSuperUser && <th className="px-2 py-3"></th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors" onClick={() => navigate(`/sac/${t.id}`)}>
                    <td className="px-4 py-3 font-mono font-semibold text-indigo-700">{t.protocolo}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800 truncate max-w-[160px]">{t.razao_social}</div>
                      <div className="text-xs text-slate-400">{t.cnpj_cpf}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{t.tipo_problema}</td>
                    <td className="px-4 py-3">
                      <SacStatusBadge status={t.status} statusDisplay={t.status_display} showVisibilityIcon={isInternal} />
                    </td>
                    {isInternal && <td className="px-4 py-3"><SacPrioridadeBadge prioridade={t.prioridade} /></td>}
                    {isInternal && <td className="px-4 py-3 text-slate-600 text-xs">{t.setor_destino}</td>}
                    {isInternal && <td className="px-4 py-3 text-slate-600 text-xs">{t.aberto_por_nome || t.razao_social || '-'}</td>}
                    {isInternal && <td className="px-4 py-3 text-slate-600 text-xs">{t.ultima_interacao_nome || '-'}</td>}
                    <td className="px-4 py-3 text-slate-400 text-xs">{t.criado_em ? formatDateBR(t.criado_em) : '-'}</td>
                    {isSuperUser && (
                      <td className="px-2 py-3 text-right">
                        <button
                          onClick={(e) => handleExcluirTicket(e, t.id, t.protocolo)}
                          title="Excluir chamado (super_user)"
                          className="p-1.5 text-rose-500 hover:text-white hover:bg-rose-500 rounded transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile: cards */}
          <div className="md:hidden space-y-3">
            {filtered.map(t => (
              <Link key={t.id} to={`/sac/${t.id}`} className="block bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:border-indigo-300 transition-colors">
                <div className="flex items-start justify-between gap-2 mb-2">
                  <span className="font-mono font-bold text-indigo-700 text-sm">{t.protocolo}</span>
                  <SacStatusBadge status={t.status} statusDisplay={t.status_display} showVisibilityIcon={isInternal} />
                </div>
                <div className="font-semibold text-slate-800 text-sm">{t.razao_social}</div>
                <div className="text-xs text-slate-400 mt-0.5">{t.cnpj_cpf}</div>
                <div className="flex flex-wrap gap-2 mt-3">
                  <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{t.tipo_problema}</span>
                  {isInternal && <SacPrioridadeBadge prioridade={t.prioridade} />}
                  {isInternal && <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">{t.setor_destino}</span>}
                </div>
                <div className="text-xs text-slate-400 mt-2">{t.criado_em ? formatDateBR(t.criado_em) : '-'}</div>
                {isInternal && STATUS_INVISIVEL_EXTERNO.includes(t.status) && (
                  <div className="flex items-center gap-1 mt-2 text-xs text-amber-600">
                    <EyeOff className="w-3 h-3" /> Externo não vê este status
                  </div>
                )}
              </Link>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default SacList;
