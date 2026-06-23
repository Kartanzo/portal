import React from 'react';
import { Search, Filter, X } from 'lucide-react';
import { TicketStatus, TicketPriority, TicketCategory } from '../types';

export interface FilterState {
    query: string;
    requester: string;
    sector: string;
    responsibleSector: string;
    status: string;
    priority: string;
    category: string;
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
}

const FilterBar: React.FC<FilterBarProps> = ({ filters, onChange, requesters, sectors, showSectorFilter = false, children }) => {

    const handleInputChange = (key: keyof FilterState, value: string) => {
        onChange({ ...filters, [key]: value });
    };

    const clearFilters = () => {
        onChange({
            query: '',
            requester: '',
            sector: showSectorFilter ? '' : filters.sector,
            responsibleSector: '',
            status: '',
            priority: '',
            category: '',
            startDate: '',
            endDate: ''
        });
    };

    const hasActiveFilters =
        Boolean(filters.query) ||
        Boolean(filters.requester) ||
        (showSectorFilter && Boolean(filters.sector)) ||
        Boolean(filters.responsibleSector) ||
        Boolean(filters.status) ||
        Boolean(filters.priority) ||
        Boolean(filters.category) ||
        Boolean(filters.startDate) ||
        Boolean(filters.endDate);

    return (
        <div className="bg-white p-4 rounded-xl border border-gray-200 shadow-sm mb-6">
            <div className="flex items-center gap-2 mb-4 text-gray-500 text-xs font-bold uppercase tracking-wider">
                <Filter className="w-3 h-3" /> Filtros Avançados
            </div>

            <div className="flex flex-wrap gap-4 items-center">
                {/* Search Input */}
                <div className="relative flex-grow min-w-[200px]">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                        type="text"
                        placeholder="Buscar por ID..."
                        value={filters.query}
                        onChange={(e) => handleInputChange('query', e.target.value)}
                        className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-all"
                    />
                </div>

                {/* Requester Filter */}
                <select
                    value={filters.requester}
                    onChange={(e) => handleInputChange('requester', e.target.value)}
                    className="flex-grow min-w-[180px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white"
                >
                    <option value="">Todos Solicitantes</option>
                    {requesters.map(r => (
                        <option key={r} value={r}>{r}</option>
                    ))}
                </select>

                {/* Sector Filter */}
                {showSectorFilter && (
                    <select
                        value={filters.sector}
                        onChange={(e) => handleInputChange('sector', e.target.value)}
                        className="flex-grow min-w-[180px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white"
                    >
                        <option value="">Todos Setores</option>
                        {sectors.map(s => (
                            <option key={s} value={s}>{s}</option>
                        ))}
                    </select>
                )}

                {/* Responsible Sector Filter */}
                <select
                    value={filters.responsibleSector}
                    onChange={(e) => handleInputChange('responsibleSector', e.target.value)}
                    className="flex-grow min-w-[180px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white"
                >
                    <option value="">Setor Responsável</option>
                    <option value="T.I">T.I</option>
                    <option value="Gestão de Informação">Gestão de Informação</option>
                </select>

                {/* Category Filter */}
                <select
                    value={filters.category}
                    onChange={(e) => handleInputChange('category', e.target.value)}
                    className="flex-grow min-w-[180px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white"
                >
                    <option value="">Todas Categorias</option>
                    {Object.values(TicketCategory).map(c => (
                        <option key={c} value={c}>{c}</option>
                    ))}
                </select>

                {/* Status Filter */}
                <select
                    value={filters.status}
                    onChange={(e) => handleInputChange('status', e.target.value)}
                    className="flex-grow min-w-[160px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white"
                >
                    <option value="">Todos Status</option>
                    {Object.values(TicketStatus).map(s => (
                        <option key={s} value={s}>{s}</option>
                    ))}
                </select>

                {/* Priority Filter */}
                <select
                    value={filters.priority}
                    onChange={(e) => handleInputChange('priority', e.target.value)}
                    className="flex-grow min-w-[160px] px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent bg-white"
                >
                    <option value="">Todas Prioridades</option>
                    {Object.values(TicketPriority).map(p => (
                        <option key={p} value={p}>{p}</option>
                    ))}
                </select>

                {/* Date Filters */}
                <div className="flex items-center gap-2">
                    <input
                        type="date"
                        value={filters.startDate || ''}
                        onChange={(e) => handleInputChange('startDate', e.target.value)}
                        className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-red-500 outline-none"
                        placeholder="Início"
                    />
                    <span className="text-gray-400 text-xs">até</span>
                    <input
                        type="date"
                        value={filters.endDate || ''}
                        onChange={(e) => handleInputChange('endDate', e.target.value)}
                        className="px-2 py-1.5 border border-gray-200 rounded-lg text-xs focus:ring-2 focus:ring-red-500 outline-none"
                        placeholder="Fim"
                    />
                </div>

                {/* Custom Children */}
                {children}

                {/* Clear Filters Button - Inline */}
                {hasActiveFilters && (
                    <button
                        onClick={clearFilters}
                        className="flex items-center px-3 py-2 text-xs font-bold text-red-600 hover:text-red-800 hover:bg-red-50 rounded-lg transition-colors whitespace-nowrap"
                    >
                        <X className="w-3 h-3 mr-1" /> Limpar
                    </button>
                )}
            </div>
        </div>
    );
};

export default FilterBar;
