
import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../app_api';
import { User, ActionPlanItem, ActionPlanSubItem } from '../types';
import {
    Plus, Layers, Calendar, User as UserIcon, AlertCircle, CheckCircle2, Clock, Ban,
    X, Edit3, Calculator, PlayCircle, MessageSquare, Lock, Save, Target, FileText, Folder,
    ChevronDown, ChevronRight
} from 'lucide-react';
import { useSectors } from '../hooks/useSectors';
import { MultiSelectDropdown } from './MultiSelectDropdown';
import { useToast } from '../contexts/ToastContext';


interface StrategicKanbanProps {
    user: User;
}

const ImplementationKanban: React.FC<StrategicKanbanProps> = ({ user }) => {
    const { showToast } = useToast();
    const SECTORS = useSectors();
    const [items, setItems] = useState<ActionPlanItem[]>([]);
    const [loading, setLoading] = useState(true);

    const [selectedItem, setSelectedItem] = useState<any | null>(null);
    const [searchParams, setSearchParams] = useSearchParams();

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

    // Filter Options
    const sectorOptions = useMemo(() => {
        return ['Todos', ...(strategicData?.allowed_sectors ?? [])];
    }, [strategicData]);

    const statusOptions = ['Todos', 'Não Iniciado', 'Em Andamento', 'Atrasado', 'Suspenso', 'Concluído'];

    // Custom Filter States
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedSectorFilter, setSelectedSectorFilter] = useState<string>('');
    const [selectedStatusFilter, setSelectedStatusFilter] = useState<string>('');
    const [selectedPriorityFilter, setSelectedPriorityFilter] = useState<string>(''); // Placeholder if needed in future

    // Edit Mode States
    const [isEditing, setIsEditing] = useState(false);
    const [formData, setFormData] = useState<any>({});
    const [sectorUsers, setSectorUsers] = useState<{ id: string, name: string, sector?: string, role?: string, permissions?: any }[]>([]);
    const [allUsers, setAllUsers] = useState<{ id: string, name: string, sector?: string, role?: string, permissions?: any }[]>([]);

    // Fetch implementation sectors on mount
    useEffect(() => {
        api.getImplementationSectors(user?.id)
            .then(data => setStrategicData(data))
            .catch(e => console.error('Failed to fetch implementation sectors', e));
    }, []);

    // Fetch users for edit dropdowns
    useEffect(() => {
        const fetchUsers = async () => {
            try {
                const [usersSimple, usersSector] = await Promise.all([
                    api.getAllUsersSimple(),
                    user.sector ? api.getUsersBySector(user.sector) : Promise.resolve([])
                ]);
                setAllUsers(usersSimple);
                setSectorUsers(usersSector);
            } catch (e) {
                console.error("Failed to fetch users", e);
            }
        };
        fetchUsers();
    }, [user.sector]);

    // Set initial sector filter based on permissions
    useEffect(() => {
        // If user is restricted, default to "Todos" (which will only show THEIR sectors due to filter)
        // OR default to their primary sector if preferred. 
        // User request: "Admin users ... can see all action plans relevant to the sectors they manage"
        // So "Todos" should be the default, showing all manage-able sectors.
        // We only force a specific selection if we want to narrow it down.
        // But for UI consistency, 'Todos' is fine as initial state if the list is restricted.

        // However, the original code forced user.sector.
        // logic: if I have [Logistica, Compras], I want to see both by default. So 'Todos' is correct.
        if (!isAdmin && !selectedSectorFilter) {
            // Do nothing? 'Todos' (empty string or 'Todos') accounts for all allowed.
            // setSelection is not strictly needed unless we want to lock it.
        }
    }, [user.sector, isAdmin]);

    useEffect(() => {
        loadPlans();
    }, [strategicData, user]);

    // Calculate business hours (Mon-Fri, 8h/day)
    const calculateBusinessHours = (start: string, end: string) => {
        if (!start || !end) return 0;
        const startDate = new Date(start);
        const endDate = new Date(end);
        if (startDate > endDate) return 0;

        let count = 0;
        let curDate = new Date(startDate.getTime());
        while (curDate <= endDate) {
            const dayOfWeek = curDate.getUTCDay(); // 0 is Sunday, 6 is Saturday
            if (dayOfWeek !== 0 && dayOfWeek !== 6) {
                count++;
            }
            curDate.setDate(curDate.getDate() + 1);
        }
        return count * 8;
    };

    // Update hours when dates change
    useEffect(() => {
        const hours = calculateBusinessHours(formData.scheduleStart, formData.scheduleEnd);
        setFormData((prev: any) => ({ ...prev, hoursPlanned: hours }));
    }, [formData.scheduleStart, formData.scheduleEnd]);

    const loadPlans = async () => {
        try {
            setLoading(true);
            // Fetch all plans via undefined (or logic dependent on backend)
            // Then filter securely on client
            const data = await api.getImplementationSchedules(undefined, user.id);

            let finalData = data;
            if (!isAdmin) {
                const allowed = (strategicData?.allowed_sectors ?? []).map((s: string) => s.trim().toLowerCase());

                finalData = data.filter((plan: ActionPlanItem) => {
                    const planSectorRaw = plan.sector || '';
                    const planSectors = planSectorRaw.split(/[;,]\s*/).map(s => s.trim().toLowerCase()).filter(Boolean);
                    if (planSectors.length === 0) return false;

                    const strictMatch = planSectors.some(ps => allowed.includes(ps));
                    return strictMatch;
                });
            }

            setItems(finalData);

        } catch (error) {
            console.error("Failed to load action plans", error);
        } finally {
            setLoading(false);
        }
    };

    // Helper: Global Filter for Valid Users (Strict Sector Match)
    // This ensures consistent view across Cards, Details, and Edit Modal
    const filterValidUsers = (list: string | string[], sector: string) => {
        if (!list) return [];
        const currentList = Array.isArray(list) ? list : [list];
        if (currentList.length === 0) return [];

        const targetSector = sector ? sector.toLowerCase() : '';
        if (!targetSector) return currentList; // No sector defined, can't filter

        // 1. Resolve "Todos"
        if (currentList.some(r => r.toLowerCase() === 'todos')) {
            return allUsers
                .filter(u => u.sector && u.sector.toLowerCase() === targetSector)
                .map(u => u.name);
        }

        return currentList.filter(name => {
            // HARD FILTER: Remove Carlos Eduardo as requested forcibly
            if (name.toLowerCase().includes('carlos eduardo')) return false;

            const user = allUsers.find(u => u.name.toLowerCase() === name.toLowerCase());
            if (user) {
                // Strict Admin Filter
                // Permission-based Filter
                if (user.role === 'admin' || user.role === 'super_user') return true;
                if (user.permissions && user.permissions.action_plans && user.permissions.action_plans.can_view) return true;
                return false;
            }
            return false; // Remove unknown names or non-admins
        });
    };

    // Flatten items for Kanban
    const kanbanItems = useMemo(() => items.flatMap((theme, themeIdx) =>
        theme.subItems.map((sub, subIdx) => ({
            ...sub,
            themeId: theme.id,
            themeObjective: theme.objective,
            macro_theme: theme.macro_theme,
            sector: theme.sector, // Pass sector from parent theme
            responsible: filterValidUsers(sub.responsible, theme.sector), // APPLY FILTER HERE
            waitingForReturn: filterValidUsers((sub as any).waitingForReturn, theme.sector), // APPLY FILTER HERE
            displayId: `${themeIdx + 1}.${subIdx + 1}`
        }))
    ).filter(item => {
        // 1. Text Search (ID, Actions, Projects, Theme)
        const matchesSearch = !searchQuery ||
            item.actions.toLowerCase().includes(searchQuery.toLowerCase()) ||
            item.projects.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (item.themeObjective && item.themeObjective.toLowerCase().includes(searchQuery.toLowerCase())) ||
            item.displayId.includes(searchQuery);

        // 2. Sector Filter (Parent Theme Sector)
        // We now have item.sector directly
        const matchesSector = !selectedSectorFilter || selectedSectorFilter === 'Todos' ||
            (item.sector && item.sector.toLowerCase().includes(selectedSectorFilter.toLowerCase()));

        // 3. Status Filter
        const matchesStatus = !selectedStatusFilter || selectedStatusFilter === 'Todos' || item.status === selectedStatusFilter;

        return matchesSearch && matchesSector && matchesStatus;
    }), [items, searchQuery, selectedSectorFilter, selectedStatusFilter, allUsers]);

    // Check for openCard param
    const processedCardRef = React.useRef<string | null>(null);

    useEffect(() => {
        const openCardId = searchParams.get('openCard');
        if (openCardId && kanbanItems.length > 0) {
            // Unconditionally set if it matches the requested ID and we haven't just processed it
            // Actually, if we just let it be, the ref prevents loop?

            // If we already processed this specific ID instance, ignore to prevent loop
            // BUT if the user navigates away and back, ref is null, so we process again. Good.
            if (processedCardRef.current === openCardId) {
                return;
            }

            const found = kanbanItems.find(i => String(i.id) === openCardId);
            if (found) {
                setSelectedItem(found);
                processedCardRef.current = openCardId;
                // do NOT clean URL here. It causes race connection/loops.
            }
        }
    }, [kanbanItems, searchParams]);

    // Helper to close and clean URL
    const handleCloseModal = () => {
        setSelectedItem(null);
        setSearchParams(params => {
            const newParams = new URLSearchParams(params);
            newParams.delete('openCard');
            return newParams;
        }, { replace: true });

        // Reset ref so if they click the same link again (external?) it works? 
        // Although URL is cleaned, so it won't trigger unless they push param again.
        processedCardRef.current = null;
    };

    const columns = [
        { id: 'Não Iniciado', title: 'Não Iniciado', icon: Layers, color: 'bg-slate-500', bg: 'bg-slate-50', border: 'border-slate-200' },
        { id: 'Em Andamento', title: 'Em Andamento', icon: Clock, color: 'bg-blue-500', bg: 'bg-blue-50', border: 'border-blue-200' },
        { id: 'Atrasado', title: 'Atrasado', icon: AlertCircle, color: 'bg-red-500', bg: 'bg-red-50', border: 'border-red-200' },
        { id: 'Suspenso', title: 'Suspenso', icon: Ban, color: 'bg-orange-500', bg: 'bg-orange-50', border: 'border-orange-200' },
        { id: 'Concluído', title: 'Concluído', icon: CheckCircle2, color: 'bg-green-500', bg: 'bg-green-50', border: 'border-green-200' },
    ];

    // Drag and Drop Logic
    const onDragStart = (e: React.DragEvent, itemId: string) => {
        if (canEditStatus) {
            e.dataTransfer.setData('itemId', itemId);
        }
    };

    const onDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const onDrop = async (e: React.DragEvent, targetStatus: string) => {
        e.preventDefault();
        const itemId = e.dataTransfer.getData('itemId');

        if (!itemId || !canEditStatus) return;

        // Optimistic update
        const originalItems = [...items];

        // Find owner theme and subItem
        let foundSub: ActionPlanSubItem | null = null;
        let foundThemeId: string | null = null;

        const newItems = items.map(theme => {
            const sub = theme.subItems.find(s => String(s.id) === String(itemId));
            if (sub) {
                foundSub = sub;
                foundThemeId = theme.id;
                return {
                    ...theme,
                    subItems: theme.subItems.map(s => s.id === sub.id ? { ...s, status: targetStatus as any } : s)
                };
            }
            return theme;
        });

        if (foundSub) {
            setItems(newItems);
            try {
                await api.updateImplementationScheduleItem(itemId, {
                    // BEWARE: The API requires all fields or supports partials? 
                    // The API definition shows `updateActionPlanItem(id, item: Partial<ActionPlanSubItem>)`.
                    // We use spread to keep existing values and overwrite status.
                    ...foundSub,
                    status: targetStatus as any // Cast to any or Specific Union Type if strict
                });
            } catch (err) {
                console.error("Failed to update status", err);
                setItems(originalItems); // Revert on failure
            }
        }
    };

    const canEditStatus = isSuperUser || isAdmin;

    if (loading) return <div className="p-8 text-center text-gray-500">Carregando Kanban...</div>;

    return (
        <div className="space-y-6 h-full flex flex-col">
            {/* Header */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 shrink-0">
                <div className="flex items-center space-x-4">
                    <div className="p-3 bg-slate-900 rounded-2xl text-white shadow-xl">
                        <Layers className="w-6 h-6" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-black text-slate-900 uppercase tracking-tighter">Kanban de Projetos</h1>
                        <p className="text-gray-500 text-sm font-medium italic">Visualização da Gestão de Projetos por status</p>
                    </div>
                </div>
            </div>

            {/* Filters */}
            {/* Custom Filter Bar */}
            <div className="bg-white p-4 rounded-2xl shadow-sm border border-slate-100 space-y-4">
                <div className="flex items-center gap-2 mb-2">
                    <div className="p-1.5 bg-slate-100 rounded-lg">
                        <UserIcon className="w-4 h-4 text-slate-500" />
                    </div>
                    <span className="text-xs font-black uppercase text-slate-500 tracking-wider">Filtros Avançados</span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    {/* Search Input */}
                    <div className="relative">
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Buscar por ID, Ação ou Objetivo..."
                            className="w-full pl-4 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-slate-900 transition-all font-medium"
                        />
                    </div>

                    {/* Sector Filter */}
                    <div className="relative">
                        <select
                            value={selectedSectorFilter}
                            onChange={(e) => setSelectedSectorFilter(e.target.value)}
                            // disabled={!isAdmin} // No longer disable, as they might want to switch between their allowed sectors
                            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold uppercase text-slate-600 outline-none focus:ring-2 focus:ring-slate-900 appearance-none cursor-pointer"
                        >
                            {sectorOptions.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>

                    {/* Status Filter */}
                    <div className="relative">
                        <select
                            value={selectedStatusFilter}
                            onChange={(e) => setSelectedStatusFilter(e.target.value)}
                            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold uppercase text-slate-600 outline-none focus:ring-2 focus:ring-slate-900 appearance-none cursor-pointer"
                        >
                            <option value="" disabled>Status do Ciclo</option>
                            {statusOptions.map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </div>

                    {/* Priority/Responsible Placeholder - Could be User Filter later */}
                    <div className="relative opacity-50 pointer-events-none">
                        <select
                            className="w-full px-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-sm font-bold uppercase text-slate-400 outline-none appearance-none"
                            disabled
                        >
                            <option>Prioridade (N/A)</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* Kanban Board */}
            <div className="flex-1 overflow-hidden pb-4">
                <div className="flex gap-4 h-full w-full">
                    {columns.map(col => {
                        const colItems = kanbanItems.filter(i => (i.status || 'No Prazo') === col.id);

                        return (
                            <div
                                key={col.id}
                                onDragOver={onDragOver}
                                onDrop={(e) => onDrop(e, col.id)}
                                className="flex-1 bg-gray-50 dark:bg-slate-700 rounded-xl p-2 flex flex-col space-y-2 border border-gray-200 dark:border-slate-600 h-full min-w-0"
                            >
                                {/* Column Header */}
                                <div className="flex items-center justify-between px-1 py-0.5">
                                    <h3 className="text-[9px] font-black text-gray-500 uppercase flex items-center truncate">
                                        <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${col.color}`}></span>
                                        {col.title}
                                    </h3>
                                    <span className="text-[9px] bg-white border border-gray-200 text-gray-600 px-1.5 py-0 rounded-full font-bold">{colItems.length}</span>
                                </div>

                                {/* Cards Container */}
                                <div className="space-y-2 overflow-y-auto flex-1 pr-1 custom-scrollbar">
                                    {colItems.map((item: any) => (
                                        <div
                                            key={item.id}
                                            draggable={canEditStatus}
                                            onDragStart={(e) => onDragStart(e, String(item.id))}
                                            onClick={() => setSelectedItem(item)}
                                            className={`bg-white p-2.5 rounded shadow-sm border border-gray-100 hover:border-red-400 transition-all hover:shadow-md relative group ${canEditStatus ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'}`}
                                        >
                                            <div className="flex justify-between items-start mb-1">
                                                <span className="text-[8px] font-black text-red-600 uppercase tracking-wider">
                                                    ID: {item.displayId}
                                                </span>
                                                {item.riskLevel === 'Alto' && (
                                                    <span className="bg-red-100 text-red-600 px-1 py-0 rounded-[2px] text-[7px] font-bold uppercase">Risco</span>
                                                )}
                                            </div>

                                            <h3 className="text-[10px] font-bold text-gray-900 leading-tight mb-2 line-clamp-3" title={item.actions}>
                                                {item.actions}
                                            </h3>

                                            <div className="mb-2">
                                                <p className="text-[8px] text-gray-500 leading-tight line-clamp-2" title={item.projects}>
                                                    <span className="font-bold text-gray-600">Proj:</span> {item.projects}
                                                </p>
                                            </div>

                                            <div className="flex items-center justify-between pt-1.5 border-t border-gray-50 text-[8px] text-gray-400 font-bold uppercase">
                                                <div className="flex items-center gap-1" title="Prazo">
                                                    <Calendar className="w-2 h-2 mr-1" />
                                                    <span>{item.scheduleEnd ? item.scheduleEnd.split('-').reverse().join('/') : '-'}</span>
                                                </div>

                                                <div className="flex -space-x-1">
                                                    {Array.isArray(item.responsible) ?
                                                        item.responsible.slice(0, 2).map((r: string, i: number) => (
                                                            <div key={i} className="w-4 h-4 rounded-full bg-slate-200 border border-white flex items-center justify-center text-[7px] font-bold text-slate-500" title={r}>
                                                                {r.substring(0, 2).toUpperCase()}
                                                            </div>
                                                        )) : (
                                                            <div className="w-4 h-4 rounded-full bg-slate-200 border border-white flex items-center justify-center text-[7px] font-bold text-slate-500" title={item.responsible as string}>
                                                                {(item.responsible as string || 'Un').substring(0, 2).toUpperCase()}
                                                            </div>
                                                        )
                                                    }
                                                </div>
                                            </div>

                                            {/* Audit Trail */}
                                            {(item.createdByName || item.updatedByName) && (
                                                <div className="mt-2 pt-2 border-t border-gray-100">
                                                    <div className="text-[7px] text-gray-400 space-y-0.5">
                                                        {item.createdByName && item.createdAt && (
                                                            <div className="truncate">
                                                                <span className="font-semibold">Criado:</span> {item.createdByName} - {new Date(item.createdAt).toLocaleDateString('pt-BR')}
                                                            </div>
                                                        )}
                                                        {item.updatedByName && item.updatedAt && (
                                                            <div className="truncate">
                                                                <span className="font-semibold">Alterado:</span> {item.updatedByName} - {new Date(item.updatedAt).toLocaleDateString('pt-BR')}
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}

                                    {colItems.length === 0 && (
                                        <div className="flex flex-col items-center justify-center py-8 opacity-30">
                                            <div className="w-8 h-8 bg-slate-200 rounded-full mb-1"></div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            {/* Detail Modal */}
            {
                selectedItem && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" onClick={handleCloseModal}>
                        {!isEditing ? (
                            <div className="bg-white rounded-2xl shadow-2xl max-w-7xl w-full overflow-hidden animate-in fade-in zoom-in duration-200" onClick={e => e.stopPropagation()}>
                                {/* Header */}
                                <div className="bg-[#f8fafc] border-b border-slate-100 px-6 py-4 flex justify-between items-center">
                                    <div>
                                        <h3 className="text-slate-800 font-bold text-lg">Detalhes da Ação</h3>
                                        <div className="flex items-center gap-4 mt-1">
                                            {selectedItem.macro_theme && (
                                                <span className="text-[10px] font-black bg-red-50 text-red-600 px-2 py-0.5 rounded-md uppercase tracking-widest flex items-center gap-1">
                                                    <Folder className="w-3 h-3" /> {selectedItem.macro_theme}
                                                </span>
                                            )}
                                            <span className="text-xs text-slate-500 truncate max-w-[300px]" title={selectedItem.themeObjective}>{selectedItem.themeObjective}</span>
                                        </div>
                                    </div>
                                    <button onClick={handleCloseModal} className="text-slate-400 hover:text-slate-600 bg-white p-1 rounded-full shadow-sm border border-slate-100"><X className="w-5 h-5" /></button>
                                </div>

                                <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto custom-scrollbar">
                                    <div className="grid grid-cols-1 gap-4">
                                        <div>
                                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Ação</label>
                                            <p className="text-sm font-bold text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-100 mt-1">{selectedItem.actions}</p>
                                        </div>
                                    </div>

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
                                                <div className={`inline-flex px-3 py-1.5 rounded-md text-xs font-bold text-white w-full justify-center shadow-sm ${selectedItem.status === 'Não Iniciado' ? 'bg-slate-400' :
                                                    selectedItem.status === 'Em Andamento' ? 'bg-blue-600' :
                                                        selectedItem.status === 'Atrasado' ? 'bg-red-500' :
                                                            selectedItem.status === 'Concluído' ? 'bg-green-500' :
                                                                selectedItem.status === 'Suspenso' ? 'bg-orange-500' : 'bg-slate-400'
                                                    }`}>
                                                    {selectedItem.status}
                                                </div>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="grid grid-cols-2 gap-6 border-t border-slate-50 pt-4">
                                        <div>
                                            <label className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Responsável</label>
                                            <div className="mt-1 flex items-center text-sm font-medium text-slate-700">
                                                <UserIcon className="w-4 h-4 mr-2 text-blue-500" />
                                                {(() => {
                                                    // Filter to show only admin users
                                                    const responsibleList = Array.isArray(selectedItem.responsible) ? selectedItem.responsible : (selectedItem.responsible ? [selectedItem.responsible] : []);
                                                    const adminUsers = allUsers
                                                        .filter((u: any) => u.role === 'admin' || u.role === 'super_user')
                                                        .map((u: any) => u.name);
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

                                    <div className="bg-slate-50 rounded-xl p-4 border border-slate-100">
                                        <h4 className="text-[11px] font-black uppercase text-slate-400 tracking-wider mb-3 flex items-center gap-2">
                                            Métricas & KPIs
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
                                        </div>
                                    </div>

                                    {selectedItem.status === 'Suspenso' && selectedItem.blockedByUserId && (
                                        <div className="bg-red-50 p-4 rounded-xl border border-red-100">
                                            <h4 className="text-[11px] font-black uppercase text-red-400 tracking-wider mb-2 flex items-center gap-2">
                                                <Ban className="w-4 h-4" /> Bloqueio Identificado
                                            </h4>
                                            <p className="text-sm font-bold text-red-700">Aguardando: {selectedItem.blockedByUserId}</p>
                                            <p className="text-xs text-red-500 mt-1">Este item está suspenso aguardando a ação deste usuário.</p>
                                        </div>
                                    )}

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
                                            onClick={async () => {
                                                try {
                                                    // 1. Identify Target Sector
                                                    const targetSector = selectedItem.sector || '';

                                                    // 2. Fetch Authoritative Users from Backend
                                                    // This ensures we match "Strategic Matrix" behavior and use backend truth
                                                    let usersInSector: { id: string, name: string, role?: string, permissions?: any }[] = [];
                                                    if (targetSector) {
                                                        usersInSector = await api.getUsersBySector(targetSector);
                                                        setSectorUsers(usersInSector); // Update state for Dropdown options
                                                    }

                                                    // 3. Helper to resolve "Todos" and Enforce Sector based on Backend Data
                                                    const resolveAndFilter = (list: string[]) => {
                                                        // If no sector users found (e.g. no sector), keep list as is to avoid clearing
                                                        if (!usersInSector.length) return list;

                                                        const sectorUserNames = usersInSector.map(u => u.name);

                                                        // Expansion
                                                        if (list.some(r => r.toLowerCase() === 'todos')) {
                                                            // Return only ADMINS in sector
                                                            return usersInSector
                                                                .filter(u => u.role === 'admin' || u.role === 'super_user')
                                                                .map(u => u.name);
                                                        }

                                                        // Filter by Permission (View Page) with Super User Override
                                                        const validNames = list.filter(name =>
                                                            usersInSector.some(valid =>
                                                                valid.name.toLowerCase() === name.toLowerCase() &&
                                                                (
                                                                    (user?.role === 'super_user') || // Viewer Override
                                                                    (valid.role === 'admin' || valid.role === 'super_user') ||
                                                                    (valid.permissions?.action_plans?.can_view)
                                                                )
                                                            )
                                                        );

                                                        return validNames;
                                                    };

                                                    const currentResponsible = Array.isArray(selectedItem.responsible) ? selectedItem.responsible : (selectedItem.responsible ? [selectedItem.responsible] : []);
                                                    const currentWaiting = Array.isArray(selectedItem.waitingForReturn) ? selectedItem.waitingForReturn : (selectedItem.waitingForReturn ? [selectedItem.waitingForReturn] : []);

                                                    setFormData({
                                                        ...selectedItem,
                                                        responsible: resolveAndFilter(currentResponsible),
                                                        waitingForReturn: resolveAndFilter(currentWaiting),
                                                        targetSectors: targetSector ? [targetSector] : []
                                                    });
                                                    setIsEditing(true);
                                                } catch (error) {
                                                    console.error("Error preparing edit modal:", error);
                                                    showToast("Erro ao carregar dados do setor.", "error");
                                                }
                                            }}
                                            className="flex items-center px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg text-sm font-bold transition-colors"
                                        >
                                            <Edit3 className="w-4 h-4 mr-2" /> Editar
                                        </button>
                                    ) : <div></div>}
                                    <button onClick={handleCloseModal} className="px-6 py-2 bg-slate-900 hover:bg-slate-800 rounded-lg text-sm font-bold text-white transition-colors">Fechar</button>
                                </div>
                            </div>
                        ) : (
                            <div className="bg-white rounded-2xl shadow-2xl max-w-5xl w-full overflow-hidden flex flex-col animate-in slide-in-from-bottom-4 duration-300" onClick={e => e.stopPropagation()}>
                                <div className="p-6 bg-red-600 text-white flex justify-between items-center shrink-0">
                                    <div>
                                        <h3 className="text-lg font-black uppercase tracking-tighter">
                                            Ajustar Ciclo
                                        </h3>
                                        <p className="text-[9px] opacity-80 mt-1">Gestão de Projetos - Setor: {isAdmin && !selectedItem.sector ? 'Todos' : (selectedItem.sector || user.sector)}</p>
                                    </div>
                                    <button onClick={() => setIsEditing(false)} className="p-2 hover:bg-white/10 rounded-xl transition-colors"><X className="w-6 h-6" /></button>
                                </div>

                                <form className="p-8 space-y-6 overflow-y-auto max-h-[75vh]" onSubmit={async (e) => {
                                    e.preventDefault();
                                    try {
                                        await api.updateImplementationScheduleItem(selectedItem.id, {
                                            ...formData,
                                            updatedBy: user.id
                                        });
                                        setItems(prev => prev.map(t => ({
                                            ...t,
                                            subItems: t.subItems.map(s => s.id === selectedItem.id ? { ...s, ...formData } : s)
                                        })));
                                        setSelectedItem(prev => ({ ...prev, ...formData })); // Update local view
                                        setIsEditing(false);
                                    } catch (err) {
                                        console.error("Failed to save", err);
                                        showToast("Erro ao salvar!", 'error');
                                    }
                                }}>
                                    <div className="space-y-6">
                                        <div className="space-y-4">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-end">
                                                <div className="space-y-1">
                                                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                                        <PlayCircle className="w-3 h-3" /> Fazer (Ação Tática)
                                                    </label>
                                                    <input
                                                        type="text"
                                                        className="w-full h-12 px-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold outline-none focus:ring-2 focus:ring-red-600 transition-all"
                                                        value={formData.actions}
                                                        onChange={(e) => setFormData({ ...formData, actions: e.target.value })}
                                                        placeholder="O que será feito na prática?"
                                                    />
                                                </div>
                                                <div className="space-y-1">
                                                    <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest mb-1">Status do Andamento</label>
                                                    <div className="relative">
                                                        <select
                                                            className="w-full h-12 px-4 bg-white border border-slate-200 rounded-xl text-xs font-bold text-slate-700 outline-none focus:ring-2 focus:ring-red-600 transition-all cursor-pointer"
                                                            value={formData.status}
                                                            onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                                                        >
                                                            {statusOptions.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                                        </select>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                            {(() => {
                                                const targetSectors = formData.targetSectors || [];
                                                const targetUsers = targetSectors.length > 0
                                                    ? (targetSectors.includes('Todos') ? allUsers : allUsers.filter(u => targetSectors.includes(u.sector)))
                                                    : (sectorUsers.length > 0 ? sectorUsers : allUsers);

                                                return (
                                                    <>
                                                        <MultiSelectDropdown
                                                            label="Participantes Envolvidos"
                                                            options={targetUsers
                                                                .filter((u: any) => u.role === 'admin' || u.role === 'super_user')
                                                                .map(u => ({ id: u.id, name: u.name, sector: u.sector }))}
                                                            selected={(formData.responsible || []).filter((r: string) => targetUsers.some(u => u.name === r && ((user?.role === 'super_user') || (u.role === 'admin' || u.role === 'super_user') || (u.permissions?.action_plans?.can_view))))}
                                                            onChange={(selected) => setFormData({ ...formData, responsible: selected })}
                                                            placeholder="Selecione os participantes..."
                                                        />

                                                        <MultiSelectDropdown
                                                            label="Aguardando Retorno"
                                                            options={targetUsers
                                                                .filter((u: any) => u.role === 'admin' || u.role === 'super_user')
                                                                .map(u => ({ id: u.id, name: u.name, sector: u.sector }))}
                                                            selected={(formData.waitingForReturn || []).filter((r: string) => targetUsers.some(u => u.name === r && ((user?.role === 'super_user') || (u.role === 'admin' || u.role === 'super_user') || (u.permissions?.action_plans?.can_view))))}
                                                            onChange={(selected) => setFormData({ ...formData, waitingForReturn: selected })}
                                                            placeholder="Aguardando retorno de..."
                                                        />
                                                    </>
                                                );
                                            })()}
                                        </div>

                                        {formData.status === 'Suspenso' && (
                                            <div className="space-y-2 animate-in fade-in slide-in-from-top-1">
                                                <label className="text-[10px] font-black text-red-600 uppercase tracking-widest flex items-center gap-2">
                                                    <Lock className="w-3 h-3" /> Projeto Suspenso Por?
                                                </label>
                                                <select
                                                    className="w-full px-5 py-4 bg-red-50 border border-red-200 rounded-2xl text-sm font-bold text-red-800 outline-none focus:ring-2 focus:ring-red-600 transition-all"
                                                    value={formData.blockedByUserId}
                                                    onChange={(e) => setFormData({ ...formData, blockedByUserId: e.target.value })}
                                                >
                                                    <option value="">Selecione o responsável...</option>
                                                    {allUsers.map(u => (
                                                        <option key={u.id} value={u.id}>{u.name} ({u.sector})</option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}

                                        {/* Removed extra closing div to keep space-y-6 open */}

                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                            <div className="space-y-1">
                                                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                                    <CheckCircle2 className="w-3 h-3" /> Checar (Indicadores e Metas)
                                                </label>
                                                <textarea
                                                    rows={5}
                                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs italic focus:ring-2 focus:ring-red-600 outline-none transition-all"
                                                    value={formData.expectedResult}
                                                    onChange={(e) => setFormData({ ...formData, expectedResult: e.target.value })}
                                                    placeholder="Como saberemos que deu certo?"
                                                ></textarea>
                                            </div>
                                            <div className="space-y-1">
                                                <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                                    <FileText className="w-3 h-3" /> Detalhamento do Projeto
                                                </label>
                                                <textarea
                                                    rows={5}
                                                    className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-xs font-bold focus:ring-2 focus:ring-red-600 outline-none transition-all"
                                                    value={formData.projects}
                                                    onChange={(e) => setFormData({ ...formData, projects: e.target.value })}
                                                    placeholder="Especificações técnicas e passos de implementação..."
                                                ></textarea>
                                            </div>
                                        </div>

                                        <div className="space-y-1">
                                            <label className="text-[9px] font-black text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                                <MessageSquare className="w-3 h-3" /> Agir (Observações e Ajustes)
                                            </label>
                                            <textarea
                                                rows={5}
                                                className="w-full px-4 py-3 bg-red-50/30 border border-red-100 rounded-xl text-xs font-medium italic text-red-900 outline-none focus:ring-2 focus:ring-red-600 transition-all"
                                                placeholder="Adicione observações, pontos de atenção ou ajustes realizados no ciclo..."
                                                value={formData.observation}
                                                onChange={(e) => setFormData({ ...formData, observation: e.target.value })}
                                            ></textarea>
                                        </div>

                                        <div className="grid grid-cols-2 gap-4 p-5 bg-slate-50 rounded-2xl border border-slate-100">
                                            <div>
                                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Data de Início</label>
                                                <input
                                                    type="date"
                                                    className="w-full h-11 px-4 bg-white border border-slate-200 rounded-xl text-sm font-bold uppercase outline-none focus:ring-2 focus:ring-slate-900 transition-all"
                                                    value={formData.scheduleStart ? formData.scheduleStart.split('T')[0] : ''}
                                                    onChange={(e) => setFormData({ ...formData, scheduleStart: e.target.value })}
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Data de Término</label>
                                                <input
                                                    type="date"
                                                    className="w-full h-11 px-4 bg-white border border-slate-200 rounded-xl text-sm font-bold uppercase outline-none focus:ring-2 focus:ring-slate-900 transition-all"
                                                    value={formData.scheduleEnd ? formData.scheduleEnd.split('T')[0] : ''}
                                                    onChange={(e) => setFormData({ ...formData, scheduleEnd: e.target.value })}
                                                />
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 p-5 bg-slate-50 rounded-2xl border border-slate-100">
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1 min-h-[16px]">Orçamento Previsto (R$)</label>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    className="w-full h-11 px-4 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-slate-900 transition-all"
                                                    value={formData.budgetPlanned}
                                                    onChange={(e) => setFormData({ ...formData, budgetPlanned: Number(e.target.value) })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1 min-h-[16px]">Orçamento Realizado (R$)</label>
                                                <input
                                                    type="number"
                                                    step="0.01"
                                                    className="w-full h-11 px-4 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-slate-900 transition-all"
                                                    value={formData.budgetActual}
                                                    onChange={(e) => setFormData({ ...formData, budgetActual: Number(e.target.value) })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1 min-h-[16px]">
                                                    Horas Previstas <span className="bg-slate-200 text-[8px] px-1 rounded text-slate-500 ml-1">AUTO (8H/DIA)</span>
                                                </label>
                                                <div className="relative">
                                                    <input
                                                        type="number"
                                                        disabled
                                                        className="w-full h-11 px-4 bg-slate-100 border border-slate-200 rounded-xl text-sm font-bold text-slate-500 cursor-not-allowed"
                                                        value={formData.hoursPlanned}
                                                    />
                                                    <Calculator className="w-4 h-4 text-slate-400 absolute right-4 top-3.5" />
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1 min-h-[16px]">Horas Realizadas</label>
                                                <input
                                                    type="number"
                                                    className="w-full h-11 px-4 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-slate-900 transition-all"
                                                    value={formData.hoursActual}
                                                    onChange={(e) => setFormData({ ...formData, hoursActual: Number(e.target.value) })}
                                                />
                                            </div>
                                            <div className="col-span-full mt-1">
                                                <p className="text-[9px] text-slate-400 bg-slate-900 p-1 rounded-md inline-block">
                                                    Calculado automaticamente com base nas datas (dias úteis * 8h)
                                                </p>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-5 bg-slate-50 rounded-2xl border border-slate-100">
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">ROI Estimado (%)</label>
                                                <input
                                                    type="number"
                                                    className="w-full h-11 px-4 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-slate-900 transition-all"
                                                    value={formData.roiPercentage}
                                                    onChange={(e) => setFormData({ ...formData, roiPercentage: Number(e.target.value) })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Satisfação Stakeholders (0-10)</label>
                                                <input
                                                    type="number"
                                                    max="10"
                                                    min="0"
                                                    className="w-full h-11 px-4 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-slate-900 transition-all"
                                                    value={formData.stakeholderSatisfaction}
                                                    onChange={(e) => setFormData({ ...formData, stakeholderSatisfaction: Number(e.target.value) })}
                                                />
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block mb-1">Nível de Risco</label>
                                                <select
                                                    className="w-full h-11 px-4 bg-white border border-slate-200 rounded-xl text-sm font-bold outline-none focus:ring-2 focus:ring-slate-900 transition-all cursor-pointer"
                                                    value={formData.riskLevel}
                                                    onChange={(e) => setFormData({ ...formData, riskLevel: e.target.value })}
                                                >
                                                    <option value="Baixo">Baixo</option>
                                                    <option value="Médio">Médio</option>
                                                    <option value="Alto">Alto</option>
                                                </select>
                                            </div>
                                        </div>

                                        {/* Action Buttons */}
                                        <div className="flex justify-between items-center pt-4 border-t border-slate-100">
                                            <button
                                                type="button"
                                                onClick={() => setIsEditing(false)}
                                                className="px-6 py-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-black uppercase tracking-widest transition-all"
                                            >
                                                Cancelar
                                            </button>
                                            <button
                                                type="submit"
                                                className="px-8 py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-black uppercase tracking-widest shadow-lg shadow-red-200 transition-all flex items-center"
                                            >
                                                <Save className="w-4 h-4 mr-2" /> Salvar Alterações
                                            </button>
                                        </div>
                                    </div>
                                </form>
                            </div>
                        )
                        }
                    </div >
                )
            }
        </div >
    );
};

export default ImplementationKanban;
