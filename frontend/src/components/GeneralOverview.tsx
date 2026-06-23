import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../app_api';
import { Ticket, TicketStatus, Notification, ActionPlanItem, User } from '../types';
import { hasAccess } from '../utils/permissionUtils';
import { Bell, FileText, Activity, Clock, AlertCircle, CheckCircle2, Target, User as UserIcon, Calendar as CalendarIcon, Filter, Info, Server, Cpu, Database, Layout, X, Building2 } from 'lucide-react';

interface GeneralOverviewProps {
    user: User;
}

const GeneralOverview: React.FC<GeneralOverviewProps> = ({ user }) => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [tickets, setTickets] = useState<Ticket[]>([]);
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const [actionPlanItems, setActionPlanItems] = useState<ActionPlanItem[]>([]);

    const canViewMatrix = hasAccess(user, 'action_plans');
    const canViewAllSectors = user.role === 'super_user' || user.role === 'ceo' || user.permissions?.['action_plans']?.view_all_sectors;
    const canViewInterSector = hasAccess(user, 'inter_sector_tickets');

    const [interSectorTickets, setInterSectorTickets] = useState<any[]>([]);
    const [selectedSector, setSelectedSector] = useState<string>('all');
    const [selectedResponsibleSector, setSelectedResponsibleSector] = useState<string>('all');
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');
    const [availableSectors, setAvailableSectors] = useState<string[]>([]);

    useEffect(() => {
        loadData();
    }, []);

    const loadData = async () => {
        try {
            setLoading(true);
            const [ticketsData, notifData, sectorsData, interSectorData] = await Promise.all([
                api.getTickets(user.id),
                api.getNotifications(user.id),
                canViewAllSectors ? api.getSectors() : Promise.resolve([]),
                canViewInterSector ? api.getInterSectorTickets() : Promise.resolve([])
            ]);
            setInterSectorTickets(interSectorData);

            if (user.role === 'super_user' || user.role === 'ceo') {
                setAvailableSectors(sectorsData.map((s: any) => s.name));
                setSelectedSector('all');
            } else {
                const managed = user.managed_sectors ? user.managed_sectors.split(/;\s*/).map(s => s.trim()).filter(Boolean) : [];
                const userSectors = Array.from(new Set([user.sector, ...managed].filter(Boolean)));
                setAvailableSectors(userSectors);
                setSelectedSector(userSectors[0] || 'all');
            }

            setTickets(ticketsData.map((t: any) => ({
                ...t,
                requesterId: t.requester_id,
                requesterName: t.requester_name,
                requesterSector: t.requester_sector,
                createdAt: t.created_at,
                updatedAt: t.updated_at
            })));

            setNotifications(notifData);
            // ... (matrix loading logic)

            if (canViewMatrix) {
                try {
                    const planData = await api.getActionPlans(undefined, user.id);
                    let filteredPlan = planData;
                    if (!canViewAllSectors) {
                        const managed = user.managed_sectors ? user.managed_sectors.split(/;\s*/).filter(Boolean) : [];
                        const allowedSectors = Array.from(new Set([user.sector, ...managed].filter(Boolean))).map(s => s.trim().toUpperCase());
                        filteredPlan = planData.filter((item: ActionPlanItem) => {
                            const itemSector = item.sector ? item.sector.trim().toUpperCase() : '';
                            return allowedSectors.includes(itemSector);
                        });
                    }
                    setActionPlanItems(filteredPlan);
                } catch (e) {
                    console.error("Failed to load matrix", e);
                }
            }

        } catch (e) {
            console.error("Failed to load overview data", e);
        } finally {
            setLoading(false);
        }
    };

    // Computed Filtered Tickets
    const filteredTickets = tickets.filter(t => {
        // Sector Filter
        if (selectedSector !== 'all') {
            const normTicketSector = ((t as any).requesterSector || '').trim().toUpperCase().replace(/\./g, '');
            const normFilterSector = (selectedSector || '').trim().toUpperCase().replace(/\./g, '');
            const ticketCategory = t.category?.trim().toUpperCase();

            if (normFilterSector === 'TI') {
                const tCat = ticketCategory || ''; const isTICategory = tCat.includes('STARSOFT') || tCat.includes('INFRAESTRUTURA') || tCat.includes('STARSF');
                if (normTicketSector !== 'TI' && !isTICategory) return false;
            } else {
                if ((t as any).requesterSector?.trim().toUpperCase() !== selectedSector.trim().toUpperCase()) return false;
            }
        }

        // Responsible Sector Filter
        if (selectedResponsibleSector !== 'all') {
            const cat = (t.category || '').toUpperCase();
            const isTI = cat.includes('STARSOFT') || cat.includes('INFRAESTRUTURA') || cat.includes('STARSF');
            if (selectedResponsibleSector === 'T.I' && !isTI) return false;
            if (selectedResponsibleSector === 'Gestão de Informação' && isTI) return false;
        }

        // Date Filter
        if (startDate) {
            const start = new Date(startDate);
            start.setHours(0, 0, 0, 0); // Start of day
            if (new Date(t.createdAt) < start) return false;
        }
        if (endDate) {
            const end = new Date(endDate);
            end.setHours(23, 59, 59, 999); // End of day
            if (new Date(t.createdAt) > end) return false;
        }

        return true;
    });

    const getStatusCount = (status: TicketStatus) => filteredTickets.filter(t => t.status === status).length;

    const statusConfigs = [
        { status: TicketStatus.OPEN, label: 'Abertos', icon: FileText, color: 'from-blue-500 to-blue-600', iconColor: 'text-white' },
        { status: TicketStatus.IN_PROGRESS, label: 'Em Atendimento', icon: Activity, color: 'from-orange-500 to-orange-600', iconColor: 'text-white' },
        { status: TicketStatus.PENDING, label: 'Aguardando Usuário', icon: Clock, color: 'from-purple-500 to-purple-600', iconColor: 'text-white' },
        { status: TicketStatus.IN_VALIDATION, label: 'Em Validação', icon: CheckCircle2, color: 'from-indigo-500 to-indigo-600', iconColor: 'text-white' },
        { status: TicketStatus.WAITING_SUPPORT, label: 'Aguardando Suporte', icon: AlertCircle, color: 'from-rose-500 to-rose-600', iconColor: 'text-white' },
        { status: TicketStatus.CLOSED, label: 'Concluídos', icon: CheckCircle2, color: 'from-emerald-500 to-emerald-600', iconColor: 'text-white' },
        { status: TicketStatus.CANCELLED, label: 'Cancelados', icon: X, color: 'from-gray-500 to-gray-600', iconColor: 'text-white' },
    ];

    // Data for Updates Column
    const recentUpdates = [...filteredTickets]
        .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
        .slice(0, 5);

    const recentInterSectorUpdates = [...interSectorTickets]
        .sort((a, b) => new Date(b.updated_at ?? b.created_at).getTime() - new Date(a.updated_at ?? a.created_at).getTime())
        .slice(0, 5);

    // Flatten and Filter Action Plans
    const matrixItems = actionPlanItems
        .filter(item => {
            if (selectedSector === 'all') return true;
            return item.sector?.trim().toUpperCase() === selectedSector.trim().toUpperCase();
        })
        .flatMap(item =>
            item.subItems.map(sub => ({
                ...sub,
                sector: item.sector,
                theme: item.objective
            }))
        ).slice(0, 4);

    if (loading) return <div className="p-8 text-center text-gray-500">Carregando visão geral...</div>;

    const formatDate = (dateStr: string) => {
        if (!dateStr) return 'Data desconhecida';
        const cleanDate = (dateStr.includes('T') && !dateStr.endsWith('Z') && !dateStr.includes('+'))
            ? dateStr + 'Z'
            : dateStr;
        const date = new Date(cleanDate);
        if (isNaN(date.getTime())) return 'Data inválida';

        const now = new Date();
        const isToday = date.toDateString() === now.toDateString();
        const yesterday = new Date(now);
        yesterday.setDate(yesterday.getDate() - 1);
        const isYesterday = date.toDateString() === yesterday.toDateString();

        const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        if (isToday) return `HOJE, ${time}`;
        if (isYesterday) return `ONTEM, ${time}`;
        return `${date.toLocaleDateString('pt-BR')}, ${time}`;
    };

    const categories = [
        { label: 'Novo dashboard / relatório', icon: Layout, color: 'text-indigo-600', bg: 'bg-indigo-50' },
        { label: 'Criar automação', icon: Cpu, color: 'text-cyan-600', bg: 'bg-cyan-50' },
        { label: 'Sugestão e inclusão de campo', icon: Info, color: 'text-emerald-600', bg: 'bg-emerald-50' },
        { label: 'Ajuste de erro ou problema', icon: AlertCircle, color: 'text-rose-600', bg: 'bg-rose-50' },
        { label: 'StarSoft', icon: Building2, color: 'text-orange-600', bg: 'bg-orange-50' },
        { label: 'Infraestrutura', icon: Server, color: 'text-slate-600', bg: 'bg-slate-50' }
    ];

    const handleStatusClick = (status: TicketStatus) => {
        let url = `/tickets?status=${status}`;
        if (selectedSector !== 'all') url += `&sector=${selectedSector}`;
        if (startDate) url += `&start=${startDate}`;
        if (endDate) url += `&end=${endDate}`;
        navigate(url);
    };

    const handleCategoryClick = (category: string) => {
        let url = `/tickets?category=${category}`;
        if (selectedSector !== 'all') url += `&sector=${selectedSector}`;
        if (startDate) url += `&start=${startDate}`;
        if (endDate) url += `&end=${endDate}`;
        navigate(url);
    };

    const getInterSectorStatusCount = (status: string) => interSectorTickets.filter(t => t.status === status).length;

    const interSectorStatusConfigs = [
        { status: 'Aberto', label: 'Abertos', icon: FileText, color: 'from-blue-500 to-blue-600' },
        { status: 'Em Atendimento', label: 'Em Atendimento', icon: Activity, color: 'from-orange-500 to-orange-600' },
        { status: 'Aguardando Usuário', label: 'Ag. Usuário', icon: Clock, color: 'from-purple-500 to-purple-600' },
        { status: 'Aguardando Suporte', label: 'Ag. Suporte', icon: AlertCircle, color: 'from-rose-500 to-rose-600' },
        { status: 'Em Validação', label: 'Em Validação', icon: CheckCircle2, color: 'from-indigo-500 to-indigo-600' },
        { status: 'Concluído', label: 'Concluídos', icon: CheckCircle2, color: 'from-emerald-500 to-emerald-600' },
        { status: 'Cancelado', label: 'Cancelados', icon: X, color: 'from-gray-500 to-gray-600' },
    ];

    const handleInterSectorStatusClick = (status: string) => {
        sessionStorage.setItem('blackd_is_ticket_filters', JSON.stringify({ query: '', status, priority: '', targetSector: '' }));
        navigate('/inter-sector-tickets');
    };

    const totalFiltered = filteredTickets.length;
    const closedCount = getStatusCount(TicketStatus.CLOSED);
    const progressPercent = totalFiltered > 0 ? Math.round((closedCount / totalFiltered) * 100) : 0;

    return (
        <div className="h-full overflow-y-auto p-4 custom-scrollbar">
            {/* FILTER BAR */}
            <div className="mb-8 bg-white p-4 rounded-2xl shadow-sm border border-gray-100 flex flex-wrap items-end gap-6">
                <div className="flex items-center gap-2 mb-2">
                    <Filter className="w-4 h-4 text-gray-400" />
                    <span className="text-sm font-bold text-gray-500 uppercase tracking-wider">Filtros</span>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Setor</label>
                        <select
                            value={selectedSector}
                            onChange={(e) => setSelectedSector(e.target.value)}
                            disabled={!canViewAllSectors}
                            className="bg-gray-50 border-none rounded-lg px-3 py-2 text-sm font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-100 min-w-[150px] disabled:opacity-60"
                        >
                            {canViewAllSectors && <option value="all">TODOS OS SETORES</option>}
                            {availableSectors.map(s => (
                                <option key={s} value={s}>{s.toUpperCase()}</option>
                            ))}
                        </select>
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Setor Responsável</label>
                        <select
                            value={selectedResponsibleSector}
                            onChange={(e) => setSelectedResponsibleSector(e.target.value)}
                            className="bg-gray-50 border-none rounded-lg px-3 py-2 text-sm font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-100 min-w-[180px]"
                        >
                            <option value="all">TODOS</option>
                            <option value="T.I">T.I</option>
                            <option value="Gestão de Informação">GESTÃO DE INFORMAÇÃO</option>
                        </select>
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Data Início</label>
                        <input
                            type="date"
                            value={startDate}
                            onChange={(e) => setStartDate(e.target.value)}
                            className="bg-gray-50 border-none rounded-lg px-3 py-2 text-sm font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-100"
                        />
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] font-bold text-gray-400 uppercase ml-1">Data Fim</label>
                        <input
                            type="date"
                            value={endDate}
                            onChange={(e) => setEndDate(e.target.value)}
                            className="bg-gray-50 border-none rounded-lg px-3 py-2 text-sm font-bold text-gray-700 outline-none focus:ring-2 focus:ring-blue-100"
                        />
                    </div>

                    {(selectedSector !== 'all' || selectedResponsibleSector !== 'all' || startDate || endDate) && (
                        <button
                            onClick={() => {
                                if (canViewAllSectors) setSelectedSector('all');
                                setSelectedResponsibleSector('all');
                                setStartDate('');
                                setEndDate('');
                            }}
                            className="mt-5 text-[10px] font-bold text-blue-500 hover:text-blue-700 uppercase"
                        >
                            Limpar
                        </button>
                    )}
                </div>
            </div>

            {/* MAIN CONTENT */}
            <div className="space-y-6">

                {/* ── ROW 1: SUPORTE DE T.I ── */}
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">

                    {/* Bloco T.I (8 cols) */}
                    <div className="lg:col-span-8">
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-5 h-full">
                            <div className="flex items-center gap-2 pb-1 border-b border-gray-50">
                                <span className="w-2.5 h-2.5 rounded-full bg-blue-500 flex-shrink-0"></span>
                                <h2 className="text-xs font-black text-gray-500 uppercase tracking-widest">Suporte de T.I</h2>
                            </div>

                            {/* Status cards */}
                            <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
                                {statusConfigs.map((config) => {
                                    const count = getStatusCount(config.status);
                                    return (
                                        <div
                                            key={config.status}
                                            onClick={() => handleStatusClick(config.status)}
                                            className="bg-gray-50 p-3 rounded-xl border border-gray-100 hover:shadow-md transition-all cursor-pointer group flex flex-col items-center justify-center text-center gap-1"
                                        >
                                            <div className={`p-1.5 rounded-lg bg-gradient-to-br ${config.color} text-white mb-1 shadow-sm group-hover:scale-110 transition-transform`}>
                                                <config.icon className="w-3.5 h-3.5" />
                                            </div>
                                            <div className="text-lg font-black text-gray-800 leading-tight">{String(count).padStart(2, '0')}</div>
                                            <div className="text-[9px] font-bold text-gray-500">{totalFiltered > 0 ? Math.round((count / totalFiltered) * 100) : 0}%</div>
                                            <div className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter line-clamp-1">{config.label}</div>
                                        </div>
                                    );
                                })}
                            </div>

                            {/* Andamento + Categorias */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                                {/* PROGRESS */}
                                <div className="flex flex-col">
                                    <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center mb-2">
                                        <Activity className="w-3.5 h-3.5 mr-1.5 text-emerald-500" /> Andamento
                                    </h3>
                                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 relative overflow-hidden flex flex-col justify-between h-full">
                                        <div className="flex justify-between items-end mb-3">
                                            <p className="text-2xl font-black text-gray-800">{progressPercent}% <span className="text-[10px] font-bold text-emerald-500 uppercase ml-1">Concluído</span></p>
                                            <div className="text-right">
                                                <span className="text-[8px] font-bold text-gray-400 uppercase block">Total</span>
                                                <span className="text-base font-black text-blue-600">{String(totalFiltered).padStart(2, '0')}</span>
                                            </div>
                                        </div>
                                        <div className="h-2 w-full bg-gray-200 rounded-full overflow-hidden mb-3">
                                            <div className="h-full bg-gradient-to-r from-emerald-400 to-emerald-600 rounded-full transition-all duration-1000 ease-out" style={{ width: `${progressPercent}%` }}></div>
                                        </div>
                                        <div className="grid grid-cols-3 gap-1">
                                            <div className="bg-white p-1.5 rounded-lg text-center border border-gray-100">
                                                <div className="text-sm font-black text-gray-700">{getStatusCount(TicketStatus.CLOSED)}</div>
                                                <div className="text-[7px] font-bold text-gray-400 uppercase">FIM</div>
                                            </div>
                                            <div className="bg-white p-1.5 rounded-lg text-center border border-gray-100">
                                                <div className="text-sm font-black text-gray-700">{totalFiltered - getStatusCount(TicketStatus.CLOSED) - getStatusCount(TicketStatus.CANCELLED)}</div>
                                                <div className="text-[7px] font-bold text-gray-400 uppercase">ABERTO</div>
                                            </div>
                                            <div className="bg-white p-1.5 rounded-lg text-center border border-gray-100">
                                                <div className="text-sm font-black text-gray-700">{getStatusCount(TicketStatus.CANCELLED)}</div>
                                                <div className="text-[7px] font-bold text-gray-400 uppercase">CANC</div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* CATEGORIES */}
                                <div className="flex flex-col">
                                    <h3 className="text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center mb-2">
                                        <Target className="w-3.5 h-3.5 mr-1.5 text-indigo-500" /> Categorias
                                    </h3>
                                    <div className="grid grid-cols-2 gap-2 h-full">
                                        {categories.map(cat => {
                                            const count = filteredTickets.filter(t => t.category && t.category.toUpperCase() === cat.label.toUpperCase()).length;
                                            return (
                                                <div
                                                    key={cat.label}
                                                    onClick={() => handleCategoryClick(cat.label)}
                                                    className={`${cat.bg} p-2.5 rounded-xl border border-transparent hover:border-gray-200 cursor-pointer transition-all flex items-center gap-3 group shadow-sm h-14`}
                                                >
                                                    <div className="p-1.5 rounded-lg bg-white shadow-sm">
                                                        <cat.icon className={`w-3.5 h-3.5 ${cat.color}`} />
                                                    </div>
                                                    <div className="flex flex-col justify-center min-w-0">
                                                        <div className="text-sm font-black text-gray-800 leading-none mb-0.5">{count}</div>
                                                        <div className="text-[8px] font-bold text-gray-500 uppercase leading-none truncate">{cat.label}</div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </div>

                    </div>{/* end lg:col-span-8 */}

                    {/* Timeline T.I (4 cols) */}
                    <div className="lg:col-span-4">
                        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 h-full flex flex-col">
                            <div className="flex items-center gap-2 pb-3 border-b border-gray-50 mb-4">
                                <Clock className="w-3.5 h-3.5 text-blue-400" />
                                <h2 className="text-xs font-black text-gray-500 uppercase tracking-widest">Timeline — Suporte T.I</h2>
                            </div>
                            <div className="flex-1 overflow-y-auto custom-scrollbar">
                                <div className="relative pl-3">
                                    <div className="absolute left-3.5 top-0 bottom-0 w-px bg-gray-100"></div>
                                    <div className="space-y-5">
                                        {recentUpdates.length === 0 ? (
                                            <p className="text-gray-400 text-xs italic text-center py-8">Nenhuma atualização.</p>
                                        ) : recentUpdates.map((t, idx) => {
                                            const colors = ['bg-blue-500', 'bg-emerald-500', 'bg-orange-500', 'bg-purple-500'];
                                            const color = colors[idx % colors.length];
                                            return (
                                                <div key={t.id} className="relative pl-6 group cursor-pointer" onClick={() => navigate(`/tickets/${t.id}`)}>
                                                    <div className={`absolute left-0 top-1.5 w-1.5 h-1.5 rounded-full ${color} z-10 ring-4 ring-white`}></div>
                                                    <div className="text-[8px] font-black text-blue-500 uppercase tracking-widest mb-0.5 opacity-80">{formatDate(t.updatedAt || t.createdAt)}</div>
                                                    <h4 className="text-xs font-bold text-gray-800 leading-tight mb-1 group-hover:text-blue-600 transition-colors line-clamp-2">{t.title}</h4>
                                                    <div className="flex flex-wrap items-center gap-1.5">
                                                        <span className="font-mono bg-gray-50 px-1 py-0.5 rounded border border-gray-100 text-[7px] uppercase">#{t.id.substring(0, 6)}</span>
                                                        <span className="bg-gray-50 px-1 py-0.5 rounded text-[7px] font-bold uppercase">{t.category}</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>{/* end lg:col-span-4 */}

                </div>{/* end ROW 1 */}

                {/* ── ROW 2: CHAMADOS ENTRE SETORES ── */}
                {canViewInterSector && (
                    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">

                        {/* Bloco Inter-setor (8 cols) */}
                        <div className="lg:col-span-8">
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 space-y-4 h-full">
                                <div className="flex items-center gap-2 pb-1 border-b border-gray-50">
                                    <span className="w-2.5 h-2.5 rounded-full bg-red-500 flex-shrink-0"></span>
                                    <h2 className="text-xs font-black text-gray-500 uppercase tracking-widest">Chamados Entre Setores</h2>
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
                                    {interSectorStatusConfigs.map((config) => {
                                        const count = getInterSectorStatusCount(config.status);
                                        return (
                                            <div
                                                key={config.status}
                                                onClick={() => handleInterSectorStatusClick(config.status)}
                                                className="bg-gray-50 p-3 rounded-xl border border-gray-100 hover:shadow-md transition-all cursor-pointer group flex flex-col items-center justify-center text-center gap-1"
                                            >
                                                <div className={`p-1.5 rounded-lg bg-gradient-to-br ${config.color} text-white mb-1 shadow-sm group-hover:scale-110 transition-transform`}>
                                                    <config.icon className="w-3.5 h-3.5" />
                                                </div>
                                                <div className="text-lg font-black text-gray-800 leading-tight">{String(count).padStart(2, '0')}</div>
                                                <div className="text-[8px] font-bold text-gray-400 uppercase tracking-tighter line-clamp-1">{config.label}</div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>{/* end lg:col-span-8 */}

                        {/* Timeline Inter-setor (4 cols) */}
                        <div className="lg:col-span-4">
                            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5 h-full flex flex-col">
                                <div className="flex items-center gap-2 pb-3 border-b border-gray-50 mb-4">
                                    <Clock className="w-3.5 h-3.5 text-red-400" />
                                    <h2 className="text-xs font-black text-gray-500 uppercase tracking-widest">Timeline — Entre Setores</h2>
                                </div>
                                <div className="flex-1 overflow-y-auto custom-scrollbar">
                                    <div className="relative pl-3">
                                        <div className="absolute left-3.5 top-0 bottom-0 w-px bg-gray-100"></div>
                                        <div className="space-y-5">
                                            {recentInterSectorUpdates.length === 0 ? (
                                                <p className="text-gray-400 text-xs italic text-center py-8">Nenhuma atualização.</p>
                                            ) : recentInterSectorUpdates.map((t, idx) => {
                                                const colors = ['bg-red-500', 'bg-orange-500', 'bg-pink-500', 'bg-rose-500'];
                                                const color = colors[idx % colors.length];
                                                return (
                                                    <div key={t.id} className="relative pl-6 group cursor-pointer" onClick={() => navigate(`/inter-sector-tickets/${t.id}`)}>
                                                        <div className={`absolute left-0 top-1.5 w-1.5 h-1.5 rounded-full ${color} z-10 ring-4 ring-white`}></div>
                                                        <div className="text-[8px] font-black text-red-500 uppercase tracking-widest mb-0.5 opacity-80">{formatDate(t.updated_at || t.created_at)}</div>
                                                        <h4 className="text-xs font-bold text-gray-800 leading-tight mb-1 group-hover:text-red-600 transition-colors line-clamp-2">{t.title}</h4>
                                                        <div className="flex flex-wrap items-center gap-1.5">
                                                            <span className="font-mono bg-gray-50 px-1 py-0.5 rounded border border-gray-100 text-[7px] uppercase">#{t.id.toString().substring(0, 6)}</span>
                                                            <span className="bg-gray-50 px-1 py-0.5 rounded text-[7px] font-bold uppercase">{t.target_sector || t.category}</span>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>{/* end lg:col-span-4 */}

                    </div>
                )}{/* end ROW 2 */}

                {/* ── ROW 3: MATRIZ ESTRATÉGICA ── */}
                {canViewMatrix && (
                    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
                        <h2 className="text-sm font-black text-gray-500 uppercase tracking-widest flex items-center mb-4">
                            <Activity className="w-4 h-4 mr-2 text-rose-500" /> Matriz Estratégica
                        </h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {matrixItems.length === 0 ? (
                                <div className="md:col-span-2 text-center text-gray-400 text-xs py-10 bg-gray-50 rounded-2xl border border-dashed border-gray-200">
                                    Nenhum item estratégico.
                                </div>
                            ) : (
                                matrixItems.map((item, idx) => {
                                    const statusColors: any = {
                                        'No Prazo': 'bg-blue-50 text-blue-600 border-blue-100',
                                        'Atrasado': 'bg-red-50 text-red-600 border-red-100',
                                        'Concluído': 'bg-emerald-50 text-emerald-600 border-emerald-100',
                                        'Suspenso': 'bg-gray-50 text-gray-600 border-gray-100'
                                    };
                                    const progress = item.status === 'Não Iniciado' ? 0 : item.status === 'Concluído' ? 100 : Math.floor(Math.random() * 80) + 10;
                                    const barColor = item.status === 'Atrasado' ? 'bg-red-500' : 'bg-blue-600';

                                    return (
                                        <div key={idx}
                                            onClick={() => navigate(`/strategic-kanban?openCard=${item.id}`)}
                                            className="bg-gray-50 p-4 rounded-xl border border-gray-100 hover:shadow-md transition-all cursor-pointer flex flex-col"
                                        >
                                            <div className="flex justify-between items-start mb-2">
                                                <div className="flex flex-col min-w-0">
                                                    <span className="text-[8px] font-black text-gray-400 uppercase tracking-widest truncate">{item.sector}</span>
                                                    <span className="text-[8px] font-bold text-blue-500 uppercase truncate">{item.theme}</span>
                                                </div>
                                                <span className={`text-[7px] font-black px-1.5 py-0.5 rounded border uppercase flex-shrink-0 ${statusColors[item.status] || 'bg-gray-50 text-gray-500 border-gray-100'}`}>
                                                    {item.status}
                                                </span>
                                            </div>
                                            <h4 className="font-bold text-gray-800 mb-3 text-xs line-clamp-1">{item.actions}</h4>
                                            <div className="mt-auto">
                                                <div className="h-1 w-full bg-gray-200 rounded-full overflow-hidden mb-2">
                                                    <div className={`h-full rounded-full ${barColor}`} style={{ width: `${progress}%` }}></div>
                                                </div>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-[8px] font-bold text-gray-400 uppercase">{progress}% PREVISTO</span>
                                                    <div className="flex items-center text-[8px] text-gray-400 font-bold">
                                                        <CalendarIcon className="w-2.5 h-2.5 mr-1" />
                                                        {item.scheduleEnd}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>
                    </div>
                )}{/* end ROW 3 */}

            </div>
        </div>
    );
};

export default GeneralOverview;
