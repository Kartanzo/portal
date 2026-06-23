import React, { useState } from 'react';
import { Search, SlidersHorizontal, X, ChevronDown, ChevronUp, ChevronsDown, ChevronsUp } from 'lucide-react';
import { TicketStatus, TicketPriority, TicketCategory } from '../types';

export interface FilterState {
    query: string;
    requester: string;
    sector: string;
    responsibleSector: string[];
    status: string[];
    priority: string[];
    category: string[];
    startDate?: string;
    endDate?: string;
}

interface FilterBarProps {
    filters: FilterState;
    onChange: (filters: FilterState) => void;
    requesters: string[];
    sectors: string[];
    showSectorFilter?: boolean;
    children?: React.ReactNode;
    isAllExpanded?: boolean;
    onToggleExpandAll?: () => void;
}

const STATUS_PILLS: { value: string; active: string }[] = [
    { value: TicketStatus.OPEN,            active: 'bg-blue-500 text-white border-blue-500' },
    { value: TicketStatus.IN_PROGRESS,     active: 'bg-orange-500 text-white border-orange-500' },
    { value: TicketStatus.PENDING,         active: 'bg-amber-400 text-white border-amber-400' },
    { value: TicketStatus.IN_VALIDATION,   active: 'bg-purple-500 text-white border-purple-500' },
    { value: TicketStatus.WAITING_SUPPORT, active: 'bg-indigo-500 text-white border-indigo-500' },
    { value: TicketStatus.CLOSED,          active: 'bg-emerald-500 text-white border-emerald-500' },
    { value: TicketStatus.CANCELLED,       active: 'bg-gray-500 text-white border-gray-500' },
];

const PRIORITY_PILLS: { value: string; active: string }[] = [
    { value: TicketPriority.URGENT,      active: 'bg-red-600 text-white border-red-600' },
    { value: TicketPriority.HIGH,        active: 'bg-orange-500 text-white border-orange-500' },
    { value: TicketPriority.MEDIUM,      active: 'bg-sky-500 text-white border-sky-500' },
    { value: TicketPriority.LOW,         active: 'bg-slate-400 text-white border-slate-400' },
    { value: TicketPriority.NOT_DEFINED, active: 'bg-gray-300 text-gray-700 border-gray-300' },
];

const RESPONSIBLE_PILLS: { value: string; active: string }[] = [
    { value: 'T.I',                  active: 'bg-blue-600 text-white border-blue-600' },
    { value: 'Gestão de Informação', active: 'bg-violet-600 text-white border-violet-600' },
];

const CATEGORY_PILLS = Object.values(TicketCategory).map(v => ({
    value: v,
    active: 'bg-gray-700 text-white border-gray-700',
}));

const pill = 'px-2.5 py-1 rounded-md text-[11px] font-semibold border cursor-pointer select-none transition-colors duration-100 whitespace-nowrap';
const pillOff = 'bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-700';
const ROW_LABEL = 'text-[9px] font-bold text-gray-400 uppercase tracking-widest w-20 shrink-0 text-right pt-1';
const selectCls = 'px-3 py-1.5 border border-gray-200 rounded-lg text-xs text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent min-w-[150px]';

const FilterBar: React.FC<FilterBarProps> = ({
    filters, onChange, requesters, sectors,
    showSectorFilter = false, children,
    isAllExpanded, onToggleExpandAll,
}) => {
    const [open, setOpen] = useState(false);

    const toggleArr = (key: 'status' | 'priority' | 'category' | 'responsibleSector', value: string) => {
        const current = filters[key];
        const next = current.includes(value)
            ? current.filter(v => v !== value)
            : [...current, value];
        onChange({ ...filters, [key]: next });
    };

    const clearFilters = () =>
        onChange({
            query: '',
            requester: '',
            sector: showSectorFilter ? '' : filters.sector,
            responsibleSector: [],
            status: [],
            priority: [],
            category: [],
            startDate: '',
            endDate: '',
        });

    const activeCount = [
        Boolean(filters.query),
        Boolean(filters.requester),
        showSectorFilter && Boolean(filters.sector),
        filters.responsibleSector.length > 0,
        filters.status.length > 0,
        filters.priority.length > 0,
        filters.category.length > 0,
        Boolean(filters.startDate),
        Boolean(filters.endDate),
    ].filter(Boolean).length;

    const filterRows: {
        label: string;
        key: 'status' | 'priority' | 'category' | 'responsibleSector';
        pills: { value: string; active: string }[];
    }[] = [
        { label: 'Status',      key: 'status',            pills: STATUS_PILLS },
        { label: 'Prioridade',  key: 'priority',          pills: PRIORITY_PILLS },
        { label: 'Responsável', key: 'responsibleSector', pills: RESPONSIBLE_PILLS },
        { label: 'Categoria',   key: 'category',          pills: CATEGORY_PILLS },
    ];

    return (
        <div className="mb-6">
            {/* ── Toolbar ── */}
            <div className="flex items-center gap-2">
                {/* Filtros */}
                <button
                    onClick={() => setOpen(v => !v)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-bold shadow-sm transition-all ${
                        open || activeCount > 0
                            ? 'bg-red-600 text-white border-red-600 hover:bg-red-700'
                            : 'bg-white text-gray-700 border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                    }`}
                >
                    <SlidersHorizontal className="w-4 h-4" />
                    Filtros
                    {activeCount > 0 && (
                        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${open ? 'bg-white/25 text-white' : 'bg-red-100 text-red-600'}`}>
                            {activeCount}
                        </span>
                    )}
                    {open ? <ChevronUp className="w-3.5 h-3.5 ml-0.5" /> : <ChevronDown className="w-3.5 h-3.5 ml-0.5" />}
                </button>

                {/* Limpar */}
                <button
                    onClick={clearFilters}
                    disabled={activeCount === 0}
                    className={`flex items-center gap-1.5 px-4 py-2 rounded-lg border text-sm font-bold shadow-sm transition-all ${
                        activeCount > 0
                            ? 'bg-white text-red-600 border-red-200 hover:bg-red-50 hover:border-red-300'
                            : 'bg-white text-gray-300 border-gray-200 cursor-not-allowed'
                    }`}
                >
                    <X className="w-4 h-4" />
                    Limpar filtros
                </button>

                {/* Expandir / Recolher */}
                {onToggleExpandAll && (
                    <button
                        onClick={onToggleExpandAll}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 text-sm font-bold shadow-sm hover:bg-gray-50 hover:border-gray-300 transition-all"
                    >
                        {isAllExpanded
                            ? <><ChevronsUp className="w-4 h-4" /> Recolher tudo</>
                            : <><ChevronsDown className="w-4 h-4" /> Expandir tudo</>
                        }
                    </button>
                )}

                {children}
            </div>

            {/* ── Filter panel ── */}
            {open && (
                <div className="mt-2 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                    <div className="p-4 space-y-4">
                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                                type="text"
                                placeholder="Buscar por ID ou título..."
                                value={filters.query}
                                onChange={(e) => onChange({ ...filters, query: e.target.value })}
                                className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
                            />
                        </div>

                        <div className="border-t border-gray-100" />

                        {/* Pill rows */}
                        {filterRows.map(({ label, key, pills }) => (
                            <div key={label} className="flex items-start gap-3">
                                <span className={ROW_LABEL}>{label}</span>
                                <div className="w-px bg-gray-100 self-stretch" />
                                <div className="flex flex-wrap gap-1.5">
                                    {pills.map(({ value, active }) => (
                                        <button
                                            key={value}
                                            onClick={() => toggleArr(key, value)}
                                            className={`${pill} ${filters[key].includes(value) ? active : pillOff}`}
                                        >
                                            {value}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        ))}

                        <div className="border-t border-gray-100" />

                        {/* Requester, Sector, Dates */}
                        <div className="flex flex-wrap items-center gap-3">
                            <select value={filters.requester}
                                onChange={(e) => onChange({ ...filters, requester: e.target.value })}
                                className={selectCls}>
                                <option value="">Todos Solicitantes</option>
                                {requesters.map(r => <option key={r} value={r}>{r}</option>)}
                            </select>

                            {showSectorFilter && (
                                <select value={filters.sector}
                                    onChange={(e) => onChange({ ...filters, sector: e.target.value })}
                                    className={selectCls}>
                                    <option value="">Todos Setores</option>
                                    {sectors.map(s => <option key={s} value={s}>{s}</option>)}
                                </select>
                            )}

                            <div className="flex items-center gap-2">
                                <input type="date" value={filters.startDate || ''}
                                    onChange={(e) => onChange({ ...filters, startDate: e.target.value })}
                                    className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-red-500 outline-none" />
                                <span className="text-gray-400 text-xs">até</span>
                                <input type="date" value={filters.endDate || ''}
                                    onChange={(e) => onChange({ ...filters, endDate: e.target.value })}
                                    className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-red-500 outline-none" />
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default FilterBar;
