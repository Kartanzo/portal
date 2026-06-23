
import React, { useState, useEffect, useMemo } from 'react';
import { TicketStatus, TicketPriority, UserRole, User } from '../types';
import { Calendar as CalendarIcon, LayoutGrid, ChevronLeft, ChevronRight, ArrowLeft, Clock, User as UserIcon, XCircle, AlertCircle, CheckCircle2, RotateCcw, Lock, ChevronDown } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { api } from '../app_api';
import DateRangePicker from './DateRangePicker';
import MonthYearPicker from './MonthYearPicker';
import FilterBar, { FilterState } from './FilterBar';

interface ScheduleViewProps {
  user: User;
}

const ScheduleView: React.FC<ScheduleViewProps> = ({ user }) => {
  const location = useLocation();

  const [viewMode, setViewMode] = useState<'calendar' | 'kanban'>(() => {
    // Check URL first - if status filter is present OR explicit view param, force Kanban
    const searchParams = new URLSearchParams(window.location.search);
    if (searchParams.get('status') || searchParams.get('view') === 'kanban') return 'kanban';

    return (sessionStorage.getItem('scheduleViewMode') as 'calendar' | 'kanban') || 'calendar';
  });

  const userRole = user.role;
  // Ensure strict boolean
  const canViewAllSectors = user.role === 'super_user' || !!user.permissions?.['tickets']?.view_all_sectors;

  // Filters State
  const [filters, setFilters] = useState<FilterState>({
    query: '',
    requester: '',
    sector: (!canViewAllSectors && user.sector) ? user.sector : '',
    status: [],
    priority: [],
    responsibleSector: [],
    category: [],
  });

  useEffect(() => {
    // Initialize filters depending on URL changes
    const searchParams = new URLSearchParams(location.search);
    const statusParam = searchParams.get('status');
    const viewParam = searchParams.get('view');

    if (viewParam === 'kanban') {
      setViewMode('kanban');
    }

    if (statusParam) {
      setFilters(prev => ({ ...prev, status: [statusParam] }));
      // Force Kanban if status is present implies intent
      setViewMode('kanban');
    }

    if (!canViewAllSectors && user.sector && filters.sector !== user.sector) {
      setFilters(prev => ({ ...prev, sector: user.sector! }));
    }
  }, [user, canViewAllSectors, location.search]);  // React to URL changes


  // Date Range State
  const [dateRange, setDateRange] = useState<{ start: Date; end: Date }>(() => {
    const savedStart = sessionStorage.getItem('scheduleRangeStart');
    const savedEnd = sessionStorage.getItem('scheduleRangeEnd');

    if (savedStart && savedEnd) {
      return { start: new Date(savedStart), end: new Date(savedEnd) };
    }

    // Default: This Month
    const now = new Date();
    return {
      start: new Date(now.getFullYear(), now.getMonth(), 1),
      end: new Date(now.getFullYear(), now.getMonth() + 1, 0)
    };
  });

  const [datePickerOpen, setDatePickerOpen] = useState(false);

  useEffect(() => {
    sessionStorage.setItem('scheduleViewMode', viewMode);
    sessionStorage.setItem('scheduleRangeStart', dateRange.start.toISOString());
    sessionStorage.setItem('scheduleRangeEnd', dateRange.end.toISOString());
  }, [viewMode, dateRange]);

  const isSuperUser = userRole === 'super_user';

  const [localTickets, setLocalTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  React.useEffect(() => {
    async function loadTickets() {
      try {
        const data = await api.getTickets(user.id);

        const formatted = data.map((t: any) => ({
          id: `CH-${t.id.split('-')[0]}`,
          realId: t.id,
          title: t.title,
          date: t.delivery_forecast ? t.delivery_forecast.split('T')[0] : null,
          status: t.status,
          priority: t.priority,
          requester: t.requester_name || 'Usuário',
          requesterId: t.requester_id,
          assignedTo: t.assigned_to,
          // Assuming sector is available or generic
          sector: t.requester_sector || 'Sem Setor',
        })).filter((t: any) => t.date);

        setLocalTickets(formatted);
      } catch (e) {
        console.error("Failed to load schedule tickets", e);
      } finally {
        setLoading(false);
      }
    }
    loadTickets();
  }, []);

  // Auto-navigate to ticket month if query matches a ticket ID
  useEffect(() => {
    if (!filters.query || filters.query.length < 5) return;

    // Try to find a Ticket ID match
    const foundTicket = localTickets.find(t =>
      t.id.toLowerCase().includes(filters.query.toLowerCase())
    );

    if (foundTicket && foundTicket.date) {
      const [year, month, day] = foundTicket.date.split('-').map(Number);

      // Only update if different from current view to avoid loops, 
      // but here we just update state which might trigger re-render.
      // Since we are setting calendarMonth state that drives the calendar view:
      setCalendarMonth(month - 1); // 0-indexed
      setCalendarYear(year);

      const start = new Date(year, month - 1, 1);
      const end = new Date(year, month, 0);

      // Update Date Range to show that month
      setDateRange({ start, end });

      // If we want to switch to calendar view effectively
      if (viewMode !== 'calendar') {
        setViewMode('calendar');
      }
    }
  }, [filters.query, localTickets]);

  // Derived lists for filters
  const uniqueRequesters = useMemo(() => Array.from(new Set(localTickets.map(t => t.requester))).sort(), [localTickets]);
  const uniqueSectors = useMemo(() => Array.from(new Set(localTickets.map(t => t.sector))).sort(), [localTickets]);

  const matchesFilters = (t: any) => {
    const matchQuery = !filters.query || t.id.toLowerCase().includes(filters.query.toLowerCase()) || t.title.toLowerCase().includes(filters.query.toLowerCase());
    const matchRequester = !filters.requester || t.requester === filters.requester;

    // Strict Permission Check
    let matchPermission = true;

    // Treat undefined or false as restricted
    if (!canViewAllSectors) {
      // User can ONLY see their own tickets OR tickets from their sector
      const isMine = String(t.requesterId) === String(user.id) || String(t.assignedTo) === String(user.id);
      const isMySector = user.sector && t.sector === user.sector;

      matchPermission = isMine || !!isMySector;
    }

    const matchStatus = !filters.status.length || filters.status.includes(t.status);
    const matchPriority = !filters.priority.length || filters.priority.includes(t.priority);

    if (!matchPermission) return false;

    return matchQuery && matchRequester && matchStatus && matchPriority;
  };

  const handleDayClick = (date: string) => {
    // Robust date construction to avoid timezone issues
    const [year, month, day] = date.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    d.setHours(0, 0, 0, 0);

    setDateRange({ start: d, end: d });
    setViewMode('kanban');
  };

  const getTicketsByDate = (date: string) => localTickets.filter(t => t.date === date && matchesFilters(t));

  const onDragStart = (e: React.DragEvent, ticketId: string) => {
    e.dataTransfer.setData('ticketId', ticketId);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const onDrop = async (e: React.DragEvent, targetStatus: TicketStatus) => {
    const ticketId = e.dataTransfer.getData('ticketId');
    const ticket = localTickets.find(t => t.realId === ticketId);

    // Optimistic update
    setLocalTickets(prev => prev.map(t => {
      if (t.realId === ticketId) {
        return { ...t, status: targetStatus };
      }
      return t;
    }));

    try {
      await api.updateTicket(ticketId, { status: targetStatus });
    } catch (err) {
      console.error("Failed to update ticket status", err);
      // Revert optimistic update if needed, but for now just log
    }
  };

  /* New state for MonthPicker */
  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());

  const formatDateRange = () => {
    const startStr = dateRange.start.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    const endStr = dateRange.end.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });

    if (dateRange.start.getTime() === dateRange.end.getTime()) {
      return dateRange.start.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
    }
    return `${startStr} - ${endStr}`;
  };

  const renderCalendar = () => {
    // Single month view based on dateRange.start
    const viewDate = new Date(dateRange.start);
    const currentMonth = viewDate.getMonth();
    const currentYear = viewDate.getFullYear();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();
    const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
    const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

    // Function to set month from picker
    const handleMonthSelect = (newDate: Date) => {
      const start = new Date(newDate.getFullYear(), newDate.getMonth(), 1);
      const end = new Date(newDate.getFullYear(), newDate.getMonth() + 1, 0);
      setDateRange({ start, end });
      setIsMonthPickerOpen(false);
    };

    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden flex flex-col h-full relative">
        {/* Header Controls */}
        <div className="p-2 border-b border-gray-100 flex items-center justify-between bg-white sticky top-0 z-10">
          <div className="text-[10px] text-gray-500 font-bold uppercase tracking-wider flex items-center bg-gray-50 px-3 py-1 rounded-full border border-gray-100">
            <span className="w-2 h-2 bg-red-500 rounded-full mr-2 shadow-sm shadow-red-200"></span>
            Entregas Previstas - {monthNames[currentMonth]} {currentYear}
          </div>
        </div>

        {/* Single Calendar Grid - Cards Layout */}
        <div className="flex-1 overflow-auto bg-gray-50">
          <div className="grid grid-cols-7 border-b border-gray-200 bg-white sticky top-0 z-10 shadow-sm">
            {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(day => (
              <div key={day} className="py-2 text-center text-[10px] font-black text-gray-500 uppercase tracking-widest">{day}</div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1 p-1 auto-rows-[75px]">
            {/* Empty cells for start of month */}
            {Array.from({ length: new Date(currentYear, currentMonth, 1).getDay() }).map((_, i) => (
              <div key={`empty-${i}`} className=""></div>
            ))}

            {days.map(day => {
              const dateStr = `${currentYear}-${(currentMonth + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
              const dayTickets = getTicketsByDate(dateStr);
              const isToday = day === new Date().getDate() && currentMonth === new Date().getMonth() && currentYear === new Date().getFullYear();

              return (
                <div
                  key={day}
                  onClick={() => dayTickets.length > 0 && handleDayClick(dateStr)}
                  className={`
                                relative p-2 flex flex-col transition-all rounded-xl border
                                ${dayTickets.length > 0
                      ? 'cursor-pointer bg-white border-gray-300 shadow-sm hover:shadow-md hover:border-red-400 hover:-translate-y-0.5'
                      : 'bg-white border-dashed border-gray-200 text-gray-300'
                    }
                            `}
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

                  <div className="flex-1 overflow-y-auto space-y-1 custom-scrollbar pr-1">
                    {dayTickets.map(t => (
                      <div key={t.id} className="p-1 bg-white border border-gray-100 shadow-sm rounded-lg group-hover:border-red-100 transition-colors">
                        <div className="flex items-center gap-1 mb-0.5">
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${t.status === 'done' ? 'bg-green-500' : 'bg-blue-500'}`}></div>
                          <span className="text-[9px] font-bold text-gray-700 truncate">{t.id}</span>
                        </div>
                        <div className="text-[8px] text-gray-500 leading-tight line-clamp-2" title={t.title}>
                          {t.title}
                        </div>
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
    // Filter by date range
    const filteredTickets = localTickets.filter(t => {
      const match = matchesFilters(t);

      if (!t.date || !match) return false; // Apply global filters
      const [tYear, tMonth, tDay] = t.date.split('-').map(Number);
      const ticketDate = new Date(tYear, tMonth - 1, tDay);
      ticketDate.setHours(0, 0, 0, 0);

      // Normalize range
      const start = new Date(dateRange.start); start.setHours(0, 0, 0, 0);
      const end = new Date(dateRange.end); end.setHours(23, 59, 59, 999);

      return ticketDate >= start && ticketDate <= end;
    });

    const columns = [
      { status: TicketStatus.OPEN, label: 'Aberto', color: 'bg-blue-500' },
      { status: TicketStatus.IN_PROGRESS, label: 'Atendimento', color: 'bg-orange-500' },
      { status: TicketStatus.PENDING, label: 'Aguard. Usuário', color: 'bg-purple-500' },
      { status: TicketStatus.WAITING_SUPPORT, label: 'Aguard. Suporte', color: 'bg-indigo-500' },
      { status: TicketStatus.IN_VALIDATION, label: 'Em Validação', color: 'bg-pink-500' },
      { status: TicketStatus.CLOSED, label: 'Concluído', color: 'bg-green-600' },
      { status: TicketStatus.CANCELLED, label: 'Cancelado', color: 'bg-gray-400' },
    ];

    return (
      <div className="space-y-4">
        {/* Changed from overflow-x-auto to overflow-hidden to contain full width without unnecessary scroll if fitting */}
        <div className="flex gap-4 w-full h-full pb-4">
          {columns.map(col => {
            const columnTickets = filteredTickets.filter(t => t.status === col.status);
            return (
              <div
                key={col.status}
                onDragOver={onDragOver}
                onDrop={(e) => onDrop(e, col.status)}
                // Removed max-w-[220px] and min-w-[180px] to allow flex-1 to fill space evenly
                className="flex-1 bg-gray-100/40 rounded-lg p-2 flex flex-col space-y-2 border border-gray-100 min-w-0"
              >
                <div className="flex items-center justify-between px-1 py-0.5">
                  <h3 className="text-[9px] font-black text-gray-500 uppercase flex items-center truncate">
                    <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${col.color}`}></span>
                    {col.label}
                  </h3>
                  <span className="text-[9px] bg-white border border-gray-200 text-gray-600 px-1.5 py-0 rounded-full font-bold">{columnTickets.length}</span>
                </div>

                <div className="space-y-2 overflow-y-auto max-h-[calc(100vh-320px)] pr-1 custom-scrollbar">
                  {columnTickets.map(ticket => (
                    <div
                      key={ticket.id}
                      draggable={userRole === 'super_user'}
                      onDragStart={(e) => userRole === 'super_user' && onDragStart(e, ticket.realId)}
                      className={`bg-white p-2.5 rounded shadow-sm border border-gray-100 hover:border-red-400 transition-all hover:shadow-md ${userRole === 'super_user' ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
                    >
                      <Link to={`/tickets/${ticket.realId}`} className="block">
                        <div className="flex justify-between items-start mb-1">
                          <span className="text-[8px] font-black text-red-600 uppercase">{ticket.id}</span>
                          <span className={`px-1 py-0 rounded-[2px] text-[7px] font-bold uppercase ${ticket.priority === TicketPriority.URGENT ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                            {ticket.priority.charAt(0)}
                          </span>
                        </div>
                        <h4 className="text-[10px] font-bold text-gray-900 leading-tight mb-2 line-clamp-2">{ticket.title}</h4>
                        <div className="flex items-center justify-between pt-1.5 border-t border-gray-50 text-[8px] text-gray-400 font-bold uppercase">
                          <div className="flex items-center truncate max-w-[60%]"><UserIcon className="w-2 h-2 mr-1" /> {ticket.requester.split(' ')[0]}</div>
                          <div className="flex items-center"><Clock className="w-2 h-2 mr-1" /> 18h</div>
                        </div>
                      </Link>
                    </div>
                  ))}

                  {columnTickets.length === 0 && (
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

  return (
    <div className="space-y-2">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900 leading-none">Agenda de Entregas</h1>
          <p className="text-gray-500 text-[10px] mt-0.5">Gerenciamento visual do cronograma de dados.</p>
        </div>
        <div className="flex bg-white p-1 rounded-lg border border-gray-200 shadow-sm">
          <button onClick={() => setViewMode('calendar')} className={`flex items-center px-3 py-1 text-[10px] font-black uppercase rounded-md transition-all ${viewMode === 'calendar' ? 'bg-slate-900 text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
            <CalendarIcon className="w-3 h-3 mr-1.5" /> Calendário
          </button>
          <button onClick={() => { setViewMode('kanban'); }} className={`flex items-center px-3 py-1 text-[10px] font-black uppercase rounded-md transition-all ${viewMode === 'kanban' ? 'bg-slate-900 text-white shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
            <LayoutGrid className="w-3 h-3 mr-1.5" /> Kanban
          </button>
        </div>
      </div>

      {/* Render Global Filter Bar */}
      <FilterBar
        filters={filters}
        onChange={setFilters}
        requesters={uniqueRequesters}
        sectors={uniqueSectors}
        showSectorFilter={canViewAllSectors}
      >
        {/* Date Range Picker - Only in Kanban mode */}
        {viewMode === 'kanban' && (
          <div className="relative flex-grow min-w-[200px]">
            <button
              onClick={() => setDatePickerOpen(!datePickerOpen)}
              className="w-full flex items-center justify-between px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white hover:border-red-300 transition-colors focus:ring-2 focus:ring-red-500 focus:outline-none"
            >
              <div className="flex items-center gap-2 truncate">
                <CalendarIcon className="w-4 h-4 text-red-600" />
                <span className="font-bold text-gray-700 uppercase text-xs truncate">
                  {formatDateRange()}
                </span>
              </div>
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${datePickerOpen ? 'rotate-180' : ''}`} />
            </button>

            {datePickerOpen && (
              <>
                <div className="fixed inset-0 z-40 bg-transparent" onClick={() => setDatePickerOpen(false)}></div>
                <div className="absolute right-0 mt-2 z-50 shadow-xl rounded-lg">
                  <DateRangePicker
                    range={dateRange}
                    onChange={(newRange) => {
                      setDateRange(newRange);
                    }}
                    onClose={() => setDatePickerOpen(false)}
                  />
                </div>
              </>
            )}
          </div>
        )}
      </FilterBar>

      {/* Calendar-specific month/year filter */}
      {viewMode === 'calendar' && (
        <div className="bg-white p-2 rounded-xl border border-gray-200 shadow-sm mb-2">
          <div className="flex items-center gap-4">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 mb-0.5 uppercase tracking-wider">Ano</label>
              <select
                value={calendarYear}
                onChange={(e) => {
                  const year = parseInt(e.target.value);
                  setCalendarYear(year);
                  const start = new Date(year, calendarMonth, 1);
                  const end = new Date(year, calendarMonth + 1, 0);
                  setDateRange({ start, end });
                }}
                className="px-2 py-1 border border-gray-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-red-500 bg-white min-w-[100px]"
              >
                {Array.from({ length: 10 }, (_, i) => new Date().getFullYear() - 5 + i).map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 mb-0.5 uppercase tracking-wider">Mês</label>
              <select
                value={calendarMonth}
                onChange={(e) => {
                  const month = parseInt(e.target.value);
                  setCalendarMonth(month);
                  const start = new Date(calendarYear, month, 1);
                  const end = new Date(calendarYear, month + 1, 0);
                  setDateRange({ start, end });
                }}
                className="px-2 py-1 border border-gray-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-red-500 bg-white min-w-[120px]"
              >
                {['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'].map((month, idx) => (
                  <option key={idx} value={idx}>{month}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      <div className="transition-all duration-300">{viewMode === 'calendar' ? renderCalendar() : renderKanban()}</div>
    </div>
  );
};

export default ScheduleView;
