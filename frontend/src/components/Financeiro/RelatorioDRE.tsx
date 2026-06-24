import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../../app_api';
import { BarChart2, Download, FileDown, Maximize2, Minimize2, Loader2, Search, X, Filter, MessageSquare } from 'lucide-react';
import { toast } from '../ui/Toaster';
import { MobileLandscapeHint } from '../ui/MobileLandscapeHint';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { aplicarLayoutEmpresa, temaTabelaEmpresa } from '../exportUtils';

const RelatorioDRE: React.FC<{ user: any }> = ({ user }) => {
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [basesOrcado, setBasesOrcado] = useState<any[]>([]);
    const [basesRealizado, setBasesRealizado] = useState<any[]>([]);
    const [selectedBaseOrc, setSelectedBaseOrc] = useState('');
    const [selectedBaseReal, setSelectedBaseReal] = useState('');
    const [department, setDepartment] = useState('Total');
    const [departments, setDepartments] = useState<string[]>([]);
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [periodMode, setPeriodMode] = useState<'mensal' | 'trimestral' | 'semestral'>('mensal');
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

    const [strategicData, setStrategicData] = useState<{
        allowed_sectors: string[];
        allowed_users: { id: string, name: string, sector: string, role: string }[];
    } | null>(null);

    const userRole = user?.role;
    const isSuperUser = userRole === 'super_user';
    const isCEO = userRole === 'ceo';
    const canEditOverride = user?.permissions?.strategic?.can_edit === true;
    const canDeleteOverride = user?.permissions?.strategic?.can_delete === true;
    const isAdmin = userRole === 'admin' || isSuperUser || isCEO || canEditOverride;
    const isReadOnly = !isAdmin;
    const canDelete = isSuperUser || canDeleteOverride;

    // --- Drill-down States ---
    const [drillDownOpen, setDrillDownOpen] = useState(false);
    const [drillDownData, setDrillDownData] = useState<any[]>([]);
    const [drillDownLoading, setDrillDownLoading] = useState(false);
    const [drillDownParams, setDrillDownParams] = useState({ rowLabel: '', month: '', source: 'orcado' as 'orcado' | 'realizado' });
    const [ddFilters, setDdFilters] = useState({ dept: '', account: '', desc: '', group: '' });

    const [allJustifications, setAllJustifications] = useState<any[]>([]);
    const [isJustifyModalOpen, setIsJustifyModalOpen] = useState(false);
    const [justifyData, setJustifyData] = useState<any>(null);
    const [justText, setJustText] = useState('');
    const [saveLoading, setSaveLoading] = useState(false);

    const toggleGroup = (gName: string) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(gName)) next.delete(gName);
            else next.add(gName);
            return next;
        });
    };

    useEffect(() => {
        loadInitialData();
    }, []);

    // Helper for loading bases and departments
    const loadInitialData = async () => {
        try {
            const [orc, real, deps, sectors] = await Promise.all([
                api.getFinanceBases('orcado'),
                api.getFinanceBases('realizado'),
                api.getDepartamentos(),
                api.getStrategicSectors()
            ]);
            setStrategicData(sectors);
            setBasesOrcado(orc);
            setBasesRealizado(real);

            const filteredDeps = isAdmin ? deps : deps.filter((d: string) => sectors.allowed_sectors.includes(d));
            setDepartments(filteredDeps);

            // If not admin and we have departments, select the first one
            if (!isAdmin && filteredDeps.length > 0) {
                setDepartment(filteredDeps[0]);
            }

            if (orc.length > 0) setSelectedBaseOrc(orc[0].id);
            if (real.length > 0) setSelectedBaseReal(real[0].id);
        } catch (e) {
            console.error(e);
        }
    };

    const handleExportExcel = () => {
        const ws = XLSX.utils.json_to_sheet(data);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "DRE_Comparativo");
        XLSX.writeFile(wb, `DRE_Comparativo_${department}.xlsx`);
    };

    const handleExportPDF = async () => {
        const doc = new jsPDF('l', 'mm', 'a3');
        const layout = await aplicarLayoutEmpresa(doc, {
            titulo: 'DRE Comparativo',
            subtitulo: `Departamento: ${department}`,
            rodapeTexto: 'EMPRESA — DRE Comparativo (Financeiro)',
        });

        const headers = [['Grupo', 'Conta', 'Descrição']];
        comps.forEach(c => headers[0].push(`${c} Orç`, `${c} Real`));

        const body = [];
        groups.forEach(g => {
            const grp = structure.get(g);
            body.push([{ content: g, colSpan: 3 + comps.length * 2, styles: { fillColor: [240, 240, 240], fontStyle: 'bold' } }]);
            grp.accounts.forEach(acc => {
                const row = ['', acc.code, acc.desc];
                comps.forEach(c => {
                    const val = acc.values[c] || { orc: 0, real: 0 };
                    row.push(val.orc.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }),
                        val.real.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
                });
                body.push(row);
            });
        });

        autoTable(doc, {
            head: headers,
            body: body,
            startY: 35,
            ...temaTabelaEmpresa,
            styles: { ...temaTabelaEmpresa.styles, fontSize: 7 },
        });
        layout.finalizar();
        doc.save(`DRE_Comparativo_${department}.pdf`);
    };;

    useEffect(() => {
        if (selectedBaseOrc || selectedBaseReal) {
            loadReport();
        }
    }, [selectedBaseOrc, selectedBaseReal, department]);

    const loadBases = async () => {
        // This function is now superseded by loadInitialData
        await loadInitialData();
    };

    const loadReport = async () => {
        setLoading(true);
        try {
            const res = await api.getReportDre(selectedBaseOrc, selectedBaseReal, department);
            setData(res);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const fetchDrillDown = async (rowLabel: string, month: string, source: 'orcado' | 'realizado') => {
        setDrillDownLoading(true);
        setDrillDownOpen(true);
        setDrillDownParams({ rowLabel, month, source });
        setDdFilters({ dept: '', account: '', desc: '', group: '' });
        try {
            const res = await api.get('/financeiro/drilldown', {
                params: {
                    row_id: rowLabel,
                    month,
                    departamento: department === 'Total' ? undefined : department,
                    base_id: source === 'orcado' ? selectedBaseOrc : selectedBaseReal
                }
            });
            setDrillDownData(res.data);
            loadJustifications();
        } catch (error) {
            console.error('Error in drilldown:', error);
            setDrillDownData([]);
        } finally {
            setDrillDownLoading(false);
        }
    };

    const loadJustifications = async () => {
        const baseId = drillDownParams.source === 'orcado' ? selectedBaseOrc : selectedBaseReal;
        if (!baseId) return;
        try {
            const res = await api.get(`/financeiro/justificativas/${baseId}`);
            setAllJustifications(Array.isArray(res.data) ? res.data : []);
        } catch (e) {
            console.error("Error loading justifications:", e);
        }
    };

    const handleSaveJustification = async () => {
        if (!justifyData) return;
        const baseId = drillDownParams.source === 'orcado' ? selectedBaseOrc : selectedBaseReal;
        if (!baseId) return;

        setSaveLoading(true);
        try {
            await api.saveJustificativa({
                base_id: baseId,
                competencia: drillDownParams.month,
                conta_contabil: justifyData.conta_contabil,
                departamento: justifyData.departamento,
                grupo: justifyData.grupo,
                justificativa: justText,
                created_by: undefined
            });
            setIsJustifyModalOpen(false);
            setJustText('');
            setJustifyData(null);

            // Re-fetch data to update the UI with the new justification
            const res = await api.get('/financeiro/drilldown', {
                params: {
                    row_id: drillDownParams.rowLabel,
                    month: drillDownParams.month,
                    departamento: department === 'Total' ? undefined : department,
                    base_id: baseId
                }
            });
            setDrillDownData(res.data);
        } catch (e) {
            toast.error("Erro ao salvar justificativa");
        } finally {
            setSaveLoading(false);
        }
    };

    const exportDrillDownToPDF = async () => {
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const layout = await aplicarLayoutEmpresa(doc, {
            titulo: 'Detalhamento DRE Comparativo',
            subtitulo: `${drillDownParams.rowLabel} - ${drillDownParams.month} (${drillDownParams.source})`,
            rodapeTexto: 'EMPRESA — DRE Comparativo (Financeiro)',
        });

        const head = [['Conta', 'Descrição', 'Departamento', 'Valor']];
        const body = filteredDrillDownData.map(item => [
            item.conta_contabil,
            item.descricao_conta,
            item.departamento,
            fmt(item.valor)
        ]);

        autoTable(doc, {
            head: head,
            body: body,
            startY: 35,
            ...temaTabelaEmpresa,
            styles: { ...temaTabelaEmpresa.styles, fontSize: 7 },
        });
        layout.finalizar();
        doc.save(`Detalhamento_${drillDownParams.rowLabel}_${drillDownParams.month}.pdf`);
    };

    const filteredDrillDownData = useMemo(() => {
        return drillDownData.filter(item => {
            const mDept = !ddFilters.dept || (item.departamento || '') === ddFilters.dept;
            const mAccount = !ddFilters.account || (item.conta_contabil || '') === ddFilters.account;
            const mDesc = !ddFilters.desc || (item.descricao_conta || '').toLowerCase().includes(ddFilters.desc.toLowerCase());
            const mGroup = !ddFilters.group || (item.grupo || '') === ddFilters.group;
            return mDept && mAccount && mDesc && mGroup;
        });
    }, [drillDownData, ddFilters]);

    const uniqueDepts = useMemo(() => Array.from(new Set(drillDownData.map(i => i.departamento).filter(Boolean))).sort() as string[], [drillDownData]);
    const uniqueAccounts = useMemo(() => Array.from(new Set(drillDownData.map(i => i.conta_contabil).filter(Boolean))).sort() as string[], [drillDownData]);

    // Processing DRE Data
    // Data: {grupo, conta, descricao, source (orcado/realizado), competencia, valor}
    // We want to Group by 'Grupo' then 'Conta'.
    // Helpers para ordenar meses de forma cronológica em vez de alfabética
    const monthOrder = [
        "JANEIRO", "FEVEREIRO", "MARÇO", "ABRIL", "MAIO", "JUNHO",
        "JULHO", "AGOSTO", "SETEMBRO", "OUTUBRO", "NOVEMBRO", "DEZEMBRO"
    ];

    const comps: string[] = (Array.from(new Set(data.map(r => r.competencia))) as string[]).sort((a, b) => {
        const aUpper = a.toUpperCase();
        const bUpper = b.toUpperCase();
        const aIdx = monthOrder.findIndex(m => aUpper.includes(m));
        const bIdx = monthOrder.findIndex(m => bUpper.includes(m));

        if (aIdx !== -1 && bIdx !== -1) {
            return aIdx - bIdx; // Sort by month index
        }
        return a.localeCompare(b); // Fallback to alpha if not a recognizable month
    });

    const groups: string[] = (Array.from(new Set(data.map(r => r.grupo))) as string[]).sort();

    // Hierarchy: Group -> Account -> Values
    const structure = new Map();

    data.forEach(row => {
        if (!structure.has(row.grupo)) {
            structure.set(row.grupo, {
                name: row.grupo,
                accounts: new Map(),
                totals: {} // { [competencia]: { orc, real } }
            });
        }
        const grp = structure.get(row.grupo);
        if (!grp.accounts.has(row.conta_contabil)) {
            grp.accounts.set(row.conta_contabil, {
                code: row.conta_contabil,
                desc: row.descricao_conta,
                values: {}
            });
        }
        const acc = grp.accounts.get(row.conta_contabil);

        // Init logic for comp
        if (!acc.values[row.competencia]) acc.values[row.competencia] = { orc: 0, real: 0 };
        if (!grp.totals[row.competencia]) grp.totals[row.competencia] = { orc: 0, real: 0 };

        if (row.source === 'orcado') {
            acc.values[row.competencia].orc += row.valor;
            grp.totals[row.competencia].orc += row.valor;
        } else {
            acc.values[row.competencia].real += row.valor;
            grp.totals[row.competencia].real += row.valor;
        }
    });

    const fmt = (val: number) => val ? val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : '-';

    if (loading && data.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 space-y-4">
                <Loader2 className="w-12 h-12 text-red-600 animate-spin" />
                <p className="text-gray-500 font-medium">Carregando DRE...</p>
            </div>
        );
    }

    return (
        <div className={`flex flex-col space-y-4 transition-all duration-300 ${isFullScreen ? 'fixed inset-0 z-50 bg-gray-50 p-6 overflow-auto' : ''}`}>
            {/* Header / Filters */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 space-y-4">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                            <BarChart2 className="text-red-600" />
                            DRE Comparativo
                        </h2>
                        <p className="text-sm text-gray-500">Comparativo entre bases de orçamento e dados reais</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <button onClick={() => setIsFullScreen(!isFullScreen)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 border border-gray-200">
                            {isFullScreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
                        </button>
                        <div className="h-8 w-px bg-gray-200 mx-2" />
                        <button onClick={handleExportExcel} className="flex items-center gap-2 px-3 py-2 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg border border-green-200 text-sm font-medium transition-colors">
                            <FileDown size={18} /> Excel
                        </button>
                        <button onClick={handleExportPDF} className="flex items-center gap-2 px-3 py-2 bg-red-50 text-red-700 hover:bg-red-100 rounded-lg border border-red-200 text-sm font-medium transition-colors">
                            <Download size={18} /> PDF
                        </button>
                    </div>
                </div>

                <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-50">
                    <div className="flex items-center gap-2 bg-gray-50 p-1 rounded-lg border border-gray-100">
                        <span className="text-xs font-bold text-gray-400 px-2 uppercase">Modo:</span>
                        {(['mensal', 'trimestral', 'semestral'] as const).map(m => (
                            <button key={m} onClick={() => setPeriodMode(m)} className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-all ${periodMode === m ? 'bg-white text-red-600 shadow-sm border border-gray-100' : 'text-gray-500 hover:text-gray-700'}`}>
                                {m}
                            </button>
                        ))}
                    </div>

                    <select value={department} onChange={e => setDepartment(e.target.value)} className="bg-white border border-gray-200 rounded-lg text-sm px-3 py-2 focus:ring-2 focus:ring-red-500 outline-none min-w-[150px]">
                        {isSuperUser && <option value="Total">Total</option>}
                        {departments.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>

                    <select value={selectedBaseOrc} onChange={e => setSelectedBaseOrc(e.target.value)} className="bg-white border border-gray-200 rounded-lg text-sm px-3 py-2 focus:ring-2 focus:ring-red-500 outline-none">
                        <option value="">Selecione Orçado</option>
                        {basesOrcado.map(b => <option key={b.id} value={b.id}>Orç: {b.version_name}</option>)}
                    </select>

                    <select value={selectedBaseReal} onChange={e => setSelectedBaseReal(e.target.value)} className="bg-white border border-gray-200 rounded-lg text-sm px-3 py-2 focus:ring-2 focus:ring-red-500 outline-none">
                        <option value="">Selecione Realizado</option>
                        {basesRealizado.map(b => <option key={b.id} value={b.id}>Real: {b.version_name}</option>)}
                    </select>

                    <button onClick={loadReport} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-bold hover:bg-red-700 transition-all active:scale-95 shadow-sm">
                        Atualizar
                    </button>
                </div>
            </div>


            <div className="bg-white shadow rounded-lg overflow-hidden border border-gray-100">
                <MobileLandscapeHint />
                <div className="overflow-x-auto max-h-[70vh]">
                    <table className="border-collapse bg-white min-w-full">
                        <thead className="sticky top-0 z-30 bg-white">
                            <tr className="bg-red-50 border-b border-red-100 text-[9px] font-bold text-red-700 uppercase tracking-wider">
                                <th className="px-2 py-2 text-left sticky left-0 bg-red-50 z-20 border-r border-red-100 min-w-[280px]">Conta / Grupo</th>
                                {comps.map(c => (
                                    <th key={c} colSpan={2} className="px-2 py-2 text-center border-l border-red-100 bg-red-600 text-white">{c}</th>
                                ))}
                            </tr>
                            <tr className="bg-red-50 border-b border-red-100 text-[9px] font-bold text-red-700 uppercase">
                                <th className="px-2 py-2 sticky left-0 bg-red-50 z-20 border-r border-red-100"></th>
                                {comps.map(c => (
                                    <React.Fragment key={c}>
                                        <th className="px-2 py-2 text-right border-l border-red-100">Orçado</th>
                                        <th className="px-2 py-2 text-right">Realizado</th>
                                    </React.Fragment>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 text-[10px]">
                            {loading && data.length > 0 ? (
                                <tr>
                                    <td colSpan={1 + comps.length * 2} className="py-20 text-center">
                                        <div className="flex flex-col items-center gap-3">
                                            <Loader2 size={32} className="animate-spin text-red-600" />
                                            <p className="text-gray-500 font-medium">Recarregando dados...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : data.length === 0 && !loading ? (
                                <tr>
                                    <td colSpan={1 + comps.length * 2} className="py-20 text-center text-gray-400">
                                        <div className="flex flex-col items-center gap-2">
                                            <Search size={32} className="opacity-20" />
                                            <p className="font-medium text-lg text-gray-300">Nenhum dado encontrado</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : groups.map(gName => {
                                const grp = structure.get(gName);
                                const accounts = Array.from(grp.accounts.values());

                                return (
                                    <React.Fragment key={gName}>
                                        <tr
                                            className="bg-red-50/50 font-bold text-red-800 uppercase text-[9px] tracking-wider border-l-4 border-red-400 cursor-pointer hover:bg-red-100/50 transition-colors"
                                            onClick={() => toggleGroup(gName)}
                                        >
                                            <td className="px-3 py-1.5 sticky left-0 bg-inherit z-10 border-r border-red-100">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] text-red-400">
                                                        {expandedGroups.has(gName) ? '▼' : '▶'}
                                                    </span>
                                                    {gName}
                                                </div>
                                            </td>
                                            {comps.map(c => {
                                                const t = grp.totals[c] || { orc: 0, real: 0 };
                                                return (
                                                    <React.Fragment key={c}>
                                                        <td
                                                            className="px-2 py-1.5 border-l border-red-100 bg-inherit text-right whitespace-nowrap cursor-pointer hover:bg-red-100 transition-colors"
                                                            onDoubleClick={() => fetchDrillDown(gName, c, 'orcado')}
                                                            title="Duplo clique para detalhar orçado"
                                                        >
                                                            {fmt(t.orc)}
                                                        </td>
                                                        <td
                                                            className="px-2 py-1.5 bg-inherit text-right whitespace-nowrap cursor-pointer hover:bg-red-100 transition-colors"
                                                            onDoubleClick={() => fetchDrillDown(gName, c, 'realizado')}
                                                            title="Duplo clique para detalhar realizado"
                                                        >
                                                            {fmt(t.real)}
                                                        </td>
                                                    </React.Fragment>
                                                );
                                            })}
                                        </tr>
                                        {expandedGroups.has(gName) && accounts.map((acc: any) => (
                                            <tr key={acc.code} className="hover:bg-opacity-90 hover:bg-blue-50/20 transition-colors group">
                                                <td className="py-1 pl-4 sticky left-0 bg-inherit border-r border-gray-100 min-w-[280px] max-w-[300px] z-10 bg-white" title={acc.desc}>
                                                    <div className="flex items-center gap-2">
                                                        <span className="font-mono text-[9px] text-gray-400 shrink-0 w-24">{acc.code}</span>
                                                        <span className="truncate">{acc.desc}</span>
                                                    </div>
                                                </td>
                                                {comps.map(c => {
                                                    const v = acc.values[c] || { orc: 0, real: 0 };
                                                    return (
                                                        <React.Fragment key={c}>
                                                            <td
                                                                className="px-2 py-1 text-right border-l border-red-100 whitespace-nowrap text-gray-600 hover:bg-red-50 transition-colors cursor-pointer"
                                                                onDoubleClick={() => fetchDrillDown(acc.desc, c, 'orcado')}
                                                                title="Duplo clique para detalhar orçado"
                                                            >
                                                                {fmt(v.orc)}
                                                            </td>
                                                            <td
                                                                className="px-2 py-1 text-right font-medium whitespace-nowrap hover:bg-red-50 transition-colors cursor-pointer"
                                                                onDoubleClick={() => fetchDrillDown(acc.desc, c, 'realizado')}
                                                                title="Duplo clique para detalhar realizado"
                                                            >
                                                                {fmt(v.real)}
                                                            </td>
                                                        </React.Fragment>
                                                    )
                                                })}
                                            </tr>
                                        ))}
                                    </React.Fragment>
                                );
                            })}
                        </tbody>
                        <tfoot className="sticky bottom-0 z-30 bg-white shadow-[0_-2px_4px_rgba(0,0,0,0.05)] border-t-2 border-gray-200">
                            <tr className="bg-gray-50/95 font-bold text-gray-800 uppercase text-[9px] tracking-wider">
                                <td className="px-3 py-3 sticky left-0 bg-inherit z-10 border-r border-gray-200">TOTAL GERAL</td>
                                {comps.map(c => {
                                    let totalOrc = 0;
                                    let totalReal = 0;
                                    groups.forEach(gName => {
                                        const t = structure.get(gName)?.totals[c];
                                        if (t) {
                                            totalOrc += t.orc || 0;
                                            totalReal += t.real || 0;
                                        }
                                    });
                                    return (
                                        <React.Fragment key={c}>
                                            <td className="px-2 py-3 border-l border-gray-200 bg-inherit text-right text-red-700">{fmt(totalOrc)}</td>
                                            <td className="px-2 py-3 bg-inherit text-right text-red-700">{fmt(totalReal)}</td>
                                        </React.Fragment>
                                    );
                                })}
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>

            {/* Drill-down Modal */}
            {drillDownOpen && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden">
                        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-white sticky top-0 z-10">
                            <div className="flex items-center gap-3">
                                <div className="p-2 bg-red-50 rounded-lg">
                                    <Search className="text-red-600" size={20} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-gray-800 flex items-center gap-2">
                                        Detalhamento: <span className="text-red-600">{drillDownParams.rowLabel}</span>
                                    </h3>
                                    <p className="text-xs text-gray-500 uppercase font-semibold tracking-wider">
                                        Período: <span className="text-gray-700">{drillDownParams.month}</span> | Base: <span className="text-gray-700 capitalize">{drillDownParams.source}</span>
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={exportDrillDownToPDF}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-red-100"
                                >
                                    <FileDown size={14} /> PDF
                                </button>
                                <button
                                    onClick={() => setDrillDownOpen(false)}
                                    className="p-2 hover:bg-gray-100 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>

                        {/* Search / Filters Bar */}
                        <div className="px-4 py-3 bg-gray-50 border-b border-gray-100 flex flex-wrap gap-3 items-end">
                            <div className="flex-1 min-w-[200px]">
                                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1 flex items-center gap-1">
                                    <Filter size={10} /> Descrição / Lançamento
                                </label>
                                <input
                                    type="text"
                                    placeholder="Buscar por descrição..."
                                    value={ddFilters.desc}
                                    onChange={e => setDdFilters({ ...ddFilters, desc: e.target.value })}
                                    className="w-full bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-red-500 outline-none"
                                />
                            </div>
                            <div className="w-40">
                                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Área / Depto</label>
                                <select
                                    value={ddFilters.dept}
                                    onChange={e => setDdFilters({ ...ddFilters, dept: e.target.value })}
                                    className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-red-500 outline-none"
                                >
                                    <option value="">TODOS</option>
                                    {uniqueDepts.map(d => <option key={d} value={d}>{d}</option>)}
                                </select>
                            </div>
                            <div className="w-48">
                                <label className="block text-[10px] font-bold text-gray-400 uppercase mb-1">Conta Contábil</label>
                                <select
                                    value={ddFilters.account}
                                    onChange={e => setDdFilters({ ...ddFilters, account: e.target.value })}
                                    className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-sm focus:ring-2 focus:ring-red-500 outline-none"
                                >
                                    <option value="">TODAS AS CONTAS</option>
                                    {uniqueAccounts.map(a => <option key={a} value={a}>{a}</option>)}
                                </select>
                            </div>
                        </div>

                        <div className="flex-1 overflow-auto p-4">
                            {drillDownLoading ? (
                                <div className="flex flex-col items-center justify-center py-20 gap-4">
                                    <Loader2 className="w-12 h-12 text-red-600 animate-spin" />
                                    <p className="text-gray-500 font-medium italic">Consultando lançamentos no banco de dados...</p>
                                </div>
                            ) : filteredDrillDownData.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-20 gap-2 opacity-30">
                                    <Search size={48} className="text-gray-400" />
                                    <p className="text-lg font-medium text-gray-500 italic">Nenhum lançamento encontrado para os filtros.</p>
                                </div>
                            ) : (
                                <div className="overflow-hidden border border-gray-200 rounded-lg">
                                    <table className="w-full border-collapse">
                                        <thead className="sticky top-0 z-10">
                                            <tr className="bg-gray-50 border-b border-gray-200 text-[11px] font-bold text-gray-500 uppercase tracking-wider">
                                                <th className="px-4 py-3 text-left w-24">Conta</th>
                                                <th className="px-4 py-3 text-left">Descrição / Razão Social</th>
                                                <th className="px-4 py-3 text-left w-32">Departamento</th>
                                                <th className="px-4 py-3 text-right w-32">Valor</th>
                                                <th className="px-4 py-3 text-center w-32">Justificativa</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-gray-100 text-xs">
                                            {(() => {
                                                const grandTotal = filteredDrillDownData.reduce((acc, curr) => acc + (curr.valor || 0), 0);

                                                // Group by department
                                                const groups: { [key: string]: any[] } = {};
                                                filteredDrillDownData.forEach(item => {
                                                    const dep = item.departamento || 'Sem Departamento';
                                                    if (!groups[dep]) groups[dep] = [];
                                                    groups[dep].push(item);
                                                });

                                                return Object.entries(groups).map(([dep, items]) => {
                                                    const depTotal = items.reduce((s, i) => s + (i.valor || 0), 0);
                                                    const depPct = grandTotal !== 0 ? (depTotal / grandTotal) * 100 : 0;

                                                    return (
                                                        <React.Fragment key={dep}>
                                                            {/* Department Header Row */}
                                                            <tr className="bg-gray-50/80 border-y border-gray-100">
                                                                <td colSpan={6} className="px-4 py-2 font-bold text-gray-600 uppercase text-[10px] tracking-wide bg-blue-50/50">
                                                                    Área / Departamento: {dep}
                                                                </td>
                                                            </tr>

                                                            {/* Items in Department */}
                                                            {items.map((item, idx) => {
                                                                const itemPct = grandTotal !== 0 ? (item.valor / grandTotal) * 100 : 0;
                                                                return (
                                                                    <tr key={`${dep}-${idx}`} className="hover:bg-red-50/20 transition-colors border-b border-gray-50">
                                                                        <td className="px-4 py-2 font-mono text-red-600 pl-8">{item.conta_contabil}</td>
                                                                        <td className="px-4 py-2 font-medium text-gray-700">
                                                                            <div>
                                                                                {item.descricao_conta}
                                                                                {item.grupo && <div className="text-[10px] text-gray-400 italic">{item.grupo}</div>}
                                                                            </div>
                                                                        </td>
                                                                        <td className="px-4 py-2 text-gray-500 font-semibold">{item.departamento}</td>
                                                                        <td className="px-4 py-2 text-right">
                                                                            <div className="font-bold text-gray-900">{fmt(item.valor)}</div>
                                                                            <div className="text-[9px] text-gray-400">{itemPct.toFixed(1)}%</div>
                                                                        </td>
                                                                        <td className="px-4 py-2 text-center">
                                                                            {item.justificativa ? (
                                                                                <div className="flex flex-col items-center gap-1 group relative">
                                                                                    <button
                                                                                        onClick={() => { setJustifyData(item); setJustText(item.justificativa); setIsJustifyModalOpen(true); }}
                                                                                        className="px-3 py-1 bg-blue-100 text-blue-700 rounded-md text-[10px] font-bold border border-blue-200 hover:bg-blue-200 transition-all flex items-center gap-1.5 shadow-sm min-w-[90px]"
                                                                                        title="Ver/Editar Justificativa"
                                                                                    >
                                                                                        <MessageSquare size={12} fill="#3b82f6" />
                                                                                        Ver/Editar
                                                                                    </button>
                                                                                    <span className="text-[9px] text-blue-600 font-medium truncate max-w-[120px] block mt-1" title={item.justificativa}>
                                                                                        {item.justificativa}
                                                                                    </span>
                                                                                </div>
                                                                            ) : (
                                                                                <button
                                                                                    onClick={() => { setJustifyData(item); setJustText(''); setIsJustifyModalOpen(true); }}
                                                                                    className="px-3 py-1 bg-blue-600 text-white rounded-md text-[10px] font-bold border border-blue-700 hover:bg-blue-700 hover:shadow-md transition-all flex items-center gap-1.5 shadow-sm min-w-[90px]"
                                                                                    title="Adicionar Justificativa"
                                                                                >
                                                                                    <MessageSquare size={12} />
                                                                                    Justificar
                                                                                </button>
                                                                            )}
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}

                                                            {/* Department Subtotal Row */}
                                                            <tr className="bg-blue-50/30 font-semibold border-b border-gray-100 italic">
                                                                <td colSpan={3} className="px-4 py-2 text-right text-blue-700 text-[10px] uppercase">Subtotal {dep}:</td>
                                                                <td className="px-4 py-2 text-right">
                                                                    <div className="text-blue-800 font-bold">{fmt(depTotal)}</div>
                                                                    <div className="text-[9px] text-blue-600 font-bold">{depPct.toFixed(1)}% de part.</div>
                                                                </td>
                                                                <td></td>
                                                            </tr>
                                                        </React.Fragment>
                                                    );
                                                });
                                            })()}
                                        </tbody>
                                        <tfoot className="sticky bottom-0 bg-white border-t-2 border-gray-100">
                                            <tr className="bg-gray-100/90 font-bold text-gray-800">
                                                <td colSpan={3} className="px-4 py-3 text-right text-[11px] uppercase tracking-wider text-gray-500">Total do Detalhamento:</td>
                                                <td className="px-4 py-3 text-right text-sm text-red-700">
                                                    {fmt(filteredDrillDownData.reduce((acc, curr) => acc + (curr.valor || 0), 0))}
                                                </td>
                                                <td className="px-4 py-3 text-center text-xs text-gray-400">100.0%</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            )}
                        </div>

                        <div className="p-4 border-t border-gray-50 flex justify-end">
                            <button
                                onClick={() => setDrillDownOpen(false)}
                                className="px-6 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg text-sm font-bold transition-all active:scale-95"
                            >
                                Fechar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Justify Modal (Same as RelatorioOrcado) */}
            {isJustifyModalOpen && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-100">
                        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                            <h4 className="font-bold text-gray-800 flex items-center gap-2">
                                <MessageSquare size={18} className="text-blue-500" />
                                Justificar Valor
                            </h4>
                            <button onClick={() => setIsJustifyModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-6">
                            <div className="mb-4 bg-blue-50 p-3 rounded-lg border border-blue-100 space-y-1">
                                <p className="text-[10px] uppercase font-bold text-blue-400">Contexto do Item</p>
                                <p className="text-xs font-semibold text-blue-900">{justifyData?.descricao_conta || '-'}</p>
                                <div className="flex justify-between text-[10px] text-blue-700">
                                    <span>Conta: {justifyData?.conta_contabil}</span>
                                    <span>Dept: {justifyData?.departamento || 'N/A'}</span>
                                    <span>Valor: {fmt(justifyData?.valor)}</span>
                                </div>
                            </div>

                            <label className="block text-xs font-bold text-gray-500 mb-2 uppercase">Sua Justificativa</label>
                            <textarea
                                className="w-full h-32 p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                                placeholder="Explique o motivo deste valor..."
                                value={justText}
                                onChange={(e) => setJustText(e.target.value)}
                            />
                        </div>
                        <div className="px-6 py-4 border-t border-gray-100 bg-gray-50 flex justify-end gap-3">
                            <button
                                onClick={() => setIsJustifyModalOpen(false)}
                                className="px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-200 rounded-lg transition-colors"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleSaveJustification}
                                disabled={saveLoading}
                                className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold shadow-lg shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
                            >
                                {saveLoading ? <Loader2 size={16} className="animate-spin" /> : 'Salvar Justificativa'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const fmt = (v: number) => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default RelatorioDRE;
