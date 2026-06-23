import React, { useEffect, useState, useMemo } from 'react';
import KpiCard, { KpiColor, KpiGrid } from './common/KpiCard';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, RadialBarChart, RadialBar, LineChart, Line
} from 'recharts';
import {
  Target, Activity, CheckCircle2, AlertTriangle, Clock, TrendingUp,
  DollarSign, Users, Leaf, ArrowUpRight, ArrowDownRight, Briefcase, ClipboardList,
  ChevronDown, ChevronUp, Calendar as CalendarIcon
} from 'lucide-react';
import { api } from '../app_api';
import { User, ActionPlanItem } from '../types';
import { useSectors } from '../hooks/useSectors';
import { parseDateLocal } from './dateUtils';
import { SearchableSelect } from './SearchableSelect';

interface ActionPlanDashboardProps {
  user: User;
}

const ActionPlanDashboard: React.FC<ActionPlanDashboardProps> = ({ user }) => {
  const SECTORS = useSectors();
  const [items, setItems] = useState<ActionPlanItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSector, setSelectedSector] = useState('Todos');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });

  const [allUsers, setAllUsers] = useState<{ id: string, name: string, sector?: string, role?: string, permissions?: any, managed_sectors?: string }[]>([]);
  const [showDelayedActions, setShowDelayedActions] = useState(false);
  const [strategicData, setStrategicData] = useState<{
    allowed_sectors: string[];
    allowed_users: { id: string, name: string, sector: string, role: string }[];
  } | null>(null);

  // Permissions (centralized model)
  const userRole = user.role;
  const isSuperUser = userRole === 'super_user';
  const isCEO = userRole === 'ceo';
  const canEditOverride = user.permissions?.strategic?.can_edit === true;
  const canDeleteOverride = user.permissions?.strategic?.can_delete === true;
  const isAdmin = userRole === 'admin' || isSuperUser || isCEO || canEditOverride;
  const isReadOnly = !isAdmin;
  const canDelete = isSuperUser || canDeleteOverride;

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const [data, usersData, sectorsResult] = await Promise.all([
          api.getActionPlans(undefined, user.id),
          api.getAllUsersSimple(),
          api.getStrategicSectors()
        ]);

        setAllUsers(usersData);
        setStrategicData(sectorsResult);

        // Filter by centralized allowed_sectors
        const allowedSet = new Set(sectorsResult.allowed_sectors);
        const finalData = isAdmin
          ? data
          : data.filter((plan: ActionPlanItem) => allowedSet.has((plan.sector || '').trim()));

        setItems(finalData);
      } catch (error) {
        console.error("Failed to fetch action plans", error);
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [user]);

  // Load available sectors from centralized allowed list
  const sectors = useMemo(() => {
    return ['Todos', ...(strategicData?.allowed_sectors ?? [])];
  }, [strategicData]);

  // 1. Centralized Filter Logic
  const filteredData = useMemo(() => {
    // We need to return the structure ActionPlanItem -> filtered SubItems
    // If a plan has no matching subitems after filter, should we hide the plan? Yes, usually.

    return items.map(plan => {
      // 1. Sector Filter (Plan Level)
      if (selectedSector !== 'Todos' && plan.sector !== selectedSector) return null;

      // 2. Date Filter (SubItem Level)
      const visibleSubItems = plan.subItems.filter(action => {
        if (dateRange.start && action.scheduleStart && action.scheduleStart < dateRange.start) return false;
        if (dateRange.end && action.scheduleEnd && action.scheduleEnd > dateRange.end) return false;

        // Hard Filter for Carlos
        if (action.responsible && action.responsible.some(r => r.toLowerCase().includes('carlos'))) {
          // Removing HIM from responsible list, or removing the item?
          // Usually just remove him from the list. 
          // But here we are filtering ITEMS.
          // We should probably filter him out of the responsible array later.
          // But let's check where responsible is used.
        }
        return true;
      });

      // Filter Responsible List inside the subItem for consistency?
      const cleanedSubItems = visibleSubItems.map(action => ({
        ...action,
        responsible: (action.responsible || []).filter(r => !r.toLowerCase().includes('carlos'))
      }));

      // if (visibleSubItems.length === 0) return null; // Use cleaned
      if (cleanedSubItems.length === 0) return null;

      return { ...plan, subItems: cleanedSubItems };
    }).filter(Boolean) as ActionPlanItem[];
  }, [items, selectedSector, dateRange]);

  const stats = useMemo(() => {
    let totalActions = 0;
    let concluded = 0;
    let delayed = 0;
    let notStarted = 0;
    let inProgress = 0;
    let suspended = 0;

    let budgetPlanned = 0;
    let budgetActual = 0;
    let hoursPlanned = 0;
    let hoursActual = 0;
    let totalROI = 0;
    let roiCount = 0;
    let totalSat = 0;
    let satCount = 0;

    const delayedActions: Array<{ actionName: string, sector: string, projectName: string, objective: string, responsible: string[], startDate?: string, endDate: string }> = [];
    const macroMap: Record<string, {
      total: number;
      concluded: number;
      sectors: Record<string, {
        total: number;
        concluded: number;
        statuses: Record<string, {
          total: number;
          count: number;
          objectives: Record<string, {
            total: number;
            concluded: number;
            items: Array<{ actionName: string, status: string, responsible: string[], end: string }>
          }>
        }>
      }>;
      categories: Set<string>; // New field for counting categories (Objectives)
    }> = {
      'CLI': { total: 0, concluded: 0, sectors: {}, categories: new Set() },
      'PIP': { total: 0, concluded: 0, sectors: {}, categories: new Set() },
      'PAC': { total: 0, concluded: 0, sectors: {}, categories: new Set() },
      'FIN': { total: 0, concluded: 0, sectors: {}, categories: new Set() },
      'RECLASSIFICAR': { total: 0, concluded: 0, sectors: {}, categories: new Set() }
    };

    const reclassifyObjectives = [
      "Reestruturação da Equipe de Televendas",
      "Entrevista Desligamento",
      "Descrição de cargos",
      "Indicadores",
      "Carro elétrico",
      "Continuidade do negócio",
      "Segurança patrimonial, física e registro de acessos",
      "Estrutura equipe Supply"
    ];

    filteredData.forEach(plan => {
      const isReclassificar = reclassifyObjectives.some(item => plan.objective.trim().toLowerCase() === item.toLowerCase()) || !['CLI', 'PIP', 'PAC', 'FIN'].includes(plan.macro_theme || '');
      const macro = isReclassificar ? 'RECLASSIFICAR' : (plan.macro_theme && ['CLI', 'PIP', 'PAC', 'FIN'].includes(plan.macro_theme)) ? plan.macro_theme : 'RECLASSIFICAR';

      plan.subItems.forEach(action => {
        totalActions++;

        // Calculate if delayed based on end date
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Use parseDateLocal to avoid UTC timezone conversion issues
        const endDate = parseDateLocal(action.scheduleEnd);
        const isDelayed = endDate && action.status !== 'Concluído' && endDate < today;

        if (isDelayed) {
          delayed++;
          delayedActions.push({
            actionName: action.actions,
            sector: plan.sector,
            projectName: plan.objective || 'Sem Título',
            objective: plan.objective,
            responsible: action.responsible || [],
            startDate: action.scheduleStart,
            endDate: action.scheduleEnd
          });
        }

        switch (action.status) {
          case 'Concluído': concluded++; break;
          case 'Suspenso': suspended++; break;
          case 'Em Andamento': inProgress++; break;
          default: notStarted++; break;
        }

        budgetPlanned += action.budgetPlanned || 0;
        budgetActual += action.budgetActual || 0;
        hoursPlanned += action.hoursPlanned || 0;
        hoursActual += action.hoursActual || 0;

        if (action.roiPercentage) {
          totalROI += action.roiPercentage;
          roiCount++;
        }
        if (action.stakeholderSatisfaction) {
          totalSat += action.stakeholderSatisfaction;
          satCount++;
        }

        if (action.stakeholderSatisfaction) {
          totalSat += action.stakeholderSatisfaction;
          satCount++;
        }

        // Macro Aggregation
        macroMap[macro].total++;
        if (action.status === 'Concluído') macroMap[macro].concluded++;

        if (plan.objective) {
          macroMap[macro].categories.add(plan.objective);
        }

        // Sector Aggregation
        const sectorName = plan.sector || 'Não Definido';
        if (!macroMap[macro].sectors[sectorName]) {
          macroMap[macro].sectors[sectorName] = { total: 0, concluded: 0, statuses: {} };
        }
        const sStats = macroMap[macro].sectors[sectorName];
        sStats.total++;
        if (action.status === 'Concluído') sStats.concluded++;

        // Status Aggregation
        const statusName = action.status || 'Não Iniciado';
        if (!sStats.statuses[statusName]) {
          sStats.statuses[statusName] = { total: 0, count: 0, objectives: {} };
        }
        const stStats = sStats.statuses[statusName];
        stStats.total++; // same as count really
        stStats.count++;

        // Objective Aggregation
        const objectiveName = plan.objective || 'Sem Objetivo Definido';
        if (!stStats.objectives[objectiveName]) {
          stStats.objectives[objectiveName] = { total: 0, concluded: 0, items: [] };
        }
        const oStats = stStats.objectives[objectiveName];
        oStats.total++;
        if (action.status === 'Concluído') oStats.concluded++;

        // Fix Responsible "Todos" logic
        let resolvedResponsible = action.responsible || [];
        if (resolvedResponsible.some(r => r.toLowerCase() === 'todos')) {
          // Get all users for this plan's sector
          const sectorUsers = allUsers
            .filter(u => u.sector && u.sector.toLowerCase() === sectorName.toLowerCase())
            .map(u => u.name);

          if (sectorUsers.length > 0) {
            resolvedResponsible = sectorUsers;
          } else {
            // Fallback if no users found in sector, just remove 'Todos' or keep as is? 
            // User said "remove 'Carlos, Todos' and leave as responsible all users". 
            // If we can't find users, maybe just keep 'Todos' to show SOMETHING. 
            // But strictly we should replace with sector members.
            // Let's keep it as sectorUsers if found, otherwise filtered original (removing 'Todos' might leave it empty).
            resolvedResponsible = sectorUsers;
          }
        }

        oStats.items.push({
          actionName: action.actions,
          status: action.status || 'Não Iniciado',
          responsible: resolvedResponsible,
          end: action.scheduleEnd
        });
      });
    });

    const efficacy = totalActions > 0 ? Math.round((concluded / totalActions) * 100) : 0;
    const avgROI = roiCount > 0 ? (totalROI / roiCount).toFixed(1) : '0.0';
    const avgSat = satCount > 0 ? (totalSat / satCount).toFixed(1) : '0.0';

    // Calculate total unique categories across all macros
    const totalCategories = Object.values(macroMap).reduce((sum, macro: any) => sum + macro.categories.size, 0);

    const statusData = [
      { name: 'Não Iniciado', value: notStarted, fill: '#cbd5e1' },
      { name: 'Em Andamento', value: inProgress, fill: '#3b82f6' },
      { name: 'Atrasado', value: delayed, fill: '#dc2626' },
      { name: 'Concluído', value: concluded, fill: '#1e293b' },
      { name: 'Suspenso', value: suspended, fill: '#94a3b8' },
    ].filter(d => d.value > 0);

    const financialData = [
      { name: 'Orçamento (R$)', Planejado: budgetPlanned, Realizado: budgetActual },
    ];

    const hoursData = [
      { name: 'Horas', Planejado: hoursPlanned, Realizado: hoursActual },
    ];



    return {
      kpis: [
        { label: 'Total de Ações', value: totalActions, sub: 'Itens mapeados', icon: Briefcase, color: 'text-slate-600', bg: 'bg-slate-50' },
        { label: 'Categorias', value: totalCategories, sub: 'Objetivos únicos', icon: ClipboardList, color: 'text-indigo-600', bg: 'bg-indigo-50' },
        { label: 'Eficácia Global', value: `${efficacy}%`, sub: 'Itens concluídos', icon: Target, color: 'text-blue-600', bg: 'bg-blue-50' },
      ],
      delayedActions,
      financial: { budgetPlanned, budgetActual, hoursPlanned, hoursActual },
      statusData,
      financialData,
      hoursData,
      macroDetails: macroMap
    };
  }, [filteredData, allUsers]);

  if (loading) return <div className="p-8 text-center text-xs font-black uppercase text-gray-400">Carregando indicadores...</div>;

  const formatCurrency = (val: number) => `R$ ${val.toLocaleString('pt-BR', { minimumFractionDigits: 0 })}`;

  const MACRO_LABELS: Record<string, string> = {
    'CLI': 'CLIENTES (MERCADO)',
    'PIP': 'PROCESSOS INTERNOS',
    'PAC': 'PESSOAS E APRENDIZADO',
    'FIN': 'FINANCEIRO',
    'RECLASSIFICAR': 'RECLASSIFICAR'
  };

  const MACRO_COLORS: Record<string, string> = {
    'CLI': 'text-orange-600',
    'PIP': 'text-cyan-600',
    'PAC': 'text-pink-600',
    'FIN': 'text-purple-600',
    'RECLASSIFICAR': 'text-slate-600'
  };

  const MACRO_BGS: Record<string, string> = {
    'CLI': 'bg-orange-50',
    'PIP': 'bg-cyan-50',
    'PAC': 'bg-pink-50',
    'FIN': 'bg-purple-50',
    'RECLASSIFICAR': 'bg-slate-50'
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-6">
        <div>
          <h1 className="text-2xl font-black text-slate-900 uppercase tracking-tighter">Planejamento Estratégico</h1>
          <p className="text-gray-500 text-sm font-medium italic">Visão consolidada do Portfólio de Projetos e Indicadores.</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-4 bg-white p-3 rounded-2xl shadow-sm border border-gray-100">
          <div className="flex flex-col min-w-[150px]">
            <label className="text-[9px] font-black uppercase text-slate-400 mb-1 ml-1">Setor</label>
            <SearchableSelect
              value={selectedSector}
              onChange={setSelectedSector}
              options={sectors}
              placeholder="Setor"
              className="mt-0.5"
            />
          </div>

          <div className="flex gap-2">
            <div className="flex flex-col">
              <label className="text-[9px] font-black uppercase text-slate-400 mb-1 ml-1">De</label>
              <input
                type="date"
                className="bg-slate-50 border-none rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-slate-200 py-2 px-3"
                value={dateRange.start}
                onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              />
            </div>
            <div className="flex flex-col">
              <label className="text-[9px] font-black uppercase text-slate-400 mb-1 ml-1">Até</label>
              <input
                type="date"
                className="bg-slate-50 border-none rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-slate-200 py-2 px-3"
                value={dateRange.end}
                onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Delayed Actions Section (New) */}
      {/* Previous Delayed Actions Location - Removed */}

      {/* KPI Grid */}
      <KpiGrid className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {stats.kpis.map((kpi, i) => {
          const colorMap: Record<string, KpiColor> = { 'text-slate-600': 'slate', 'text-indigo-600': 'indigo', 'text-blue-600': 'blue', 'text-emerald-600': 'emerald', 'text-orange-600': 'orange', 'text-red-600': 'red', 'text-amber-600': 'amber' };
          return (
            <KpiCard key={i} label={kpi.label} value={kpi.value} sub={kpi.sub} Icon={kpi.icon} color={colorMap[kpi.color] || 'blue'} />
          );
        })}
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 transition-all hover:shadow-md">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Orçamento Planejado</p>
              <h3 className="text-lg font-black text-slate-900 mt-1">{formatCurrency(stats.financial.budgetPlanned)}</h3>
              <p className="text-[10px] text-slate-400 font-medium mt-1">Previsão inicial</p>
            </div>
            <div className="bg-slate-50 p-3 rounded-xl">
              <DollarSign className="w-5 h-5 text-slate-600" />
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 transition-all hover:shadow-md">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Orçamento Realizado</p>
              <h3 className="text-lg font-black text-slate-900 mt-1">{formatCurrency(stats.financial.budgetActual)}</h3>
              <p className="text-[10px] text-slate-400 font-medium mt-1">Valor executado</p>
            </div>
            <div className={`p-3 rounded-xl ${stats.financial.budgetActual > stats.financial.budgetPlanned ? 'bg-red-50' : 'bg-green-50'}`}>
              <DollarSign className={`w-5 h-5 ${stats.financial.budgetActual > stats.financial.budgetPlanned ? 'text-red-600' : 'text-green-600'}`} />
            </div>
          </div>
        </div>
        <div className="bg-white p-4 rounded-2xl shadow-sm border border-gray-100 transition-all hover:shadow-md">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Esforço (Horas)</p>
              <h3 className="text-lg font-black text-slate-900 mt-1">{stats.financial.hoursActual}h</h3>
              <p className="text-[10px] text-slate-400 font-medium mt-1">de {stats.financial.hoursPlanned}h planejadas</p>
            </div>
            <div className="bg-blue-50 p-3 rounded-xl">
              <Clock className="w-5 h-5 text-blue-600" />
            </div>
          </div>
        </div>
      </KpiGrid>

      {/* Delayed Actions Section (Moved Here) */}

      {/* Delayed Actions Section (Moved Here) */}
      <DelayedActionsSection actions={stats.delayedActions} allUsers={allUsers} />

      {/* Macro/Sector Accordion List */}
      <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 flex flex-col">
        <h3 className="text-sm font-black text-slate-900 uppercase tracking-widest mb-6 flex items-center gap-2">
          <ClipboardList className="w-4 h-4 text-slate-400" /> Detalhamento por Perspectiva (BSC)
        </h3>
        <div className="space-y-4">
          {['PAC', 'PIP', 'CLI', 'FIN', 'RECLASSIFICAR'].map(macro => {
            const mStats = stats.macroDetails[macro];
            if (mStats.total === 0) return null;

            return (
              <MacroAccordionItem
                key={macro}
                macroCode={macro}
                label={MACRO_LABELS[macro] || macro}
                color={MACRO_COLORS[macro] || 'text-gray-600'}
                bg={MACRO_BGS[macro] || 'bg-gray-50'}
                stats={mStats}
                allUsers={allUsers}
              />
            );
          })}
          {Object.values(stats.macroDetails).every((m: any) => m.total === 0) && <p className="text-xs text-gray-400 italic">Nenhum dado disponível.</p>}
        </div>
      </div>
    </div>
  );
};

const MacroAccordionItem: React.FC<{ macroCode: string, label: string, color: string, bg: string, stats: any, allUsers: any[] }> = ({ macroCode, label, color, bg, stats, allUsers }) => {
  const [isOpen, setIsOpen] = useState(false);
  const completion = stats.total > 0 ? Math.round((stats.concluded / stats.total) * 100) : 0;

  return (
    <div className="border border-slate-100 rounded-xl overflow-hidden shadow-sm">
      <div
        onClick={() => setIsOpen(!isOpen)}
        className={`p-4 cursor-pointer transition-colors flex flex-col gap-3 ${isOpen ? 'bg-slate-50' : 'bg-white hover:bg-slate-50'}`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${bg}`}>
              <Target className={`w-5 h-5 ${color}`} />
            </div>
            <div>
              <h4 className={`text-xs font-black uppercase tracking-widest ${color}`}>{label}</h4>
              <p className="text-[10px] text-slate-400 font-medium">
                {stats.total} ações mapeadas
                <span className="mx-1">•</span>
                {stats.categories.size} categorias
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end">
              <span className="text-[10px] font-bold text-slate-500">{completion}% Concluído</span>
              <div className="w-24 h-1.5 bg-slate-200 rounded-full mt-1 overflow-hidden">
                <div className={`h-full rounded-full ${macroCode === 'CLI' ? 'bg-orange-500' : macroCode === 'PIP' ? 'bg-cyan-500' : macroCode === 'FIN' ? 'bg-purple-500' : macroCode === 'PAC' ? 'bg-pink-500' : 'bg-slate-500'}`} style={{ width: `${completion}%` }}></div>
              </div>
            </div>
            <button className="p-1 text-slate-400">
              {isOpen ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>

      {isOpen && (
        <div className="p-4 bg-white border-t border-slate-100 space-y-3">
          <h5 className="text-[10px] font-black uppercase text-slate-300 tracking-widest mb-2 ml-1">Detalhamento por Setor</h5>
          {Object.keys(stats.sectors).sort().map(sectorName => (
            <SectorItem
              key={sectorName}
              name={sectorName}
              data={stats.sectors[sectorName]}
              allUsers={allUsers}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const SectorItem: React.FC<{ name: string, data: any, allUsers: any[] }> = ({ name, data, allUsers }) => {
  const [isOpen, setIsOpen] = useState(false);
  const completion = data.total > 0 ? Math.round((data.concluded / data.total) * 100) : 0;

  return (
    <div className="border border-slate-100 rounded-lg overflow-hidden">
      <div className="p-3 bg-slate-50/50 hover:bg-slate-100/50 transition-colors flex flex-col gap-2">
        <div className="flex items-center justify-between cursor-pointer" onClick={() => setIsOpen(!isOpen)}>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-black uppercase text-slate-600">{name}</span>
            <span className="text-[9px] font-bold text-slate-400 bg-white border border-slate-200 px-1.5 rounded-full">{data.total}</span>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-bold text-slate-400">{completion}%</span>
              <div className="w-16 h-1 bg-slate-200 rounded-full overflow-hidden">
                <div className="h-full bg-slate-600" style={{ width: `${completion}%` }}></div>
              </div>
            </div>
            {isOpen ? <ChevronUp className="w-3 h-3 text-slate-400" /> : <ChevronDown className="w-3 h-3 text-slate-400" />}
          </div>
        </div>
      </div>

      {isOpen && (
        <div className="p-3 bg-white border-t border-slate-100 space-y-2">
          {Object.entries(data.statuses || {}).map(([status, stData]: [string, any]) => (
            <StatusAccordionItem
              key={status}
              status={status}
              data={stData}
              allUsers={allUsers}
              sectorName={name}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const StatusAccordionItem: React.FC<{ status: string, data: any, allUsers: any[], sectorName: string }> = ({ status, data, allUsers, sectorName }) => {
  const [isOpen, setIsOpen] = useState(false);

  const getStatusConfig = (status: string) => {
    switch (status) {
      case 'Não Iniciado': return { bg: 'bg-slate-100', text: 'text-slate-600', border: 'border-slate-200', icon: Clock, accent: 'bg-slate-500' };
      case 'Em Andamento': return { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-100', icon: Activity, accent: 'bg-blue-500' };
      case 'Atrasado': return { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-100', icon: AlertTriangle, accent: 'bg-red-500' };
      case 'Concluído': return { bg: 'bg-green-50', text: 'text-green-600', border: 'border-green-100', icon: CheckCircle2, accent: 'bg-green-500' };
      case 'Suspenso': return { bg: 'bg-orange-50', text: 'text-orange-600', border: 'border-orange-100', icon: AlertTriangle, accent: 'bg-orange-500' };
      default: return { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200', icon: Clock, accent: 'bg-gray-500' };
    }
  };
  const config = getStatusConfig(status);
  const Icon = config.icon;

  return (
    <div className={`rounded-xl border ${config.border} overflow-hidden transition-all duration-300 hover:shadow-md ${isOpen ? 'shadow-sm' : ''}`}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`w-full flex items-center justify-between p-3 ${config.bg} transition-colors group relative overflow-hidden`}
      >
        <div className={`absolute left-0 top-0 bottom-0 w-1 ${config.accent}`}></div>
        <div className="flex items-center gap-3 pl-2">
          <div className={`p-1.5 rounded-lg bg-white/60 shadow-sm group-hover:scale-110 transition-transform`}>
            <Icon className={`w-3.5 h-3.5 ${config.text}`} />
          </div>
          <div className="flex flex-col items-start">
            <span className={`text-[10px] font-black uppercase tracking-widest ${config.text}`}>
              {status}
            </span>
            <span className="text-[9px] font-bold text-slate-400">
              {data.count} {data.count === 1 ? 'item' : 'itens'}
            </span>
          </div>
        </div>
        <div className={`p-1 rounded-full ${isOpen ? 'bg-white shadow-sm' : 'bg-transparent'} transition-all`}>
          {isOpen ? <ChevronUp className={`w-3.5 h-3.5 ${config.text}`} /> : <ChevronDown className={`w-3.5 h-3.5 text-slate-400`} />}
        </div>
      </button>

      {isOpen && (
        <div className="p-3 bg-white space-y-3">
          {Object.entries(data.objectives).map(([objective, objData]: [string, any]) => (
            <ObjectiveItem
              key={objective}
              objective={objective}
              data={objData}
              statusColor={config.text}
              allUsers={allUsers}
              sectorName={sectorName}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const ObjectiveItem: React.FC<{ objective: string, data: any, statusColor: string, allUsers: any[], sectorName: string }> = ({ objective, data, statusColor, allUsers, sectorName }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="group/obj">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className={`w-full flex items-center justify-between p-3 rounded-xl border border-slate-100 hover:border-slate-200 hover:bg-slate-50 transition-all duration-300 ${isExpanded ? 'bg-slate-50 ring-1 ring-slate-100' : ''}`}
      >
        <div className="flex items-center gap-3 text-left w-full overflow-hidden">
          <div className={`w-8 h-8 rounded-lg bg-white border border-slate-100 flex items-center justify-center shadow-sm shrink-0 group-hover/obj:scale-105 transition-transform group-hover/obj:shadow-md`}>
            <Target className={`w-4 h-4 ${statusColor} opacity-70 group-hover/obj:opacity-100 transition-opacity`} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-black uppercase text-slate-700 leading-tight truncate pr-4 group-hover/obj:text-slate-900 transition-colors">{objective}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[9px] font-bold text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded-full">{data.total} Sub-ações</span>
            </div>
          </div>
        </div>
        {isExpanded ? <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0 ml-2" /> : <ChevronDown className="w-3.5 h-3.5 text-slate-300 shrink-0 ml-2" />}
      </button>

      {isExpanded && (
        <div className="pl-4 pr-1 py-2 space-y-2 mt-1 relative before:absolute before:left-[27px] before:top-0 before:bottom-4 before:w-[1px] before:bg-slate-200">
          {data.items.map((item: any, idx: number) => {
            // Resolve Sectors Involved
            const involvedSectors = new Set<string>();
            if (item.responsible) {
              item.responsible.forEach((respName: string) => {
                const user = allUsers.find(u => u.name.toLowerCase() === respName.toLowerCase());
                if (user && user.sector) involvedSectors.add(user.sector);
              });
            }
            const sectorsList = Array.from(involvedSectors);
            if (sectorsList.length === 0 && sectorName) {
              sectorsList.push(sectorName);
            }

            return (
              <div key={idx} className="relative pl-6 py-2 rounded-lg hover:bg-slate-50 transition-colors group/item ml-2">
                <div className="absolute left-0 top-1/2 -translate-y-1/2 w-4 h-[1px] bg-slate-200"></div>

                <div className="flex flex-col gap-1">
                  <p className="text-[11px] font-medium text-slate-600 leading-snug group-hover/item:text-slate-900 transition-colors">
                    {item.actionName}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1">
                    <div className="flex items-center gap-1.5 min-w-[150px]">
                      <Users className="w-3 h-3 text-slate-300" />
                      <span className="text-[9px] font-bold text-slate-400">Participantes:
                        <span className="text-slate-500 ml-1">
                          {(() => {
                            // Find Admins for the Involved Sectors
                            const adminNames = new Set<string>();
                            sectorsList.forEach(secName => {
                              const admins = allUsers.filter(u =>
                                u.sector && u.sector.toLowerCase() === secName.toLowerCase() &&
                                (u.role === 'admin' || u.role === 'super_user')
                              );
                              admins.forEach(a => adminNames.add(a.name));
                            });
                            const adminsArray = Array.from(adminNames);
                            return adminsArray.length > 0 ? adminsArray.join(', ') : 'Sem Admins';
                          })()}
                        </span>
                      </span>
                    </div>

                    {/* New Fields */}
                    <div className="flex items-center gap-1.5">
                      <Briefcase className="w-3 h-3 text-slate-300" />
                      <span className="text-[9px] font-bold text-slate-400">Setores:
                        {sectorsList.length > 0 ? (
                          <span className="text-slate-500 ml-1">{sectorsList.join(', ')}</span>
                        ) : (
                          <span className="text-slate-400 ml-1 italic">--</span>
                        )}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <Clock className="w-3 h-3 text-slate-300" />
                      <span className="text-[9px] font-bold text-slate-400">Aguardando:
                        {item.waitingForReturn && item.waitingForReturn.length > 0 ? (
                          <span className="text-slate-500 ml-1">{item.waitingForReturn.join(', ')}</span>
                        ) : (
                          <span className="text-slate-400 ml-1 italic">--</span>
                        )}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const DelayedActionsSection: React.FC<{ actions: any[], allUsers: any[] }> = ({ actions, allUsers }) => {
  const [isOpen, setIsOpen] = useState(false);

  if (!actions || actions.length === 0) return null;

  // Group by sector
  const grouped = actions.reduce((acc: any, action: any) => {
    const sector = action.sector || 'Sem Setor';
    if (!acc[sector]) acc[sector] = [];
    acc[sector].push(action);
    return acc;
  }, {});

  return (
    <div className="bg-gradient-to-br from-red-50 to-white border border-red-100 rounded-3xl shadow-lg mb-8 animate-in fade-in slide-in-from-top-2 overflow-hidden relative">
      <div className="absolute top-0 right-0 w-64 h-64 bg-red-100/50 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

      <div
        className="px-8 py-6 flex items-center justify-between cursor-pointer relative z-10"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-5">
          <div className="w-12 h-12 rounded-2xl bg-red-500 text-white flex items-center justify-center shadow-red-200 shadow-lg ring-4 ring-red-50">
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-lg font-black text-slate-900 uppercase tracking-tighter">Ações em Atraso</h3>
            <p className="text-xs text-slate-500 font-medium mt-1">
              <span className="text-red-600 font-extrabold bg-red-100 px-2 py-0.5 rounded-full border border-red-200 mr-1.5">{actions.length} ações</span>
              requerem atenção imediata
            </p>
          </div>
        </div>
        <div className={`p-2.5 rounded-xl bg-white shadow-sm border border-slate-100 transition-all duration-300 ${isOpen ? 'rotate-180 bg-slate-50' : 'hover:scale-105'}`}>
          <ChevronDown className="w-5 h-5 text-slate-400" />
        </div>
      </div>

      {isOpen && (
        <div className="mx-6 mb-6 bg-white/80 backdrop-blur-sm rounded-2xl border border-red-100/50 overflow-hidden shadow-sm">
          <div className="divide-y divide-red-50">
            {Object.entries(grouped).map(([sector, items]: [string, any]) => (
              <DelayedSectorGroup key={sector} sector={sector} items={items} allUsers={allUsers} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const DelayedSectorGroup: React.FC<{ sector: string, items: any[], allUsers: any[] }> = ({ sector, items, allUsers }) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="group first:rounded-t-2xl last:rounded-b-2xl">
      <div
        className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-red-50/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-4">
          <div className={`w-1.5 h-10 rounded-full transition-all duration-300 ${expanded ? 'bg-gradient-to-b from-red-400 to-red-600 shadow-lg shadow-red-200' : 'bg-slate-200 group-hover:bg-red-300'}`}></div>
          <span className="text-sm font-black uppercase text-slate-700 tracking-wide">{sector}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-[10px] font-bold text-red-600 bg-red-50 px-3 py-1.5 rounded-full border border-red-100 shadow-sm">
            {items.length} {items.length === 1 ? 'item' : 'itens'}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />}
        </div>
      </div>

      {expanded && (
        <div className="bg-white px-6 pb-6 pt-2">
          <div className="overflow-hidden rounded-xl border border-slate-100 shadow-sm">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-50/50 border-b border-slate-100">
                  <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 py-3 px-5 text-left w-[25%]">Ação / Projeto</th>
                  <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 py-3 px-5 text-left w-[15%]">Setores Env.</th>
                  <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 py-3 px-5 text-left w-[20%]">Participantes (Admins)</th>
                  <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 py-3 px-5 text-left w-[15%]">Aguardando Ret.</th>
                  <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 py-3 px-5 text-left w-[10%]">Cronograma</th>
                  <th className="text-[10px] font-black uppercase tracking-widest text-slate-400 py-3 px-5 text-center w-[5%]">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {items.map((item: any, idx: number) => {
                  // Resolve Sectors Involved
                  const involvedSectors = new Set<string>();
                  if (item.responsible) {
                    item.responsible.forEach((respName: string) => {
                      const user = allUsers.find(u => u.name.toLowerCase() === respName.toLowerCase());
                      if (user && user.sector) involvedSectors.add(user.sector);
                    });
                  }
                  const sectorsList = Array.from(involvedSectors);
                  if (sectorsList.length === 0 && item.sector) {
                    sectorsList.push(item.sector);
                  }

                  return (
                    <tr key={idx} className="hover:bg-red-50/20 transition-colors group/row">
                      <td className="py-4 px-5">
                        <div className="flex flex-col gap-1">
                          <p className="text-xs font-bold text-slate-700 leading-relaxed group-hover/row:text-red-700 transition-colors" title={item.actionName}>
                            {item.actionName}
                          </p>
                          <div className="flex items-center gap-1.5 mt-1">
                            <Briefcase className="w-3 h-3 text-slate-300" />
                            <p className="text-[10px] font-medium text-slate-400 line-clamp-1">{item.projectName}</p>
                          </div>
                        </div>
                      </td>

                      <td className="py-4 px-5">
                        {sectorsList.length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {sectorsList.map(s => (
                              <span key={s} className="text-[9px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full border border-slate-200">{s}</span>
                            ))}
                          </div>
                        ) : (
                          <span className="text-[10px] text-slate-500 italic">--</span>
                        )}
                      </td>

                      {/* Participantes (Now Sector Admins) */}
                      <td className="py-4 px-5">
                        <div className="flex flex-wrap gap-1.5">
                          {(() => {
                            // Find Admins for the Involved Sectors (or Item Sector fallback)
                            // Logic: For each sector in sectorsList, find users with role 'admin' or 'super_user'
                            const adminNames = new Set<string>();
                            sectorsList.forEach(secName => {
                              const admins = allUsers.filter(u =>
                                u.sector && u.sector.toLowerCase() === secName.toLowerCase() &&
                                (u.role === 'admin' || u.role === 'super_user')
                              );
                              admins.forEach(a => adminNames.add(a.name));
                            });
                            const adminsArray = Array.from(adminNames);

                            if (adminsArray.length > 0) {
                              return adminsArray.map((resp, i) => (
                                <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-50 border border-slate-100" title={resp}>
                                  <div className="w-1.5 h-1.5 rounded-full bg-slate-400"></div>
                                  <span className="text-[10px] font-bold text-slate-600 uppercase truncate max-w-[80px]">
                                    {resp.split(' ')[0]}
                                  </span>
                                </div>
                              ));
                            } else {
                              return <span className="text-[10px] text-slate-400 italic px-2">Sem Admins</span>;
                            }
                          })()}
                        </div>
                      </td>

                      {/* Aguardando Retorno */}
                      <td className="py-4 px-5">
                        {item.waitingForReturn && item.waitingForReturn.length > 0 ? (
                          <div className="text-[10px] text-slate-600 font-medium">
                            {item.waitingForReturn.join(', ')}
                          </div>
                        ) : (
                          <div className="text-[10px] text-slate-400 italic">
                            -
                          </div>
                        )}
                      </td>

                      <td className="py-4 px-5">
                        <div className="flex flex-col gap-2">
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-bold text-slate-400 uppercase w-8 tracking-wider">Início</span>
                            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-slate-50 border border-slate-100">
                              <CalendarIcon className="w-3 h-3 text-slate-400" />
                              <span className="text-[10px] font-medium text-slate-600">
                                {item.startDate ? parseDateLocal(item.startDate)?.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : '--/--'}
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[9px] font-black text-red-500 uppercase w-8 tracking-wider">Prazo</span>
                            <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-red-50 border border-red-100 shadow-sm">
                              <AlertTriangle className="w-3 h-3 text-red-500" />
                              <span className="text-[10px] font-bold text-red-700">
                                {item.endDate ? parseDateLocal(item.endDate)?.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : 'S/P'}
                              </span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-5 text-center">
                        <span className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-red-100 text-red-600 shadow-sm border border-red-200 group-hover/row:scale-110 transition-transform">
                          <Clock className="w-4 h-4" />
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};


export default ActionPlanDashboard;
