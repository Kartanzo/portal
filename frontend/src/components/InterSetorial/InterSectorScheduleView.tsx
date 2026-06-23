import React, { useState, useEffect, useMemo } from 'react';
import { User } from '../../types';
import { Link } from 'react-router-dom';
import { api } from '../../app_api';
import { useToast } from '../../contexts/ToastContext';
import { Calendar as CalendarIcon, LayoutGrid, ChevronDown } from 'lucide-react';

interface Props { user: User; }

const MONTH_NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const WEEK_DAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

const STATUS_COLORS: Record<string, string> = {
  'Aberto': 'bg-blue-500',
  'Em Atendimento': 'bg-orange-500',
  'Concluído': 'bg-green-600',
  'Cancelado': 'bg-gray-400',
};

const InterSectorScheduleView: React.FC<Props> = ({ user }) => {
  const { showToast } = useToast();
  const [tickets, setTickets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'calendar' | 'kanban'>('calendar');
  const [calendarMonth, setCalendarMonth] = useState(new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(new Date().getFullYear());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  useEffect(() => {
    api.getInterSectorTickets()
      .then(data => setTickets(data.filter((t: any) => t.delivery_forecast)))
      .catch(() => showToast('Erro ao carregar agenda.', 'error'))
      .finally(() => setLoading(false));
  }, []);

  const getDateStr = (year: number, month: number, day: number) =>
    `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

  const getTicketsByDate = (dateStr: string) =>
    tickets.filter(t => t.delivery_forecast && t.delivery_forecast.startsWith(dateStr));

  const daysInMonth = new Date(calendarYear, calendarMonth + 1, 0).getDate();
  const firstDayOfWeek = new Date(calendarYear, calendarMonth, 1).getDay();
  const today = new Date();
  const todayStr = getDateStr(today.getFullYear(), today.getMonth(), today.getDate());

  // For kanban by date
  const dateGroups = useMemo(() => {
    const groups: Record<string, any[]> = {};
    tickets.forEach(t => {
      if (t.delivery_forecast) {
        const d = t.delivery_forecast.split('T')[0];
        if (!groups[d]) groups[d] = [];
        groups[d].push(t);
      }
    });
    return groups;
  }, [tickets]);

  const sortedDates = useMemo(() => Object.keys(dateGroups).sort(), [dateGroups]);

  if (loading) return <div className="flex items-center justify-center py-16 text-gray-400 text-sm">Carregando...</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Agenda — Chamados Entre Setores</h1>
          <p className="text-gray-500 text-[11px]">Previsão de entrega dos chamados entre departamentos.</p>
        </div>
        <div className="flex bg-white p-1 rounded-lg border border-gray-200 shadow-sm">
          <button
            onClick={() => setViewMode('calendar')}
            className={`flex items-center px-3 py-1 text-[10px] font-black uppercase rounded-md transition-all ${viewMode === 'calendar' ? 'bg-slate-900 text-white' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <CalendarIcon className="w-3 h-3 mr-1.5" /> Calendário
          </button>
          <button
            onClick={() => setViewMode('kanban')}
            className={`flex items-center px-3 py-1 text-[10px] font-black uppercase rounded-md transition-all ${viewMode === 'kanban' ? 'bg-slate-900 text-white' : 'text-gray-400 hover:text-gray-600'}`}
          >
            <LayoutGrid className="w-3 h-3 mr-1.5" /> Lista por Data
          </button>
        </div>
      </div>

      {viewMode === 'calendar' && (
        <>
          {/* Month/Year selector */}
          <div className="bg-white p-3 rounded-xl border border-gray-200 shadow-sm flex items-center gap-4">
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-0.5">Ano</label>
              <select
                value={calendarYear}
                onChange={e => setCalendarYear(Number(e.target.value))}
                className="px-2 py-1 border border-gray-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
              >
                {Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 2 + i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-[10px] font-bold text-gray-500 uppercase mb-0.5">Mês</label>
              <select
                value={calendarMonth}
                onChange={e => setCalendarMonth(Number(e.target.value))}
                className="px-2 py-1 border border-gray-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-red-500 bg-white min-w-[120px]"
              >
                {MONTH_NAMES.map((m, i) => <option key={i} value={i}>{m}</option>)}
              </select>
            </div>
          </div>

          {/* Calendar grid */}
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="grid grid-cols-7 border-b border-gray-100 bg-gray-50">
              {WEEK_DAYS.map(d => (
                <div key={d} className="py-2 text-center text-[10px] font-black text-gray-400 uppercase tracking-widest">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 p-1 auto-rows-[80px]">
              {Array.from({ length: firstDayOfWeek }).map((_, i) => <div key={`e-${i}`} />)}
              {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
                const dateStr = getDateStr(calendarYear, calendarMonth, day);
                const dayTickets = getTicketsByDate(dateStr);
                const isToday = dateStr === todayStr;
                return (
                  <div
                    key={day}
                    onClick={() => dayTickets.length > 0 && setSelectedDate(dateStr)}
                    className={`relative p-2 flex flex-col rounded-xl border transition-all ${
                      dayTickets.length > 0
                        ? 'bg-white border-gray-300 shadow-sm hover:border-red-400 hover:-translate-y-0.5 cursor-pointer'
                        : 'bg-white border-dashed border-gray-200'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className={`text-xs font-bold leading-none ${isToday ? 'bg-red-600 text-white w-6 h-6 flex items-center justify-center rounded-full' : 'text-gray-500'}`}>
                        {day}
                      </span>
                      {dayTickets.length > 0 && (
                        <span className="bg-red-50 text-red-600 text-[9px] font-black px-1.5 py-0.5 rounded-md">{dayTickets.length}</span>
                      )}
                    </div>
                    <div className="flex-1 overflow-hidden space-y-0.5">
                      {dayTickets.slice(0, 2).map(t => (
                        <div key={t.id} className="text-[8px] text-gray-600 truncate bg-gray-50 rounded px-1 py-0.5 leading-tight">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${STATUS_COLORS[t.status] || 'bg-gray-400'}`} />
                          {t.title}
                        </div>
                      ))}
                      {dayTickets.length > 2 && <div className="text-[8px] text-gray-400">+{dayTickets.length - 2} mais</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Selected day detail */}
          {selectedDate && dateGroups[selectedDate] && (
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-gray-700">
                  Entregas em {new Date(selectedDate + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}
                </h3>
                <button onClick={() => setSelectedDate(null)} className="text-gray-400 hover:text-gray-600 text-xs">Fechar</button>
              </div>
              <div className="space-y-2">
                {dateGroups[selectedDate].map(t => (
                  <Link key={t.id} to={`/inter-sector-tickets/${t.id}`} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg hover:bg-red-50 transition-colors">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[t.status] || 'bg-gray-400'}`} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-900 truncate">{t.title}</p>
                      <p className="text-xs text-gray-500">{t.requester_sector} → {t.target_sector}</p>
                    </div>
                    <span className="text-[10px] text-gray-400 shrink-0">{t.status}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {viewMode === 'kanban' && (
        <div className="space-y-4">
          {sortedDates.length === 0 ? (
            <div className="flex items-center justify-center py-12 text-gray-400 text-sm">Nenhum chamado com previsão de entrega.</div>
          ) : (
            sortedDates.map(dateStr => (
              <div key={dateStr} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 border-b border-gray-100">
                  <span className="text-xs font-bold text-gray-700">
                    {new Date(dateStr + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                  </span>
                  <span className="ml-2 text-[10px] text-gray-400">{dateGroups[dateStr].length} chamado(s)</span>
                </div>
                <div className="divide-y divide-gray-50">
                  {dateGroups[dateStr].map(t => (
                    <Link key={t.id} to={`/inter-sector-tickets/${t.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-gray-50 transition-colors">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_COLORS[t.status] || 'bg-gray-400'}`} />
                      <span className="text-xs font-bold text-red-600 shrink-0">CS-{t.id.substring(0, 8).toUpperCase()}</span>
                      <span className="flex-1 text-sm font-semibold text-gray-900 truncate">{t.title}</span>
                      <span className="text-xs text-gray-400 shrink-0">{t.requester_sector} → {t.target_sector}</span>
                    </Link>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

export default InterSectorScheduleView;
