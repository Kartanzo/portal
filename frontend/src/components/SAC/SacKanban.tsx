import React, { useState, useEffect, useMemo } from 'react';
import { User } from '../../types';
import { api } from '../../app_api';
import { Link } from 'react-router-dom';
import { Clock, User as UserIcon, RefreshCw } from 'lucide-react';
import FilterBar, { FilterState } from '../FilterBar';

interface Props { user: User; }

const STATUS_COLS = [
  { status: 'Aberto',          label: 'Aberto',          color: 'bg-blue-500' },
  { status: 'Em Análise',      label: 'Em Análise',      color: 'bg-orange-500' },
  { status: 'Aguard. Retorno', label: 'Aguard. Retorno', color: 'bg-purple-500' },
  { status: 'Em Resolução',    label: 'Em Resolução',    color: 'bg-indigo-500' },
  { status: 'Concluído',       label: 'Concluído',       color: 'bg-green-600' },
];

const SacKanban: React.FC<Props> = ({ user }) => {
  const isExterno = user.role === 'externo';
  const canEdit = !isExterno && (
    user.role === 'super_user' || user.role === 'admin' || user.role === 'ceo' ||
    !!(user.permissions?.['sac'] as any)?.can_edit
  );

  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<FilterState>({
    query: '', requester: '', sector: '', status: [], priority: [],
    responsibleSector: [], category: [],
  });

  const load = () => {
    setLoading(true);
    api.get('/sac/tickets').then((resp: any) => {
      const data = resp?.data ?? resp;
      setTickets(Array.isArray(data) ? data : []);
    }).catch(() => {}).finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  const uniqueRequesters = useMemo(() =>
    Array.from(new Set(tickets.map((t: any) => t.razao_social || t.email_contato || '—'))).sort()
  , [tickets]);

  const uniqueSectors = useMemo(() =>
    Array.from(new Set(tickets.map((t: any) => t.setor_destino))).sort()
  , [tickets]);

  const matchesFilters = (t: any) => {
    if (filters.query) {
      const q = filters.query.toLowerCase();
      if (!t.protocolo?.toLowerCase().includes(q) && !t.tipo_problema?.toLowerCase().includes(q) && !(t.razao_social || '').toLowerCase().includes(q)) return false;
    }
    if (filters.status.length && !filters.status.includes(t.status)) return false;
    if (filters.priority.length && !filters.priority.includes(t.prioridade)) return false;
    if (filters.sector && t.setor_destino !== filters.sector) return false;
    return true;
  };

  const onDragStart = (e: React.DragEvent, id: number) => e.dataTransfer.setData('ticketId', String(id));
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = async (e: React.DragEvent, targetStatus: string) => {
    const ticketId = e.dataTransfer.getData('ticketId');
    setTickets(prev => prev.map(t => String(t.id) === ticketId ? { ...t, status: targetStatus } : t));
    try {
      const fd = new FormData();
      fd.append('status', targetStatus);
      await fetch(`/api/sac/tickets/${ticketId}/status`, { credentials: 'include', 
        method: 'PATCH', headers: { 'user-id': user.id }, body: fd,
      });
    } catch { /* silently ignore */ }
  };

  const filtered = tickets.filter(matchesFilters);

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 leading-none">SAC — Kanban</h1>
          <p className="text-gray-500 text-[10px] mt-0.5">Gestão visual dos chamados por status.</p>
        </div>
        <button onClick={load} className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg text-gray-500 text-xs hover:bg-gray-50 self-start md:self-auto">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* FilterBar */}
      <FilterBar
        filters={filters}
        onChange={setFilters}
        requesters={uniqueRequesters}
        sectors={uniqueSectors}
        showSectorFilter={!isExterno}
      />

      {/* Kanban */}
      <div className="flex gap-4 w-full pb-4 overflow-x-auto">
        {STATUS_COLS.map(col => {
          const colTickets = filtered.filter(t => t.status === col.status);
          return (
            <div
              key={col.status}
              onDragOver={onDragOver}
              onDrop={e => onDrop(e, col.status)}
              className="flex-1 bg-gray-50 dark:bg-slate-700 rounded-xl p-2 flex flex-col space-y-2 border border-gray-200 dark:border-slate-600 min-w-[160px]"
            >
              <div className="flex items-center justify-between px-1 py-0.5">
                <h3 className="text-[9px] font-black text-gray-500 uppercase flex items-center truncate">
                  <span className={`w-1.5 h-1.5 rounded-full mr-1.5 shrink-0 ${col.color}`}></span>
                  {col.label}
                </h3>
                <span className="text-[9px] bg-white border border-gray-200 text-gray-600 px-1.5 py-0 rounded-full font-bold">
                  {colTickets.length}
                </span>
              </div>

              <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-280px)] pr-1">
                {colTickets.map(ticket => (
                  <div
                    key={ticket.id}
                    draggable={canEdit}
                    onDragStart={e => canEdit && onDragStart(e, ticket.id)}
                    className={`bg-white p-2.5 rounded shadow-sm border border-gray-100 hover:border-red-400 transition-all hover:shadow-md ${canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
                  >
                    <Link to={`/sac/${ticket.id}`} className="block">
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-[8px] font-black text-red-600 uppercase">{ticket.protocolo}</span>
                        <span className="px-1 py-0 rounded-[2px] text-[7px] font-bold uppercase bg-gray-100 text-gray-600">
                          {ticket.prioridade?.charAt(0)}
                        </span>
                      </div>
                      <h4 className="text-[10px] font-bold text-gray-900 leading-tight mb-2 line-clamp-2">
                        {ticket.tipo_problema}{ticket.razao_social ? ` — ${ticket.razao_social}` : ''}
                      </h4>
                      <div className="flex items-center justify-between pt-1.5 border-t border-gray-50 text-[8px] text-gray-400 font-bold uppercase">
                        <div className="flex items-center truncate max-w-[60%]">
                          <UserIcon className="w-2 h-2 mr-1" />
                          {(ticket.razao_social || ticket.email_contato || '—').split(' ')[0]}
                        </div>
                        <div className="flex items-center">
                          <Clock className="w-2 h-2 mr-1" />
                          {ticket.setor_destino}
                        </div>
                      </div>
                    </Link>
                  </div>
                ))}

                {colTickets.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-6 opacity-30">
                    <div className="w-8 h-8 bg-slate-200 rounded-full mb-1"></div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SacKanban;
