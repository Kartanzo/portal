import React, { useState, useEffect, useMemo } from 'react';
import { MobileLandscapeHint } from './ui/MobileLandscapeHint';
import { TicketStatus, TicketPriority, TicketCategory, UserRole, Ticket, User } from '../types';
import { MoreHorizontal, Calendar, ChevronUp, ChevronDown, LayoutDashboard, ChevronRight, Folder, FolderOpen, Eye, EyeOff, Paperclip, Loader2 } from 'lucide-react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { api } from '../app_api';
import ConfirmationModal from './ConfirmationModal';
import FilterBar, { FilterState } from './FilterBar';
import { formatDateBR, formatDateOnly } from './dateUtils';

import { useToast } from '../contexts/ToastContext';

export const TICKET_FILTER_STORAGE_KEY = 'empresa_ticket_filters';

const TI_CATEGORIES: string[] = [TicketCategory.STARSOFT, TicketCategory.INFRASTRUCTURE];

const DEFAULT_FILTERS: FilterState = {
  query: '',
  requester: '',
  sector: '',
  responsibleSector: [],
  status: [],
  priority: [],
  category: [],
};

interface TicketListProps {
  user: User;
}

const TicketList: React.FC<TicketListProps> = ({ user }) => {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [tickets, setTickets] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const userRole = user.role;
  const userId = user.id;
  const canViewAllSectors = user.role === 'super_user' || user.permissions?.['tickets']?.view_all_sectors;

  // Filters State — URL params take priority (navigation from other pages), then sessionStorage
  const [filters, setFilters] = useState<FilterState>(() => {
    const searchParams = new URLSearchParams(location.search);
    const hasUrlParams = searchParams.get('status') || searchParams.get('category') || searchParams.get('sector');

    if (hasUrlParams) {
      return {
        ...DEFAULT_FILTERS,
        status: searchParams.get('status') ? [searchParams.get('status')!] : [],
        category: searchParams.get('category') ? [searchParams.get('category')!] : [],
        sector: searchParams.get('sector') || '',
        startDate: searchParams.get('start') || '',
        endDate: searchParams.get('end') || ''
      };
    }

    try {
      const saved = sessionStorage.getItem(TICKET_FILTER_STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        // Migrate old string-based session data to arrays and persist all filters
        return {
          ...parsed,
          status: Array.isArray(parsed.status) ? parsed.status : (parsed.status ? [parsed.status] : []),
          priority: Array.isArray(parsed.priority) ? parsed.priority : (parsed.priority ? [parsed.priority] : []),
          category: Array.isArray(parsed.category) ? parsed.category : (parsed.category ? [parsed.category] : []),
          responsibleSector: Array.isArray(parsed.responsibleSector) ? parsed.responsibleSector : (parsed.responsibleSector ? [parsed.responsibleSector] : []),
        };
      }
    } catch { }

    return DEFAULT_FILTERS;
  });

  // Persist filters to sessionStorage on every change
  useEffect(() => {
    sessionStorage.setItem(TICKET_FILTER_STORAGE_KEY, JSON.stringify(filters));
  }, [filters]);

  // Row expand state (preview inline)
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
  const [rowDetails, setRowDetails] = useState<Record<string, any[]>>({});
  const [loadingRows, setLoadingRows] = useState<Set<string>>(new Set());

  const handleExpandRow = async (e: React.MouseEvent, realId: string) => {
    e.stopPropagation();
    if (expandedRows.has(realId)) {
      setExpandedRows(prev => { const n = new Set(prev); n.delete(realId); return n; });
      return;
    }
    setExpandedRows(prev => new Set(prev).add(realId));
    if (rowDetails[realId]) return;
    setLoadingRows(prev => new Set(prev).add(realId));
    try {
      const updates = await api.getTicketUpdates(realId);
      setRowDetails(prev => ({ ...prev, [realId]: Array.isArray(updates) ? updates : [] }));
    } catch {
      setRowDetails(prev => ({ ...prev, [realId]: [] }));
    } finally {
      setLoadingRows(prev => { const n = new Set(prev); n.delete(realId); return n; });
    }
  };

  // Accordion state — sectors expanded by default, categories collapsed
  const [expandedSectors, setExpandedSectors] = useState<Set<string>>(
    new Set(['T.I', 'Gestão de Informação'])
  );
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

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

  const [isDeleting, setIsDeleting] = useState(false);

  // Delete Modal State
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [ticketToDelete, setTicketToDelete] = useState<string | null>(null);

  // Sorting State
  const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>({
    key: 'createdAtRaw',
    direction: 'desc'
  });

  const requestSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const isAdmin = userRole === 'admin' || userRole === 'super_user';

  useEffect(() => {
    const fetchTickets = async () => {
      try {
        const data = await api.getTickets(userId, userRole);

        const transformed = data.map((t: any) => ({
          id: `CH-${t.id.substring(0, 8)}`,
          realId: t.id,
          title: t.title,
          requester: t.requester_name || 'Usuário',
          sector: t.requester_sector || 'Sem Setor',
          requester_sector: t.requester_sector,
          priority: t.priority as TicketPriority,
          status: t.status as TicketStatus,
          category: t.category,
          requesterId: t.requester_id,
          assignedTo: t.assigned_to,
          createdAt: formatDateBR(t.created_at),
          createdAtRaw: t.created_at,
          updatedAt: formatDateBR(t.updated_at),
          updatedAtRaw: t.updated_at,
          deliveryForecast: t.delivery_forecast ? formatDateOnly(t.delivery_forecast) : 'Em breve',
          deliveryForecastRaw: t.delivery_forecast,
          description: t.description || ''
        }));
        setTickets(transformed);
      } catch (error) {
        console.error("Error fetching tickets:", error);
      } finally {
        setLoading(false);
      }
    };

    if (userId) {
      fetchTickets();
    }
  }, [userId, userRole]);

  // Fetch all users for requester filter
  useEffect(() => {
    const fetchUsers = async () => {
      try {
        const users = await api.getUsers();
        setAllUsers(users);
      } catch (error) {
        console.error("Error fetching users:", error);
      }
    };
    fetchUsers();
  }, []);

  // Derived lists for filters
  const uniqueRequesters = useMemo(() => Array.from(new Set(allUsers.map(u => u.name))).sort(), [allUsers]);
  const uniqueSectors = useMemo(() => Array.from(new Set(tickets.map(t => t.requester_sector).filter(Boolean))).sort(), [tickets]);

  // Filtered Tickets
  const filteredTickets = useMemo(() => {
    return tickets.filter(t => {
      const matchQuery = !filters.query || t.id.toLowerCase().includes(filters.query.toLowerCase()) || t.title.toLowerCase().includes(filters.query.toLowerCase());
      const matchRequester = !filters.requester || t.requester === filters.requester;
      let matchSector = !filters.sector || t.requester_sector === filters.sector;
      const matchStatus = filters.status.length === 0 || filters.status.includes(t.status);
      const matchPriority = filters.priority.length === 0 || filters.priority.includes(t.priority);
      const matchCategory = filters.category.length === 0 || filters.category.includes(t.category);
      const matchResponsibleSector = filters.responsibleSector.length === 0 || (() => {
        const cat = (t.category || '').toUpperCase();
        const isTI = cat.includes('STARSOFT') || cat.includes('INFRAESTRUTURA') || cat.includes('STARSF');
        return filters.responsibleSector.some(rs => rs === 'T.I' ? isTI : !isTI);
      })();

      // Enforce sector filter if user cannot view all sectors
      if (!canViewAllSectors) {
        const primary = user.sector;
        const managed = user.managed_sectors ? user.managed_sectors.split(/;\s*/).filter(Boolean) : [];
        const allowed = Array.from(new Set([primary, ...managed].filter(Boolean))).map(s => s.trim());

        const normRequesterSector = (t.requester_sector || '').toUpperCase().replace(/\./g, '');
        const normFilterSector = (filters.sector || '').toUpperCase().replace(/\./g, '');
        const normAllowed = allowed.map(s => s.toUpperCase().replace(/\./g, ''));
        const tCat = (t.category || '').toUpperCase();
        const isTICategory = tCat.includes('STARSOFT') || tCat.includes('INFRAESTRUTURA') || tCat.includes('STARSF');

        if (filters.sector) {
          const isAllowedFilter = normAllowed.includes(normFilterSector);
          if (!isAllowedFilter) {
            matchSector = false;
          } else {
            if (normFilterSector === 'TI') {
              matchSector = normRequesterSector === 'TI' || isTICategory;
            } else {
              matchSector = t.requester_sector === filters.sector;
            }
          }
        } else {
          const isRequester = String(t.requesterId) === String(user.id);
          const isAssigned = String(t.assignedTo) === String(user.id);
          const isSector = t.requester_sector && normAllowed.includes(normRequesterSector);
          const isSpecialTI = normAllowed.includes('TI') && isTICategory;
          matchSector = isRequester || isAssigned || isSector || isSpecialTI;
        }
      }

      // Date Range Filter
      let matchDate = true;
      if (filters.startDate) {
        const start = new Date(filters.startDate);
        start.setHours(0, 0, 0, 0);
        if (new Date(t.createdAtRaw) < start) matchDate = false;
      }
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        if (new Date(t.createdAtRaw) > end) matchDate = false;
      }

      return matchQuery && matchRequester && matchSector && matchResponsibleSector && matchStatus && matchPriority && matchCategory && matchDate;
    }).sort((a, b) => {
      if (!sortConfig) return 0;
      const { key, direction } = sortConfig;

      let aValue = a[key];
      let bValue = b[key];

      if (key === 'priority') {
        const weights: any = { 'Urgente': 4, 'Alta': 3, 'Média': 2, 'Baixa': 1, 'Não Definida': 0 };
        aValue = weights[aValue] || 0;
        bValue = weights[bValue] || 0;
      }

      if (aValue === null || aValue === undefined) aValue = '';
      if (bValue === null || bValue === undefined) bValue = '';

      if (aValue < bValue) return direction === 'asc' ? -1 : 1;
      if (aValue > bValue) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  }, [tickets, filters, canViewAllSectors, user.sector, user.managed_sectors, sortConfig]);

  // Group tickets: Responsible Sector → Category → tickets
  const groupedTickets = useMemo(() => {
    const groups: Record<string, Record<string, any[]>> = {
      'T.I': {},
      'Gestão de Informação': {}
    };
    filteredTickets.forEach(ticket => {
      const tCat = (ticket.category || '').toUpperCase();
      const isTI = tCat.includes('STARSOFT') || tCat.includes('INFRAESTRUTURA') || tCat.includes('STARSF');
      const sectorKey = isTI ? 'T.I' : 'Gestão de Informação';
      const cat = ticket.category || 'Sem Categoria';
      if (!groups[sectorKey][cat]) groups[sectorKey][cat] = [];
      groups[sectorKey][cat].push(ticket);
    });
    return groups;
  }, [filteredTickets]);

  // Auto-expand categories if a search query or filter is active
  useEffect(() => {
    const hasActiveFilter =
      filters.query !== '' ||
      filters.requester !== '' ||
      filters.sector !== '' ||
      filters.responsibleSector.length > 0 ||
      filters.status.length > 0 ||
      filters.priority.length > 0 ||
      filters.category.length > 0 ||
      filters.startDate !== '' ||
      filters.endDate !== '';

    if (hasActiveFilter) {
      const allCatKeys = new Set<string>();
      Object.entries(groupedTickets).forEach(([sectorName, categoryGroups]) => {
        Object.keys(categoryGroups).forEach(categoryName => {
          allCatKeys.add(`${sectorName}:${categoryName}`);
        });
      });
      setExpandedCategories(allCatKeys);

      setExpandedSectors(prev => {
        const next = new Set(prev);
        Object.keys(groupedTickets).forEach(sector => next.add(sector));
        return next;
      });
    }
  }, [filters, groupedTickets]);

  const getPriorityStyle = (priority: TicketPriority) => {
    switch (priority) {
      case TicketPriority.URGENT: return 'bg-red-100 text-red-800 border-red-200';
      case TicketPriority.HIGH: return 'bg-orange-100 text-orange-800 border-orange-200';
      case TicketPriority.MEDIUM: return 'bg-blue-100 text-blue-800 border-blue-200';
      case TicketPriority.LOW: return 'bg-slate-100 text-slate-700 border-slate-200';
      default: return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getStatusStyle = (status: TicketStatus) => {
    switch (status) {
      case TicketStatus.OPEN: return 'text-blue-600 bg-blue-50';
      case TicketStatus.IN_PROGRESS: return 'text-orange-600 bg-orange-50';
      case TicketStatus.IN_VALIDATION: return 'text-purple-600 bg-purple-50';
      case TicketStatus.WAITING_SUPPORT: return 'text-indigo-600 bg-indigo-50';
      case TicketStatus.CLOSED: return 'text-green-600 bg-green-50';
      default: return 'text-gray-600 bg-gray-50';
    }
  };

  const SECTOR_COLORS: Record<string, { bg: string; border: string; text: string; badge: string }> = {
    'T.I': {
      bg: 'bg-blue-50',
      border: 'border-blue-200',
      text: 'text-blue-800',
      badge: 'bg-blue-600 text-white'
    },
    'Gestão de Informação': {
      bg: 'bg-purple-50',
      border: 'border-purple-200',
      text: 'text-purple-800',
      badge: 'bg-purple-600 text-white'
    }
  };

  const renderTicketRows = (ticketList: any[]) => (
    <>
    <MobileLandscapeHint message="A lista de chamados funciona melhor em paisagem ou no desktop." />
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead className="bg-gray-50 border-b border-gray-100">
          <tr className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
            <th className="px-6 py-3 cursor-pointer hover:text-gray-600 transition-colors" onClick={() => requestSort('title')}>
              <div className="flex items-center gap-1">
                Chamado
                {sortConfig?.key === 'title' && (sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
              </div>
            </th>
            <th className="px-6 py-3 cursor-pointer hover:text-gray-600 transition-colors" onClick={() => requestSort('requester')}>
              <div className="flex items-center gap-1">
                Solicitante
                {sortConfig?.key === 'requester' && (sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
              </div>
            </th>
            <th className="px-6 py-3 cursor-pointer hover:text-gray-600 transition-colors" onClick={() => requestSort('createdAtRaw')}>
              <div className="flex items-center gap-1">
                Abertura
                {sortConfig?.key === 'createdAtRaw' && (sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
              </div>
            </th>
            <th className="px-6 py-3 cursor-pointer hover:text-gray-600 transition-colors" onClick={() => requestSort('updatedAtRaw')}>
              <div className="flex items-center gap-1 text-blue-600">
                Última Alt.
                {sortConfig?.key === 'updatedAtRaw' && (sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
              </div>
            </th>
            <th className="px-6 py-3 cursor-pointer hover:text-gray-600 transition-colors" onClick={() => requestSort('priority')}>
              <div className="flex items-center gap-1">
                Prioridade
                {sortConfig?.key === 'priority' && (sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
              </div>
            </th>
            <th className="px-6 py-3 cursor-pointer hover:text-gray-600 transition-colors" onClick={() => requestSort('status')}>
              <div className="flex items-center gap-1">
                Status
                {sortConfig?.key === 'status' && (sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
              </div>
            </th>
            <th className="px-6 py-3 cursor-pointer hover:text-gray-600 transition-colors" onClick={() => requestSort('deliveryForecastRaw')}>
              <div className="flex items-center gap-1">
                Previsão
                {sortConfig?.key === 'deliveryForecastRaw' && (sortConfig.direction === 'asc' ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
              </div>
            </th>
            <th className="px-6 py-3 text-center"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {ticketList.map((ticket) => {
            const isExpanded = expandedRows.has(ticket.realId);
            const isLoadingRow = loadingRows.has(ticket.realId);
            const details = rowDetails[ticket.realId] || [];
            const lastMsg = [...details].reverse().find((u: any) => u.message && !u.is_system);
            const attachments = details.filter((u: any) => u.attachment_path);
            return (
            <React.Fragment key={ticket.id}>
            <tr className="hover:bg-gray-50 transition-colors cursor-pointer group" onClick={() => navigate(`/tickets/${ticket.realId}`)}>
              <td className="px-6 py-4">
                <div className="flex items-start gap-2">
                  <button
                    onClick={(e) => handleExpandRow(e, ticket.realId)}
                    className={`mt-0.5 flex-shrink-0 p-1 rounded transition-colors ${isExpanded ? 'text-red-500 bg-red-50' : 'text-gray-300 hover:text-gray-600 hover:bg-gray-100'}`}
                    title="Visualizar detalhes"
                  >
                    {isLoadingRow ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : isExpanded ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <div className="flex flex-col">
                    <span className="text-xs font-bold text-red-600 mb-0.5">{ticket.id}</span>
                    <span className="text-sm font-semibold text-gray-900">{ticket.title}</span>
                  </div>
                </div>
              </td>
              <td className="px-6 py-4 text-sm text-gray-600">{ticket.requester}</td>
              <td className="px-6 py-4 text-[10px] text-gray-500 font-medium leading-tight">{ticket.createdAt}</td>
              <td className="px-6 py-4 text-[10px] text-blue-600 font-bold leading-tight">{ticket.updatedAt}</td>
              <td className="px-6 py-4">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${getPriorityStyle(ticket.priority)}`}>
                  {ticket.priority === TicketPriority.NOT_DEFINED ? '-' : ticket.priority}
                </span>
              </td>
              <td className="px-6 py-4">
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-black uppercase ${getStatusStyle(ticket.status)}`}>
                  {ticket.status}
                </span>
              </td>
              <td className="px-6 py-4">
                <div className="flex items-center text-xs text-gray-500 font-medium">
                  <Calendar className="w-3.5 h-3.5 mr-1.5 text-gray-400" />
                  {ticket.deliveryForecast}
                </div>
              </td>
              <td className="px-6 py-4 text-center">
                {userRole === 'super_user' && (
                  <button
                    onClick={(e) => { e.stopPropagation(); setTicketToDelete(ticket.realId || ticket.id); setDeleteModalOpen(true); }}
                    className="text-red-300 hover:text-red-700 transition-colors p-1"
                    title="Excluir Chamado"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /><line x1="10" x2="10" y1="11" y2="17" /><line x1="14" x2="14" y1="11" y2="17" /></svg>
                  </button>
                )}
              </td>
            </tr>
            {isExpanded && (
              <tr className="bg-gray-50 border-t-0">
                <td colSpan={8} className="px-6 py-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Mensagem Original</p>
                      <p className="text-gray-700 whitespace-pre-wrap leading-relaxed line-clamp-5">{ticket.description || '—'}</p>
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Última Resposta</p>
                      {isLoadingRow ? (
                        <p className="text-gray-400 italic">Carregando...</p>
                      ) : lastMsg ? (
                        <div>
                          <p className="text-[10px] font-bold text-gray-500 mb-0.5">{lastMsg.user_name}</p>
                          <p className="text-gray-700 whitespace-pre-wrap line-clamp-4">{lastMsg.message}</p>
                        </div>
                      ) : (
                        <p className="text-gray-400 italic">Sem respostas</p>
                      )}
                    </div>
                    <div>
                      <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Anexos</p>
                      {attachments.length === 0 ? (
                        <p className="text-gray-400 italic">Nenhum anexo</p>
                      ) : (
                        <div className="space-y-1">
                          {attachments.map((u: any, i: number) => (
                            <a key={i} href={u.attachment_path} target="_blank" rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="flex items-center gap-1.5 text-blue-600 hover:text-blue-800 hover:underline truncate">
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

  // Derived: expand/collapse all
  const allExpandSectorKeys = Object.keys(groupedTickets).filter(s => Object.values(groupedTickets[s]).flat().length > 0);
  const allExpandCatKeys = allExpandSectorKeys.flatMap(s => Object.keys(groupedTickets[s]).map(c => `${s}:${c}`));
  const isAllExpanded = allExpandSectorKeys.length > 0
    && allExpandSectorKeys.every(s => expandedSectors.has(s))
    && allExpandCatKeys.every(k => expandedCategories.has(k));

  const handleToggleExpandAll = () => {
    if (isAllExpanded) {
      setExpandedSectors(new Set());
      setExpandedCategories(new Set());
    } else {
      setExpandedSectors(new Set(allExpandSectorKeys));
      setExpandedCategories(new Set(allExpandCatKeys));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{isAdmin ? 'Central de Suporte TI' : 'Meus Chamados'}</h1>
          <p className="text-gray-500 text-sm">Acompanhe as solicitações abertas.</p>
        </div>
        <div className="flex items-center gap-3">
          <Link to="/overview" className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-200 rounded-lg text-sm font-bold shadow-sm hover:bg-gray-50 transition-colors">
            <LayoutDashboard className="w-4 h-4" />
            Visão Geral
          </Link>
          <Link to="/tickets/new" className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-bold shadow-sm hover:bg-red-700 transition-colors">Novo Chamado</Link>
        </div>
      </div>

      <FilterBar
        filters={filters}
        onChange={setFilters}
        requesters={uniqueRequesters}
        sectors={uniqueSectors}
        showSectorFilter={canViewAllSectors}
        isAllExpanded={isAllExpanded}
        onToggleExpandAll={handleToggleExpandAll}
      />

      {loading ? (
        <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Carregando chamados...</div>
      ) : filteredTickets.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Nenhum chamado encontrado.</div>
      ) : (
        <div className="space-y-4">
          {Object.entries(groupedTickets).map(([sectorName, categoryGroups]) => {
            const sectorTotal = Object.values(categoryGroups).reduce((sum, list) => sum + list.length, 0);
            if (sectorTotal === 0) return null;

            const colors = SECTOR_COLORS[sectorName];
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
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setTicketToDelete(null);
        }}
        onConfirm={async () => {
          if (!ticketToDelete) return;
          setIsDeleting(true);
          try {
            await api.deleteTicket(ticketToDelete);
            setTickets(prev => prev.filter(t => (t.realId || t.id) !== ticketToDelete));
            setDeleteModalOpen(false);
            setTicketToDelete(null);
          } catch (err) {
            console.error(err);
            showToast('Erro ao excluir chamado.', 'error');
          } finally {
            setIsDeleting(false);
          }
        }}
        title="Excluir Chamado"
        message="Tem certeza que deseja excluir este chamado? Esta ação removerá permanentemente o histórico e não poderá ser desfeita."
        isLoading={isDeleting}
      />
    </div>
  );
};

export default TicketList;
