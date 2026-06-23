import React, { useState, useEffect, useMemo } from 'react';
import { User } from '../../types';
import { Calendar as CalendarIcon, LayoutGrid, Clock, User as UserIcon, ChevronDown } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../app_api';
import DateRangePicker from '../DateRangePicker';
import FilterBar, { FilterState } from '../FilterBar';

interface Props { user: User; }

const SLA_HORAS: Record<string, number> = {
  Urgente: 4, Alta: 8, Média: 24, Baixa: 40,
};

const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];

const STATUS_COLS = [
  { status: 'Aberto',          label: 'Aberto',          color: 'bg-blue-500' },
  { status: 'Em Análise',      label: 'Em Análise',      color: 'bg-orange-500' },
  { status: 'Aguard. Retorno', label: 'Aguard. Retorno', color: 'bg-purple-500' },
  { status: 'Em Resolução',    label: 'Em Resolução',    color: 'bg-indigo-500' },
  { status: 'Concluído',       label: 'Concluído',       color: 'bg-green-600' },
  { status: 'Cancelado',       label: 'Cancelado',       color: 'bg-gray-400' },
];

function slaDeadline(criado_em: string, prioridade: string): string {
  const horas = SLA_HORAS[prioridade] ?? 24;
  const d = new Date(criado_em);
  d.setHours(d.getHours() + horas);
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const SacAgenda: React.FC<Props> = ({ user }) => {
  const isExterno = user.role === 'externo';
  const canEdit = !isExterno && (
    user.role === 'super_user' || user.role === 'admin' || user.role === 'ceo' ||
    !!(user.permissions?.['sac'] as any)?.can_edit
  );

  const [viewMode, setViewMode] = useState<'calendar' | 'kanban'>(() =>
    (sessionStorage.getItem('sacAgendaView') as 'calendar' | 'kanban') || 'calendar'
  );

  const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>(() => {
    const s = sessionStorage.getItem('sacAgendaStart');
    const e = sessionStorage.getItem('sacAgendaEnd');
    if (s && e) return { start: new Date(s), end: new Date(e) };
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0),
    };
  });

  const [calendarMonth, setCalendarMonth] = useState(dateRange.start.getMonth());
  const [calendarYear, setCalendarYear] = useState(dateRange.start.getFullYear());
  const [datePickerOpen, setDatePickerOpen] = useState(false);

  const [filters, setFilters] = useState<FilterState>({
    query: '', requester: '', sector: '', status: [], priority: [],
    responsibleSector: [], category: [],
  });

  const [tickets, setTickets] = useState<any[]>([]);

  useEffect(() => {
    sessionStorage.setItem('sacAgendaView', viewMode);
    sessionStorage.setItem('sacAgendaStart', dateRange.start.toISOString());
    sessionStorage.setItem('sacAgendaEnd', dateRange.end.toISOString());
  }, [viewMode, dateRange]);

  useEffect(() => {
    api.get('/sac/tickets').then((resp: any) => {
      const data = resp?.data ?? resp;
      const list = (Array.isArray(data) ? data : []).map((t: any) => ({
        id: t.protocolo,
        realId: String(t.id),
        title: t.tipo_problema + (t.razao_social ? ` — ${t.razao_social}` : ''),
        date: slaDeadline(t.criado_em, t.prioridade),
        status: t.status,
        priority: t.prioridade,
        requester: t.razao_social || t.email_contato || '—',
        setor: t.setor_destino,
      }));
      setTickets(list);
    }).catch(() => {});
  }, []);

  const uniqueRequesters = useMemo(() => Array.from(new Set(tickets.map((t: any) => t.requester))).sort(), [tickets]);
  const uniqueSectors = useMemo(() => Array.from(new Set(tickets.map((t: any) => t.setor))).sort(), [tickets]);

  const matchesFilters = (t: any) => {
    if (filters.query && !t.id.toLowerCase().includes(filters.query.toLowerCase()) && !t.title.toLowerCase().includes(filters.query.toLowerCase())) return false;
    if (filters.status.length && !filters.status.includes(t.status)) return false;
    if (filters.priority.length && !filters.priority.includes(t.priority)) return false;
    return true;
  };

  const getTicketsByDate = (date: string) => tickets.filter(t => t.date === date && matchesFilters(t));

  const handleDayClick = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    setDateRange({ start: dt, end: dt });
    setViewMode('kanban');
  };

  const onDragStart = (e: React.DragEvent, ticketId: string) => e.dataTransfer.setData('ticketId', ticketId);
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = async (e: React.DragEvent, targetStatus: string) => {
    const ticketId = e.dataTransfer.getData('ticketId');
    setTickets(prev => prev.map(t => t.realId === ticketId ? { ...t, status: targetStatus } : t));
    try {
      const fd = new FormData();
      fd.append('status', targetStatus);
      await fetch(`/api/sac/tickets/${ticketId}/status`, { credentials: 'include', 
        method: 'PATCH', headers: { 'user-id': user.id }, body: fd,
      });
    } catch { /* silently ignore */ }
  };

  const formatDateRange = () => {
    const s = dateRange.start.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    const e = dateRange.end.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    if (dateRange.start.getTime() === dateRange.end.getTime())
      return dateRange.start.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    return `${s} - ${e}`;
  };

  const renderCalendar = () => {
    const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const today = new Date();

    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-full relative">
        <div className="p-2 border-b border-gray-100 flex items-center bg-white sticky top-0 z-10">
          <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider flex items-center bg-gray-50 px-3 py-1 rounded-full border border-gray-100">
            <span className="w-2 h-2 bg-red-500 rounded-full mr-2 shadow-sm shadow-red-200"></span>
            Vencimentos SAC — {MONTH_NAMES[calendarMonth]} {calendarYear}
          </div>
        </div>
        <div className="flex-1 overflow-auto bg-gray-50">
          <div className="grid grid-cols-7 border-b border-gray-200 bg-white sticky top-0 z-10 shadow-sm">
            {['Dom','Seg','Ter','Qua','Qui','Sex','Sáb'].map(d => (
              <div key={d} className="py-2 text-center text-[10px] font-black text-gray-500 uppercase tracking-widest">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1 p-1 auto-rows-[75px]">
            {Array.from({ length: new Date(calendarYear, calendarMonth, 1).getDay() }).map((_, i) => (
              <div key={`e-${i}`} />
            ))}
            {days.map(day => {
              const dateStr = `${calendarYear}-${(calendarMonth + 1).toString().padStart(2,'0')}-${day.toString().padStart(2,'0')}`;
              const dayTickets = getTicketsByDate(dateStr);
              const isToday = day === today.getDate() && calendarMonth === today.getMonth() && calendarYear === today.getFullYear();
              return (
                <div
                  key={day}
                  onClick={() => dayTickets.length > 0 && handleDayClick(dateStr)}
                  className={`relative p-2 flex flex-col transition-all rounded-xl border ${
                    dayTickets.length > 0
                      ? 'cursor-pointer bg-white border-gray-300 shadow-sm hover:shadow-md hover:border-red-400 hover:-translate-y-0.5'
                      : 'bg-white border-dashed border-gray-200 text-gray-300'
                  }`}
                >
                  <div className="flex justify-between items-start mb-1">
                    <span className={`text-xs font-bold leading-none ${isToday ? 'bg-red-600 text-white w-6 h-6 flex items-center justify-center rounded-full shadow-sm' : 'text-gray-500'}`}>
                      {day}
                    </span>
                    {dayTickets.length > 0 && (
                      <span className="bg-red-50 text-red-600 text-[9px] font-black px-1.5 py-0.5 rounded-md">
                        {dayTickets.length}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto space-y-1 pr-1">
                    {dayTickets.map(t => (
                      <div key={t.id} className="p-1 bg-white border border-gray-100 shadow-sm rounded-lg">
                        <div className="flex items-center gap-1 mb-0.5">
                          <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-blue-500"></div>
                          <span className="text-[9px] font-bold text-gray-700 truncate">{t.id}</span>
                        </div>
                        <div className="text-[8px] text-gray-500 leading-tight line-clamp-2">{t.title}</div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderKanban = () => {
    const filtered = tickets.filter(t => {
      if (!matchesFilters(t) || !t.date) return false;
      const [ty, tm, td] = t.date.split('-').map(Number);
      const dt = new Date(ty, tm - 1, td);
      dt.setHours(0, 0, 0, 0);
      const start = new Date(dateRange.start); start.setHours(0, 0, 0, 0);
      const end = new Date(dateRange.end); end.setHours(23, 59, 59, 999);
      return dt >= start && dt <= end;
    });

    return (
      <div className="flex gap-4 w-full pb-4">
        {STATUS_COLS.map(col => {
          const colTickets = filtered.filter(t => t.status === col.status);
          return (
            <div
              key={col.status}
              onDragOver={onDragOver}
              onDrop={e => onDrop(e, col.status)}
              className="flex-1 bg-gray-100/40 rounded-lg p-2 flex flex-col space-y-2 border border-gray-100 min-w-0"
            >
              <div className="flex items-center justify-between px-1 py-0.5">
                <h3 className="text-[9px] font-black text-gray-500 uppercase flex items-center truncate">
                  <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${col.color}`}></span>
                  {col.label}
                </h3>
                <span className="text-[9px] bg-white border border-gray-200 text-gray-600 px-1.5 py-0 rounded-full font-bold">{colTickets.length}</span>
              </div>
              <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-320px)] pr-1">
                {colTickets.map(ticket => (
                  <div
                    key={ticket.id}
                    draggable={canEdit}
                    onDragStart={e => canEdit && onDragStart(e, ticket.realId)}
                    className={`bg-white p-2.5 rounded shadow-sm border border-gray-100 hover:border-red-400 transition-all hover:shadow-md ${canEdit ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
                  >
                    <Link to={`/sac/${ticket.realId}`} className="block">
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-[8px] font-black text-red-600 uppercase">{ticket.id}</span>
                        <span className="px-1 py-0 rounded-[2px] text-[7px] font-bold uppercase bg-gray-100 text-gray-600">
                          {ticket.priority?.charAt(0)}
                        </span>
                      </div>
                      <h4 className="text-[10px] font-bold text-gray-900 leading-tight mb-2 line-clamp-2">{ticket.title}</h4>
                      <div className="flex items-center justify-between pt-1.5 border-t border-gray-50 text-[8px] text-gray-400 font-bold uppercase">
                        <div className="flex items-center truncate max-w-[60%]">
                          <UserIcon className="w-2 h-2 mr-1" />{ticket.requester.split(' ')[0]}
                        </div>
                        <div className="flex items-center">
                          <Clock className="w-2 h-2 mr-1" />{ticket.date}
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
    );
  };

  return (
    <div className="space-y-2">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 leading-none">SAC — Agenda</h1>
          <p className="text-gray-500 text-[10px] mt-0.5">Vencimentos de SLA por data de abertura.</p>
        </div>
        <div className="flex bg-white p-1 rounded-lg border border-gray-200 shadow-sm">
          <button
            onClick={() => setViewMode('calendar')}
            className={`flex items-center px-3 py-1 text-[10px] font-black uppercase rounded-md transition-all ${viewMode === 'calendar' ? 'bg-slate-900 text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <CalendarIcon className="w-3 h-3 mr-1.5" /> Calendário
          </button>
          <button
            onClick={() => setViewMode('kanban')}
            className={`flex items-center px-3 py-1 text-[10px] font-black uppercase rounded-md transition-all ${viewMode === 'kanban' ? 'bg-slate-900 text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <LayoutGrid className="w-3 h-3 mr-1.5" /> Kanban
          </button>
        </div>
      </div>

      {/* FilterBar */}
      <FilterBar
        filters={filters}
        onChange={setFilters}
        requesters={uniqueRequesters}
        sectors={uniqueSectors}
        showSectorFilter={!isExterno}
      >
        {viewMode === 'kanban' && (
          <div className="relative flex-grow min-w-[200px]">
            <button
              onClick={() => setDatePickerOpen(!datePickerOpen)}
              className="w-full flex items-center justify-between px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white hover:border-red-300 transition-colors focus:ring-2 focus:ring-red-500 focus:outline-none"
            >
              <div className="flex items-center gap-2 truncate">
                <CalendarIcon className="w-4 h-4 text-red-600" />
                <span className="font-bold text-gray-700 uppercase text-xs truncate">{formatDateRange()}</span>
              </div>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${datePickerOpen ? 'rotate-180' : ''}`} />
            </button>
            {datePickerOpen && (
              <>
                <div className="fixed inset-0 z-40 bg-transparent" onClick={() => setDatePickerOpen(false)}></div>
                <div className="absolute right-0 mt-2 z-50 shadow-xl rounded-lg">
                  <DateRangePicker
                    range={dateRange}
                    onChange={setDateRange}
                    onClose={() => setDatePickerOpen(false)}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </FilterBar>

      {/* ANO / MÊS — calendar mode only */}
      {viewMode === 'calendar' && (
        <div className="bg-white p-2 rounded-xl border border-gray-200 shadow-sm mb-2">
          <div className="flex items-center gap-4">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 mb-0.5 uppercase tracking-wider">Ano</label>
              <select
                value={calendarYear}
                onChange={e => {
                  const y = parseInt(e.target.value);
                  setCalendarYear(y);
                  setDateRange({ start: new Date(y, calendarMonth, 1), end: new Date(y, calendarMonth + 1, 0) });
                }}
                className="px-2 py-1 border border-gray-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-red-500 bg-white min-w-[100px]"
              >
                {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 3 + i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 mb-0.5 uppercase tracking-wider">Mês</label>
              <select
                value={calendarMonth}
                onChange={e => {
                  const m = parseInt(e.target.value);
                  setCalendarMonth(m);
                  setDateRange({ start: new Date(calendarYear, m, 1), end: new Date(calendarYear, m + 1, 0) });
                }}
                className="px-2 py-1 border border-gray-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-red-500 bg-white min-w-[120px]"
              >
                {MONTH_NAMES.map((name, idx) => <option key={idx} value={idx}>{name}</option>)}
              </select>
            </div>
          </div>
        </div>
      )}

      <div className="transition-all duration-300">
        {viewMode === 'calendar' ? renderCalendar() : renderKanban()}
      </div>
    </div>
  );
};

export default SacAgenda;
