
import React, { useEffect, useState, useMemo } from 'react';
import {
  LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar, Legend, ComposedChart
} from 'recharts';
import { TrendingUp, Clock, Target, CheckCircle, AlertTriangle, Users } from 'lucide-react';
import { api } from '../app_api';
import { Ticket, User, TicketStatus } from '../types';
import KpiCard, { KpiColor, KpiGrid } from './common/KpiCard';

const Metrics: React.FC = () => {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [ticketsData, usersData] = await Promise.all([
          api.getTickets(),
          api.getUsers()
        ]);
        setTickets(ticketsData);
        setUsers(usersData);
      } catch (error) {
        console.error("Failed to fetch metrics data", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const stats = useMemo(() => {
    const today = new Date();

    // Helpers
    const isDelayed = (t: Ticket) => {
      if (t.status === TicketStatus.CLOSED || t.status === TicketStatus.CANCELLED) return false;
      if (!t.deliveryForecast) return false;
      return new Date(t.deliveryForecast) < today;
    };

    // 1. Analyst Performance
    const analystMap = new Map<string, { name: string, assigned: number, concluded: number, pending: number, delayed: number }>();

    // Initial population for all users who are admins/support
    users.filter(u => u.role !== 'user').forEach(u => {
      analystMap.set(u.id, {
        name: u.name,
        assigned: 0, concluded: 0, pending: 0, delayed: 0
      });
    });

    tickets.forEach(t => {
      if (t.assignedTo) {
        // If assigned user not in map (maybe deleted?), add them
        if (!analystMap.has(t.assignedTo)) {
          // Try to find name if possible
          const u = users.find(user => user.id === t.assignedTo);
          analystMap.set(t.assignedTo, {
            name: u ? u.name : 'Outro',
            assigned: 0, concluded: 0, pending: 0, delayed: 0
          });
        }

        const stat = analystMap.get(t.assignedTo)!;
        stat.assigned++;

        if (t.status === TicketStatus.CLOSED) stat.concluded++;
        else stat.pending++;

        if (isDelayed(t)) stat.delayed++;
      }
    });

    const analystPerformance = Array.from(analystMap.values())
      .filter(a => a.assigned > 0) // Only show active analysts
      .map(a => ({
        name: a.name,
        concluidos: a.concluded,
        pendentes: a.pending,
        // SLA Calculation: % of tickets NOT delayed
        sla: a.assigned > 0 ? Math.round(((a.assigned - a.delayed) / a.assigned) * 100) : 100
      }))
      .sort((a, b) => b.concluidos - a.concluidos);

    // 2. Trend Data (Last 6 Months)
    const months: Record<string, { total: number, delayed: number }> = {};
    const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

    // Initialize last 6 months
    for (let i = 5; i >= 0; i--) {
      const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
      const key = `${monthNames[d.getMonth()]}`;
      months[key] = { total: 0, delayed: 0 };
    }

    tickets.forEach(t => {
      // Use created_at or fallback to now if missing (shouldn't happen with new data)
      const dateStr = t.created_at || t.createdAt;
      if (dateStr) {
        const d = new Date(dateStr);
        const key = monthNames[d.getMonth()];
        // Only count if it falls within our tracked months (simple check)
        if (months[key]) {
          months[key].total++;
          if (isDelayed(t)) months[key].delayed++;
        }
      }
    });

    const slaTrendData = Object.entries(months).map(([name, val]) => ({
      name,
      volume: val.total,
      sla: val.total > 0 ? Math.round(((val.total - val.delayed) / val.total) * 100) : 100,
      target: 95
    }));

    // 3. KPIs
    const totalTickets = tickets.length;
    const totalDelayed = tickets.filter(isDelayed).length;
    const totalConcluded = tickets.filter(t => t.status === TicketStatus.CLOSED).length;

    // Global SLA: (Total - Delayed) / Total
    const globalSLA = totalTickets > 0 ? ((totalTickets - totalDelayed) / totalTickets) * 100 : 100;

    // Health Score: % of tickets with Delivery Forecast (excluding Closed/Cancelled which might not need it anymore?)
    // Actually, usually we want all tickets to have had a forecast.
    const activeTickets = tickets.filter(t => t.status !== TicketStatus.CLOSED && t.status !== TicketStatus.CANCELLED);
    const activeWithForecast = activeTickets.filter(t => t.deliveryForecast).length;
    const activeTotal = activeTickets.length;

    // If no active tickets, integrity is 100% (nothing missing). 
    // If active tickets exist, calc ratio.
    const healthScore = activeTotal > 0 ? Math.round((activeWithForecast / activeTotal) * 100) : 100;

    return {
      analystPerformance,
      slaTrendData,
      kpis: [
        { title: 'SLA Geral', value: `${globalSLA.toFixed(1)}%`, trend: totalDelayed > 0 ? `-${totalDelayed} Atrasados` : 'On Track', icon: Target, color: 'text-red-600', bg: 'bg-red-50' },
        { title: 'Chamados Totais', value: totalTickets.toString(), trend: 'Volume Total', icon: Users, color: 'text-blue-600', bg: 'bg-blue-50' },
        { title: 'Taxa Conclusão', value: `${totalTickets > 0 ? Math.round((totalConcluded / totalTickets) * 100) : 0}%`, trend: `${totalConcluded} Fechados`, icon: CheckCircle, color: 'text-green-600', bg: 'bg-green-50' },
        { title: 'Integridade dos Dados', value: `${healthScore}/100`, trend: 'Active Tickets with Dates', icon: TrendingUp, color: 'text-purple-600', bg: 'bg-purple-50' },
      ],
      healthScore
    };
  }, [tickets, users]);

  if (loading) return <div className="p-8 text-center text-gray-500 text-xs font-bold uppercase">Carregando métricas...</div>;

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Métricas Operacionais (Analistas)</h1>
          <p className="text-gray-500 text-sm">Monitoramento em tempo real da performance.</p>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-xs font-semibold text-gray-400 uppercase">Período:</span>
          <select className="bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-red-500">
            <option>Últimos 6 Meses</option>
          </select>
        </div>
      </div>

      {/* KPI Row */}
      <KpiGrid className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.kpis.map((kpi, i) => {
          const colorMap: Record<string, KpiColor> = {
            'text-red-600': 'red',
            'text-blue-600': 'blue',
            'text-green-600': 'emerald',
            'text-purple-600': 'indigo',
          };
          return (
            <KpiCard
              key={i}
              label={kpi.title}
              value={kpi.value}
              Icon={kpi.icon}
              color={colorMap[kpi.color] || 'blue'}
              trend={
                <span className={`text-xs font-bold ${typeof kpi.trend === 'string' && kpi.trend.includes('-') ? 'text-red-600' : 'text-green-600'}`}>
                  {kpi.trend}
                </span>
              }
            />
          );
        })}
      </KpiGrid>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Trend Chart */}
        <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-lg font-bold text-gray-900 flex items-center">
              <TrendingUp className="w-5 h-5 mr-2 text-red-600" /> Tendência de SLA vs Volume
            </h3>
          </div>
          <div className="h-[350px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={stats.slaTrendData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f1f1" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
                <YAxis yAxisId="left" orientation="left" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} />
                <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#6b7280' }} unit="%" domain={[0, 100]} />
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Legend />
                <Bar yAxisId="left" dataKey="volume" name="Volume de Chamados" fill="#1e293b" radius={[4, 4, 0, 0]} barSize={40} />
                <Line yAxisId="right" type="monotone" dataKey="sla" name="SLA Realizado (%)" stroke="#dc2626" strokeWidth={3} dot={{ r: 4, fill: '#dc2626' }} />
                <Line yAxisId="right" type="monotone" dataKey="target" name="Meta SLA" stroke="#94a3b8" strokeDasharray="5 5" dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Efficiency Chart */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 overflow-y-auto max-h-[450px] custom-scrollbar">
          <h3 className="text-lg font-bold text-gray-900 mb-6 flex items-center">
            <Users className="w-5 h-5 mr-2 text-red-600" /> Performance por Analista
          </h3>
          <div className="space-y-6">
            {stats.analystPerformance.length > 0 ? stats.analystPerformance.map((analyst) => (
              <div key={analyst.name} className="space-y-2">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-semibold text-gray-700 truncate max-w-[120px]" title={analyst.name}>{analyst.name}</span>
                  <span className={`text-xs font-bold ${analyst.sla >= 95 ? 'text-green-600' : 'text-orange-600'}`}>
                    {analyst.sla}% On-Time
                  </span>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden flex">
                  <div
                    className="h-full bg-red-600 transition-all duration-500"
                    style={{ width: `${(analyst.concluidos / (analyst.concluidos + analyst.pendentes + 0.001)) * 100}%` }}
                  ></div>
                </div>
                <div className="flex justify-between text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                  <span>{analyst.concluidos} Concluídos</span>
                  <span>{analyst.pendentes} Pendentes</span>
                </div>
              </div>
            )) : (
              <div className="text-center text-gray-400 text-xs py-10">Nenhum analista com chamados atribuídos.</div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-gray-900 mb-4">Qualidade - Histórico de SLA</h3>
          <div className="h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.slaTrendData}>
                <defs>
                  <linearGradient id="colorQuality" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f1f1" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10 }} />
                <YAxis axisLine={false} tickLine={false} hide />
                <Tooltip contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                <Area type="monotone" dataKey="sla" stroke="#3b82f6" fillOpacity={1} fill="url(#colorQuality)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col justify-center items-center text-center">
          <div className="w-24 h-24 rounded-full border-8 border-red-600 border-t-gray-100 flex items-center justify-center mb-4">
            <span className="text-2xl font-black text-red-600">{stats.healthScore}%</span>
          </div>
          <h4 className="text-lg font-bold text-gray-900">Data Integrity Index</h4>
          <p className="text-sm text-gray-500 max-w-xs mt-2">
            Percentual de Chamados Ativos com Previsão de Entrega definida.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Metrics;
