import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../../app_api';
import * as XLSX from 'xlsx';
import { Maximize2, Minimize2, Download, Eye, EyeOff, BarChart2, Search, Loader2, X, FileDown, Trash2, MessageSquare, Filter, ChevronRight, ChevronDown } from 'lucide-react';
import { toast } from '../ui/Toaster';
import { MobileLandscapeHint } from '../ui/MobileLandscapeHint';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { aplicarLayoutEmpresa } from '../exportUtils';

interface RelatorioOrcadoRealizadoProps {
    user: any;
}

// --- Constants ---
const ALL_MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const QUARTERS: Record<string, string[]> = {
    'Q1 (Jan-Mar)': ['Janeiro', 'Fevereiro', 'Março'],
    'Q2 (Abr-Jun)': ['Abril', 'Maio', 'Junho'],
    'Q3 (Jul-Set)': ['Julho', 'Agosto', 'Setembro'],
    'Q4 (Out-Dez)': ['Outubro', 'Novembro', 'Dezembro'],
};

const SEMESTERS: Record<string, string[]> = {
    'H1 (Jan-Jun)': ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho'],
    'H2 (Jul-Dez)': ['Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'],
};

type PeriodMode = 'mensal' | 'trimestral' | 'semestral';

const RelatorioOrcadoRealizado: React.FC<RelatorioOrcadoRealizadoProps> = ({ user }) => {
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [showCompleto, setShowCompleto] = useState(false);
    const [periodMode, setPeriodMode] = useState<PeriodMode>('mensal');
    const [expandedPeriods, setExpandedPeriods] = useState<Set<string>>(new Set());
    const [excludedRowIds, setExcludedRowIds] = useState<Set<string>>(new Set());
    const [basesOrc, setBasesOrc] = useState<any[]>([]);
    const [basesReal, setBasesReal] = useState<any[]>([]);
    const [selectedBaseOrc, setSelectedBaseOrc] = useState('');
    const [selectedBaseReal, setSelectedBaseReal] = useState('');
    const [department, setDepartment] = useState('Total');
    const [departments, setDepartments] = useState<string[]>([]);

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

    const [activeBaseOrc, setActiveBaseOrc] = useState('');
    const [activeBaseReal, setActiveBaseReal] = useState('');

    // --- Drill-down State ---
    const [drillDownOpen, setDrillDownOpen] = useState(false);
    const [drillDownData, setDrillDownData] = useState<any[]>([]);
    const [drillDownLoading, setDrillDownLoading] = useState(false);
    const [drillDownParams, setDrillDownParams] = useState({ rowLabel: '', month: '' });
    const [ddFilters, setDdFilters] = useState({ dept: '', account: '', desc: '', group: '' });
    const [allJustifications, setAllJustifications] = useState<any[]>([]);

    // --- Justification State ---
    const [isJustifyModalOpen, setIsJustifyModalOpen] = useState(false);
    const [justText, setJustText] = useState('');
    const [justifyData, setJustifyData] = useState<any>(null);
    const [saveLoading, setSaveLoading] = useState(false);

    const toggleRow = (id: string) => {
        const next = new Set(expandedRows);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setExpandedRows(next);
    };

    const togglePeriod = (label: string) => {
        const next = new Set(expandedPeriods);
        if (next.has(label)) next.delete(label);
        else next.add(label);
        setExpandedPeriods(next);
    };

    const toggleExcludeRows = (id: string) => {
        const next = new Set(excludedRowIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setExcludedRowIds(next);
    };

    useEffect(() => {
        const init = async () => {
            setLoading(true);
            try {
                const [bOrc, bReal, deps, sectors] = await Promise.all([
                    api.getFinanceBases('orcado'),
                    api.getFinanceBases('realizado'),
                    api.getDepartamentos(),
                    api.getStrategicSectors()
                ]);
                setStrategicData(sectors);
                setBasesOrc(bOrc);
                setBasesReal(bReal);
                if (bOrc.length > 0) setSelectedBaseOrc(bOrc[0].id);
                if (bReal.length > 0) setSelectedBaseReal(bReal[0].id);

                const filteredDeps = isAdmin ? deps : deps.filter((d: string) => sectors.allowed_sectors.includes(d));
                setDepartments(filteredDeps);

                // If not admin and Total is selected but not in filtered, select first one
                if (!isAdmin && (department === 'Total' || !filteredDeps.includes(department))) {
                    if (filteredDeps.length > 0) {
                        setDepartment(filteredDeps[0]);
                    }
                }
            } catch (e) { console.error(e); }
            finally { setLoading(false); }
        };
        init();
    }, []);

    useEffect(() => {
        if (selectedBaseOrc) {
            fetchData();
            loadJustifications();
        }
    }, [selectedBaseOrc, selectedBaseReal, department]);

    const loadJustifications = async () => {
        if (!selectedBaseOrc) return;
        try {
            const res = await api.getJustificativas(selectedBaseOrc);
            setAllJustifications(res);
        } catch (e) { console.error(e); }
    };

    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await api.get('/financeiro/report/orcado-realizado', {
                params: {
                    base_id_orcado: selectedBaseOrc,
                    base_id_realizado: selectedBaseReal,
                    departamento: department
                }
            });
            console.log("Report Response:", res.data);
            const reportArray = res.data?.data || [];
            setData(reportArray);
            setActiveBaseOrc(res.data?.base_id_orcado || '');
            setActiveBaseReal(res.data?.base_id_realizado || '');
        } catch (error) {
            console.error('Error fetching conversion report:', error);
            setData([]);
        } finally {
            setLoading(false);
        }
    };

    const fetchDrillDown = async (rowId: string, rowLabel: string, month: string, type: 'orc' | 'real') => {
        setDrillDownLoading(true);
        setDrillDownOpen(true);
        const bid = type === 'orc' ? activeBaseOrc : activeBaseReal;
        setDrillDownParams({ rowLabel, month: `${month} (${type === 'orc' ? 'Orçado' : 'Realizado'})` });
        setDdFilters({ dept: '', account: '', desc: '', group: '' });
        try {
            const res = await api.get('/financeiro/drilldown', {
                params: {
                    row_id: rowId,
                    month,
                    departamento: department === 'Total' ? undefined : department,
                    base_id: bid
                }
            });
            setDrillDownData(res.data);
        } catch (error) {
            console.error('Error in drilldown:', error);
            setDrillDownData([]);
        } finally {
            setDrillDownLoading(false);
        }
    };

    // --- Justification & Analytics ---
    const handleSaveJustification = async () => {
        if (!justifyData) return;
        setSaveLoading(true);
        // O Relatório Orçado x Realizado busca justificativas baseadas na base Orçada.
        try {
            await api.saveJustificativa({
                base_id: activeBaseOrc,
                competencia: drillDownParams.month.split(' ')[0], // Remover " (Orçado)" extra string
                conta_contabil: justifyData.conta_contabil,
                departamento: justifyData.departamento,
                grupo: justifyData.grupo,
                justificativa: justText,
                created_by: user?.id
            });
            setIsJustifyModalOpen(false);
            setJustText('');
            setJustifyData(null);

            const updated = drillDownData.map(d =>
                (d.conta_contabil === justifyData.conta_contabil && d.departamento === justifyData.departamento)
                    ? { ...d, justificativa: justText }
                    : d
            );
            setDrillDownData(updated);
            loadJustifications();
        } catch (e) {
            toast.error("Erro ao salvar justificativa");
        } finally {
            setSaveLoading(false);
        }
    };

    const uniqueDepts = useMemo(() => Array.from(new Set(drillDownData.map(i => i.departamento).filter(Boolean))).sort() as string[], [drillDownData]);
    const uniqueAccounts = useMemo(() => Array.from(new Set(drillDownData.map(i => i.conta_contabil).filter(Boolean))).sort() as string[], [drillDownData]);
    const uniqueGroups = useMemo(() => Array.from(new Set(drillDownData.map(i => i.grupo).filter(Boolean))).sort() as string[], [drillDownData]);

    const filteredDrillDownData = useMemo(() => {
        return drillDownData.filter(item => {
            const mDept = !ddFilters.dept || (item.departamento || '') === ddFilters.dept;
            const mAccount = !ddFilters.account || (item.conta_contabil || '') === ddFilters.account;
            const mDesc = !ddFilters.desc || (item.descricao_conta || '').toLowerCase().includes(ddFilters.desc.toLowerCase());
            const mGroup = !ddFilters.group || (item.grupo || '') === ddFilters.group;
            return mDept && mAccount && mDesc && mGroup;
        });
    }, [drillDownData, ddFilters]);

    // --- Helpers ---
    const fmt = (val: any) => {
        if (typeof val !== 'number') return val ?? '-';
        if (Math.abs(val) < 0.01) return 'R$ 0,00';
        return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };
    const fmtPct = (val: any) => {
        if (typeof val !== 'number') return '-';
        return val.toFixed(1) + '%';
    };

    const dataMonths = useMemo(() => {
        if (!data || data.length === 0) return [];
        // Guard against data[0] being undefined or null
        const firstRow = data[0];
        if (!firstRow) return [];
        return ALL_MONTHS.filter(m => `${m}_orc` in firstRow);
    }, [data]);

    const periodGroups = useMemo(() => {
        if (periodMode === 'trimestral') return Object.entries(QUARTERS).map(([l, ms]) => ({ label: l, months: ms }));
        if (periodMode === 'semestral') return Object.entries(SEMESTERS).map(([l, ms]) => ({ label: l, months: ms }));
        return ALL_MONTHS.map(m => ({ label: m, months: [m] }));
    }, [periodMode]);

    const columnGroups = useMemo(() => {
        const baseCols: { key: string; label: string; months: string[]; isGroup: boolean }[] = [];
        if (periodMode === 'mensal') {
            dataMonths.forEach(m => baseCols.push({ key: m, label: m, months: [m], isGroup: false }));
        } else {
            periodGroups.forEach(grp => {
                const grpMonths = grp.months.filter(m => dataMonths.includes(m));
                if (grpMonths.length === 0) return;
                const isExpanded = expandedPeriods.has(grp.label);
                baseCols.push({ key: grp.label, label: grp.label, months: grpMonths, isGroup: true });
                if (isExpanded) {
                    grpMonths.forEach(m => baseCols.push({ key: m, label: m, months: [m], isGroup: false }));
                }
            });
        }
        return baseCols;
    }, [periodMode, periodGroups, dataMonths, expandedPeriods]);

    const totalColSpan = (columnGroups.length * 2) + 2 + 1; // Months*2 + AccCol + TotalCols-ish

    const effectiveData = useMemo(() => {
        if (data.length === 0) return [];
        let effective = JSON.parse(JSON.stringify(data));

        const getRow = (id: string) => effective.find((r: any) => r.id === id);

        // 1. Recursive Zeroring
        // A row is zeroed if it is excluded OR if any of its ancestors are excluded.
        const isExcludedRecursively = (row: any): boolean => {
            if (excludedRowIds.has(row.id)) return true;
            if (row.parent_id) {
                const parent = getRow(row.parent_id);
                if (parent) return isExcludedRecursively(parent);
            }
            return false;
        };

        effective.forEach((row: any) => {
            if (isExcludedRecursively(row)) {
                dataMonths.forEach(m => {
                    row[`${m}_orc`] = 0;
                    row[`${m}_real`] = 0;
                    row[`${m}_var`] = 0;
                });
                row.Total_orc = 0;
                row.Total_real = 0;
                row.Total_var = 0;
            }
        });

        // 2. Hierarchical Aggregation (Bottom-Up)
        const maxLevel = Math.max(...effective.map((r: any) => r.level || 0));
        for (let l = maxLevel; l >= 0; l--) {
            effective.forEach((parent: any) => {
                if ((parent.level || 0) !== l || parent.type === 'percentage') return;

                const children = effective.filter((c: any) => c.parent_id === parent.id);
                if (children.length > 0) {
                    dataMonths.forEach(m => {
                        parent[`${m}_orc`] = children.reduce((s, c) => s + (c[`${m}_orc`] || 0), 0);
                        parent[`${m}_real`] = children.reduce((s, c) => s + (c[`${m}_real`] || 0), 0);
                    });
                }
            });
        }

        // 3. DRE Formulas (Mandatory Overrides)
        dataMonths.forEach(m => {
            const rb = getRow('receita_bruta');
            const ded = getRow('deducoes');
            const rl = getRow('receita_liquida');
            const cpv = getRow('cpv');
            const resB = getRow('resultado_bruto');
            const comTotal = getRow('despesas_comerciais_total');
            const admTotal = getRow('despesas_administrativas');
            const resO = getRow('resultado_operacional');
            const mc = getRow('margem_contribuicao');
            const pess_cpv = getRow('pessoal_cpv');

            if (rl && rb && ded) rl[`${m}_orc`] = (rb[`${m}_orc`] || 0) + (ded[`${m}_orc`] || 0);
            if (rl && rb && ded) rl[`${m}_real`] = (rb[`${m}_real`] || 0) + (ded[`${m}_real`] || 0);

            if (resB && rl && cpv) resB[`${m}_orc`] = (rl[`${m}_orc`] || 0) + (cpv[`${m}_orc`] || 0);
            if (resB && rl && cpv) resB[`${m}_real`] = (rl[`${m}_real`] || 0) + (cpv[`${m}_real`] || 0);

            if (resO && resB && comTotal && admTotal) {
                resO[`${m}_orc`] = (resB[`${m}_orc`] || 0) + (comTotal[`${m}_orc`] || 0) + (admTotal[`${m}_orc`] || 0);
                resO[`${m}_real`] = (resB[`${m}_real`] || 0) + (comTotal[`${m}_real`] || 0) + (admTotal[`${m}_real`] || 0);
            }

            if (mc && resB && comTotal && pess_cpv) {
                mc[`${m}_orc`] = (resB[`${m}_orc`] || 0) + (comTotal[`${m}_orc`] || 0) - (pess_cpv[`${m}_orc`] || 0);
                mc[`${m}_real`] = (resB[`${m}_real`] || 0) + (comTotal[`${m}_real`] || 0) - (pess_cpv[`${m}_real`] || 0);
            }
        });

        // 4. Final Pass: Row Totals and Percentage Recalculation
        effective.forEach((row: any) => {
            dataMonths.forEach(m => {
                row[`${m}_var`] = (row[`${m}_real`] || 0) - (row[`${m}_orc`] || 0);
            });

            if (row.type === 'percentage') {
                let numId = row.formula_ref;
                let denId = row.denom || 'receita_liquida';

                // Hardcoded fallback for known percentage rows in DRE
                if (row.id === 'margem_bruta_pct') { numId = 'resultado_bruto'; denId = 'receita_liquida'; }
                if (row.id === 'margem_contribuicao_pct') { numId = 'margem_contribuicao'; denId = 'receita_liquida'; }
                if (row.id === 'margem_operacional_pct') { numId = 'resultado_operacional'; denId = 'receita_liquida'; }

                const num = getRow(numId);
                const den = getRow(denId);

                if (num && den) {
                    dataMonths.forEach(m => {
                        row[`${m}_orc`] = den[`${m}_orc`] !== 0 ? (num[`${m}_orc`] / den[`${m}_orc`]) * 100 : 0;
                        row[`${m}_real`] = den[`${m}_real`] !== 0 ? (num[`${m}_real`] / den[`${m}_real`]) * 100 : 0;
                    });

                    // Recalculate row totals for percentages
                    row.Total_orc = den.Total_orc !== 0 ? (num.Total_orc / den.Total_orc) * 100 : 0;
                    row.Total_real = den.Total_real !== 0 ? (num.Total_real / den.Total_real) * 100 : 0;
                }
            } else {
                row.Total_orc = dataMonths.reduce((s, m) => s + (row[`${m}_orc`] || 0), 0);
                row.Total_real = dataMonths.reduce((s, m) => s + (row[`${m}_real`] || 0), 0);
            }
            row.Total_var = row.Total_real - row.Total_orc;

            // Group Column Aggregates
            columnGroups.forEach(colGrp => {
                if (row.type === 'percentage') {
                    let numId = row.formula_ref;
                    let denId = row.denom || 'receita_liquida';

                    if (row.id === 'margem_bruta_pct') { numId = 'resultado_bruto'; denId = 'receita_liquida'; }
                    if (row.id === 'margem_contribuicao_pct') { numId = 'margem_contribuicao'; denId = 'receita_liquida'; }
                    if (row.id === 'margem_operacional_pct') { numId = 'resultado_operacional'; denId = 'receita_liquida'; }

                    const num = getRow(numId);
                    const den = getRow(denId);

                    if (num && den) {
                        const nOrc = colGrp.months.reduce((s: number, m: string) => s + (num[`${m}_orc`] || 0), 0);
                        const nReal = colGrp.months.reduce((s: number, m: string) => s + (num[`${m}_real`] || 0), 0);
                        const dOrc = colGrp.months.reduce((s: number, m: string) => s + (den[`${m}_orc`] || 0), 0);
                        const dReal = colGrp.months.reduce((s: number, m: string) => s + (den[`${m}_real`] || 0), 0);
                        row[`_col_${colGrp.key}_orc`] = dOrc !== 0 ? (nOrc / dOrc) * 100 : 0;
                        row[`_col_${colGrp.key}_real`] = dReal !== 0 ? (nReal / dReal) * 100 : 0;
                    }
                } else {
                    row[`_col_${colGrp.key}_orc`] = colGrp.months.reduce((s: number, m: string) => s + (row[`${m}_orc`] || 0), 0);
                    row[`_col_${colGrp.key}_real`] = colGrp.months.reduce((s: number, m: string) => s + (row[`${m}_real`] || 0), 0);
                }
                row[`_col_${colGrp.key}_var`] = (row[`_col_${colGrp.key}_real`] || 0) - (row[`_col_${colGrp.key}_orc`] || 0);
            });
        });

        return effective;
    }, [data, columnGroups, dataMonths, excludedRowIds]);



    const visibleRows = useMemo(() => {
        return effectiveData.filter((row: any) => {
            if (row.parent_id) {
                // Start from immediate parent and check all ancestors
                let curr = row;
                while (curr.parent_id) {
                    // If showCompleto is true, we show all nested rows regardless of manual expansion
                    // Otherwise, we only show if the user explicitly clicked to expand this parent
                    if (!expandedRows.has(curr.parent_id) && !showCompleto) return false;

                    // Move up to the next ancestor
                    curr = effectiveData.find((r: any) => r.id === curr.parent_id);
                    if (!curr) break;
                }
            }
            return true;
        });
    }, [effectiveData, expandedRows, showCompleto]);


    // --- Exports ---
    const exportDrillDownToPDF = async () => {
        if (!drillDownData.length) return;
        const doc = new jsPDF('p', 'mm', 'a4');
        const layout = await aplicarLayoutEmpresa(doc, {
            titulo: 'Detalhamento da DRE (Orçado x Realizado)',
            subtitulo: `${drillDownParams.rowLabel} - ${drillDownParams.month} · Departamento: ${department}`,
            rodapeTexto: 'EMPRESA — Orçado x Realizado (Financeiro)',
        });

        const head = [['Conta', 'Descrição', 'Grupo', 'Valor', '%']];
        const body: any[] = [];
        const grandTotal = filteredDrillDownData.reduce((s, d) => s + (d.valor || 0), 0);

        const groups: { [key: string]: any[] } = {};
        filteredDrillDownData.forEach(item => {
            const dep = item.departamento || 'Sem Departamento';
            if (!groups[dep]) groups[dep] = [];
            groups[dep].push(item);
        });

        Object.entries(groups).forEach(([dep, items]) => {
            const depTotal = items.reduce((s, i) => s + (i.valor || 0), 0);
            const depPct = grandTotal !== 0 ? (depTotal / grandTotal) * 100 : 0;

            body.push([{ content: `Área: ${dep}`, colSpan: 5, styles: { fillColor: [240, 249, 255], fontStyle: 'bold' } }]);

            items.forEach(item => {
                const itemPct = grandTotal !== 0 ? (item.valor / grandTotal) * 100 : 0;
                body.push([
                    item.conta_contabil,
                    item.descricao_conta,
                    item.grupo,
                    fmt(item.valor),
                    itemPct.toFixed(1) + '%'
                ]);
            });

            body.push([
                { content: `Subtotal ${dep}`, colSpan: 3, styles: { halign: 'right', fontStyle: 'bold' } },
                { content: fmt(depTotal), styles: { fontStyle: 'bold', halign: 'right' } },
                { content: depPct.toFixed(1) + '%', styles: { fontStyle: 'bold', halign: 'right' } }
            ]);
        });

        body.push([
            { content: 'TOTAL GERAL', colSpan: 3, styles: { halign: 'right', fillColor: [243, 244, 246], fontStyle: 'bold' } },
            { content: fmt(grandTotal), styles: { fillColor: [243, 244, 246], fontStyle: 'bold', halign: 'right' } },
            { content: '100.0%', styles: { fillColor: [243, 244, 246], fontStyle: 'bold', halign: 'right' } }
        ]);

        autoTable(doc, {
            head: head,
            body: body,
            startY: 35,
            theme: 'grid',
            styles: { fontSize: 7, overflow: 'visible' },
            headStyles: { fillColor: [30, 41, 59], halign: 'center', textColor: 255, fontSize: 8 },
            columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' } }
        });

        layout.finalizar();
        doc.save(`Detalhamento_${drillDownParams.rowLabel}_${drillDownParams.month}.pdf`);
    };

    const handleExportExcel = () => {
        const sheetData = effectiveData.map((r: any) => {
            const obj: any = { 'Conta': r.conta_contabil || '', 'Descrição': r.descricao_conta };
            dataMonths.forEach(m => {
                obj[`${m} Orç`] = r[`${m}_orc`];
                obj[`${m} Real`] = r[`${m}_real`];
            });
            obj['Total Orç'] = r.Total_orc;
            obj['Total Real'] = r.Total_real;
            return obj;
        });
        const ws = XLSX.utils.json_to_sheet(sheetData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Report");
        XLSX.writeFile(wb, `Orcado_x_Realizado_${department}.xlsx`);
    };

    const handleExportPDF = async () => {
        const doc = new jsPDF('l', 'mm', 'a3');
        const layout = await aplicarLayoutEmpresa(doc, {
            titulo: 'Relatório Orçado x Realizado',
            subtitulo: `Departamento: ${department}`,
            rodapeTexto: 'EMPRESA — Orçado x Realizado (Financeiro)',
        });
        const headers = [['Conta', 'Descrição']];
        columnGroups.forEach(g => {
            headers[0].push(`${g.label} Orç`, `${g.label} Real`);
        });
        headers[0].push('Total Orç', 'Total Real');

        const body = visibleRows.map((r: any) => {
            const row = [r.conta_contabil || '', r.descricao_conta];
            columnGroups.forEach(g => {
                row.push(fmt(r[`_col_${g.key}_orc`]), fmt(r[`_col_${g.key}_real`]));
            });
            row.push(fmt(r.Total_orc), fmt(r.Total_real));
            return row;
        });

        autoTable(doc, {
            head: headers,
            body: body,
            startY: 35,
            styles: { fontSize: 7 },
            headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 8 },
            didParseCell: (dataCell) => {
                const rowIndex = dataCell.row.index;
                const rowObj = visibleRows[rowIndex];
                if (rowObj?.style?.bg) {
                    const hex = rowObj.style.bg.replace('#', '');
                    const r = parseInt(hex.substring(0, 2), 16);
                    const g = parseInt(hex.substring(2, 4), 16);
                    const b = parseInt(hex.substring(4, 6), 16);
                    dataCell.cell.styles.fillColor = [r, g, b];
                    if (rowObj.style.color === 'white') dataCell.cell.styles.textColor = [255, 255, 255];
                }
            }
        });
        layout.finalizar();
        doc.save(`Orcado_x_Realizado_${department}.pdf`);
    };

    if (loading && data.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-64 space-y-4">
                <Loader2 className="w-12 h-12 text-red-600 animate-spin" />
                <p className="text-gray-500 font-medium">Carregando comparativo...</p>
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
                            Orçado x Realizado
                        </h2>
                        <p className="text-sm text-gray-500">Comparativo detalhado de desempenho financeiro</p>
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
                        {(['mensal', 'trimestral', 'semestral'] as PeriodMode[]).map(m => (
                            <button key={m} onClick={() => setPeriodMode(m)} className={`px-3 py-1.5 rounded-md text-xs font-semibold capitalize transition-all ${periodMode === m ? 'bg-white text-red-600 shadow-sm border border-gray-100' : 'text-gray-500 hover:text-gray-700'}`}>
                                {m}
                            </button>
                        ))}
                    </div>

                    <select value={department} onChange={e => setDepartment(e.target.value)} className="bg-white border border-gray-200 rounded-lg text-sm px-3 py-2 focus:ring-2 focus:ring-red-500 outline-none min-w-[150px]">
                        {isSuperUser && <option value="Total">Todos Departamentos</option>}
                        {departments.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>

                    <select value={selectedBaseOrc} onChange={e => setSelectedBaseOrc(e.target.value)} className="bg-white border border-gray-200 rounded-lg text-sm px-3 py-2 focus:ring-2 focus:ring-red-500 outline-none">
                        {basesOrc.map(b => <option key={b.id} value={b.id}>Orç: {b.version_name}</option>)}
                    </select>

                    <select value={selectedBaseReal} onChange={e => setSelectedBaseReal(e.target.value)} className="bg-white border border-gray-200 rounded-lg text-sm px-3 py-2 focus:ring-2 focus:ring-red-500 outline-none">
                        <option value="">Real: Automático (Mais recente)</option>
                        {basesReal.map(b => <option key={b.id} value={b.id}>Real: {b.version_name}</option>)}
                    </select>

                    <button onClick={() => setShowCompleto(!showCompleto)} className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${showCompleto ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                        {showCompleto ? 'Visão Simplificada' : 'Visão Completa'}
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <MobileLandscapeHint />
                <div className="overflow-x-auto max-h-[70vh]">
                    <table className="w-full border-collapse min-w-full">
                        <thead className="sticky top-0 z-30 bg-white">
                            <tr className="bg-gray-50 border-b border-gray-100 text-[9px] font-bold text-gray-400 uppercase">
                                <th className="px-2 py-2 text-left sticky left-0 bg-gray-50 z-40 min-w-[280px]"></th>
                                {columnGroups.map(g => (
                                    <th key={g.key} colSpan={2} className="px-2 py-2 text-center border-l border-gray-100">
                                        <div className="flex items-center justify-center gap-2">
                                            {g.label}
                                            {g.isGroup && (
                                                <button onClick={() => togglePeriod(g.label)} className="p-1 hover:bg-gray-200 rounded transition-colors">
                                                    {expandedPeriods.has(g.label) ? <Minimize2 size={10} /> : <Maximize2 size={10} />}
                                                </button>
                                            )}
                                        </div>
                                    </th>
                                ))}
                                <th colSpan={2} className="px-2 py-2 text-center text-red-600 bg-red-50 border-l border-red-100">Acumulado Ano</th>
                            </tr>
                            <tr className="bg-gray-50/50 border-b border-gray-100 text-[9px] font-bold text-gray-400 uppercase">
                                <th className="px-2 py-2 text-left sticky left-0 bg-gray-50 z-40">Estrutura / Contas</th>
                                {columnGroups.map(g => (
                                    <React.Fragment key={g.key}>
                                        <th className="px-2 py-2 text-right border-l border-gray-100">Orçado</th>
                                        <th className="px-2 py-2 text-right">Realizado</th>
                                    </React.Fragment>
                                ))}
                                <th className="px-2 py-2 text-right border-l border-red-100 bg-red-50">Orçado</th>
                                <th className="px-2 py-2 text-right bg-red-50">Realizado</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-50 text-[10px]">
                            {loading ? (
                                <tr>
                                    <td colSpan={totalColSpan} className="py-20 text-center">
                                        <div className="flex flex-col items-center gap-3">
                                            <Loader2 size={32} className="animate-spin text-red-600" />
                                            <p className="text-gray-500 font-medium">Carregando dados do relatório...</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : visibleRows.length === 0 ? (
                                <tr>
                                    <td colSpan={totalColSpan} className="py-20 text-center text-gray-400">
                                        <div className="flex flex-col items-center gap-2">
                                            <Search size={32} className="opacity-20" />
                                            <p className="font-medium text-lg text-gray-300">Nenhum dado encontrado</p>
                                            <p className="text-sm">Tente ajustar os filtros ou selecionar outra base</p>
                                        </div>
                                    </td>
                                </tr>
                            ) : visibleRows.map((row: any) => (
                                <tr key={row.id} className={`group hover:bg-blue-50/30 transition-colors ${row.type === 'total' ? 'font-bold' : ''}`} style={{ backgroundColor: row.style?.bg || '' }}>
                                    <td className="px-2 py-1 sticky left-0 z-20 shadow-[2px_0_5px_rgba(0,0,0,0.02)] border-r border-gray-100 max-w-[280px]" style={{ backgroundColor: row.style?.bg || 'white', color: row.style?.color || '', paddingLeft: row.level ? row.level * 20 : 10 }}>
                                        <div className={`flex items-center gap-1 ${excludedRowIds.has(row.id) ? 'opacity-40 line-through' : ''}`}>
                                            {/* Expand/Collapse Icon */}
                                            {effectiveData.some((c: any) => c.parent_id === row.id) && (
                                                <button onClick={() => toggleRow(row.id)} className="p-0.5 hover:bg-black/10 rounded text-[9px] shrink-0 text-gray-400">
                                                    {expandedRows.has(row.id) ? '▼' : '▶'}
                                                </button>
                                            )}

                                            {/* Visibility Toggle Icon */}
                                            <button
                                                onClick={() => toggleExcludeRows(row.id)}
                                                title={excludedRowIds.has(row.id) ? "Mostrar linha" : "Ocultar linha"}
                                                className={`flex-shrink-0 p-0.5 rounded ${excludedRowIds.has(row.id) ? 'text-red-400' : 'text-gray-400 hover:text-blue-600'}`}
                                            >
                                                {excludedRowIds.has(row.id) ? <EyeOff size={11} /> : <Eye size={11} />}
                                            </button>

                                            <span className={`truncate ${row.style?.italic ? 'italic' : ''}`} title={row.descricao_conta}>
                                                {row.descricao_conta}
                                            </span>
                                        </div>
                                    </td>


                                    {columnGroups.map(g => {
                                        const vo = row[`_col_${g.key}_orc`];
                                        const vr = row[`_col_${g.key}_real`];
                                        const vv = row[`_col_${g.key}_var`];
                                        // Variância em tooltip ou cor se necessário, mas colunas pedidas são Orc/Real
                                        const varColor = vv > 0 ? 'text-blue-600' : vv < 0 ? 'text-red-600' : 'text-gray-400';

                                        return (
                                            <React.Fragment key={g.key}>
                                                <td className="px-2 py-1 text-right border-l border-gray-100 whitespace-nowrap" style={{ color: row.style?.color || '' }} onDoubleClick={() => !g.isGroup && fetchDrillDown(row.id, row.descricao_conta, g.key, 'orc')}>
                                                    {row.type === 'percentage' ? fmtPct(vo) : fmt(vo)}
                                                </td>
                                                <td className={`px-2 py-1 text-right whitespace-nowrap ${showCompleto ? varColor : ''}`} style={{ color: (!showCompleto || !varColor) ? (row.style?.color || '') : undefined }} onDoubleClick={() => !g.isGroup && fetchDrillDown(row.id, row.descricao_conta, g.key, 'real')}>
                                                    {row.type === 'percentage' ? fmtPct(vr) : fmt(vr)}
                                                </td>
                                            </React.Fragment>
                                        );
                                    })}

                                    {/* Total columns */}
                                    <td className="px-2 py-1 text-right border-l border-red-100 bg-red-50/30 font-bold whitespace-nowrap" style={{ color: row.style?.color || '' }} onDoubleClick={() => fetchDrillDown(row.id, row.descricao_conta, 'Total', 'orc')}>
                                        {row.type === 'percentage' ? fmtPct(row.Total_orc) : fmt(row.Total_orc)}
                                    </td>
                                    <td className={`px-2 py-1 text-right bg-red-50/30 font-bold whitespace-nowrap ${showCompleto ? ((row.Total_var || 0) >= 0 ? 'text-blue-700' : 'text-red-700') : ''}`} style={{ color: !showCompleto ? (row.style?.color || '') : undefined }} onDoubleClick={() => fetchDrillDown(row.id, row.descricao_conta, 'Total', 'real')}>
                                        {row.type === 'percentage' ? fmtPct(row.Total_real) : fmt(row.Total_real)}
                                    </td>

                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Drill-down Modal */}
            {drillDownOpen && (
                <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-20 bg-black bg-opacity-50 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden border border-gray-100 scale-in-center">
                        {/* Modal Header */}
                        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                            <div>
                                <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                                    <Search size={20} className="text-red-500" />
                                    Detalhamento Orçado x Realizado
                                </h3>
                                <p className="text-sm text-gray-500 mt-1">
                                    {drillDownParams.rowLabel} &bull; <span className="font-semibold text-red-600">{drillDownParams.month}</span>
                                </p>
                            </div>
                            <button
                                onClick={exportDrillDownToPDF}
                                className="p-2 hover:bg-red-50 text-red-600 rounded-full transition-colors flex items-center justify-center"
                                title="Exportar Detalhamento para PDF"
                            >
                                <FileDown size={20} />
                            </button>
                            <button
                                onClick={() => setDrillDownOpen(false)}
                                className="p-2 hover:bg-gray-200 rounded-full transition-colors text-gray-500 hover:text-gray-700"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        {/* Modal Content */}
                        <div className="flex-1 overflow-auto p-6">
                            {/* Filter Bar */}
                            <div className="grid grid-cols-4 gap-4 mb-6 bg-gray-50 p-4 rounded-lg border border-gray-100">
                                <div className="relative">
                                    <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Departamento</label>
                                    <select
                                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-md text-xs focus:ring-1 focus:ring-red-500 outline-none appearance-none"
                                        value={ddFilters.dept}
                                        onChange={(e) => setDdFilters({ ...ddFilters, dept: e.target.value })}
                                    >
                                        <option value="">Todos</option>
                                        {uniqueDepts.map(d => <option key={d} value={d}>{d}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Conta</label>
                                    <select
                                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-md text-xs focus:ring-1 focus:ring-red-500 outline-none appearance-none"
                                        value={ddFilters.account}
                                        onChange={(e) => setDdFilters({ ...ddFilters, account: e.target.value })}
                                    >
                                        <option value="">Todas</option>
                                        {uniqueAccounts.map(a => <option key={a} value={a}>{a}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Grupo</label>
                                    <select
                                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-md text-xs focus:ring-1 focus:ring-red-500 outline-none appearance-none"
                                        value={ddFilters.group}
                                        onChange={(e) => setDdFilters({ ...ddFilters, group: e.target.value })}
                                    >
                                        <option value="">Todos</option>
                                        {uniqueGroups.map(g => <option key={g} value={g}>{g}</option>)}
                                    </select>
                                </div>
                                <div>
                                    <label className="text-[10px] font-bold text-gray-400 uppercase mb-1 block">Descrição</label>
                                    <input
                                        type="text"
                                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-md text-xs focus:ring-1 focus:ring-red-500 outline-none"
                                        placeholder="Filtrar por nome..."
                                        value={ddFilters.desc}
                                        onChange={(e) => setDdFilters({ ...ddFilters, desc: e.target.value })}
                                    />
                                </div>
                            </div>

                            {drillDownLoading ? (
                                <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
                                    <Loader2 className="animate-spin" size={32} />
                                    <p className="text-sm font-medium animate-pulse">Buscando lançamentos no banco...</p>
                                </div>
                            ) : filteredDrillDownData.length === 0 ? (
                                <div className="text-center py-20 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                                    <p className="text-gray-400">Nenhum detalhamento encontrado para este critério.</p>
                                </div>
                            ) : (
                                <div className="overflow-hidden border border-gray-200 rounded-lg">
                                    <table className="w-full text-left border-collapse">
                                        <thead className="bg-gray-50 text-[11px] uppercase tracking-wider text-gray-500 font-bold border-b border-gray-200 sticky top-0 z-10">
                                            <tr>
                                                <th className="px-4 py-3">Conta</th>
                                                <th className="px-4 py-3">Descrição</th>
                                                <th className="px-4 py-3">Departamento</th>
                                                <th className="px-4 py-3 text-right">Valor</th>
                                                {drillDownParams.month.includes('Orçado') && (
                                                    <th className="px-4 py-3 text-center">Justificativa</th>
                                                )}
                                            </tr>
                                        </thead>
                                        <tbody className="text-xs">
                                            {(() => {
                                                const grandTotal = filteredDrillDownData.reduce((s, d) => s + (d.valor || 0), 0);
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
                                                            <tr className="bg-red-50/20 border-y border-gray-100">
                                                                <td colSpan={drillDownParams.month.includes('Orçado') ? 5 : 4} className="px-4 py-2 font-bold text-gray-600 uppercase text-[10px] tracking-wide bg-red-50/30">
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
                                                                        <td className="px-4 py-2 text-gray-500">{item.departamento}</td>
                                                                        <td className="px-4 py-2 text-right">
                                                                            <div className="font-medium text-gray-900">{fmt(item.valor)}</div>
                                                                            <div className="text-[9px] text-gray-400">{itemPct.toFixed(1)}%</div>
                                                                        </td>
                                                                        {drillDownParams.month.includes('Orçado') && (
                                                                            <td className="px-4 py-2 text-center">
                                                                                {item.justificativa ? (
                                                                                    <div className="flex flex-col items-center gap-1 group relative">
                                                                                        <button
                                                                                            onClick={() => { setJustifyData(item); setJustText(item.justificativa); setIsJustifyModalOpen(true); }}
                                                                                            className="px-3 py-1 bg-red-100 text-red-700 rounded-md text-[10px] font-bold border border-red-200 hover:bg-red-200 transition-all flex items-center gap-1.5 shadow-sm min-w-[90px]"
                                                                                            title="Ver/Editar Justificativa"
                                                                                        >
                                                                                            <MessageSquare size={12} fill="#dc2626" />
                                                                                            Ver/Editar
                                                                                        </button>
                                                                                        <span className="text-[9px] text-red-600 font-medium truncate max-w-[120px] block mt-1" title={item.justificativa}>
                                                                                            {item.justificativa}
                                                                                        </span>
                                                                                    </div>
                                                                                ) : (
                                                                                    <button
                                                                                        onClick={() => { setJustifyData(item); setJustText(''); setIsJustifyModalOpen(true); }}
                                                                                        className="px-3 py-1 bg-red-600 text-white rounded-md text-[10px] font-bold border border-red-700 hover:bg-red-700 hover:shadow-md transition-all flex items-center gap-1.5 shadow-sm min-w-[90px]"
                                                                                        title="Adicionar Justificativa"
                                                                                    >
                                                                                        <MessageSquare size={12} />
                                                                                        Justificar
                                                                                    </button>
                                                                                )}
                                                                            </td>
                                                                        )}
                                                                    </tr>
                                                                );
                                                            })}

                                                            {/* Department Subtotal Row */}
                                                            <tr className="bg-red-50/10 font-semibold border-b border-gray-100">
                                                                <td colSpan={3} className="px-4 py-2 text-right text-red-700 text-[10px] uppercase">Subtotal {dep}:</td>
                                                                <td className="px-4 py-2 text-right text-red-800">{fmt(depTotal)}</td>
                                                                {drillDownParams.month.includes('Orçado') && (
                                                                    <td className="px-4 py-2 text-right text-red-600">{depPct.toFixed(1)}%</td>
                                                                )}
                                                            </tr>
                                                        </React.Fragment>
                                                    );
                                                });
                                            })()}
                                        </tbody>
                                        <tfoot className="bg-gray-50 font-bold text-gray-800 border-t-2 border-gray-200">
                                            <tr>
                                                <td colSpan={3} className="px-4 py-3 text-right text-[11px] uppercase tracking-wider">Total do Detalhamento:</td>
                                                <td className="px-4 py-3 text-right text-sm">{fmt(filteredDrillDownData.reduce((s, i) => s + (i.valor || 0), 0))}</td>
                                                {drillDownParams.month.includes('Orçado') && <td className="px-4 py-3"></td>}
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        <div className="px-6 py-4 border-t border-gray-100 flex justify-end bg-gray-50/50">
                            <button
                                onClick={() => setDrillDownOpen(false)}
                                className="px-6 py-2 bg-white border border-gray-300 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 shadow-sm transition-all active:scale-95"
                            >
                                Fechar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* --- Justify Entry Modal (Global to component) --- */}
            {isJustifyModalOpen && (
                <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden border border-gray-100 scale-in-center">
                        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex items-center justify-between">
                            <h4 className="font-bold text-gray-800 flex items-center gap-2">
                                <MessageSquare size={18} className="text-red-500" />
                                Justificar Valor
                            </h4>
                            <button onClick={() => setIsJustifyModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-6">
                            <div className="mb-4 bg-red-50 p-3 rounded-lg border border-red-100 space-y-1">
                                <p className="text-[10px] uppercase font-bold text-red-400">Contexto do Item (Orçado)</p>
                                <p className="text-xs font-semibold text-red-900">{justifyData?.descricao_conta || '-'}</p>
                                <div className="flex justify-between text-[10px] text-red-700">
                                    <span>Conta: {justifyData?.conta_contabil}</span>
                                    <span>Dept: {justifyData?.departamento || 'N/A'}</span>
                                    <span>Valor: {fmt(justifyData?.valor)}</span>
                                </div>
                            </div>

                            <label className="block text-xs font-bold text-gray-500 mb-2 uppercase">Sua Justificativa</label>
                            <textarea
                                className="w-full h-32 p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-red-500 outline-none transition-all"
                                placeholder="Explique o motivo deste valor orçado..."
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
                                className="px-6 py-2 bg-red-600 text-white rounded-lg text-sm font-bold shadow-lg shadow-red-200 hover:bg-red-700 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
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

export default RelatorioOrcadoRealizado;
