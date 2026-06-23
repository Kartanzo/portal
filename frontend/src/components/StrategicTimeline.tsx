
import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { api } from '../app_api';
import { ChevronDown, ChevronRight, Calculator, User, AlertCircle, Calendar, ArrowLeft, ArrowRight, Search, Filter, Minus, Plus, Edit3 } from 'lucide-react';
import { useSectors } from '../hooks/useSectors';
import { User as UserType } from '../types';
import { exportActionPlanToExcel, exportActionPlanToPDF } from './exportUtils';
import { FileText, Download, X } from 'lucide-react';

// --- Helper Functions ---
const normalizeString = (s: string) =>
    s ? s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim().replace(/\s+/g, ' ') : '';

interface StrategicTimelineProps {
    user?: UserType;
}

const StrategicTimeline: React.FC<StrategicTimelineProps> = ({ user }) => {
    const SECTORS = useSectors();
    const location = useLocation();
    const navigate = useNavigate();
    const [plans, setPlans] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [expandedPlans, setExpandedPlans] = useState<string[]>([]);
    const [expandedThemes, setExpandedThemes] = useState<string[]>(['FIN', 'CLI', 'PIP', 'PAC']);
    const [searchTerm, setSearchTerm] = useState('');

    // All Users for filtering
    const [allUsers, setAllUsers] = useState<{ id: string, name: string, sector?: string, role?: string, permissions?: any, managed_sectors?: string }[]>([]);
    const [strategicData, setStrategicData] = useState<{
        allowed_sectors: string[];
        allowed_users: { id: string, name: string, sector: string, role: string }[];
    } | null>(null);

    // Fetch strategic data from dedicated endpoint
    useEffect(() => {
        api.getStrategicSectors()
            .then(data => setStrategicData(data))
            .catch(e => console.error('Failed to fetch strategic sectors', e));
    }, []);

    const checkUserModuleAccess = (u: any, moduleId: string) => {
        if (u.role === 'super_user' || u.role === 'ceo') return true;
        // Módulos estratégicos (strategic_*): role_permissions define can_view=false para admin e user.
        // Apenas super_user e ceo devem aparecer nos filtros desses módulos.
        if (moduleId.startsWith('strategic')) return false;
        // Para outros módulos: verificar permissões individuais do usuário
        const perms = u.permissions?.[moduleId];
        if (perms && perms.can_view === false) return false;
        if (u.role === 'admin') return true;
        return !!perms?.can_view;
    };

    const accessibleUsers = React.useMemo(() => {
        // Super_user e ceo: usar usuários diretamente do banco via /strategic-sectors
        if ((user?.role === 'super_user' || user?.role === 'ceo') && strategicData?.allowed_users) {
            return strategicData.allowed_users;
        }
        return allUsers.filter(u => checkUserModuleAccess(u, 'strategic_timeline'));
    }, [allUsers, strategicData, user?.role]);

    // Filters
    const [selectedSector, setSelectedSector] = useState('Todos');
    const [selectedStatus, setSelectedStatus] = useState('Todos');
    const [selectedMacroTheme, setSelectedMacroTheme] = useState('Todos');
    const [activeCreatedBy, setActiveCreatedBy] = useState('');
    const [legendOpen, setLegendOpen] = useState(false);

    // View Mode
    type ViewMode = 'month' | 'week' | 'day';
    const [viewMode, setViewMode] = useState<ViewMode>('month');

    // For 'day' view, we need a current month reference
    const [currentDateRef, setCurrentDateRef] = useState(new Date());

    // Selected Item for Modal
    const [selectedItem, setSelectedItem] = useState<any | null>(null);

    // Permissions
    const perm_timeline = user?.permissions?.['strategic_timeline'];
    const hasSpecificSectors_timeline = perm_timeline?.allowed_sectors && perm_timeline.allowed_sectors.length > 0;
    const canViewAllSectors = !hasSpecificSectors_timeline && (user?.role === 'super_user' || user?.role === 'ceo' || perm_timeline?.view_all_sectors);

    const allowedSectors = React.useMemo(() => {
        if (!user) return [];

        // Super_user e ceo: usar setores diretamente do banco via /strategic-sectors
        if (user.role === 'super_user' || user.role === 'ceo') {
            if (strategicData?.allowed_sectors && strategicData.allowed_sectors.length > 0) {
                return ['Todos', ...[...strategicData.allowed_sectors].sort()];
            }
            // Fallback enquanto carrega
            return ['Todos', ...[...SECTORS].sort()];
        }

        if (hasSpecificSectors_timeline) {
            const sectorMode = perm_timeline?.sector_mode || 'include';
            let roleSectors: string[];
            if (sectorMode === 'include') {
                roleSectors = [...perm_timeline!.allowed_sectors!];
            } else {
                roleSectors = SECTORS.filter(s => !perm_timeline!.allowed_sectors!.includes(s));
            }
            // Mesclar com os setores gerenciados individualmente pelo usuário
            const managed = user.managed_sectors ? user.managed_sectors.split(/[;,]\s*/).filter(Boolean).map((s: string) => s.trim()) : [];
            const userPersonalSectors = user.sector ? [user.sector, ...managed] : managed;
            return ['Todos', ...Array.from(new Set([...roleSectors, ...userPersonalSectors])).sort()];
        }
        if (canViewAllSectors) {
            return ['Todos', ...SECTORS.sort()];
        }
        const managed = user.managed_sectors ? user.managed_sectors.split(/;\s*/).filter(Boolean) : [];
        const base = Array.from(new Set([user.sector, ...managed].filter(Boolean))).map(s => s.trim()).sort();
        return ['Todos', ...base];
    }, [user, canViewAllSectors, hasSpecificSectors_timeline, SECTORS, strategicData]);

    const allowedSectorsStr = allowedSectors.join(',');

    useEffect(() => {
        loadData();
    }, [user?.id, canViewAllSectors, allowedSectorsStr]);

    const loadData = async () => {
        try {
            const [data, usersData] = await Promise.all([
                api.getActionPlans(undefined, user?.id),
                api.getAllUsersSimple()
            ]);

            setAllUsers(usersData);

            // STRICTOR FILTER: Filter results by allowedSectors list
            const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
            const allowedNorm = new Set(allowedSectors.map(norm));
            let finalData = data;

            if (!canViewAllSectors || allowedSectors.length <= SECTORS.length) {
                finalData = data.filter((plan: any) => {
                    const planSector = (plan.sector || '').trim();
                    return allowedNorm.has(norm('Todos')) || planSector.split(/[;,]\s*/).some((s: string) => allowedNorm.has(norm(s)));
                });
            }

            // Sort Alphabetically by Objective
            finalData.sort((a: any, b: any) => (a.objective || '').localeCompare(b.objective || ''));

            setPlans(finalData);

            // Handle navigation objective expansion state parameter 
            const state = location.state as any;
            if (state && state.expandObjective) {
                const searchStr = normalizeString(state.expandObjective);

                // Find all matching plan ids where the strict objective name matches exactly
                const matches = finalData.filter((p: any) => normalizeString(p.objective) === searchStr);
                if (matches.length > 0) {
                    setExpandedPlans(prev => {
                        const newExpanded = [...prev];
                        matches.forEach((m: any) => {
                            if (!newExpanded.includes(m.id)) newExpanded.push(m.id);
                        });
                        return newExpanded;
                    });
                }
                setSearchTerm(state.expandObjective);

                // Keep loading until the navigation state is cleared and transition completes
                setTimeout(() => {
                    navigate(location.pathname, { replace: true, state: {} });
                    setLoading(false);
                }, 400);
            } else {
                setLoading(false);
            }

        } catch (e) {
            console.error(e);
            setLoading(false);
        }
    };

    const togglePlan = (id: string) => {
        setExpandedPlans(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
    };

    const toggleTheme = (theme: string) => {
        setExpandedThemes(prev => prev.includes(theme) ? prev.filter(t => t !== theme) : [...prev, theme]);
    };

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
        const durationMs = visibleEnd.getTime() - visibleStart.getTime(); // + 1 day?

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

    // Filter Logic
    const filteredPlans = plans.map(p => {
        // Strict match check for Parent Name:
        const objectiveString = normalizeString(p.objective);
        const searchStr = normalizeString(searchTerm);
        const isExactObjectiveSearch = plans.some(pl => normalizeString(pl.objective) === searchStr);

        // If the user's search term is EXACTLY some objective's name, ONLY show that exact objective
        if (isExactObjectiveSearch && objectiveString !== searchStr) {
            return null; // hide completely
        }

        // Filter sub items
        const filteredSub = (p.subItems || []).filter((item: any) => {
            const statusMatch = selectedStatus === 'Todos' || item.status === selectedStatus;

            // Search match: Check item action and parent objective text
            const itemSearchMatch = !searchTerm ||
                normalizeString(item.actions).includes(searchStr) ||
                objectiveString.includes(searchStr);

            // Created By match
            const createdByMatch = !activeCreatedBy || item.createdByName === activeCreatedBy;

            return statusMatch && itemSearchMatch && createdByMatch;
        });

        // Filter parent based on Sector
        const sectorMatch = selectedSector === 'Todos' || p.sector === selectedSector;

        // Filter parent based on Macro Theme
        const macroMatch = selectedMacroTheme === 'Todos' || p.macro_theme === selectedMacroTheme;

        if (!sectorMatch || !macroMatch) return null; // Hide parent completely

        // Always hide parent if strict conditionals drop subItems to Zero UNLESS we specifically matched the parent's generic label 
        const matchesObjectiveName = objectiveString.includes(searchStr);
        if (filteredSub.length === 0 && (selectedStatus !== 'Todos' || activeCreatedBy || (searchTerm && !matchesObjectiveName))) {
            return null;
        }

        return { ...p, subItems: filteredSub };
    }).filter(Boolean);


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
            {/* Loading Overlay */}
            {loading && (
                <div className="fixed inset-0 z-[200] bg-white/80 backdrop-blur-md flex flex-col items-center justify-center animate-in fade-in duration-300">
                    <div className="flex flex-col items-center gap-6">
                        <div className="relative">
                            <div className="w-16 h-16 border-4 border-slate-100 border-t-blue-500 rounded-full animate-spin"></div>
                            <Calendar className="w-6 h-6 text-blue-500 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
                        </div>
                        <div className="flex flex-col items-center gap-1">
                            <h2 className="text-xl font-bold text-slate-800">Carregando Planejamento</h2>
                            <p className="text-sm text-slate-500 font-medium">Sincronizando cronograma estratégico...</p>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-slate-200">
                <div className="px-6 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-8">
                        <div className="flex flex-col">
                            <button
                                onClick={() => navigate('/strategic-map')}
                                className="group mb-5 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-[11px] font-black uppercase text-slate-500 shadow-sm transition-all hover:border-red-200 hover:bg-red-50 hover:text-red-600 active:scale-95"
                            >
                                <ArrowLeft className="w-4 h-4 transition-transform group-hover:-translate-x-1" /> Voltar para o Mapa
                            </button>
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center text-white shadow-lg shadow-blue-500/20">
                                    <Calendar className="w-5 h-5" />
                                </div>
                                <h1 className="text-xl font-bold tracking-tight text-slate-800">Cronograma <span className="text-blue-500">Visual</span></h1>
                            </div>
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
                                onClick={() => exportActionPlanToExcel(filteredPlans, 'Cronograma_Estrategico.xlsx')}
                                className="p-2 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-lg transition-all"
                                title="Exportar Excel"
                            >
                                <Download className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => exportActionPlanToPDF(filteredPlans, 'Cronograma Estratégico')}
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
                        value={activeCreatedBy}
                        onChange={e => setActiveCreatedBy(e.target.value)}
                    >
                        <option value="">Todos os Criadores</option>
                        {accessibleUsers.map(u => (
                            <option key={u.id} value={u.name}>{u.name}</option>
                        ))}
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

                    {/* Macro Theme Filter */}
                    <div className="flex items-center gap-2 bg-white p-1 rounded-lg border border-slate-200">
                        {['Todos', 'PAC', 'PIP', 'CLI', 'FIN'].map(mt => (
                            <button
                                key={mt}
                                onClick={() => setSelectedMacroTheme(mt)}
                                className={`px-3 py-1.5 rounded-md text-[10px] font-black uppercase tracking-widest transition-all ${selectedMacroTheme === mt
                                    ? (mt === 'PAC' ? 'bg-[#ea0061] text-white shadow-sm' :
                                        mt === 'PIP' ? 'bg-[#1da0cc] text-white shadow-sm' :
                                            mt === 'CLI' ? 'bg-[#ef5a24] text-white shadow-sm' :
                                                mt === 'FIN' ? 'bg-[#83229b] text-white shadow-sm' :
                                                    'bg-slate-800 text-white shadow-sm')
                                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'
                                    }`}
                            >
                                {mt}
                            </button>
                        ))}
                        <button
                            onClick={() => { setSelectedMacroTheme('Todos'); setSelectedSector('Todos'); setSelectedStatus('Todos'); setActiveCreatedBy(''); setSearchTerm(''); }}
                            className="px-3 py-1.5 rounded-md text-[10px] font-black uppercase text-white bg-slate-900 hover:bg-slate-800 transition-all ml-auto flex items-center gap-1 shadow-md"
                            title="Limpar Filtros"
                        >
                            🔄 LIMPAR TUDO
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

                            {(() => {
                                const themes = ['PAC', 'PIP', 'CLI', 'FIN'];
                                const themeColors: Record<string, string> = {
                                    'FIN': '#83229b',
                                    'CLI': '#ef5a24',
                                    'PIP': '#1da0cc',
                                    'PAC': '#ea0061'
                                };

                                return themes.map(theme => {
                                    const themePlans = filteredPlans.filter(p => p.macro_theme === theme);
                                    if (themePlans.length === 0) return null;
                                    const isExpanded = expandedThemes.includes(theme);

                                    return (
                                        <div key={theme} className="flex flex-col">
                                            {/* Macro Theme Header - Clickable & Non-Sticky to fix "fixed" bug */}
                                            <div
                                                onClick={() => toggleTheme(theme)}
                                                className="flex h-10 items-center px-4 cursor-pointer hover:brightness-95 transition-all shadow-sm z-20 group/theme"
                                                style={{ backgroundColor: themeColors[theme] || '#334155' }}
                                            >
                                                {isExpanded ? <ChevronDown className="w-4 h-4 text-white/80 mr-2" /> : <ChevronRight className="w-4 h-4 text-white/80 mr-2" />}
                                                <span className="text-[10px] font-black tracking-widest text-white uppercase">{theme}</span>
                                                <div className="ml-4 flex-1 h-px bg-white/20"></div>
                                                <span className="ml-4 text-[9px] font-bold text-white/70 italic">{themePlans.length} objetivo{themePlans.length > 1 ? 's' : ''}</span>
                                            </div>

                                            {isExpanded && themePlans.map(plan => (
                                                <div key={plan.id} className="group hover:bg-slate-50 transition-colors border-b border-slate-100">
                                                    {/* Parent Row */}
                                                    <div className="flex h-14 relative">
                                                        {/* Sidebar Cell */}
                                                        <div className="w-[280px] shrink-0 p-4 border-r border-slate-200 flex items-center gap-2 cursor-pointer z-10 bg-inherit" onClick={() => togglePlan(plan.id)}>
                                                            {expandedPlans.includes(plan.id) ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                                                            <div className="flex flex-col overflow-hidden">
                                                                <div className="flex items-center gap-1">
                                                                    <span className="text-sm font-semibold text-slate-700 whitespace-normal leading-tight" title={plan.objective}>{plan.objective}</span>
                                                                </div>
                                                            </div>
                                                        </div>

                                                        {/* Timeline Cells */}
                                                        <div className="flex-1 relative">
                                                            {/* Parent Bar */}
                                                            {(() => {
                                                                const subTokens = plan.subItems || [];
                                                                let parentStartStr = '';
                                                                let parentEndStr = '';

                                                                if (subTokens.length > 0) {
                                                                    const starts = subTokens.map((s: any) => s.scheduleStart).filter(Boolean).sort();
                                                                    const ends = subTokens.map((s: any) => s.scheduleEnd).filter(Boolean).sort();
                                                                    if (starts.length) parentStartStr = starts[0];
                                                                    if (ends.length) parentEndStr = ends[ends.length - 1];
                                                                }
                                                                const parentPos = (parentStartStr && parentEndStr) ? getBarPosition(parentStartStr, parentEndStr) : null;

                                                                if (parentPos) {
                                                                    // Mapping Sector to Gradient
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
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                togglePlan(plan.id);
                                                                                setSelectedItem({
                                                                                    id: plan.id,
                                                                                    actions: `(Ações de: ${plan.objective})`,
                                                                                    parentObjective: plan.objective,
                                                                                    parentSector: plan.sector,
                                                                                    parentThemeId: plan.id,
                                                                                    status: '---',
                                                                                    scheduleStart: parentStartStr,
                                                                                    scheduleEnd: parentEndStr,
                                                                                    budgetPlanned: subTokens.reduce((sum: number, s: any) => sum + (Number(s.budgetPlanned) || 0), 0),
                                                                                    budgetActual: subTokens.reduce((sum: number, s: any) => sum + (Number(s.budgetActual) || 0), 0),
                                                                                    hoursPlanned: subTokens.reduce((sum: number, s: any) => sum + (Number(s.hoursPlanned) || 0), 0),
                                                                                    hoursActual: subTokens.reduce((sum: number, s: any) => sum + (Number(s.hoursActual) || 0), 0),
                                                                                    roiPercentage: 0,
                                                                                    riskLevel: 'Misto',
                                                                                    expectedResult: 'Verifique as subações para o resultado consolidado.',
                                                                                    observation: 'Este é um agrupador (Objetivo Estratégico).',
                                                                                    projects: plan.macro_theme,
                                                                                    responsible: []
                                                                                });
                                                                            }}
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

                                                    {/* Sub Items (Children) */}
                                                    {expandedPlans.includes(plan.id) && (plan.subItems || []).map((item: any) => {
                                                        const pos = getBarPosition(item.scheduleStart, item.scheduleEnd);
                                                        return (
                                                            <div key={item.id} className="flex h-14 relative bg-slate-50/30">
                                                                <div
                                                                    className="w-[280px] shrink-0 p-4 pl-10 border-r border-slate-200 flex items-center z-10 bg-inherit border-b border-white cursor-pointer hover:bg-slate-100 transition-colors"
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        setSelectedItem({ ...item, parentObjective: plan.objective, parentSector: plan.sector, parentThemeId: plan.id });
                                                                    }}
                                                                >
                                                                    <span className="text-xs font-medium text-slate-500 whitespace-normal leading-tight hover:text-slate-700 line-clamp-2" title={item.actions}>
                                                                        {item.actions.length > 60 ? `${item.actions.substring(0, 60)}...` : item.actions}
                                                                    </span>
                                                                </div>

                                                                <div className="flex-1 relative border-b border-white">
                                                                    {pos && (
                                                                        <div
                                                                            className={`absolute top-1/2 -translate-y-1/2 h-6 rounded-md shadow-sm flex items-center justify-center px-1 cursor-pointer transition-all z-10 ${getStatusColor(item.status)}`}
                                                                            style={{ left: pos.left, width: Math.max(pos.width, 24) }}
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                setSelectedItem({ ...item, parentObjective: plan.objective, parentSector: plan.sector, parentThemeId: plan.id });
                                                                            }}
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
                                                        )
                                                    })}
                                                </div>
                                            ))}
                                        </div>
                                    );
                                });
                            })()}
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
                                    <span className="text-xs text-slate-500 truncate max-w-[300px]" title={selectedItem.parentObjective}>{selectedItem.parentObjective}</span>
                                </div>
                            </div>
                            <button onClick={() => setSelectedItem(null)} className="text-slate-400 hover:text-slate-600 bg-white p-1 rounded-full shadow-sm border border-slate-100"><X className="w-5 h-5" /></button>
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
                                    onClick={() => window.location.hash = `/action-plan?themeId=${selectedItem.parentThemeId}&subId=${selectedItem.id}`}
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

export default StrategicTimeline;
