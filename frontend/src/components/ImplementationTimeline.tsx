
import React, { useState, useEffect } from 'react';
import { api } from '../app_api';
import { ChevronDown, ChevronRight, Calculator, User, AlertCircle, Calendar, ArrowLeft, ArrowRight, Search, Filter, Minus, Plus, Edit3, Folder } from 'lucide-react';
import { useSectors } from '../hooks/useSectors';
import { User as UserType } from '../types';
import { exportActionPlanToExcel, exportActionPlanToPDF } from './exportUtils';
import { FileText, Download } from 'lucide-react';

interface StrategicTimelineProps {
    user?: UserType;
}

const ImplementationTimeline: React.FC<StrategicTimelineProps> = ({ user }) => {
    const SECTORS = useSectors();
    const [plans, setPlans] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedThemes, setExpandedThemes] = useState<string[]>([]);
    const [expandedPlans, setExpandedPlans] = useState<string[]>([]);
    const [searchTerm, setSearchTerm] = useState('');

    // Filters
    const [selectedSector, setSelectedSector] = useState('Todos');
    const [selectedStatus, setSelectedStatus] = useState('Todos');
    const [legendOpen, setLegendOpen] = useState(false);

    // View Mode
    type ViewMode = 'month' | 'week' | 'day';
    const [viewMode, setViewMode] = useState<ViewMode>('month');

    // For 'day' view, we need a current month reference
    const [currentDateRef, setCurrentDateRef] = useState(new Date());

    // Selected Item for Modal
    const [selectedItem, setSelectedItem] = useState<any | null>(null);

    // All Users for filtering
    const [allUsers, setAllUsers] = useState<{ id: string, name: string, role?: string }[]>([]);

    const [strategicData, setStrategicData] = useState<{
        allowed_sectors: string[];
        allowed_users: { id: string, name: string, sector: string, role: string }[];
    } | null>(null);

    // Permissions (centralized model)
    const userRole = user?.role;
    const isSuperUser = userRole === 'super_user';
    const isCEO = userRole === 'ceo';
    const canEditOverride = user?.permissions?.strategic?.can_edit === true;
    const canDeleteOverride = user?.permissions?.strategic?.can_delete === true;
    const isAdmin = userRole === 'admin' || isSuperUser || isCEO || canEditOverride;
    const isReadOnly = !isAdmin;
    const canDelete = isSuperUser || canDeleteOverride;

    const allowedSectors = React.useMemo(() => {
        return ['Todos', ...(strategicData?.allowed_sectors ?? [])];
    }, [strategicData]);

    useEffect(() => {
        api.getImplementationSectors(user?.id)
            .then(data => setStrategicData(data))
            .catch(e => console.error('Failed to fetch implementation sectors', e));
    }, []);

    useEffect(() => {
        loadData();
    }, [user]);

    const loadData = async () => {
        try {
            const [data, usersData, sectorsResult] = await Promise.all([
                api.getImplementationSchedules(undefined, user?.id),
                api.getAllUsersSimple(),
                api.getImplementationSectors(user?.id)
            ]);

            setAllUsers(usersData);
            setStrategicData(sectorsResult);

            let finalData = data;
            if (user && !isAdmin) {
                const allowed = sectorsResult.allowed_sectors.map((s: string) => s.trim().toLowerCase());

                finalData = data.filter((plan: any) => {
                    const planSectorRaw = plan.sector || '';
                    const planSectors = planSectorRaw.split(/[;,]\s*/).map(s => s.trim().toLowerCase()).filter(Boolean);
                    if (planSectors.length === 0) return false;

                    const strictMatch = planSectors.some(ps => allowed.includes(ps));
                    return strictMatch;
                });
            }

            // Sort Alphabetically by Objective
            finalData.sort((a: any, b: any) => (a.objective || '').localeCompare(b.objective || ''));

            setPlans(finalData);
            setExpandedPlans([]);
            setExpandedThemes([]);

        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const toggleTheme = (theme: string) => {
        setExpandedThemes(prev => prev.includes(theme) ? prev.filter(t => t !== theme) : [...prev, theme]);
    };

    const togglePlan = (id: string) => {
        setExpandedPlans(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
    };

    // Grouping logic for 3-level hierarchy
    const filteredPlans = React.useMemo(() => {
        return plans.filter(plan => {
            const matchesSearch = !searchTerm ||
                (plan.objective || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (plan.macro_theme || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (plan.subItems || []).some((s: any) => (s.actions || '').toLowerCase().includes(searchTerm.toLowerCase()));

            const matchesSector = selectedSector === 'Todos' ||
                (plan.sector || '').split(/[;,]\s*/).some((s: string) => s.trim() === selectedSector);

            const matchesStatus = selectedStatus === 'Todos' ||
                (plan.subItems || []).some((s: any) => s.status === selectedStatus);

            return matchesSearch && matchesSector && matchesStatus;
        });
    }, [plans, searchTerm, selectedSector, selectedStatus]);

    const groupedThemes = React.useMemo(() => {
        const groups: { [key: string]: any[] } = {};
        filteredPlans.forEach(plan => {
            const theme = (plan.macro_theme || 'Sem Tema').trim();
            if (!groups[theme]) groups[theme] = [];
            groups[theme].push(plan);
        });
        return Object.entries(groups).map(([theme, items]) => ({
            theme,
            items
        })).sort((a, b) => a.theme === 'Sem Tema' ? 1 : b.theme === 'Sem Tema' ? -1 : a.theme.localeCompare(b.theme));
    }, [filteredPlans]);

    // --- Time Scale Helpers ---

    const getTimelineRange = () => {
        const year = currentDateRef.getFullYear();
        if (viewMode === 'day') {
            // Current Month Only
            const month = currentDateRef.getMonth();
            const start = new Date(year, month, 1);
            const end = new Date(year, month + 1, 0);
            return { start, end };
        } else {
            // Full Year for Month/Week
            const start = new Date(year, 0, 1);
            const end = new Date(year, 11, 31);
            return { start, end };
        }
    };

    const { start: timelineStart, end: timelineEnd } = getTimelineRange();

    const getGrid = () => {
        const grid = [];
        const current = new Date(timelineStart);

        if (viewMode === 'month') {
            // 12 Months
            while (current <= timelineEnd) {
                const label = current.toLocaleDateString('pt-BR', { month: 'short' }).toUpperCase();
                grid.push({ label, start: new Date(current), width: 100 }); // Fixed width for months
                current.setMonth(current.getMonth() + 1);
            }
        } else if (viewMode === 'week') {
            // Weeks
            // Align to start of timeline
            while (current <= timelineEnd) {
                const weekStart = new Date(current);
                const weekEnd = new Date(current);
                weekEnd.setDate(weekEnd.getDate() + 6);

                const label = `${weekStart.getDate()}/${weekStart.getMonth() + 1} - ${weekEnd.getDate()}/${weekEnd.getMonth() + 1}`;
                grid.push({ label, start: new Date(weekStart), width: 150 });
                current.setDate(current.getDate() + 7);
            }
        } else if (viewMode === 'day') {
            // Days of month
            while (current <= timelineEnd) {
                const label = current.getDate().toString();
                grid.push({ label, start: new Date(current), width: 40 });
                current.setDate(current.getDate() + 1);
            }
        }
        return grid;
    };

    const gridItems = getGrid();

    // Calculate Bar Position based on grid
    const getBarPosition = (startStr: string, endStr: string) => {
        if (!startStr || !endStr) return null;
        const itemStart = new Date(startStr);
        const itemEnd = new Date(endStr);

        // Bounds check
        if (itemEnd < timelineStart || itemStart > timelineEnd) return null;

        // Effective range visible
        const visibleStart = itemStart < timelineStart ? timelineStart : itemStart;
        const visibleEnd = itemEnd > timelineEnd ? timelineEnd : itemEnd;

        // Calculate pixels
        const msPerPixel = getMsPerPixel();

        const offsetMs = visibleStart.getTime() - timelineStart.getTime();
        // Inclusive duration: if start and end are same day, it should be 1 day (24h)
        const durationMs = Math.max(0, (visibleEnd.getTime() - visibleStart.getTime()) + (1000 * 60 * 60 * 24));

        let left = offsetMs / msPerPixel;
        let width = durationMs / msPerPixel;

        // Min width visibility
        if (width < 5) width = 5;

        // Adjust for item start < timeline start (negative offset handling if not clipped)
        // We clipped above, so left starts at 0 if itemStart < timelineStart

        return { left, width };
    };

    const getMsPerPixel = () => {
        // Depends on view mode logic mostly relying on fixed cell widths
        // Month: 1 month ~= 100px. 1 month = 30 days. 
        // Week: 7 days = 150px.
        // Day: 1 day = 40px.
        const dayMs = 1000 * 60 * 60 * 24;
        if (viewMode === 'month') return (dayMs * 30.5) / 100;
        if (viewMode === 'week') return (dayMs * 7) / 150;
        if (viewMode === 'day') return dayMs / 40;
        return dayMs / 40;
    };

    // Calculate Today's Position in Timeline
    const getTodayPosition = () => {
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // Check if today is within timeline range
        if (today < timelineStart || today > timelineEnd) return null;

        const msPerPixel = getMsPerPixel();
        const offsetMs = today.getTime() - timelineStart.getTime();
        const left = offsetMs / msPerPixel;

        return left;
    };

    const todayPosition = getTodayPosition();



    const getStatusColor = (status: string) => {
        switch (status) {
            case 'Não Iniciado': return 'bg-slate-400';
            case 'Em Andamento': return 'bg-blue-600';
            case 'Atrasado': return 'bg-red-500';
            case 'Concluído': return 'bg-green-500';
            case 'Suspenso': return 'bg-orange-500';
            default: return 'bg-slate-300';
        }
    };

    const getSectorColor = (sector: string) => {
        switch (sector) {
            case 'Administrativo': return 'bg-slate-500 border-slate-600';
            case 'Comercial': return 'bg-blue-600 border-blue-700'; // Distinct blue
            case 'Compras': return 'bg-emerald-600 border-emerald-700';
            case 'Diretoria': return 'bg-purple-600 border-purple-700';
            case 'Ecommerce': return 'bg-indigo-600 border-indigo-700';
            case 'Financeiro': return 'bg-green-600 border-green-700';
            case 'Logistica': return 'bg-orange-500 border-orange-600';
            case 'Marketing': return 'bg-pink-600 border-pink-700';
            case 'Fabrica': return 'bg-cyan-600 border-cyan-700';
            case 'Qualidade': return 'bg-teal-600 border-teal-700';
            case 'RH': return 'bg-rose-600 border-rose-700';
            case 'T.I': return 'bg-violet-600 border-violet-700';
            default: return 'bg-gray-500 border-gray-600';
        }
    };

    // ... (logic remains)

    // Helper: Material Icons mapping to Lucide
    // event_note -> CalendarDays or Frame
    // search -> Search
    // dark_mode -> Moon
    // notifications -> Bell
    // add -> Plus
    // keyboard_arrow_down -> ChevronDown
    // keyboard_arrow_right -> ChevronRight

    return (
        <div className="flex flex-col h-full bg-[#f8fafc] text-slate-800 font-sans relative">
            {/* Header */}
            <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
                <div className="px-6 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-8">
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                                <Calendar className="w-5 h-5" />
                            </div>
                            <h1 className="text-xl font-bold tracking-tight text-slate-800">Gestão de Projetos <span className="text-blue-500">Visual</span></h1>
                        </div>
                        {/* Search Bar - Hidden on mobile */}
                        <div className="hidden md:flex items-center bg-slate-100 rounded-full px-4 py-1.5 border border-slate-200">
                            <Search className="w-4 h-4 text-slate-400 mr-2" />
                            <input
                                className="bg-transparent border-none focus:ring-0 text-sm w-64 placeholder-slate-400 outline-none text-slate-600"
                                placeholder="Buscar tarefas..."
                                type="text"
                                value={searchTerm}
                                onChange={e => setSearchTerm(e.target.value)}
                            />
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2 border-r border-slate-200 pr-4">
                            <button
                                onClick={() => exportActionPlanToExcel(filteredPlans, 'Cronograma_Projeto.xlsx')}
                                className="p-2 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-all"
                                title="Exportar Excel"
                            >
                                <Download className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => exportActionPlanToPDF(filteredPlans, 'Cronograma de Projeto')}
                                className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all"
                                title="Exportar PDF"
                            >
                                <FileText className="w-4 h-4" />
                            </button>
                        </div>

                        {/* Legend Popover Trigger - Keeping this instead of scrollbar */}
                        <div className="relative">
                            <button
                                onClick={() => setLegendOpen(!legendOpen)}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold uppercase transition-all border ${legendOpen ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                            >
                                <span className="material-icons-round text-sm">palette</span>
                                Legenda
                            </button>
                            {legendOpen && (
                                <>
                                    <div className="fixed inset-0 z-40 bg-transparent" onClick={() => setLegendOpen(false)}></div>
                                    <div className="absolute top-full right-0 mt-2 z-50 bg-white border border-gray-100 shadow-xl rounded-xl p-4 w-[400px] animate-in fade-in zoom-in-95 duration-200">
                                        <div className="flex justify-between items-center mb-3 pb-2 border-b border-gray-50">
                                            <h3 className="text-xs font-black uppercase text-slate-400 tracking-wider">Legenda de Setores</h3>
                                            <button onClick={() => setLegendOpen(false)}><Minus className="w-4 h-4 text-gray-400 hover:text-red-500" /></button>
                                        </div>
                                        <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                                            {SECTORS.map(sector => (
                                                <div key={sector} className="flex items-center gap-2">
                                                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 shadow-sm ${getSectorColor(sector).split(' ')[0]}`}></span>
                                                    <span className="text-[10px] font-bold text-slate-700 truncate">{sector}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            <main className="p-6 flex-1 overflow-hidden flex flex-col">
                {/* Controls Toolbar */}
                <div className="flex flex-wrap items-center justify-between gap-4 mb-6 shrink-0">
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => {
                                if (expandedPlans.length === filteredPlans.length) setExpandedPlans([]);
                                else setExpandedPlans(filteredPlans.map(p => p.id));
                            }}
                            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-all shadow-lg shadow-blue-500/20 active:scale-95"
                        >
                            {expandedPlans.length === filteredPlans.length ? (
                                <><Minus className="w-4 h-4" /><span className="text-sm font-medium uppercase">Recolher</span></>
                            ) : (
                                <><Plus className="w-4 h-4" /><span className="text-sm font-medium uppercase">Expandir</span></>
                            )}
                        </button>
                    </div>

                    <div className="flex items-center gap-3 bg-slate-100 p-1 rounded-lg border border-slate-200">
                        {(['month', 'week', 'day'] as ViewMode[]).map(mode => (
                            <button
                                key={mode}
                                onClick={() => setViewMode(mode)}
                                className={`px-4 py-1.5 text-xs font-bold rounded-md transition-all uppercase ${viewMode === mode ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                            >
                                {mode === 'month' ? 'Mês' : mode === 'week' ? 'Semana' : 'Dia'}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Filters Row */}
                <div className="flex gap-4 mb-4 shrink-0">
                    <select
                        className="bg-white border border-slate-200 rounded-lg text-sm text-slate-600 py-2 px-3 focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-sm cursor-pointer"
                        value={selectedSector}
                        onChange={e => setSelectedSector(e.target.value)}
                    >
                        {/* allowedSectors already includes 'Todos' */}
                        {allowedSectors.map(s => <option key={s} value={s}>{s === 'Todos' ? 'Todos os Setores' : s}</option>)}
                    </select>
                    <select
                        className="bg-white border border-slate-200 rounded-lg text-sm text-slate-600 py-2 px-3 focus:ring-2 focus:ring-blue-500 focus:outline-none shadow-sm cursor-pointer"
                        value={selectedStatus}
                        onChange={e => setSelectedStatus(e.target.value)}
                    >
                        <option value="Todos">Todos Status</option>
                        <option value="Não Iniciado">Não Iniciado</option>
                        <option value="Em Andamento">Em Andamento</option>
                        <option value="Atrasado">Atrasado</option>
                        <option value="Concluído">Concluído</option>
                        <option value="Suspenso">Suspenso</option>
                    </select>

                    <div className="flex items-center gap-2 bg-white p-1 rounded-lg border border-slate-200">
                        <button
                            onClick={() => { setSelectedSector('Todos'); }}
                            className="px-2 py-1.5 rounded-md text-[10px] font-bold uppercase text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition-all ml-auto"
                            title="Limpar Filtros"
                        >
                            🔄 LIMPAR
                        </button>
                    </div>
                </div>

                {/* Timeline Grid Container */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col flex-1">
                    {/* Grid Header */}
                    <div className="flex border-b border-slate-200 bg-slate-50/50">
                        <div className="w-[280px] shrink-0 p-4 text-xs font-bold uppercase tracking-wider text-slate-400 border-r border-slate-200 flex items-center">
                            Tarefas
                        </div>
                        <div className="flex-1 overflow-hidden relative">
                            <div className="flex" style={{ transform: 'translateX(0)' }}> {/* We need to sync scroll but for now static header needs to match grid items */}
                                {gridItems.map((cell, i) => (
                                    <div key={i} className="flex-shrink-0 border-r border-slate-100 p-4 text-xs font-medium text-slate-500 text-center flex items-center justify-center uppercase" style={{ width: cell.width }}>
                                        {cell.label}
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Scrollable Content */}
                    <div className="flex-1 overflow-auto custom-scrollbar relative">
                        <div className="min-w-max relative">
                            {/* Vertical Grid Lines Background */}
                            <div className="absolute inset-0 flex pointer-events-none pl-[280px]">
                                {gridItems.map((cell, i) => (
                                    <div key={i} className="border-r border-slate-50 h-full flex-shrink-0" style={{ width: cell.width }}></div>
                                ))}
                            </div>

                            {/* Today Indicator Line */}
                            {todayPosition !== null && (
                                <div
                                    className="absolute top-0 bottom-0 w-[2px] bg-red-500 pointer-events-none z-50"
                                    style={{ left: `${280 + todayPosition}px` }}
                                >
                                    <div className="absolute -top-1 -left-10 bg-red-500 text-white text-[9px] font-black px-2 py-0.5 rounded-full shadow-lg whitespace-nowrap">
                                        HOJE {new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).toUpperCase()}
                                    </div>
                                </div>
                            )}

                            {groupedThemes.map(group => (
                                <React.Fragment key={group.theme}>
                                    {/* Level 1: Macro Theme */}
                                    <div className="flex h-12 relative bg-slate-100/50 border-b border-slate-200">
                                        <div
                                            className="w-[280px] shrink-0 py-2 px-4 flex items-center gap-2 cursor-pointer z-10 bg-inherit group/theme border-r border-slate-200"
                                            onClick={() => toggleTheme(group.theme)}
                                        >
                                            <Folder className={`w-4 h-4 ${expandedThemes.includes(group.theme) ? 'text-blue-500' : 'text-slate-400'}`} />
                                            <span className="text-xs font-black uppercase text-slate-600 tracking-wider whitespace-normal leading-tight" title={group.theme}>{group.theme}</span>
                                            <div className="ml-auto">
                                                {expandedThemes.includes(group.theme) ? <ChevronDown className="w-3 h-3 text-slate-400" /> : <ChevronRight className="w-3 h-3 text-slate-400" />}
                                            </div>
                                        </div>
                                        <div className="flex-1 relative">
                                            {(() => {
                                                const allActions: any[] = [];
                                                group.items.forEach(p => {
                                                    if (p.subItems) allActions.push(...p.subItems);
                                                });

                                                if (allActions.length === 0) return null;

                                                const validStarts = allActions.map(s => s.scheduleStart).filter(Boolean).sort();
                                                const validEnds = allActions.map(s => s.scheduleEnd).filter(Boolean).sort();

                                                if (validStarts.length === 0 || validEnds.length === 0) return null;

                                                // Since they are YYYY-MM-DD, simple sort gives us min/max correctly
                                                const themeStartStr = validStarts[0];
                                                const themeEndStr = validEnds[validEnds.length - 1];

                                                const themePos = getBarPosition(themeStartStr, themeEndStr);

                                                if (themePos) {
                                                    return (
                                                        <div
                                                            className="absolute top-1/2 -translate-y-1/2 h-3 rounded-full bg-blue-400/30 border border-blue-400/40 z-10 pointer-events-none shadow-sm"
                                                            style={{ left: themePos.left, width: Math.max(themePos.width, 24) }}
                                                        >
                                                            <div className="absolute inset-x-0 top-0 h-[2px] bg-white/40 rounded-full" />
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            })()}
                                        </div>
                                    </div>

                                    {expandedThemes.includes(group.theme) && group.items.map(plan => (
                                        <React.Fragment key={plan.id}>
                                            {/* Level 2: Objective (Plan) */}
                                            <div className="flex h-14 relative group/plan hover:bg-slate-50 transition-colors border-b border-slate-100">
                                                <div
                                                    className="w-[280px] shrink-0 py-2 px-4 pl-8 border-r border-slate-200 flex items-center gap-2 cursor-pointer z-10 bg-inherit"
                                                    onClick={() => togglePlan(plan.id)}
                                                >
                                                    {expandedPlans.includes(plan.id) ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                                                    <div className="flex flex-col overflow-hidden">
                                                        <span className="text-sm font-semibold text-slate-700 whitespace-normal leading-tight group-hover/plan:text-blue-600 transition-colors" title={plan.objective}>{plan.objective}</span>
                                                    </div>
                                                </div>

                                                <div className="flex-1 relative">
                                                    {/* Parent Bar */}
                                                    {(() => {
                                                        const subTokens = plan.subItems || [];
                                                        let parentStartStr = '';
                                                        let parentEndStr = '';

                                                        if (subTokens.length > 0) {
                                                            const validStarts = subTokens.map((s: any) => s.scheduleStart).filter(Boolean).sort();
                                                            const validEnds = subTokens.map((s: any) => s.scheduleEnd).filter(Boolean).sort();
                                                            if (validStarts.length) parentStartStr = validStarts[0];
                                                            if (validEnds.length) parentEndStr = validEnds[validEnds.length - 1];
                                                        }
                                                        const parentPos = (parentStartStr && parentEndStr) ? getBarPosition(parentStartStr, parentEndStr) : null;

                                                        if (parentPos) {
                                                            const getGradient = (sector: string) => {
                                                                if (sector === 'Comercial') return 'from-blue-600 to-blue-400';
                                                                if (sector === 'Compras') return 'from-emerald-500 to-emerald-400';
                                                                if (sector === 'Financeiro') return 'from-green-600 to-green-500';
                                                                if (sector === 'Diretoria') return 'from-purple-600 to-purple-400';
                                                                if (sector === 'Logistica') return 'from-orange-500 to-orange-400';
                                                                if (sector === 'Marketing') return 'from-pink-600 to-pink-400';
                                                                if (sector === 'T.I') return 'from-violet-600 to-violet-400';
                                                                return 'from-slate-500 to-slate-400';
                                                            };

                                                            const counts = subTokens.reduce((acc: any, curr: any) => {
                                                                acc[curr.status] = (acc[curr.status] || 0) + 1;
                                                                return acc;
                                                            }, {});

                                                            return (
                                                                <div
                                                                    className={`absolute top-1/2 -translate-y-1/2 h-8 rounded-md shadow-sm bg-gradient-to-r ${getGradient(plan.sector)} flex items-center px-1.5 gap-1 cursor-pointer hover:brightness-110 transition-all z-10 overflow-hidden`}
                                                                    style={{ left: parentPos.left, width: Math.max(parentPos.width, 40) }}
                                                                    onClick={() => togglePlan(plan.id)}
                                                                >
                                                                    {[
                                                                        { key: 'Não Iniciado', label: 'NI' },
                                                                        { key: 'Em Andamento', label: 'EA' },
                                                                        { key: 'Atrasado', label: 'AT' },
                                                                        { key: 'Suspenso', label: 'SU' },
                                                                        { key: 'Concluído', label: 'CO' }
                                                                    ].map(s => counts[s.key] > 0 && (
                                                                        <div key={s.key} className="flex flex-col leading-none items-center min-w-[12px]">
                                                                            <span className="text-[8px] font-black text-white">{counts[s.key]}</span>
                                                                            <span className="text-[6px] font-bold text-white/70">{s.label}</span>
                                                                        </div>
                                                                    )).reduce((prev: any, curr: any) => prev === null ? [curr] : [...prev, <div key={Math.random()} className="w-px h-3 bg-white/20 shrink-0" />, curr], null)}
                                                                </div>
                                                            );
                                                        }
                                                        return null;
                                                    })()}
                                                </div>
                                            </div>

                                            {/* Level 3: Action (SubItem) */}
                                            {expandedPlans.includes(plan.id) && (plan.subItems || []).map((item: any) => {
                                                const pos = getBarPosition(item.scheduleStart, item.scheduleEnd);
                                                return (
                                                    <div key={item.id} className="flex h-14 relative bg-slate-50/30">
                                                        <div
                                                            className="w-[280px] shrink-0 py-2 px-4 pl-14 border-r border-slate-200 flex flex-col justify-center z-10 bg-inherit border-b border-white cursor-pointer hover:bg-slate-100 transition-colors group/item"
                                                            onClick={() => setSelectedItem({ ...item, parentObjective: plan.objective, parentSector: plan.sector, parentThemeId: plan.id, parentMacroTheme: plan.macro_theme })}
                                                        >
                                                            <div className="flex items-center gap-1.5 mb-0.5">
                                                                <span className="text-[7px] font-black text-red-500/70 border border-red-100 px-1 rounded-[2px] uppercase tracking-tighter">Ação</span>
                                                                <span className="text-[8px] font-black text-slate-300 uppercase tracking-widest">#{item.displayId || item.id?.substring(0, 4)}</span>
                                                            </div>
                                                            <span className="text-xs font-medium text-slate-600 whitespace-normal leading-tight group-hover/item:text-slate-900" title={item.actions}>{item.actions}</span>
                                                        </div>

                                                        <div className="flex-1 relative border-b border-white">
                                                            {pos && (
                                                                <div
                                                                    className={`absolute top-1/2 -translate-y-1/2 h-6 rounded-md shadow-sm flex items-center justify-center px-1 cursor-pointer transition-all z-10 ${getStatusColor(item.status)}`}
                                                                    style={{ left: pos.left, width: Math.max(pos.width, 24) }}
                                                                    onClick={() => setSelectedItem({ ...item, parentObjective: plan.objective, parentSector: plan.sector, parentThemeId: plan.id, parentMacroTheme: plan.macro_theme })}
                                                                >
                                                                    <span className="text-[9px] font-black text-white leading-tight text-center shadow-black/10 drop-shadow-sm">
                                                                        {item.status === 'Não Iniciado' && 'NI'}
                                                                        {item.status === 'Em Andamento' && 'EA'}
                                                                        {item.status === 'Atrasado' && 'AT'}
                                                                        {item.status === 'Concluído' && 'CO'}
                                                                        {item.status === 'Suspenso' && 'SU'}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </React.Fragment>
                                    ))}
                                </React.Fragment>
                            ))}
                        </div>
                    </div>
                </div>
            </main>

            {/* Footer Stripes */}
            <footer className="fixed bottom-0 left-0 right-0 h-1.5 flex z-50">
                <div className="h-full bg-emerald-500 transition-all duration-500 w-1/4"></div>
                <div className="h-full bg-blue-500 transition-all duration-500 w-[15%]"></div>
                <div className="h-full bg-orange-500 transition-all duration-500 w-1/5"></div>
                <div className="h-full bg-pink-500 transition-all duration-500 w-1/5"></div>
                <div className="h-full bg-slate-300 transition-all duration-500 flex-grow"></div>
            </footer>

            {/* Detail Modal */}
            {selectedItem && (
                // Modal Code remains similar but with updated styling if needed
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => setSelectedItem(null)}>
                    <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full overflow-hidden animate-in fade-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
                        {/* Header */}
                        <div className="bg-[#f8fafc] border-b border-slate-100 px-6 py-4 flex justify-between items-center">
                            <div>
                                <h3 className="text-slate-800 font-bold text-lg">Detalhes da Ação</h3>
                                <div className="flex items-center gap-2 mt-1">
                                    <span className={`text-[10px] text-white px-2 py-0.5 rounded shadow-sm font-bold uppercase tracking-wider ${getSectorColor(selectedItem.parentSector).split(' ')[0]}`}>{selectedItem.parentSector}</span>
                                    {selectedItem.parentMacroTheme && (
                                        <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded font-black uppercase tracking-widest">{selectedItem.parentMacroTheme}</span>
                                    )}
                                    <span className="text-xs text-slate-400 font-medium truncate max-w-[200px]" title={selectedItem.parentObjective}>{selectedItem.parentObjective}</span>
                                </div>
                            </div>
                            <button onClick={() => setSelectedItem(null)} className="text-slate-400 hover:text-slate-600 bg-white p-1 rounded-full shadow-sm border border-slate-100"><XButton className="w-5 h-5" /></button>
                        </div>

                        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
                            {/* Content same as before but lighter styles */}
                            <div className="grid grid-cols-1 gap-4">
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Ação</label>
                                    <p className="text-sm font-bold text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100 mt-1">{selectedItem.actions}</p>
                                </div>
                            </div>
                            {/* ... Other details ... */}
                            <div className="grid grid-cols-3 gap-4">
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Início</label>
                                    <div className="flex items-center mt-1 text-sm font-medium text-slate-700 bg-white border border-gray-100 p-2 rounded-md shadow-sm">
                                        <Calendar className="w-4 h-4 mr-2 text-blue-500" />
                                        {selectedItem.scheduleStart?.split('-').reverse().join('/')}
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Fim</label>
                                    <div className="flex items-center mt-1 text-sm font-medium text-slate-700 bg-white border border-gray-100 p-2 rounded-md shadow-sm">
                                        <Calendar className="w-4 h-4 mr-2 text-orange-500" />
                                        {selectedItem.scheduleEnd?.split('-').reverse().join('/')}
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Status</label>
                                    <div className="mt-1">
                                        <div className={`inline-flex px-3 py-1.5 rounded-md text-xs font-bold text-white w-full justify-center shadow-sm ${getStatusColor(selectedItem.status)}`}>
                                            {selectedItem.status}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Secondary Info: Responsible & Projects */}
                            <div className="grid grid-cols-2 gap-6 border-t border-slate-50 pt-4">
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Responsável</label>
                                    <div className="mt-1 flex items-center text-sm font-medium text-slate-700">
                                        <User className="w-4 h-4 mr-2 text-blue-500" />
                                        {(() => {
                                            // Filter to show only admin users
                                            const responsibleList = Array.isArray(selectedItem.responsible) ? selectedItem.responsible : (selectedItem.responsible ? [selectedItem.responsible] : []);
                                            const adminUsers = allUsers
                                                .filter(u => u.role === 'admin' || u.role === 'super_user')
                                                .map(u => u.name);
                                            const filteredResponsible = responsibleList.filter((r: string) => adminUsers.includes(r));
                                            return filteredResponsible.length > 0 ? filteredResponsible.join(', ') : 'N/A';
                                        })()}
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Projeto</label>
                                    <div className="mt-1 flex items-center text-sm font-medium text-slate-700">
                                        <Calculator className="w-4 h-4 mr-2 text-purple-500" />
                                        {selectedItem.projects || 'N/A'}
                                    </div>
                                </div>
                            </div>

                            {/* Metrics & KPIs */}
                            <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                                <h4 className="text-[11px] font-black uppercase text-slate-400 tracking-wider mb-3 flex items-center gap-2">
                                    <span className="material-icons-round text-sm">trending_up</span> Métricas & KPIs
                                </h4>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                                    <div className="bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
                                        <label className="text-[9px] font-bold text-slate-400 uppercase">Orçamento (R$)</label>
                                        <div className="mt-1">
                                            <div className="flex justify-between text-[10px] text-slate-400"><span>Plan</span> <span>{selectedItem.budgetPlanned?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></div>
                                            <div className="flex justify-between text-xs font-bold text-slate-700"><span>Real</span> <span>{selectedItem.budgetActual?.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></div>
                                        </div>
                                    </div>
                                    <div className="bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
                                        <label className="text-[9px] font-bold text-slate-400 uppercase">Horas (H)</label>
                                        <div className="mt-1">
                                            <div className="flex justify-between text-[10px] text-slate-400"><span>Est</span> <span>{selectedItem.hoursPlanned}h</span></div>
                                            <div className="flex justify-between text-xs font-bold text-slate-700"><span>Real</span> <span>{selectedItem.hoursActual}h</span></div>
                                        </div>
                                    </div>
                                    <div className="bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
                                        <label className="text-[9px] font-bold text-slate-400 uppercase">ROI (%)</label>
                                        <div className="mt-2 text-lg font-black text-emerald-600 flex items-center">
                                            {selectedItem.roiPercentage}%
                                            <span className="text-[9px] ml-1 font-normal text-emerald-400">retorno</span>
                                        </div>
                                    </div>
                                    <div className="bg-white p-3 rounded-lg border border-slate-100 shadow-sm">
                                        <label className="text-[9px] font-bold text-slate-400 uppercase">Risco</label>
                                        <div className={`mt-2 inline-flex px-2 py-1 rounded text-[10px] font-bold uppercase w-full justify-center ${selectedItem.riskLevel === 'Alto' ? 'bg-red-100 text-red-600' :
                                            selectedItem.riskLevel === 'Médio' ? 'bg-amber-100 text-amber-600' :
                                                'bg-emerald-100 text-emerald-600'
                                            }`}>
                                            {selectedItem.riskLevel || 'N/A'}
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Results & Observations */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Resultado Esperado</label>
                                    <p className="text-sm text-slate-600 mt-1 border-l-2 border-green-500 pl-3 leading-relaxed">
                                        {selectedItem.expectedResult || 'Não definido.'}
                                    </p>
                                </div>
                                <div>
                                    <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Observações</label>
                                    <p className="text-sm text-slate-500 italic mt-1 bg-yellow-50/50 p-2 rounded">
                                        {selectedItem.observation || 'Nenhuma observação registrada.'}
                                    </p>
                                </div>
                            </div>
                        </div>
                        <div className="bg-gray-50 px-6 py-4 flex justify-between items-center">
                            {(user?.role === 'admin' || user?.role === 'super_user') ? (
                                <button
                                    onClick={() => window.location.hash = `/implementation-schedule?themeId=${selectedItem.parentThemeId}&subId=${selectedItem.id}`}
                                    className="flex items-center px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-sm font-bold transition-colors"
                                >
                                    <Edit3 className="w-4 h-4 mr-2" /> Editar
                                </button>
                            ) : <div></div>}
                            <button onClick={() => setSelectedItem(null)} className="px-6 py-2 bg-slate-900 hover:bg-slate-800 rounded-lg text-sm font-bold text-white transition-colors">Fechar</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );

};

// Mini component for Close button avoiding Icon conflict if X is not imported or needed
const XButton = ({ className }: { className?: string }) => (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
);

export default ImplementationTimeline;
