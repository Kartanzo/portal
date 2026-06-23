import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { useToast } from '../contexts/ToastContext';
import { api } from '../app_api';
import { Plus, Trash, Search, DollarSign, Package, AlertTriangle, TrendingUp, Truck, Info, Calendar, BarChart, Maximize2, Minimize2, X, RotateCcw, FileDown, Upload, LayoutPanelLeft, LayoutDashboard, User, Clock, ChevronLeft, ChevronRight, MessageSquare } from 'lucide-react';
import WhatsAppEnvioModal from './Configuracoes/WhatsAppEnvioModal';

// Botao reutilizavel: expande um elemento para tela cheia + tenta travar paisagem (mobile)
const ExpandButton: React.FC<{ targetRef: React.RefObject<HTMLDivElement> }> = ({ targetRef }) => {
    const [fs, setFs] = useState(false);
    useEffect(() => {
        const onChange = () => setFs(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);
    const toggle = useCallback(async () => {
        if (document.fullscreenElement) {
            try { await document.exitFullscreen?.(); } catch {}
            try { (screen.orientation as any)?.unlock?.(); } catch {}
            return;
        }
        const el = targetRef.current;
        if (!el) return;
        try {
            await (el.requestFullscreen?.() || (el as any).webkitRequestFullscreen?.());
            try { await (screen.orientation as any)?.lock?.('landscape'); } catch {}
        } catch (e) { console.warn('Fullscreen falhou', e); }
    }, [targetRef]);
    return (
        <button
            onClick={toggle}
            title={fs ? 'Sair da tela cheia' : 'Expandir tabela (gira para paisagem no celular)'}
            className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600 bg-white border border-slate-200 rounded-full flex items-center gap-2 hover:bg-slate-50 transition-all"
        >
            {fs ? <><Minimize2 className="w-3.5 h-3.5" /> Reduzir</> : <><Maximize2 className="w-3.5 h-3.5" /> Expandir</>}
        </button>
    );
};
import { BarChart as ReCharts, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ComposedChart, Line } from 'recharts';

interface PipelineItem {
    cod_item: string;
    quantidade: number;
    data_chegada: string;
}

interface ImportationResult {
    items: any[];
    containers: any[];
    chart: {
        labels: string[];
        qty: number[];
        yuan: number[];
    };
    kpis: {
        k1: string;
        k2: string;
        k3: string;
        k4: number;
        h_val_last?: number;
        h_val_avg?: number;
        h_qtd_last?: number;
        h_qtd_avg?: number;
    };
    hist_labels?: string[];
}

interface HistoryItem {
    id: string;
    filename: string;
    date: string;
    user: string;
    items_count: number;
}

const INITIAL_COLUMN_WIDTHS = {
    'Código': 80,
    'DESCRICAO_PRODUTO': 250,
    'DESCRIPTION': 200,
    'NCM': 80,
    'DISPONIVEL': 70,
    'Pipeline_Em_Andamento': 70,
    'Média_Histórica_ADS': 70,
    'Cobertura_Dias': 70,
    'Estoque_Seguranca': 80,
    'Ruptura': 150,
    'Sugestão_Compra': 80,
    'UNIT/CTN': 50,
    'UNIT': 50,
    'CTNS': 60,
    'Volume_Total_CBM': 70,
    'Peso_Total': 80,
    'PRICE': 70,
    'Investimento_Yuan': 90,
    'Previsão_Chegada': 100,
    'OBS': 120
};

interface ImportationProps {
    user?: any;
}

const Importation: React.FC<ImportationProps> = ({ user }) => {
    const { showToast } = useToast();
    const [pipelineItems, setPipelineItems] = useState<PipelineItem[]>([{ cod_item: '', quantidade: 0, data_chegada: '' }]);
    const [results, setResults] = useState<ImportationResult | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
    const [activeTab, setActiveTab] = useState<'items' | 'containers'>('items');
    const [filterText, setFilterText] = useState('');
    const [activeItem, setActiveItem] = useState<any | null>(null);
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
    const [history, setHistory] = useState<HistoryItem[]>([]);
    const [selectedHistoryId, setSelectedHistoryId] = useState<string | null>(null);
    const [deleteModal, setDeleteModal] = useState<{ isOpen: boolean, historyId: string | null }>({ isOpen: false, historyId: null });
    const [isUploading, setIsUploading] = useState(false);
    const [columnWidths, setColumnWidths] = useState<Record<string, number>>(INITIAL_COLUMN_WIDTHS);
    const [resizing, setResizing] = useState<string | null>(null);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [sidebarView, setSidebarView] = useState<'dashboard' | 'history'>('dashboard');
    const [isExporting, setIsExporting] = useState(false);
    const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
    const [wppModalOpen, setWppModalOpen] = useState(false);
    const tableWrapperRef = useRef<HTMLDivElement>(null);

    const getImportationStatusColor = (item: any) => {
        const status = item['Status'] || '';
        const coverage = item['Cobertura_Dias'] || 0;

        if (status === 'CRÍTICO' || coverage < 30) return 'red';
        if (status === 'ATENÇÃO' || (coverage >= 30 && coverage <= 90)) return 'yellow';
        return 'green';
    };

    const getRowBgColor = (item: any) => {
        const color = getImportationStatusColor(item);
        const isActive = activeItem?.['Código'] === item['Código'];

        if (color === 'red') return isActive ? 'bg-red-100 border-l-4 border-l-red-600' : 'bg-red-50/40 hover:bg-red-100/50';
        if (color === 'yellow') return isActive ? 'bg-yellow-100 border-l-4 border-l-yellow-600' : 'bg-yellow-50/40 hover:bg-yellow-100/50';
        return isActive ? 'bg-emerald-100 border-l-4 border-l-emerald-600' : 'bg-emerald-50/20 hover:bg-emerald-100/30';
    };

    const getStatusTextLabel = (item: any) => {
        const color = getImportationStatusColor(item);
        if (color === 'red') return 'CRÍTICO';
        if (color === 'yellow') return 'ATENÇÃO';
        return 'OK';
    };

    const getStatusTextColor = (item: any) => {
        const color = getImportationStatusColor(item);
        if (color === 'red') return 'text-red-600';
        if (color === 'yellow') return 'text-yellow-600';
        return 'text-emerald-600';
    };


    // Overlay Loading Component
    const LoadingOverlay = () => (
        <div className="fixed inset-0 z-[9999] bg-white/80 backdrop-blur-sm flex flex-col items-center justify-center">
            <div className="w-16 h-16 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin mb-4"></div>
            <p className="text-slate-600 font-bold text-lg animate-pulse">Processando dados...</p>
        </div>
    );

    const onSort = (key: string) => {
        let direction: 'asc' | 'desc' = 'asc';
        if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setSortConfig({ key, direction });
    };

    const handleAddItem = () => {
        setPipelineItems(prev => [...prev, { cod_item: '', quantidade: 0, data_chegada: '' }]);
    };

    const handleRemoveItem = (index: number) => {
        setPipelineItems(prev => prev.filter((_, i) => i !== index));
    };

    const handleItemChange = (index: number, field: keyof PipelineItem, value: any) => {
        const newItems = [...pipelineItems];
        newItems[index] = { ...newItems[index], [field]: value };
        setPipelineItems(newItems);
    };

    const fetchHistory = async () => {
        try {
            const data = await api.getImportationHistory();
            setHistory(data);
        } catch (err) {
            console.error("Error fetching history:", err);
        }
    };

    React.useEffect(() => {
        fetchHistory();
    }, []);

    // Init Data - Load from cache or wait (User requested persistence)
    React.useEffect(() => {
        const initData = async () => {
            try {
                const cache = await api.getImportationCache();
                if (cache) {
                    setResults(cache);
                    setLastUpdate(new Date());
                } else if (history.length > 0) {
                    // Auto-load last history item if cache is empty
                    await handleCalculate(history[0].id);
                } else {
                    // Always trigger a base calculation if no cache and no history
                    // This ensures the 57 fixed codes are loaded
                    await handleCalculate();
                }
            } catch (err) {
                console.error("Cache load error", err);
            }
        };
        initData();
    }, []);

    const handleCalculate = async (histId?: string) => {
        setLoading(true);
        setError(null);
        try {
            let response;
            if (histId) {
                response = await api.calculateImportation({ history_id: histId });
                setSelectedHistoryId(histId);
            } else {
                const validItems = pipelineItems.filter(i => i.cod_item && i.quantidade > 0);
                response = await api.calculateImportation({ items: validItems });
                setSelectedHistoryId(null);
            }
            setResults(response);
            setLastUpdate(new Date());
            showToast("Dados atualizados com sucesso!", "success");

            if (activeItem) {
                const updatedItem = response.items.find((i: any) => String(i['Código']) === String(activeItem['Código']));
                setActiveItem(updatedItem || null);
            } else {
                setActiveItem(null);
            }
        } catch (err: any) {
            const msg = err.message || "Erro ao calcular importação.";
            setError(msg);
            showToast(msg, "error");
        } finally {
            setLoading(false);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsUploading(true);
        setError(null);
        try {
            const formData = new FormData();
            formData.append('file', file);
            const savedUserStr = sessionStorage.getItem('blackd_user');
            const savedUser = savedUserStr ? JSON.parse(savedUserStr) : null;
            const userId = user?.id || savedUser?.id || localStorage.getItem('user_id') || '00000000-0000-0000-0000-000000000000';
            const res = await api.uploadImportationExcel(formData, userId);
            await fetchHistory();
            await handleCalculate(res.history_id);
            showToast("Arquivo importado com sucesso!", "success");
        } catch (err: any) {
            const errorMsg = err.response?.data?.detail || "Erro ao fazer upload do arquivo.";
            setError(errorMsg);
            showToast(errorMsg, "error");
        } finally {
            setIsUploading(false);
            if (e.target) e.target.value = '';
        }
    };

    const handleDeleteClick = (historyId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setDeleteModal({ isOpen: true, historyId });
    };

    const confirmDelete = async () => {
        if (!deleteModal.historyId) return;

        try {
            await api.deleteImportationHistory(deleteModal.historyId);
            showToast("Histórico excluído com sucesso.", "success");

            // Refresh history
            await fetchHistory();

            // If deleted item was active, clear it
            if (selectedHistoryId === deleteModal.historyId) {
                setSelectedHistoryId(null);
                setResults(null);
                setActiveItem(null);
            }
        } catch (err: any) {
            const msg = err.message || "Erro ao excluir histórico.";
            showToast(msg, "error");
        } finally {
            setDeleteModal({ isOpen: false, historyId: null });
        }
    };

    const downloadTemplate = async () => {
        try {
            const response = await api.getImportationTemplate();
            const url = window.URL.createObjectURL(new Blob([response]));
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', 'modelo_importacao.xlsx');
            document.body.appendChild(link);
            link.click();
            link.remove();
        } catch (err) {
            showToast("Erro ao baixar modelo.", "error");
        }
    };

    const formatCurrency = (value: number) => {
        return `¥ ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };

    const formatBRL = (value: number) => {
        return `R$ ${value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    };



    const handleResizeStart = (e: React.MouseEvent, columnId: string) => {
        e.preventDefault();
        setResizing(columnId);
        const startX = e.pageX;
        const startWidth = columnWidths[columnId];
        const onMouseMove = (moveEvent: MouseEvent) => {
            const newWidth = Math.max(30, startWidth + (moveEvent.pageX - startX));
            setColumnWidths(prev => ({ ...prev, [columnId]: newWidth }));
        };
        const onMouseUp = () => {
            setResizing(null);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    // Column Definitions moved up for scope access
    const columnsItems = [
        { id: 'Código', label: 'Código' },
        { id: 'DESCRICAO_PRODUTO', label: 'Descrição Produto' },
        { id: 'DESCRIPTION', label: 'Description' },
        { id: 'DISPONIVEL', label: 'Estoque' },
        { id: 'Pipeline_Em_Andamento', label: 'Em andamento' },
        { id: 'Média_Histórica_ADS', label: 'venda/dia' },
        { id: 'Cobertura_Dias', label: 'Cobertura (Dias)' },
        { id: 'Estoque_Seguranca', label: 'Est. Segurança' },
        { id: 'Ruptura', label: 'Ruptura' },
        { id: 'Sugestão_Compra', label: 'Sugestão' },
        { id: 'UNIT/CTN', label: 'Cx' },
        { id: 'UNIT', label: 'Un' },
        { id: 'CTNS', label: 'Cart.' },
        { id: 'Volume_Total_CBM', label: 'CBM T.' },
        { id: 'Peso_Total', label: 'Peso Bruto T.' },
        { id: 'Peso_Liquido_Unit', label: 'Peso Líq. (un)' },
        { id: 'PRICE', label: 'Preço' },
        { id: 'Investimento_Yuan', label: 'Total (¥)' },
        { id: 'Previsão_Chegada', label: 'Prev. Chegada' },
        { id: 'OBS', label: 'Obs' }
    ];

    const handleAutoFit = (columnId: string, items: any[]) => {
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        if (!context) return;
        context.font = 'bold 10px Inter, system-ui, sans-serif'; // Match header font

        let maxW = 40;
        const colDef = columnsItems.find(c => c.id === columnId);
        const headerText = colDef ? colDef.label : columnId;

        // Header width + padding + sorting arrow space
        maxW = Math.max(maxW, context.measureText(headerText).width + 32);

        // Content width
        context.font = '11px Inter, system-ui, sans-serif'; // Match cell font
        items.forEach(item => {
            let val = item[columnId];
            if (val === null || val === undefined) val = '';

            // Format specific columns to match display
            if (typeof val === 'number') {
                if (['DISPONIVEL', 'Pipeline_Em_Andamento', 'Sugestão_Compra'].includes(columnId)) {
                    val = val.toLocaleString();
                } else if (['Média_Histórica_ADS', 'Volume_Total_CBM', 'Peso_Total', 'PRICE'].includes(columnId)) {
                    val = val.toFixed(2);
                } else if (columnId === 'Investimento_Yuan') {
                    // This one is complicated due to formatCurrency call, approximation
                    val = `¥ ${val.toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
                }
            }

            const w = context.measureText(String(val)).width + 24; // + padding
            if (w > maxW) maxW = w;
        });

        setColumnWidths(prev => ({ ...prev, [columnId]: Math.min(maxW, 500) }));
    };

    const resetLayout = () => {
        setColumnWidths(INITIAL_COLUMN_WIDTHS);
        setSortConfig(null);
    };

    const toggleFullScreen = () => setIsFullScreen(!isFullScreen);

    const filteredItems = useMemo(() => {
        let items = results?.items || [];
        if (filterText) {
            items = items.filter(i => String(i['Código']).includes(filterText));
        }
        if (sortConfig) {
            const { key, direction } = sortConfig;
            items = [...items].sort((a, b) => {
                const aVal = a[key] ?? '';
                const bVal = b[key] ?? '';
                if (aVal < bVal) return direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return items;
    }, [results, filterText, sortConfig]);

    const chartData = useMemo(() => {
        if (!results) return [];
        if (activeItem) {
            return (results.hist_labels || []).map((label, i) => ({
                name: label,
                qty: activeItem[`Hist_Mes_${i + 1}`] || 0,
                val: activeItem[`Hist_Valor_Mes_${i + 1}`] || 0
            }));
        }
        return (results.chart?.labels || []).map((label, idx) => ({
            name: label,
            qty: results.chart.qty[idx] || 0,
            val: results.chart.yuan[idx] || 0
        }));
    }, [activeItem, results]);

    // Container Table Columns
    const containerColumns = [
        { header: 'CONTAINER', accessor: 'Container_ID', width: '180px' },
        { header: 'CÓDIGO', accessor: 'Código', width: '100px' },
        { header: 'DESCRIÇÃO PRODUTO', accessor: 'DESCRICAO_PRODUTO', width: '250px' },
        { header: 'SUGESTÃO', accessor: 'Sugestão_Compra', width: '100px' },
        { header: 'CTNS', accessor: 'CTNS', width: '80px' },
        { header: 'CBM TOTAL', accessor: 'CBM_Total', width: '100px' },
        { header: 'PESO BRUTO TOTAL', accessor: 'Peso_Total', width: '110px' },
        { header: 'PESO LÍQ. (UN)', accessor: 'Peso_Liquido_Unit', width: '110px' },
        { header: 'VALOR TOTAL', accessor: 'AMOUNT', width: '120px' },
    ];

    const ContainerContent = () => (
        <div className="flex-1 bg-white relative">
            <table className="w-full text-left border-collapse table-fixed">
                <thead className="bg-gray-50 border-b border-gray-100 sticky top-0 z-20 shadow-sm">
                    <tr>
                        {containerColumns.map((col, idx) => (
                            <th key={idx} className="px-4 py-3 font-black text-[10px] text-gray-400 uppercase tracking-widest sticky top-0 bg-gray-50 z-50">
                                {col.header}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                    {results?.containers?.map((row: any, idx: number) => (
                        <tr key={idx} className="hover:bg-gray-50/50 text-[11px] font-medium text-slate-600">
                            <td className="px-4 py-3 font-bold text-slate-800">{row['Container_ID']}</td>
                            <td className="px-4 py-3 font-bold text-blue-600">#{row['Código']}</td>
                            <td className="px-4 py-3 truncate text-slate-700" title={row['DESCRICAO_PRODUTO']}>{row['DESCRICAO_PRODUTO']}</td>
                            <td className="px-4 py-3">{row['Sugestão_Compra']}</td>
                            <td className="px-4 py-3">{row['CTNS']}</td>
                            <td className="px-4 py-3">{row['CBM_Total']} m³</td>
                            <td className="px-4 py-3">{row['Peso_Total'] ?? 0} kg</td>
                            <td className="px-4 py-3">{row['Peso_Liquido_Unit'] ?? 0} kg</td>
                            <td className="px-4 py-3 text-emerald-600 font-bold">{formatCurrency(row['AMOUNT'])}</td>
                        </tr>
                    ))}
                    {!results?.containers?.length && (
                        <tr>
                            <td colSpan={9} className="p-8 text-center text-slate-400 text-xs uppercase tracking-widest">
                                Nenhum container gerado
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );

    const TableContent = () => (
        <div className="flex-1 bg-white relative">
            <table className="w-full text-left border-collapse table-fixed">
                <thead className="bg-gray-50 border-b border-gray-100 sticky top-0 z-20 shadow-sm">
                    <tr>
                        {columnsItems.map(col => (
                            <th key={col.id} className="px-1 py-4 font-black text-[10px] text-gray-400 uppercase tracking-widest relative group select-none sticky top-0 bg-gray-50 z-50" style={{ width: columnWidths[col.id] }}>
                                <div className="flex items-center justify-between">
                                    <span className="truncate cursor-pointer hover:text-red-600 transition-colors" onClick={() => onSort(col.id)} title={col.label}>
                                        {col.label} {sortConfig?.key === col.id ? (sortConfig.direction === 'asc' ? '↑' : '↓') : ''}
                                    </span>
                                    <div
                                        className="absolute right-0 top-0 bottom-0 w-3 -mr-1.5 cursor-col-resize hover:bg-blue-400/50 transition-colors z-50 group-hover:bg-slate-200/50"
                                        onMouseDown={(e) => handleResizeStart(e, col.id)}
                                        onDoubleClick={(e) => {
                                            e.stopPropagation();
                                            handleAutoFit(col.id, filteredItems);
                                        }}
                                        title="Arraste para redimensionar ou duplo clique para ajustar"
                                    />
                                </div>
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                    {filteredItems.map(item => (
                        <tr
                            key={item['Código']}
                            className={`cursor-pointer text-[11px] font-medium divide-x divide-gray-50/50 transition-all ${getRowBgColor(item)}`}
                            onClick={() => setActiveItem(item)}
                        >
                            <td className="px-2 py-2 font-bold text-slate-900 truncate">#{item['Código']}</td>
                            <td className="px-2 py-2 truncate text-slate-700" title={item['DESCRICAO_PRODUTO']}>{item['DESCRICAO_PRODUTO']}</td>
                            <td className="px-2 py-2 truncate text-slate-400 italic" title={item['DESCRIPTION']}>{item['DESCRIPTION']}</td>
                            <td className="px-2 py-2 text-right font-bold truncate bg-slate-50/30">{(item['DISPONIVEL'] || 0).toLocaleString()}</td>
                            <td className="px-2 py-2 text-right font-bold truncate">{(item['Pipeline_Em_Andamento'] || 0).toLocaleString()}</td>
                            <td className="px-2 py-2 text-right font-bold truncate">{(item['Média_Histórica_ADS'] || 0).toFixed(2)}</td>
                            <td className={`px-2 py-2 text-right font-black truncate ${item['Cobertura_Dias'] < 30 ? 'text-red-600' : (item['Cobertura_Dias'] < 90 ? 'text-amber-600' : 'text-emerald-600')}`}>{(item['Cobertura_Dias'] || 0).toFixed(0)}</td>
                            <td className="px-2 py-2 text-right font-bold truncate text-slate-500">{(item['Estoque_Seguranca'] || 0).toLocaleString()}</td>
                            <td className={`px-2 py-2 truncate text-[10px] font-bold ${item['Ruptura'] !== 'Sem Ruptura' ? 'text-red-600' : 'text-emerald-600'}`}>{item['Ruptura']}</td>
                            <td className="px-2 py-2 text-right font-black text-red-600 truncate bg-red-50/20">{(item['Sugestão_Compra'] || 0).toLocaleString()}</td>
                            <td className="px-2 py-2 text-right text-slate-400 truncate">{item['UNIT/CTN']}</td>
                            <td className="px-2 py-2 text-center text-slate-400 truncate">{item['UNIT']}</td>
                            <td className="px-2 py-2 text-right text-slate-400 truncate">{(item['Sugestão_Compra'] / (item['UNIT/CTN'] || 1)).toFixed(0)}</td>
                            <td className="px-2 py-2 text-right text-slate-500 truncate">{item['Volume_Total_CBM']?.toFixed(2)}</td>
                            <td className="px-2 py-2 text-right text-slate-500 truncate">{(item['Sugestão_Compra'] * (item['G.W'] || 0)).toFixed(0)}</td>
                            <td className="px-2 py-2 text-right text-slate-500 truncate">¥{item['PRICE']?.toFixed(2)}</td>
                            <td className="px-2 py-2 text-right font-black text-emerald-600 truncate bg-emerald-50/20">{formatCurrency(item['Investimento_Yuan'])}</td>
                            <td className="px-2 py-2 text-center truncate text-slate-500 font-bold">{item['Previsão_Chegada'] || '-'}</td>
                            <td className="px-2 py-2 truncate text-slate-300 italic text-[10px]" title={item['OBS']}>{item['OBS']}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {filteredItems.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-4 opacity-50 py-20">
                    <Package className="w-16 h-16 stroke-1" />
                    <p className="font-medium">Nenhum dado carregado. Importe um arquivo ou adicione itens manuais.</p>
                </div>
            )}
        </div>
    );

    const handleExport = () => {
        if (!results) return;
        let csvContent = "data:text/csv;charset=utf-8,\uFEFF";

        if (activeTab === 'items') {
            const header = columnsItems.map(c => c.label).join(";");
            const rows = filteredItems.map(item => columnsItems.map(c => item[c.id]).join(";"));
            csvContent += header + "\n" + rows.join("\n");
        } else {
            // Container Export — usa exatamente as colunas da tabela do front
            const header = containerColumns.map(c => c.header).join(";");
            const rows = results.containers.map((c: any) => containerColumns.map(col => c[col.accessor]).join(";"));
            csvContent += header + "\n" + rows.join("\n");
        }

        const link = document.createElement("a");
        link.setAttribute("href", encodeURI(csvContent));
        link.setAttribute("download", `importacao_${activeTab}_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className={`importation-root flex h-full bg-[#f8fafc] overflow-hidden ${isFullScreen ? 'fixed inset-0 z-[100]' : ''}`}>
            {/* Botão flutuante mobile: toggle sidebar de gráficos */}
            <button
                type="button"
                onClick={() => setIsMobileSidebarOpen(v => !v)}
                className="importation-mobile-toggle"
                aria-label={isMobileSidebarOpen ? 'Recolher painel' : 'Expandir painel'}
            >
                {isMobileSidebarOpen ? <ChevronLeft className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                <span>{isMobileSidebarOpen ? 'Recolher painel' : 'Expandir painel'}</span>
            </button>

            {/* LEFT SIDEBAR */}
            <div className={`importation-sidebar ${isMobileSidebarOpen ? 'mobile-open' : 'mobile-closed'} w-80 border-r border-slate-200 bg-white flex flex-col overflow-y-auto p-5 gap-6 custom-scrollbar shrink-0`}>
                <div className="flex items-center gap-3 px-1">
                    <div className="p-2 bg-blue-600 rounded-xl text-white shadow-lg shadow-blue-200">
                        <TrendingUp className="w-5 h-5" />
                    </div>
                    <h2 className="text-lg font-black text-slate-900 uppercase tracking-tighter">Importação</h2>
                </div>

                <div className="grid grid-cols-2 gap-2">
                    <button onClick={downloadTemplate} className="flex items-center justify-center gap-2 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-all">
                        <FileDown className="w-3.5 h-3.5" /> Modelo
                    </button>
                    <label className={`flex items-center justify-center gap-2 px-3 py-2 text-[10px] font-black uppercase tracking-widest bg-white border border-slate-200 text-slate-600 rounded-xl cursor-pointer hover:bg-slate-50 transition-all ${isUploading ? 'opacity-50 pointer-events-none' : ''}`}>
                        <Upload className="w-3.5 h-3.5" /> {isUploading ? '...' : 'Upload'}
                        <input type="file" accept=".xlsx,.xls" onChange={handleFileUpload} className="hidden" />
                    </label>
                    <button
                        onClick={() => setSidebarView('history')}
                        className={`flex items-center justify-center gap-2 px-3 py-2 text-[10px] font-black uppercase tracking-widest border rounded-xl transition-all ${sidebarView === 'history' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                    >
                        <Calendar className="w-3.5 h-3.5" /> Histórico
                    </button>
                    <button
                        onClick={() => setSidebarView('dashboard')}
                        className={`flex items-center justify-center gap-2 px-3 py-2 text-[10px] font-black uppercase tracking-widest border rounded-xl transition-all ${sidebarView === 'dashboard' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                    >
                        <LayoutDashboard className="w-3.5 h-3.5" /> Dashboard
                    </button>
                </div>

                {sidebarView === 'history' && (
                    <div className="flex flex-col gap-2 mt-2">
                        <div className="space-y-2">
                            {history.map(item => (
                                <div key={item.id} className={`p-3 rounded-xl border transition-all group ${selectedHistoryId === item.id ? 'bg-blue-50 border-blue-200' : 'bg-slate-50 border-slate-100 hover:border-blue-200'}`}>
                                    <div className="flex items-start justify-between mb-2">
                                        <span className={`text-[10px] font-bold break-all line-clamp-2 ${selectedHistoryId === item.id ? 'text-blue-700' : 'text-slate-700'}`}>{item.filename}</span>
                                        <div className="flex gap-1">
                                            {(user?.role === 'super_user' || user?.permissions?.importation?.can_delete) && (
                                                <button
                                                    onClick={(e) => handleDeleteClick(item.id, e)}
                                                    className="p-1.5 bg-white text-red-600 rounded-lg shadow-sm border border-slate-100 hover:bg-red-600 hover:text-white transition-all"
                                                    title="Excluir histórico"
                                                >
                                                    <Trash className="w-3 h-3" />
                                                </button>
                                            )}
                                            <button onClick={() => handleCalculate(item.id)} className="p-1.5 bg-white text-blue-600 rounded-lg shadow-sm border border-slate-100 hover:bg-blue-600 hover:text-white transition-all">
                                                <RotateCcw className="w-3 h-3" />
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 text-[9px] text-slate-400">
                                        <User className="w-3 h-3" /> {item.user}
                                    </div>
                                    <div className="flex items-center gap-2 text-[9px] text-slate-400 mt-1">
                                        <Clock className="w-3 h-3" /> {new Date(item.date).toLocaleString('pt-BR')}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}


                {/* Resumo Global / Item Detail KPIs */}
                {sidebarView === 'dashboard' && results && (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2 mb-2">
                            {activeItem && (
                                <button onClick={() => setActiveItem(null)} className="mr-1 text-slate-400 hover:text-blue-600 transition-colors"><X className="w-4 h-4" /></button>
                            )}
                            <span className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em]">
                                {activeItem ? `Resumo Item #${activeItem['Código']}` : 'Resumo Global'}
                            </span>
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                            <div className="bg-blue-50 p-3 rounded-2xl border border-blue-100">
                                <span className="text-[9px] font-black uppercase text-blue-400 block mb-1">Volume Total</span>
                                <span className="text-sm font-black text-slate-900">
                                    {activeItem ? `${(activeItem['Volume_Total_CBM'] || 0).toFixed(2)} CBM` : results.kpis.k1}
                                </span>
                            </div>
                            <div className="bg-emerald-50 p-3 rounded-2xl border border-emerald-100">
                                <span className="text-[9px] font-black uppercase text-emerald-400 block mb-1">Investimento Total</span>
                                <span className="text-sm font-black text-slate-900">
                                    {activeItem ? formatCurrency(activeItem['Investimento_Yuan'] || 0) : results.kpis.k2}
                                </span>
                            </div>
                            <div className="bg-rose-50 p-3 rounded-2xl border border-rose-100">
                                <span className="text-[9px] font-black uppercase text-rose-400 block mb-1">Peso Total</span>
                                <span className="text-sm font-black text-slate-900">
                                    {activeItem ? `${(activeItem['Peso_Total'] || 0).toFixed(1)} KG` : results.kpis.k3}
                                </span>
                            </div>
                            <div className={`p-3 rounded-2xl border ${activeItem ? (getImportationStatusColor(activeItem) === 'red' ? 'bg-red-50 border-red-100' : getImportationStatusColor(activeItem) === 'yellow' ? 'bg-yellow-50 border-yellow-100' : 'bg-emerald-50 border-emerald-100') : 'bg-orange-50 border-orange-100'}`}>
                                <span className={`text-[9px] font-black uppercase block mb-1 ${activeItem ? (getImportationStatusColor(activeItem) === 'red' ? 'text-red-400' : getImportationStatusColor(activeItem) === 'yellow' ? 'text-yellow-400' : 'text-emerald-400') : 'text-orange-400'}`}>{activeItem ? 'Status' : 'Alertas'}</span>
                                <span className={`text-sm font-black ${activeItem ? getStatusTextColor(activeItem) : 'text-slate-900'}`}>
                                    {activeItem ? getStatusTextLabel(activeItem) : results.kpis.k4}
                                </span>
                            </div>

                            {/* HISTÓRICO GLOBAL OU ITEM */}
                            <div className="col-span-2 mt-4 mb-2">
                                <span className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em]">
                                    {activeItem ? 'Histórico Item (3 Meses)' : 'Histórico Global (Itens da Lista)'}
                                </span>
                            </div>
                            <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                                <span className="text-[9px] font-black uppercase text-slate-400 block mb-1">Qtd Média (3M)</span>
                                <span className="text-sm font-black text-slate-900">
                                    {activeItem
                                        ? Math.round(activeItem['vendas_qtd_media_3_meses'] || 0)
                                        : (results.kpis.h_qtd_avg?.toFixed(0) || '-')}
                                </span>
                            </div>
                            <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                                <span className="text-[9px] font-black uppercase text-slate-400 block mb-1">Qtd Último Mês</span>
                                <span className="text-sm font-black text-slate-900">
                                    {activeItem
                                        ? Math.round(activeItem['vendas_qtd_ultimo_mes'] || 0)
                                        : (results.kpis.h_qtd_last?.toFixed(0) || '-')}
                                </span>
                            </div>
                            <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                                <span className="text-[9px] font-black uppercase text-slate-400 block mb-1">Valor Médio (3M)</span>
                                <span className="text-sm font-black text-slate-900">
                                    {activeItem
                                        ? formatBRL(activeItem['vendas_valor_media_3_meses'] || 0)
                                        : (results.kpis.h_val_avg ? formatBRL(results.kpis.h_val_avg) : '-')}
                                </span>
                            </div>
                            <div className="bg-slate-50 p-3 rounded-2xl border border-slate-100">
                                <span className="text-[9px] font-black uppercase text-slate-400 block mb-1">Valor Último Mês</span>
                                <span className="text-sm font-black text-slate-900">
                                    {activeItem
                                        ? formatBRL(activeItem['vendas_valor_ultimo_mes'] || 0)
                                        : (results.kpis.h_val_last ? formatBRL(results.kpis.h_val_last) : '-')}
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Chart Section - MOVED TO SIDEBAR */}
                {sidebarView === 'dashboard' && results && (
                    <div className="mt-6">
                        <div className="flex items-center gap-2 mb-4">
                            <span className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em]">
                                {activeItem ? 'HISTÓRICO ÚLTIMOS 12 MESES' : 'DEMANDA CONSOLIDADA (3 MESES)'}
                            </span>
                        </div>
                        <div className="h-48 w-full bg-white rounded-2xl border border-slate-100 p-2 relative">
                            <ResponsiveContainer width="100%" height="100%">
                                <ComposedChart data={activeItem
                                    ? (results.hist_labels || []).map((label, i) => ({
                                        name: label,
                                        qty: activeItem[`Hist_Mes_${i + 1}`] || 0,
                                        real: activeItem[`Hist_Valor_Mes_${i + 1}`] || 0
                                    }))
                                    : results.chart.labels.map((label, i) => ({
                                        name: label,
                                        qty: results.chart.qty[i],
                                        real: results.chart.yuan[i]
                                    }))
                                }>
                                    <defs>
                                        <linearGradient id="colorQty" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                                            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.1} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E2E8F0" />
                                    <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#64748B' }} axisLine={false} tickLine={false} dy={10} />
                                    <YAxis yAxisId="left" tick={{ fontSize: 9, fill: '#64748B' }} axisLine={false} tickLine={false} />
                                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 9, fill: '#64748B' }} axisLine={false} tickLine={false} tickFormatter={(val) => `R$${(val / 1000).toFixed(0)}k`} />
                                    <Tooltip
                                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                                        itemStyle={{ fontSize: '11px', fontWeight: 'bold' }}
                                        labelStyle={{ fontSize: '10px', color: '#94a3b8', marginBottom: '4px' }}
                                    />
                                    <Bar yAxisId="left" dataKey="qty" fill="url(#colorQty)" radius={[4, 4, 0, 0]} barSize={32} />
                                    <Line yAxisId="right" type="monotone" dataKey="real" stroke="#10b981" strokeWidth={2} dot={false} />
                                </ComposedChart>
                            </ResponsiveContainer>
                        </div>
                    </div>
                )}


            </div>

            {/* MAIN CONTENT AREA */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Header */}
                <div className="px-8 py-8 flex items-center justify-between shrink-0">
                    <div>
                        <h1 className="text-[32px] font-black text-slate-900 leading-tight">Importação</h1>
                        <p className="text-slate-400 text-sm font-medium italic">Dashboard de decisões e simulação</p>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="relative group">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                            <input
                                type="text"
                                placeholder="Buscar código..."
                                value={filterText}
                                onChange={(e) => setFilterText(e.target.value)}
                                className="pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-[20px] text-sm w-72 focus:ring-1 focus:ring-blue-500 outline-none shadow-sm transition-all"
                            />
                        </div>
                        <div className="flex items-center gap-1">
                            <button onClick={() => { resetLayout(); handleCalculate(selectedHistoryId || undefined); }} disabled={loading} className="p-2.5 text-slate-400 hover:bg-white hover:text-red-600 rounded-xl transition-all shadow-sm border border-transparent hover:border-slate-100 disabled:opacity-50" title="Atualizar dados"><RotateCcw className={`w-4.5 h-4.5 ${loading ? 'animate-spin text-red-500' : ''}`} /></button>
                            <button onClick={toggleFullScreen} className="p-2.5 text-slate-400 hover:bg-white hover:text-blue-600 rounded-xl transition-all shadow-sm border border-transparent hover:border-slate-100" title="Tela Cheia"><Maximize2 className="w-4.5 h-4.5" /></button>
                        </div>
                    </div>
                </div>

                <div className="flex-1 overflow-auto px-8 pb-10 custom-scrollbar space-y-10">


                    {/* Table Section */}
                    <div className="bg-white rounded-[32px] border border-slate-100 shadow-xl shadow-slate-200/50 flex flex-col min-h-[500px] w-fit min-w-full">
                        {/* Tabs */}
                        <div className="flex items-center p-6 border-b border-slate-50 gap-2 shrink-0">
                            <button onClick={() => setActiveTab('items')} className={`px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'items' ? 'bg-slate-900 text-white' : 'text-slate-400 hover:text-slate-600'}`}>
                                LISTA DE ITENS
                            </button>
                            <button onClick={() => setActiveTab('containers')} className={`px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${activeTab === 'containers' ? 'bg-slate-900 text-white' : 'text-slate-400 hover:text-slate-600'}`}>
                                MÓDULO CONTAINERS
                            </button>
                            {results && (
                                <>
                                    <button
                                        onClick={() => handleCalculate(selectedHistoryId || undefined)}
                                        disabled={loading}
                                        className="px-4 py-2 text-[10px] font-black uppercase tracking-widest text-blue-600 bg-blue-50 rounded-full border border-blue-100 flex items-center gap-2 hover:bg-blue-100 transition-all disabled:opacity-50"
                                    >
                                        <RotateCcw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                                        {loading ? 'Atualizando...' : 'Atualizar'}
                                    </button>

                                    <div className="flex items-center gap-2">
                                        <button onClick={handleExport} title="Exportar para CSV" className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-emerald-600 bg-emerald-50 rounded-full border border-emerald-100 flex items-center gap-1.5 hover:bg-emerald-100 transition-all">
                                            <FileDown className="w-3.5 h-3.5" /> CSV
                                        </button>
                                        <button
                                            onClick={() => setWppModalOpen(true)}
                                            disabled={!results}
                                            title="Enviar planilha (Itens + Containers) via WhatsApp"
                                            className="px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white bg-green-600 hover:bg-green-700 rounded-full border border-green-500 flex items-center gap-1.5 disabled:opacity-50"
                                        >
                                            <MessageSquare className="w-3.5 h-3.5" /> WhatsApp
                                        </button>
                                        <ExpandButton targetRef={tableWrapperRef} />
                                        <span className="hidden xl:inline-flex text-[9px] font-bold text-slate-400 uppercase tracking-widest whitespace-nowrap ml-2">
                                            Atualizado {(lastUpdate || new Date()).toLocaleString('pt-BR')}
                                        </span>
                                    </div>

                                    {activeTab === 'containers' && results.containers && (
                                        <div className="flex items-center gap-4 mr-4 ml-auto">
                                            <div className="bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100 whitespace-nowrap">
                                                <span className="text-[9px] font-black uppercase text-slate-400 block whitespace-nowrap">Total Containers</span>
                                                <span className="text-xs font-black text-slate-900 whitespace-nowrap">{new Set(results.containers.map((c: any) => c.Container_ID)).size} CNTRs</span>
                                            </div>
                                            <div className="bg-slate-50 px-3 py-1.5 rounded-lg border border-slate-100 whitespace-nowrap">
                                                <span className="text-[9px] font-black uppercase text-slate-400 block whitespace-nowrap">Peso Total</span>
                                                <span className="text-xs font-black text-slate-900 whitespace-nowrap">{results.containers.reduce((acc: number, curr: any) => acc + (curr.Peso_Total || 0), 0).toLocaleString()} kg</span>
                                            </div>
                                        </div>
                                    )}
                                </>
                            )}
                        </div>

                        <div ref={tableWrapperRef} className="flex-1 flex flex-col relative bg-white overflow-auto">
                            {activeTab === 'items' ? (
                                <TableContent />
                            ) : (
                                <ContainerContent />
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Float Detail Panel - When an item is selected */}

            <WhatsAppEnvioModal
                open={wppModalOpen}
                onClose={() => setWppModalOpen(false)}
                titulo="Enviar Importação (Excel: Itens + Containers)"
                onEnviar={(numero) => api.enviarImportacaoWhatsApp(numero)}
            />

            {loading && <LoadingOverlay />}

            {deleteModal.isOpen && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
                    <div className="bg-white p-6 rounded-2xl shadow-2xl max-w-sm w-full mx-4 border border-slate-100 transform transition-all scale-100">
                        <div className="flex flex-col items-center text-center gap-4">
                            <div className="p-3 bg-red-50 rounded-full text-red-500">
                                <AlertTriangle className="w-8 h-8" />
                            </div>
                            <h3 className="text-lg font-black text-slate-800">Confirmar Exclusão</h3>
                            <p className="text-sm text-slate-500">
                                Tem certeza que deseja excluir este item do histórico? Esta ação não pode ser desfeita.
                            </p>
                            <div className="flex gap-3 w-full mt-2">
                                <button
                                    onClick={() => setDeleteModal({ isOpen: false, historyId: null })}
                                    className="flex-1 px-4 py-2 bg-white border border-slate-200 text-slate-600 font-bold rounded-xl hover:bg-slate-50 transition-colors"
                                >
                                    Cancelar
                                </button>
                                <button
                                    onClick={confirmDelete}
                                    className="flex-1 px-4 py-2 bg-red-600 text-white font-bold rounded-xl hover:bg-red-700 shadow-lg shadow-red-200 transition-colors"
                                >
                                    Sim, Excluir
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

        </div >
    );
};

export default Importation;
