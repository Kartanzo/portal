import React, { useState, useEffect, useMemo } from 'react';
import { MobileLandscapeHint } from '../ui/MobileLandscapeHint';
import { User } from '../../types';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../app_api';
import { useToast } from '../../contexts/ToastContext';
import { Search, Filter, X, Plus, ChevronUp, ChevronDown, ChevronRight, MoreHorizontal, FolderOpen, Folder, Eye, EyeOff, Paperclip, Loader2 } from 'lucide-react';
import { formatDateBR } from '../dateUtils';
import ConfirmationModal from '../ConfirmationModal';

const IS_FILTER_KEY = 'blackd_is_ticket_filters';

const PRIORITY_STYLE: Record<string, string> = {
  'Urgente': 'bg-red-100 text-red-800 border-red-200',
  'Alta': 'bg-orange-100 text-orange-800 border-orange-200',
  'Média': 'bg-blue-100 text-blue-800 border-blue-200',
  'Baixa': 'bg-slate-100 text-slate-700 border-slate-200',
};

const STATUS_STYLE: Record<string, string> = {
  'Aberto': 'text-blue-600 bg-blue-50',
  'Em Atendimento': 'text-orange-600 bg-orange-50',
  'Aguardando Usuário': 'text-yellow-600 bg-yellow-50',
  'Em Validação': 'text-purple-600 bg-purple-50',
  'Aguardando Suporte': 'text-indigo-600 bg-indigo-50',
  'Concluído': 'text-green-600 bg-green-50',
  'Cancelado': 'text-gray-500 bg-gray-50',
};

const ALL_STATUSES = ['Aberto', 'Em Atendimento', 'Aguardando Usuário', 'Em Validação', 'Aguardando Suporte', 'Concluído', 'Cancelado'];
const ALL_PRIORITIES = ['Baixa', 'Média', 'Alta', 'Urgente'];

const SECTOR_COLOR_PALETTE = [
  { bg: 'bg-blue-50', border: 'border-blue-200', text: 'text-blue-800', badge: 'bg-blue-600 text-white' },
  { bg: 'bg-purple-50', border: 'border-purple-200', text: 'text-purple-800', badge: 'bg-purple-600 text-white' },
  { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-800', badge: 'bg-emerald-600 text-white' },
  { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-800', badge: 'bg-orange-600 text-white' },
  { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-800', badge: 'bg-rose-600 text-white' },
  { bg: 'bg-indigo-50', border: 'border-indigo-200', text: 'text-indigo-800', badge: 'bg-indigo-600 text-white' },
  { bg: 'bg-teal-50', border: 'border-teal-200', text: 'text-teal-800', badge: 'bg-teal-600 text-white' },
];

interface ISFilterState {
  query: string;
  status: string;
  priority: string;
  targetSector: string;
}

const DEFAULT_FILTERS: ISFilterState = { query: '', status: '', priority: '', targetSector: '' };

interface Props { user: User; }

const InterSectorTicketList: React.FC<Props> = ({ user }) => {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const isSuperUser = user.role === 'super_user';

  const [tickets, setTickets] = useState<any[]>([]);
  const [interSectorData, setInterSectorData] = useState<{ allowed_sectors: string[], allowed_users: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [rowDetails, setRowDetails] = useState<Record<string, any[]>>({});
  const [loadingRows, setLoadingRows] = useState<Set<string>>(new Set());

  const handleExpandRow = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (expandedRows.has(id)) {
      setExpandedRows(prev => { const n = new Set(prev); n.delete(id); return n; });
      return;
    }
    setExpandedRows(prev => new Set(prev).add(id));
    if (rowDetails[id]) return;
    setLoadingRows(prev => new Set(prev).add(id));
    try {
      const updates = await api.getInterSectorTicketUpdates(id);
      setRowDetails(prev => ({ ...prev, [id]: Array.isArray(updates) ? updates : [] }));
    } catch {
      setRowDetails(prev => ({ ...prev, [id]: [] }));
    } finally {
      setLoadingRows(prev => { const n = new Set(prev); n.delete(id); return n; });
    }
  };

  const [filters, setFilters] = useState<ISFilterState>(() => {
    try {
      const saved = sessionStorage.getItem(IS_FILTER_KEY);
      if (saved) return JSON.parse(saved);
    } catch {}
    return DEFAULT_FILTERS;
  });

  const [sortConfig, setSortConfig] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'created_at', dir: 'desc' });

  // Accordion state — sectors expanded by default, categories collapsed
  const [expandedSectors, setExpandedSectors] = useState<Set<string>>(new Set());
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const sectorOptions = useMemo(() => interSectorData?.allowed_sectors ?? [], [interSectorData]);

  useEffect(() => {
    sessionStorage.setItem(IS_FILTER_KEY, JSON.stringify(filters));
  }, [filters]);

  useEffect(() => {
    Promise.all([
      api.getInterSectorTickets(),
      api.getInterSectorSectors(),
    ]).then(([ticketsResult, sectorsResult]) => {
      setTickets(ticketsResult);
      setInterSectorData(sectorsResult);
      setExpandedSectors(new Set(sectorsResult.allowed_sectors));
    }).catch(() => showToast('Erro ao carregar chamados.', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const toggleSector = (sector: string) => {
    setExpandedSectors(prev => {
      const next = new Set(prev);
      if (next.has(sector)) next.delete(sector); else next.add(sector);
      return next;
    });
  };

  const toggleCategory = (key: string) => {
    setExpandedCategories(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  };

  const filtered = useMemo(() => {
    return tickets.filter(t => {
      const q = filters.query.toLowerCase();
      if (q && !t.title?.toLowerCase().includes(q) && !t.id?.toLowerCase().includes(q)) return false;
      if (filters.status && t.status !== filters.status) return false;
      if (filters.priority && t.priority !== filters.priority) return false;
      if (filters.targetSector && t.target_sector !== filters.targetSector) return false;
      return true;
    }).sort((a, b) => {
      const { key, dir } = sortConfig;
      const av = a[key] ?? '';
      const bv = b[key] ?? '';
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [tickets, filters, sortConfig]);

  const groupedTickets = useMemo(() => {
    const groups: Record<string, Record<string, any[]>> = {};
    sectorOptions.forEach(s => { groups[s] = {}; });
    filtered.forEach(t => {
      const sector = t.target_sector || 'Sem Setor';
      if (!groups[sector]) groups[sector] = {};
      const cat = t.category || 'Sem Categoria';
      if (!groups[sector][cat]) groups[sector][cat] = [];
      groups[sector][cat].push(t);
    });
    return groups;
  }, [filtered, sectorOptions]);

  const sectorColorMap = useMemo(() => {
    const map: Record<string, typeof SECTOR_COLOR_PALETTE[0]> = {};
    sectorOptions.forEach((s, i) => { map[s] = SECTOR_COLOR_PALETTE[i % SECTOR_COLOR_PALETTE.length]; });
    return map;
  }, [sectorOptions]);

  const sort = (key: string) => {
    setSortConfig(prev => ({ key, dir: prev.key === key && prev.dir === 'asc' ? 'desc' : 'asc' }));
  };

  const SortIcon = ({ k }: { k: string }) => sortConfig.key === k
    ? (sortConfig.dir === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)
    : null;

  const hasFilters = Object.values(filters).some(Boolean);

  const clearFilters = () => {
    setFilters(DEFAULT_FILTERS);
    sessionStorage.removeItem(IS_FILTER_KEY);
  };

  const renderTicketRows = (ticketList: any[]) => (
    <>
    <MobileLandscapeHint message="A lista funciona melhor em paisagem ou no desktop." />
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead className="bg-gray-50 border-b border-gray-100">
          <tr className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
            <th className="px-6 py-3 cursor-pointer hover:text-gray-600" onClick={() => sort('title')}>
              <div className="flex items-center gap-1">Chamado <SortIcon k="title" /></div>
            </th>
            <th className="px-6 py-3 cursor-pointer hover:text-gray-600" onClick={() => sort('requester_sector')}>
              <div className="flex items-center gap-1">De <SortIcon k="requester_sector" /></div>
            </th>
            <th className="px-6 py-3 cursor-pointer hover:text-gray-600" onClick={() => sort('priority')}>
              <div className="flex items-center gap-1">Prioridade <SortIcon k="priority" /></div>
            </th>
            <th className="px-6 py-3 cursor-pointer hover:text-gray-600" onClick={() => sort('status')}>
              <div className="flex items-center gap-1">Status <SortIcon k="status" /></div>
            </th>
            <th className="px-6 py-3 cursor-pointer hover:text-gray-600" onClick={() => sort('created_at')}>
              <div className="flex items-center gap-1">Abertura <SortIcon k="created_at" /></div>
            </th>
            <th className="px-6 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {ticketList.map(t => {
            const isExpanded = expandedRows.has(t.id);
            const isLoadingRow = loadingRows.has(t.id);
            const details = rowDetails[t.id] || [];
            const lastMsg = [...details].reverse().find((u: any) => u.message && !u.is_system);
            const attachments = details.filter((u: any) => u.attachment_path);
            return (
            <React.Fragment key={t.id}>
            <tr className="hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => navigate(`/inter-sector-tickets/${t.id}`)}>
              <td className="px-6 py-4">
                <div className="flex items-start gap-2">
                  <button
                    onClick={(e) => handleExpandRow(e, t.id)}
                    className={`mt-0.5 flex-shrink-0 p-1 rounded transition-colors ${isExpanded ? 'text-red-500 bg-red-50' : 'text-gray-300 hover:text-gray-600 hover:bg-gray-100'}`}
                    title="Visualizar detalhes"
                  >
                    {isLoadingRow ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isExpanded ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-red-600 mb-0.5">CS-{t.id.substring(0, 8).toUpperCase()}</span>
                    <span className="text-sm font-semibold text-gray-900">{t.title}</span>
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 text-sm text-gray-600">{t.requester_sector || '-'}</td>
              <td className="px-6 py-4">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${PRIORITY_STYLE[t.priority] || 'bg-gray-100 text-gray-700 border-gray-200'}`}>
                  {t.priority}
                </span>
              </td>
              <td className="px-6 py-4">
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${STATUS_STYLE[t.status] || 'text-gray-600 bg-gray-50'}`}>
                  {t.status}
                </span>
              </td>
              <td className="px-6 py-4 text-[10px] text-gray-500 font-medium">{formatDateBR(t.created_at)}</td>
              <td className="px-6 py-4 text-center">
                {isSuperUser ? (
                  <button
                    onClick={e => { e.stopPropagation(); setDeleteId(t.id); }}
                    className="text-red-300 hover:text-red-700 transition-colors p-1"
                    title="Excluir"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                  </button>
                ) : <MoreHorizontal className="w-5 h-5 text-gray-300" />}
              </td>
            </tr>
            {isExpanded && (
              <tr className="bg-gray-50">
                <td colSpan={7} className="px-6 py-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Mensagem Original</p>
                      <p className="text-gray-700 whitespace-pre-wrap line-clamp-5">{t.description || '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Última Resposta</p>
                      {isLoadingRow ? <p className="text-gray-400 italic">Carregando...</p> : lastMsg ? (
                        <div>
                          <p className="text-[10px] font-bold text-gray-500 mb-0.5">{lastMsg.user_name}</p>
                          <p className="text-gray-700 whitespace-pre-wrap line-clamp-4">{lastMsg.message}</p>
                        </div>
                      ) : <p className="text-gray-400 italic">Sem respostas</p>}
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Anexos</p>
                      {attachments.length === 0 ? <p className="text-gray-400 italic">Nenhum anexo</p> : (
                        <div className="space-y-1">
                          {attachments.map((u: any, i: number) => (
                            <a key={i} href={`${api.API_PREFIX}/inter-sector-ticket-updates/${u.id}/attachment`} target="_blank" rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="flex items-center gap-1.5 text-blue-600 hover:underline truncate">
                              <Paperclip className="w-3 h-3 flex-shrink-0" />
                              <span className="truncate">{u.attachment_name || `Arquivo ${i + 1}`}</span>
                            </a>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </td>
              </tr>
            )}
            </React.Fragment>
          )})}
        </tbody>
      </table>
    </div>
    </>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Chamados Entre Setores</h1>
          <p className="text-gray-500 text-sm">Solicitações e comunicação entre departamentos.</p>
        </div>
        <Link
          to="/inter-sector-tickets/new"
          className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-bold shadow-sm hover:bg-red-700 transition-colors"
        >
          <Plus className="w-4 h-4" /> Novo Chamado
        </Link>
      </div>

      {/* Filter Bar */}
      <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm">
        <div className="flex items-center gap-2 mb-3 text-gray-500 text-xs font-bold uppercase tracking-wider">
          <Filter className="w-3 h-3" /> Filtros
        </div>
        <div className="flex flex-wrap gap-3 items-center">
          <div className="relative flex-grow min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Buscar por título ou ID..."
              value={filters.query}
              onChange={e => setFilters(prev => ({ ...prev, query: e.target.value }))}
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
          </div>
          <select
            value={filters.targetSector}
            onChange={e => setFilters(prev => ({ ...prev, targetSector: e.target.value }))}
            className="flex-grow min-w-[160px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
          >
            <option value="">Todos os Setores</option>
            {sectorOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={filters.status}
            onChange={e => setFilters(prev => ({ ...prev, status: e.target.value }))}
            className="flex-grow min-w-[160px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
          >
            <option value="">Todos os Status</option>
            {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <select
            value={filters.priority}
            onChange={e => setFilters(prev => ({ ...prev, priority: e.target.value }))}
            className="flex-grow min-w-[140px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
          >
            <option value="">Todas as Prioridades</option>
            {ALL_PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          {hasFilters && (
            <button onClick={clearFilters} className="flex items-center px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50 rounded-lg transition-colors whitespace-nowrap">
              <X className="w-3 h-3 mr-1" /> Limpar
            </button>
          )}
        </div>
      </div>

      {/* Grouped Accordion */}
      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Nenhum chamado encontrado.</div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedTickets).map(([sectorName, categoryGroups]) => {
            const sectorTotal = Object.values(categoryGroups).reduce((sum, list) => sum + list.length, 0);
            if (sectorTotal === 0) return null;

            const colors = sectorColorMap[sectorName] ?? SECTOR_COLOR_PALETTE[0];
            const isSectorExpanded = expandedSectors.has(sectorName);

            return (
              <div key={sectorName} className={`rounded-xl border ${colors.border} overflow-hidden shadow-sm`}>
                {/* Sector Header */}
                <button
                  className={`w-full flex items-center justify-between px-6 py-4 ${colors.bg} hover:brightness-95 transition-all`}
                  onClick={() => toggleSector(sectorName)}
                >
                  <div className="flex items-center gap-3">
                    {isSectorExpanded
                      ? <FolderOpen className={`w-5 h-5 ${colors.text}`} />
                      : <Folder className={`w-5 h-5 ${colors.text}`} />
                    }
                    <span className={`text-base font-bold ${colors.text}`}>{sectorName}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${colors.badge}`}>
                      {sectorTotal} {sectorTotal === 1 ? 'chamado' : 'chamados'}
                    </span>
                  </div>
                  {isSectorExpanded
                    ? <ChevronDown className={`w-5 h-5 ${colors.text}`} />
                    : <ChevronRight className={`w-5 h-5 ${colors.text}`} />
                  }
                </button>

                {/* Category Groups */}
                {isSectorExpanded && (
                  <div className="divide-y divide-gray-100 bg-white">
                    {Object.entries(categoryGroups).map(([categoryName, categoryTickets]) => {
                      const catKey = `${sectorName}:${categoryName}`;
                      const isCatExpanded = expandedCategories.has(catKey);

                      return (
                        <div key={catKey}>
                          {/* Category Header */}
                          <button
                            className="w-full flex items-center justify-between px-8 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
                            onClick={() => toggleCategory(catKey)}
                          >
                            <div className="flex items-center gap-2">
                              {isCatExpanded
                                ? <ChevronDown className="w-4 h-4 text-gray-500" />
                                : <ChevronRight className="w-4 h-4 text-gray-500" />
                              }
                              <span className="text-sm font-semibold text-gray-700">{categoryName}</span>
                              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-gray-200 text-gray-600">
                                {categoryTickets.length}
                              </span>
                            </div>
                          </button>

                          {/* Ticket Table */}
                          {isCatExpanded && (
                            <div className="border-t border-gray-100">
                              {renderTicketRows(categoryTickets)}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmationModal
        isOpen={!!deleteId}
        onClose={() => setDeleteId(null)}
        onConfirm={async () => {
          if (!deleteId) return;
          setIsDeleting(true);
          try {
            await api.deleteInterSectorTicket(deleteId);
            setTickets(prev => prev.filter(t => t.id !== deleteId));
            setDeleteId(null);
            showToast('Chamado excluído.', 'success');
          } catch {
            showToast('Erro ao excluir chamado.', 'error');
          } finally {
            setIsDeleting(false);
          }
        }}
        title="Excluir Chamado"
        message="Tem certeza que deseja excluir este chamado? Esta ação não pode ser desfeita."
        isLoading={isDeleting}
      />
    </div>
  );
};

export default InterSectorTicketList;
