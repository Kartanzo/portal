import React, { useState, useEffect, useMemo } from 'react';
import { User } from '../../types';
import { Link } from 'react-router-dom';
import { api } from '../../app_api';
import { useToast } from '../../contexts/ToastContext';
import { Search, User as UserIcon } from 'lucide-react';

const COLUMNS = [
  { status: 'Aberto', color: 'bg-blue-500' },
  { status: 'Em Atendimento', color: 'bg-orange-500' },
  { status: 'Aguardando Usuário', color: 'bg-yellow-500' },
  { status: 'Aguardando Suporte', color: 'bg-indigo-500' },
  { status: 'Em Validação', color: 'bg-purple-500' },
  { status: 'Concluído', color: 'bg-green-600' },
  { status: 'Cancelado', color: 'bg-gray-400' },
];

const PRIORITY_DOT: Record<string, string> = {
  'Urgente': 'bg-red-500',
  'Alta': 'bg-orange-400',
  'Média': 'bg-blue-400',
  'Baixa': 'bg-gray-300',
};

interface Props { user: User; }

const InterSectorKanban: React.FC<Props> = ({ user }) => {
  const { showToast } = useToast();
  const [tickets, setTickets] = useState<any[]>([]);
  const [interSectorData, setInterSectorData] = useState<{ allowed_sectors: string[], allowed_users: any[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [targetFilter, setTargetFilter] = useState('');

  const isSuperUser = user.role === 'super_user';

  useEffect(() => {
    Promise.all([
      api.getInterSectorTickets(),
      api.getInterSectorSectors(),
    ]).then(([ticketsResult, sectorsResult]) => {
      setTickets(ticketsResult);
      setInterSectorData(sectorsResult);
    }).catch(() => showToast('Erro ao carregar chamados.', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const sectorOptions = useMemo(() => interSectorData?.allowed_sectors ?? [], [interSectorData]);

  const filtered = useMemo(() => tickets.filter(t => {
    const q = query.toLowerCase();
    if (q && !t.title?.toLowerCase().includes(q)) return false;
    if (targetFilter && t.target_sector !== targetFilter) return false;
    return true;
  }), [tickets, query, targetFilter]);

  const onDragStart = (e: React.DragEvent, id: string) => e.dataTransfer.setData('ticketId', id);
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = async (e: React.DragEvent, status: string) => {
    const ticketId = e.dataTransfer.getData('ticketId');
    const ticket = tickets.find(t => t.id === ticketId);
    if (!ticket) return;
    const managed = (user.managed_sectors || '').split(/;\s*/).filter(Boolean);
    const allowed = [user.sector, ...managed].filter(Boolean);
    if (!isSuperUser && !allowed.includes(ticket.target_sector)) {
      showToast('Apenas o setor de destino pode mover este chamado.', 'error');
      return;
    }
    setTickets(prev => prev.map(t => t.id === ticketId ? { ...t, status } : t));
    try {
      await api.updateInterSectorTicket(ticketId, { status });
    } catch {
      showToast('Erro ao atualizar status.', 'error');
    }
  };

  if (loading) return <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Carregando...</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Kanban — Chamados Entre Setores</h1>
          <p className="text-gray-500 text-sm">Visualização por status dos chamados entre departamentos.</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex flex-wrap gap-3 items-center">
        <div className="relative flex-grow min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Buscar título..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
          />
        </div>
        <select
          value={targetFilter}
          onChange={e => setTargetFilter(e.target.value)}
          className="flex-grow min-w-[160px] px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          <option value="">Todos os Setores</option>
          {sectorOptions.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
      </div>

      {/* Colunas */}
      <div className="flex gap-3 overflow-x-auto pb-4">
        {COLUMNS.map(col => {
          const colTickets = filtered.filter(t => t.status === col.status);
          return (
            <div
              key={col.status}
              onDragOver={onDragOver}
              onDrop={e => onDrop(e, col.status)}
              className="flex-1 min-w-[200px] bg-gray-50 dark:bg-slate-700 rounded-xl border border-gray-200 dark:border-slate-600 p-2 flex flex-col gap-2"
            >
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5">
                  <span className={`w-2 h-2 rounded-full ${col.color}`} />
                  <span className="text-[10px] font-black text-gray-500 uppercase tracking-wider">{col.status}</span>
                </div>
                <span className="text-[10px] font-bold bg-white border border-gray-200 text-gray-600 px-1.5 rounded-full">{colTickets.length}</span>
              </div>
              <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-300px)]">
                {colTickets.map(t => (
                  <div
                    key={t.id}
                    draggable
                    onDragStart={e => onDragStart(e, t.id)}
                    className="bg-white rounded-lg border border-gray-100 p-2.5 shadow-sm hover:border-red-300 hover:shadow-md transition-all cursor-grab active:cursor-grabbing"
                  >
                    <Link to={`/inter-sector-tickets/${t.id}`} onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[8px] font-black text-red-600">CS-{t.id.substring(0, 8).toUpperCase()}</span>
                        <span className={`w-2 h-2 rounded-full ${PRIORITY_DOT[t.priority] || 'bg-gray-300'}`} title={t.priority} />
                      </div>
                      <h4 className="text-[11px] font-bold text-gray-900 leading-tight mb-2 line-clamp-2">{t.title}</h4>
                      <div className="flex items-center justify-between text-[9px] text-gray-400 font-bold uppercase border-t border-gray-50 pt-1.5">
                        <div className="flex items-center gap-1">
                          <UserIcon className="w-2 h-2" />
                          <span className="truncate max-w-[60px]">{t.requester_sector || '-'}</span>
                        </div>
                        <span className="text-gray-500">{t.target_sector}</span>
                      </div>
                    </Link>
                  </div>
                ))}
                {colTickets.length === 0 && (
                  <div className="py-6 flex justify-center opacity-20">
                    <div className="w-8 h-8 rounded-full bg-gray-200" />
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

export default InterSectorKanban;
