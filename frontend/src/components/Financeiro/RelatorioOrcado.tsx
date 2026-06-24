import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../../app_api';
import * as XLSX from 'xlsx';
import { Maximize2, Minimize2, Download, Eye, EyeOff, BarChart2, Search, Loader2, X, FileDown, Trash2, MessageSquare, Filter } from 'lucide-react';
import { toast } from '../ui/Toaster';
import { useConfirm } from '../../contexts/ConfirmContext';
import { MobileLandscapeHint } from '../ui/MobileLandscapeHint';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { aplicarLayoutEmpresa } from '../exportUtils';

interface RelatorioOrcadoProps {
    user: any;
}

// --- Constants ---
const ALL_MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const DRE_STRUCTURE = [
    { id: "receita_bruta", label: "RECEITA BRUTA", type: "total", source_accounts: ["4.1.1.001", "4.2.2.007"] },

    { id: "deducoes", label: "(-) Impostos sobre a vendas", type: "total", source_accounts: ["4.2.2.004", "4.2.2.003", "4.2.2.007", "4.2.2.006", "4.2.2.005"] },
    { id: "ipi_vendas", label: "(-) IPI", type: "data", source_accounts: ["4.2.2.003"], parent_id: "deducoes", level: 1 },
    { id: "icms_vendas", label: "(-) ICMS", type: "data", source_accounts: ["4.2.2.004"], parent_id: "deducoes", level: 1 },
    { id: "pis_vendas", label: "(-) PIS", type: "data", source_accounts: ["4.2.2.006"], parent_id: "deducoes", level: 1 },
    { id: "cofins_vendas", label: "(-) COFINS", type: "data", source_accounts: ["4.2.2.005"], parent_id: "deducoes", level: 1 },
    { id: "icms_st_vendas", label: "(-) ICMS ST", type: "data", source_accounts: ["4.2.2.007"], parent_id: "deducoes", level: 1 },

    { id: "receita_liquida", label: "RECEITA LÍQUIDA", type: "total" },

    { id: "cpv", label: "(-) Custos dos produtos vendidos", type: "total" },
    { id: "materia_prima", label: "(-) Matéria-prima", type: "total", source_groups: ["Matéria-Prima Consumida"], parent_id: "cpv", level: 1 },
    { id: "materia_prima_plastica", label: "Venda de Produtos Plásticos", type: "data", source_accounts: ["4.1.1.001"], parent_id: "materia_prima", level: 2 },
    { id: "creditos_icms", label: "(+) Créditos de ICMS", type: "data", source_accounts: ["5.1.1.008"], parent_id: "materia_prima", level: 2 },
    { id: "creditos_ipi", label: "(+) Créditos de IPI", type: "data", source_accounts: ["5.1.1.009"], parent_id: "materia_prima", level: 2 },
    { id: "creditos_pis", label: "(+) Créditos de PIS", type: "data", source_accounts: ["5.1.1.010"], parent_id: "materia_prima", level: 2 },
    { id: "creditos_cofins", label: "(+) Créditos de COFINS", type: "data", source_accounts: ["5.1.1.011"], parent_id: "materia_prima", level: 2 },

    { id: "pessoal_cpv", label: "(-) Despesa com pessoal", type: "data", source_accounts: ["5.1.2.001", "5.1.2.003", "5.1.2.007", "5.1.2.008", "5.1.2.010", "5.1.2.011", "5.1.2.014", "5.1.2.015", "5.1.2.016", "5.1.2.017"], parent_id: "cpv", level: 1 },
    { id: "ocupacao_cpv", label: "(-) Despesa com ocupação", type: "data", source_accounts: ["5.1.3.001", "5.1.3.002"], parent_id: "cpv", level: 1 },
    { id: "cif", label: "(-) Custos indiretos de fabricação (CIF)", type: "data", source_accounts: ["5.1.3.003"], parent_id: "cpv", level: 1 },

    { id: "resultado_bruto", label: "RESULTADO BRUTO", type: "total" },

    { id: "despesas_comerciais_total", label: "(-) Despesas comerciais", type: "total" },
    { id: "despesas_comerciais", label: "(-) Despesas comerciais", type: "data", source_accounts: ["6.1.1.001", "6.1.1.002", "6.1.1.004", "6.1.1.005", "6.1.1.007", "6.1.1.010"], parent_id: "despesas_comerciais_total", level: 1 },
    { id: "marketing", label: "(-) Despesas com marketing", type: "total", source_accounts: ["6.1.2.001", "6.1.2.002", "6.1.2.003", "6.1.2.005", "6.1.2.008", "6.1.2.014", "6.1.2.015", "6.1.2.016", "6.1.2.017"], parent_id: "despesas_comerciais_total", level: 1 },
    { id: "materiais_graficos", label: "(-) Mat. Gráficos/Papelaria", type: "data", source_accounts: ["6.1.2.001"], parent_id: "marketing", level: 2 },
    { id: "trafego_pago", label: "(-) Tráfego Pago", type: "data", source_accounts: ["6.1.2.014"], parent_id: "marketing", level: 2 },

    { id: "negocios_digitais", label: "(-) Despesas com negócios digitais", type: "data", source_accounts: ["6.1.3.001", "6.1.3.004", "6.1.3.012"], parent_id: "despesas_comerciais_total", level: 1 },

    { id: "margem_contribuicao", label: "($) MARGEM DE CONTRIBUIÇÃO", type: "total" },

    { id: "despesas_administrativas", label: "(-) Despesas administrativas", type: "total" },
    { id: "pessoal_adm", label: "(-) Despesa com pessoal", type: "data", source_accounts: ["6.2.1.001", "6.2.1.005", "6.2.1.006", "6.2.1.007", "6.2.1.008", "6.2.1.009", "6.2.1.010", "6.2.1.011", "6.2.1.012", "6.2.1.014", "6.2.1.015", "6.2.1.016", "6.2.1.017"], parent_id: "despesas_administrativas", level: 1 },
    { id: "servicos_terceiros", label: "(-) Despesas com serviços de terceiros", type: "data", source_accounts: ["6.2.2.002", "6.2.2.003", "6.2.2.004", "6.2.2.005", "6.2.2.006", "6.2.2.007", "6.2.2.011", "6.2.2.014", "6.2.2.015", "6.2.2.018", "6.2.2.021"], parent_id: "despesas_administrativas", level: 1 },
    { id: "despesas_gerais", label: "(-) Despesas gerais", type: "data", source_accounts: ["5.1.3.003", "6.2.4.001", "6.2.4.002", "6.2.4.006", "6.2.4.007", "6.2.4.009", "6.2.4.010", "6.2.4.012", "6.2.4.015", "6.2.4.018", "6.2.4.020", "6.2.4.023", "6.2.4.026", "6.2.4.028", "6.2.4.029", "6.2.4.030", "6.2.4.031", "6.2.4.032"], parent_id: "despesas_administrativas", level: 1 },

    { id: "despesas_operacionais", label: "(-) Despesas operacionais", type: "total" },
    { id: "resultado_operacional", label: "RESULTADO OPERACIONAL", type: "total" },
];

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

const RelatorioOrcado: React.FC<RelatorioOrcadoProps> = ({ user }) => {
    const confirmar = useConfirm();
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const [isFullScreen, setIsFullScreen] = useState(false);
    const [showCompleto, setShowCompleto] = useState(false);
    const [periodMode, setPeriodMode] = useState<PeriodMode>('mensal');
    const [expandedPeriods, setExpandedPeriods] = useState<Set<string>>(new Set());
    const [excludedRowIds, setExcludedRowIds] = useState<Set<string>>(new Set());
    const [bases, setBases] = useState<any[]>([]);
    const [selectedBase, setSelectedBase] = useState('');
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

    // --- Drill-down State ---
    const [drillDownOpen, setDrillDownOpen] = useState(false);
    const [drillDownData, setDrillDownData] = useState<any[]>([]);
    const [drillDownLoading, setDrillDownLoading] = useState(false);
    const [drillDownParams, setDrillDownParams] = useState({ rowLabel: '', month: '' });
    const [ddFilters, setDdFilters] = useState({ dept: '', account: '', desc: '', group: '' });
    const [allJustifications, setAllJustifications] = useState<any[]>([]);
    const [isJustifyModalOpen, setIsJustifyModalOpen] = useState(false);
    const [justifyData, setJustifyData] = useState<any>(null);
    const [justText, setJustText] = useState('');
    const [saveLoading, setSaveLoading] = useState(false);

    const toggleRow = (id: string) => {
        const s = new Set(expandedRows);
        s.has(id) ? s.delete(id) : s.add(id);
        setExpandedRows(s);
    };

    const toggleExclusion = (id: string) => {
        const s = new Set(excludedRowIds);
        s.has(id) ? s.delete(id) : s.add(id);
        setExcludedRowIds(s);
    };

    const togglePeriod = (period: string) => {
        const s = new Set(expandedPeriods);
        s.has(period) ? s.delete(period) : s.add(period);
        setExpandedPeriods(s);
    };

    const exportToPDF = async () => {
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });

        // Use version name instead of ID
        const baseObj = bases.find(b => b.id === selectedBase);
        const baseLabel = baseObj ? baseObj.version_name : selectedBase;

        const layout = await aplicarLayoutEmpresa(doc, {
            titulo: 'Relatório Gerencial - Orçado',
            subtitulo: `Competência: ${baseLabel}`,
            rodapeTexto: 'EMPRESA — Relatório Orçado (Financeiro)',
        });

        const head = [['Descrição', ...columnGroups.map(g => g.label), 'Total']];

        // FILTER ROWS: Exactly as they appear on screen
        const visibleRows = effectiveData.filter((row: any) => {
            const isChild = !!row.parent_id;
            const parentExpanded = !isChild || expandedRows.has(row.parent_id);
            return !isChild || parentExpanded;
        });

        const body = visibleRows.map((row: any) => {
            const rowArr = [];
            const indent = '  '.repeat(row.level || 0);
            rowArr.push(indent + (row.descricao_conta || ''));

            columnGroups.forEach(cg => {
                const val = row[`_col_${cg.key}`];
                rowArr.push(row.type === 'percentage' ? fmtPct(val) : fmt(val));
            });

            rowArr.push(row.type === 'percentage' ? fmtPct(row.Total) : fmt(row.Total));
            return rowArr;
        });

        autoTable(doc, {
            head: head,
            body: body,
            startY: 35,
            theme: 'grid',
            styles: { fontSize: 5.5, cellPadding: 1, overflow: 'visible' }, // overflow: visible prevents wrap for numbers
            headStyles: { fillColor: [30, 41, 59], halign: 'center', textColor: 255, fontSize: 8 },
            columnStyles: { 0: { cellWidth: 45 } }, // Give more room to description
            didParseCell: (data) => {
                if (data.section === 'body') {
                    const rowObj = visibleRows[data.row.index];
                    if (rowObj?.style?.bg) {
                        const bg = rowObj.style.bg;
                        if (bg === '#fef2f2') data.cell.styles.fillColor = [254, 242, 242];
                        else if (bg === '#fdf2f7') data.cell.styles.fillColor = [253, 242, 247];
                        else if (bg === '#f0f9ff') data.cell.styles.fillColor = [240, 249, 255];
                        else if (bg === '#f9fafb') data.cell.styles.fillColor = [249, 250, 251];
                        else if (bg === '#f3f4f6') data.cell.styles.fillColor = [243, 244, 246];
                    }
                    if (rowObj?.style?.bold) data.cell.styles.fontStyle = 'bold';
                    if (data.column.index > 0) data.cell.styles.halign = 'right';
                }
            }
        });

        layout.finalizar();
        doc.save(`Relatorio_Orcado_${baseLabel}.pdf`);
    };

    const exportDrillDownToPDF = async () => {
        const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
        const layout = await aplicarLayoutEmpresa(doc, {
            titulo: 'Detalhamento do Orçamento',
            subtitulo: `${drillDownParams.rowLabel} - ${drillDownParams.month}`,
            rodapeTexto: 'EMPRESA — Relatório Orçado (Financeiro)',
        });

        const head = [['Conta', 'Descrição', 'Grupo', 'Valor', '%']];
        const body: any[] = [];
        const grandTotal = drillDownData.reduce((s, d) => s + (d.valor || 0), 0);

        const groups: { [key: string]: any[] } = {};
        drillDownData.forEach(item => {
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

    useEffect(() => { loadBases(); }, []);
    useEffect(() => {
        if (selectedBase) {
            fetchData();
            loadDepartments();
            loadJustifications();
        }
    }, [selectedBase]);

    const loadJustifications = async () => {
        if (!selectedBase) return;
        try {
            const res = await api.getJustificativas(selectedBase);
            setAllJustifications(res);
        } catch (e) {
            console.error("Error loading justifications:", e);
        }
    };

    useEffect(() => {
        if (selectedBase) {
            fetchData();
        }
    }, [department]);

    const loadBases = async () => {
        try {
            const b = await api.getFinanceBases('orcado');
            setBases(b);
            if (b.length > 0 && !selectedBase) setSelectedBase(b[0].id);
        } catch (e) { console.error(e); }
    };

    const handleDeleteBase = async () => {
        if (!selectedBase) return;
        const base = bases.find(b => b.id === selectedBase);
        const ok = await confirmar({
            title: `Excluir base "${base?.version_name}"`,
            message: 'Esta ação é irreversível e excluirá todos os dados vinculados a esta base.',
            confirmText: 'Excluir',
            variant: 'danger',
        });
        if (!ok) return;

        setLoading(true);
        try {
            await api.deleteFinanceBase(selectedBase, user.id);
            // Refresh list
            const b = await api.getFinanceBases('orcado');
            setBases(b);
            if (b.length > 0) {
                setSelectedBase(b[0].id);
            } else {
                setSelectedBase('');
                setData([]);
            }
        } catch (e) {
            console.error(e);
            toast.error("Erro ao excluir base: " + (e as Error).message);
        } finally {
            setLoading(false);
        }
    };

    const loadDepartments = async () => {
        try {
            const [deps, sectors] = await Promise.all([
                api.getDepartamentos(selectedBase || undefined),
                api.getStrategicSectors()
            ]);
            setStrategicData(sectors);
            const filteredDeps = isAdmin ? deps : deps.filter((d: string) => sectors.allowed_sectors.includes(d));
            setDepartments(filteredDeps);

            // If not admin and Total is selected but not in filtered, select first one
            if (!isAdmin && (department === 'Total' || !filteredDeps.includes(department))) {
                if (filteredDeps.length > 0) {
                    setDepartment(filteredDeps[0]);
                }
            }
        } catch (e) { console.error(e); }
    };
    // --- Actions ---
    const fetchData = async () => {
        setLoading(true);
        try {
            const res = await api.get('/financeiro/report/orcado', {
                params: { base_id: selectedBase, departamento: department }
            });
            setData(res.data);

            // Extract unique departments
            const depts: string[] = Array.from(new Set(res.data.flatMap((r: any) =>
                // This is a bit tricky since data is pivoted. 
                // For now, let's assume we fetch them once or the backend provides them.
                []
            )));
        } catch (error) {
            console.error('Error fetching DRE:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchDrillDown = async (rowId: string, rowLabel: string, month: string) => {
        setDrillDownLoading(true);
        setDrillDownOpen(true);
        setDrillDownParams({ rowLabel, month });
        setDdFilters({ dept: '', account: '', desc: '', group: '' }); // Reset filters
        try {
            const res = await api.get('/financeiro/drilldown', {
                params: {
                    row_id: rowId,
                    month,
                    departamento: department === 'Total' ? undefined : department,
                    base_id: selectedBase
                }
            });
            setDrillDownData(res.data);
            // After drilldown, we might want to refresh all justifications in case some were added there
            loadJustifications();
        } catch (error) {
            console.error('Error in drilldown:', error);
            setDrillDownData([]);
        } finally {
            setDrillDownLoading(false);
        }
    };

    const handleSaveJustification = async () => {
        if (!justifyData) return;
        setSaveLoading(true);
        try {
            await api.saveJustificativa({
                base_id: selectedBase,
                competencia: drillDownParams.month,
                conta_contabil: justifyData.conta_contabil,
                departamento: justifyData.departamento,
                grupo: justifyData.grupo,
                justificativa: justText,
                created_by: user?.id
            });
            setIsJustifyModalOpen(false);
            setJustText('');
            setJustifyData(null);
            // Refresh data
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
        return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };
    const fmtPct = (val: any) => {
        if (typeof val !== 'number') return '-';
        return val.toFixed(1) + '%';
    };

    // --- Period columns: determines which column groups to show ---
    const periodGroups: { label: string; months: string[] }[] = useMemo(() => {
        if (periodMode === 'trimestral') {
            return Object.entries(QUARTERS).map(([label, months]) => ({ label, months }));
        }
        if (periodMode === 'semestral') {
            return Object.entries(SEMESTERS).map(([label, months]) => ({ label, months }));
        }
        // Mensal: each month is its own group
        return ALL_MONTHS.map(m => ({ label: m, months: [m] }));
    }, [periodMode]);

    // filterMonths: actual month columns present in data (they may not all be 12)
    const fixedKeys = ['conta_contabil', 'descricao_conta', 'grupo', 'departamento', 'id', 'type', 'style', 'parent_id', 'level', 'Total'];
    const dataMonths = data.length > 0
        ? ALL_MONTHS.filter(m => m in data[0])
        : [];

    // Columnar view: for each period group, if expanded show individual months, else show aggregate
    // In mensal mode, no expand/collapse needed.
    // Column structure for rendering
    // Each item in 'columns' represents a major column group (e.g., a Month or a Quarter)
    // It has a 'subCols' array defining the actual <td> cells: Value, AV, AH
    interface ColumnGroup {
        key: string;
        label: string;
        months: string[];
        isGroup: boolean;
    }

    const columnGroups: ColumnGroup[] = useMemo(() => {
        const baseCols: { key: string; label: string; months: string[]; isGroup: boolean }[] = [];

        if (periodMode === 'mensal') {
            dataMonths.forEach(m => baseCols.push({ key: m, label: m, months: [m], isGroup: false }));
        } else {
            // Quarterly/Semestral logic
            periodGroups.forEach(grp => {
                const grpMonths = grp.months.filter(m => dataMonths.includes(m));
                if (grpMonths.length === 0) return;
                const isExpanded = expandedPeriods.has(grp.label);
                baseCols.push({ key: grp.label, label: grp.label, months: grpMonths, isGroup: true });
                if (isExpanded) {
                    grpMonths.forEach(m => {
                        baseCols.push({ key: m, label: m, months: [m], isGroup: false });
                    });
                }
            });
        }

        return baseCols;
    }, [periodMode, periodGroups, dataMonths, expandedPeriods]);

    // Flattened display columns for data mapping (if needed, but we iterate groups in render)
    // We'll iterate columnGroups in the render to handle colspan


    // --- Core recalculation ---
    const effectiveData = useMemo(() => {
        if (data.length === 0) return [];
        let effective = JSON.parse(JSON.stringify(data));

        // 1. Zero out excluded rows
        effective.forEach((row: any) => {
            const isExcluded = excludedRowIds.has(row.id) || (row.parent_id && excludedRowIds.has(row.parent_id));
            if (isExcluded) {
                dataMonths.forEach(m => row[m] = 0);
                row.Total = 0;
            }
        });

        // 2. Aggregate children to parents
        effective.forEach((parent: any) => {
            if (parent.type === 'header' || parent.type === 'percentage') return;
            const children = effective.filter((c: any) => c.parent_id === parent.id);
            if (children.length > 0) {
                dataMonths.forEach(m => {
                    parent[m] = children.reduce((s: number, c: any) => s + (c[m] || 0), 0);
                });
            }
        });

        const getRow = (id: string) => effective.find((r: any) => r.id === id);
        const getByAcc = (acc: string) => effective.find((r: any) => r.conta_contabil === acc);

        // 3. DRE-specific logic
        dataMonths.forEach(m => {
            const rb = getRow('receita_bruta');
            const ded = getRow('deducoes');
            const rl = getRow('receita_liquida');
            const cpv = getRow('cpv');
            const resB = getRow('resultado_bruto');
            const comTotal = getRow('despesas_comerciais_total');
            const admTotal = getRow('despesas_administrativas');
            const despOp = getRow('despesas_operacionais');
            const resO = getRow('resultado_operacional');
            const mc = getRow('margem_contribuicao');

            // if (rb) {
            //    const venda = getByAcc('4.1.1.001');
            //    const icms_st = getByAcc('4.2.2.007');
            //    rb[m] = (venda?.[m] || 0) + Math.abs(icms_st?.[m] || 0);
            // }
            if (rl && rb && ded) rl[m] = rb[m] + ded[m];
            if (resB && rl && cpv) resB[m] = rl[m] + cpv[m];
            if (despOp && comTotal && admTotal) despOp[m] = comTotal[m] + admTotal[m];
            if (resO && resB && comTotal && admTotal) resO[m] = resB[m] + comTotal[m] + admTotal[m];
            const pers_cpv = getRow('pessoal_cpv');
            if (mc && resB && comTotal && pers_cpv) mc[m] = resB[m] + comTotal[m] - pers_cpv[m];

            // Percentage Recalculation - DISABLED (Using Backend Values)
            // effective.forEach((row: any) => {
            //     if (row.type === 'percentage') {
            //         const denom = getRow(row.denom || 'receita_bruta');
            //         const num = getRow(row.formula_ref);
            //         if (denom && num) row[m] = denom[m] !== 0 ? (num[m] / denom[m]) * 100 : 0;
            //     }
            // });
        });

        // 4. Update row.Total
        effective.forEach((row: any) => {
            if (row.type !== 'percentage') {
                row.Total = dataMonths.reduce((acc: number, m: string) => acc + (row[m] || 0), 0);
            }
            // else {
            //     const num = getRow(row.formula_ref);
            //     const denom = getRow(row.denom || 'receita_bruta');
            //     if (num && denom) row.Total = denom.Total !== 0 ? (num.Total / denom.Total) * 100 : 0;
            // }
        });

        // 5. Precompute period aggregates
        effective.forEach((row: any) => {
            columnGroups.forEach(colGrp => {
                if (row.type === 'percentage') {
                    const num = getRow(row.formula_ref);
                    const denom = getRow(row.denom || 'receita_bruta');
                    if (num && denom) {
                        const numVal = colGrp.months.reduce((s: number, m: string) => s + (num[m] || 0), 0);
                        const denomVal = colGrp.months.reduce((s: number, m: string) => s + (denom[m] || 0), 0);
                        row[`_col_${colGrp.key}`] = denomVal !== 0 ? (numVal / denomVal) * 100 : 0;
                    } else {
                        row[`_col_${colGrp.key}`] = 0;
                    }
                } else {
                    row[`_col_${colGrp.key}`] = colGrp.months.reduce((s: number, m: string) => s + (row[m] || 0), 0);
                }
            });
        });

        return effective;
    }, [data, excludedRowIds, columnGroups, dataMonths]);

    // Check if a cell in the main report has any justification in its hierarchy
    const hasJustification = (row: any, month: string) => {
        const relevantJusts = allJustifications.filter(j => j.competencia === month);
        if (relevantJusts.length === 0) return false;

        const checkRowJust = (r: any): boolean => {
            if (r.type === 'detail') {
                return relevantJusts.some(j =>
                    j.conta_contabil === r.conta_contabil &&
                    j.justificativa && j.justificativa.trim().length > 0
                );
            }
            if (r.type === 'data') {
                const rowDef = DRE_STRUCTURE.find(rd => rd.id === r.id);
                if (!rowDef) return false;
                const accounts = rowDef.source_accounts || [];
                const groups = rowDef.source_groups || [];
                return relevantJusts.some(j =>
                    (accounts.includes(j.conta_contabil) || (j.grupo && groups.includes(j.grupo))) &&
                    j.justificativa && j.justificativa.trim().length > 0
                );
            }
            if (r.type === 'total') {
                const children = effectiveData.filter(c => c.parent_id === r.id);
                return children.some(c => checkRowJust(c));
            }
            return false;
        };

        return checkRowJust(row);
    };

    const parentIds = useMemo(() => {
        return new Set(effectiveData.map((r: any) => r.parent_id).filter(Boolean));
    }, [effectiveData]);

    // Check if a row is "white" (no background color) — only these get AV/AH in Completo
    const isWhiteRow = (row: any) => !row.style?.bg && row.type !== 'header' && row.type !== 'percentage';

    const exportToExcel = () => {
        if (!effectiveData.length) return;
        const excelData = effectiveData.map((row: any) => {
            const r: any = { 'Conta': row.conta_contabil, 'Descrição': row.descricao_conta };
            columnGroups.forEach(grp => {
                r[grp.label] = row[`_col_${grp.key}`];
            });
            r['Total'] = row.Total;
            return r;
        });
        const ws = XLSX.utils.json_to_sheet(excelData);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Relatório Orçado");
        XLSX.writeFile(wb, `Relatorio_Orcado_${department}_${new Date().toISOString().split('T')[0]}.xlsx`);
    };

    // Helper render cell content (Value + Percentages if applicable)
    const renderCell = (row: any, colKey: string, isGroupCol: boolean) => {
        const raw = row[`_col_${colKey}`];
        if (raw === undefined || raw === null) return '-';

        // Base Value
        const valElement = (
            <div className="flex items-center justify-end gap-1.5">
                <div className={`font-bold ${row.type === 'percentage' ? '' : ''}`}>
                    {row.type === 'percentage' ? fmtPct(raw) : fmt(raw)}
                </div>
                {!isGroupCol && hasJustification(row, colKey) && (
                    <MessageSquare size={12} className="text-blue-500 flex-shrink-0 animate-pulse" fill="#3b82f644" />
                )}
            </div>
        );

        // If not Completo mode, return just value
        if (!showCompleto) return valElement;

        // If Header, Percentage Row, or Excluded Totals -> No analysis metrics
        const excludedIds = ['receita_bruta', 'receita_liquida', 'resultado_bruto', 'margem_contribuicao', 'resultado_operacional', 'resultado_liquido', 'ebitda'];
        if (row.type === 'header' || row.type === 'percentage' || excludedIds.includes(row.id)) {
            return valElement;
        }

        // Calculate Metrics
        // 1. Vertical (Share of Parent)
        const parent = effectiveData.find((r: any) => r.id === row.parent_id);
        const parentVal = parent?.[`_col_${colKey}`] || 0;
        const av = parentVal !== 0 ? ((raw / parentVal) * 100).toFixed(1) + '%' : '-';

        // 2. Horizontal (Share of Total Row Year)
        const totalVal = row.Total || 0;
        const ah = totalVal !== 0 ? ((raw / totalVal) * 100).toFixed(1) + '%' : '-';

        return (
            <div className="flex flex-col items-end">
                {valElement}
                <div className="flex gap-2 text-[8px] opacity-80 mt-0.5 font-medium" style={{ color: row.style?.color ? 'inherit' : '#6b7280' }}>
                    <span title="Vertical (% do Pai)">V: {av}</span>
                    <span className="text-gray-300">|</span>
                    <span title="Horizontal (% do Ano)">H: {ah}</span>
                </div>
            </div>
        );
    };

    const totalColSpan = 2 + columnGroups.length + 1;

    return (
        <div className={`flex flex-col space-y-4 transition-all duration-300 ${isFullScreen ? 'fixed inset-0 z-50 bg-gray-50 p-6 overflow-auto' : ''}`}>
            {/* Header / Filters */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 space-y-4">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                    <div>
                        <h2 className="text-2xl font-bold text-gray-800 flex items-center gap-2">
                            <BarChart2 className="text-red-600" />
                            Relatório Orçado
                        </h2>
                        <p className="text-sm text-gray-500">Planejamento estratégico e metas orçamentárias</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <button onClick={() => setIsFullScreen(!isFullScreen)} className="p-2 hover:bg-gray-100 rounded-lg text-gray-600 border border-gray-200">
                            {isFullScreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
                        </button>
                        <div className="h-8 w-px bg-gray-200 mx-2" />
                        <button onClick={exportToExcel} className="flex items-center gap-2 px-3 py-2 bg-green-50 text-green-700 hover:bg-green-100 rounded-lg border border-green-200 text-sm font-medium transition-colors">
                            <FileDown size={18} /> Excel
                        </button>
                        <button onClick={exportToPDF} className="flex items-center gap-2 px-3 py-2 bg-red-50 text-red-700 hover:bg-red-100 rounded-lg border border-red-200 text-sm font-medium transition-colors">
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

                    <div className="flex items-center gap-2">
                        <select value={selectedBase} onChange={e => setSelectedBase(e.target.value)} className="bg-white border border-gray-200 rounded-lg text-sm px-3 py-2 focus:ring-2 focus:ring-red-500 outline-none">
                            {bases.map(b => (
                                <option key={b.id} value={b.id}>Orç: {b.version_name}</option>
                            ))}
                        </select>
                        {(user.role === 'super_user' || user.role === 'ceo' || user.permissions?.finance?.can_delete) && (
                            <button
                                onClick={handleDeleteBase}
                                disabled={!selectedBase || loading}
                                className="p-2 bg-gray-100 text-red-500 hover:bg-red-50 rounded-lg border border-gray-200 transition-all disabled:opacity-50"
                                title="Excluir base selecionada"
                            >
                                <Trash2 size={16} />
                            </button>
                        )}
                    </div>

                    <button onClick={() => setShowCompleto(!showCompleto)} className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${showCompleto ? 'bg-gray-800 text-white border-gray-800' : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>
                        {showCompleto ? 'Visão Simplificada' : 'Visão Completa'}
                    </button>

                    <button onClick={fetchData} className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-bold hover:bg-red-700 transition-all active:scale-95 shadow-sm">
                        Atualizar
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="bg-white shadow rounded-lg overflow-hidden">
                <MobileLandscapeHint />
                <div className="overflow-x-auto">
                    <table className="border-collapse bg-white min-w-full">
                        <thead>
                            {/* Row 1: Group Headers (Month/Period names) */}
                            <tr className="bg-gray-50 border-b border-gray-200 text-[9px] font-bold text-gray-600 uppercase">
                                <th rowSpan={2} className="px-2 py-2 text-left sticky left-0 bg-gray-50 z-20 border-r border-gray-200 w-24">Conta</th>
                                <th rowSpan={2} className="px-2 py-2 text-left sticky left-0 bg-gray-50 z-20 border-r border-gray-200 w-52 min-w-[200px]">Descrição</th>

                                {columnGroups.map(grp => (
                                    <th key={grp.key} colSpan={periodMode === 'mensal' ? 1 : (expandedPeriods.has(grp.key) ? grp.months.length + 1 : 1)}
                                        className={`px-2 py-3.5 text-center border-r border-gray-200 ${grp.isGroup ? 'bg-blue-50 text-blue-700 cursor-pointer hover:bg-blue-100' : 'bg-gray-50'}`}
                                        onClick={grp.isGroup ? () => togglePeriod(grp.key) : undefined}
                                        title={grp.isGroup ? (expandedPeriods.has(grp.key) ? 'Recolher' : 'Expandir meses') : undefined}>
                                        {grp.isGroup ? (
                                            <span className="flex items-center justify-center gap-1">
                                                {grp.label}
                                                <span className="text-[8px]">{expandedPeriods.has(grp.key) ? '▲' : '▼'}</span>
                                            </span>
                                        ) : grp.label}
                                    </th>
                                ))}

                                <th className="px-2 py-3.5 text-right sticky right-0 bg-gray-50 z-20 border-l-2 border-gray-300 w-28">Total</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100 text-[10px]">
                            {loading ? (
                                <tr><td colSpan={totalColSpan} className="py-8 text-center text-gray-400">Carregando...</td></tr>
                            ) : effectiveData.length === 0 ? (
                                <tr><td colSpan={totalColSpan} className="py-8 text-center text-gray-400">Nenhum dado encontrado.</td></tr>
                            ) : effectiveData.map((row: any, idx: number) => {
                                const isChild = !!row.parent_id;
                                const parentExpanded = !isChild || expandedRows.has(row.parent_id);
                                if (isChild && !parentExpanded) return null;
                                const isExcluded = excludedRowIds.has(row.id) || (row.parent_id && excludedRowIds.has(row.parent_id));
                                const isHeader = row.type === 'header';
                                const isParent = parentIds.has(row.id);
                                const paddingLeft = row.level ? `${row.level * 16 + 8}px` : '8px';

                                const style: React.CSSProperties = {};
                                if (row.style?.bg) style.backgroundColor = row.style.bg;
                                if (row.style?.color) style.color = row.style.color;
                                if (row.style?.bold) style.fontWeight = 'bold';
                                if (isExcluded) { style.opacity = 0.4; style.textDecoration = 'line-through'; }

                                if (isHeader) {
                                    return (
                                        <tr key={row.id || idx}>
                                            <td colSpan={totalColSpan} className="px-3 py-1 font-bold text-gray-700 uppercase text-[9px] tracking-wider bg-gray-100 border-l-4 border-gray-400">
                                                {row.descricao_conta}
                                            </td>
                                        </tr>
                                    );
                                }

                                return (
                                    <tr key={row.id || idx} style={style} className="hover:bg-opacity-90">
                                        <td className="px-2 py-1 whitespace-nowrap font-mono text-[9px] sticky left-0 bg-inherit border-r border-gray-100" style={style}>
                                            {row.conta_contabil}
                                        </td>
                                        <td className="py-1 sticky left-0 bg-inherit border-r border-gray-100 max-w-[200px] z-10" style={{ ...style, paddingLeft: row.level ? row.level * 20 : 10, backgroundColor: style.backgroundColor || 'white' }}>
                                            <div className="flex items-center gap-1">
                                                {!row.style?.bg && (
                                                    <button onClick={(e) => { e.stopPropagation(); toggleExclusion(row.id); }}
                                                        className={`flex-shrink-0 p-0.5 rounded ${isExcluded ? 'text-gray-400' : 'text-blue-400 hover:text-blue-600'}`}
                                                        title={isExcluded ? 'Incluir no cálculo' : 'Excluir do cálculo'}>
                                                        {isExcluded ? <EyeOff size={11} /> : <Eye size={11} />}
                                                    </button>
                                                )}
                                                {isParent && (
                                                    <button onClick={(e) => { e.stopPropagation(); toggleRow(row.id); }}
                                                        className="flex-shrink-0 p-0.5 hover:bg-black/10 rounded text-[9px]">
                                                        {expandedRows.has(row.id) ? '▼' : '▶'}
                                                    </button>
                                                )}
                                                <span className="truncate" title={row.descricao_conta}>{row.descricao_conta}</span>
                                            </div>
                                        </td>

                                        {columnGroups.map(grp => {
                                            const isGroupCol = (periodMode !== 'mensal') && grp.isGroup;
                                            const subStyle = { ...style };
                                            if (isGroupCol) {
                                                subStyle.backgroundColor = style.backgroundColor ? style.backgroundColor + 'dd' : '#eff6ff99';
                                            }
                                            return (
                                                <td key={grp.key}
                                                    className={`px-2 py-1 whitespace-nowrap text-right border-r border-gray-100 ${isGroupCol ? 'font-bold' : ''} cursor-pointer hover:bg-blue-50 transition-colors`}
                                                    style={subStyle}
                                                    onDoubleClick={() => !isGroupCol && grp.months.length === 1 && fetchDrillDown(row.id, row.descricao_conta, grp.key)}
                                                >
                                                    {renderCell(row, grp.key, isGroupCol)}
                                                </td>
                                            );
                                        })}

                                        <td className="px-2 py-1 whitespace-nowrap text-right font-bold sticky right-0 border-l-2 border-gray-300 shadow-[-3px_0_6px_-3px_rgba(0,0,0,0.1)] z-10"
                                            style={{ ...style, backgroundColor: style.backgroundColor || 'white' }}>
                                            {row.type === 'percentage' ? fmtPct(row.Total) : fmt(row.Total)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>

                {/* --- Drill-down Modal --- */}
                {drillDownOpen && (
                    <div className="fixed inset-0 z-[100] flex items-start justify-center p-4 pt-20 bg-black bg-opacity-50 backdrop-blur-sm animate-in fade-in duration-200">
                        <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden border border-gray-100 scale-in-center">
                            {/* Modal Header */}
                            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50/50">
                                <div>
                                    <h3 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                                        <Search size={20} className="text-blue-500" />
                                        Detalhamento do Orçamento
                                    </h3>
                                    <p className="text-sm text-gray-500 mt-1">
                                        {drillDownParams.rowLabel} &bull; <span className="font-semibold text-blue-600">{drillDownParams.month}</span>
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
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-md text-xs focus:ring-1 focus:ring-blue-500 outline-none appearance-none"
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
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-md text-xs focus:ring-1 focus:ring-blue-500 outline-none appearance-none"
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
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-md text-xs focus:ring-1 focus:ring-blue-500 outline-none appearance-none"
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
                                            className="w-full px-3 py-2 bg-white border border-gray-200 rounded-md text-xs focus:ring-1 focus:ring-blue-500 outline-none"
                                            placeholder="Filtrar por nome..."
                                            value={ddFilters.desc}
                                            onChange={(e) => setDdFilters({ ...ddFilters, desc: e.target.value })}
                                        />
                                    </div>
                                </div>

                                {drillDownLoading ? (
                                    <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
                                        <Loader2 className="animate-spin" size={32} />
                                        <p className="text-sm font-medium animate-pulse">Buscando dados no banco...</p>
                                    </div>
                                ) : drillDownData.length === 0 ? (
                                    <div className="text-center py-20 bg-gray-50 rounded-lg border-2 border-dashed border-gray-200">
                                        <p className="text-gray-400">Nenhum detalhamento encontrado para este item.</p>
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
                                                    <th className="px-4 py-3 text-center">Justificativa</th>
                                                </tr>
                                            </thead>
                                            <tbody className="text-xs">
                                                {(() => {
                                                    const grandTotal = filteredDrillDownData.reduce((s, d) => s + (d.valor || 0), 0);

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
                                                                        <tr key={`${dep}-${idx}`} className="hover:bg-blue-50/20 transition-colors border-b border-gray-50">
                                                                            <td className="px-4 py-2 font-mono text-blue-600 pl-8">{item.conta_contabil}</td>
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
                                                                <tr className="bg-blue-50/30 font-semibold border-b border-gray-100">
                                                                    <td colSpan={4} className="px-4 py-2 text-right text-blue-700 text-[10px] uppercase">Subtotal {dep}:</td>
                                                                    <td className="px-4 py-2 text-right text-blue-800">{fmt(depTotal)}</td>
                                                                    <td className="px-4 py-2 text-right text-blue-600">{depPct.toFixed(1)}%</td>
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
                                                    <td className="px-4 py-3 text-right text-sm"></td>
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
                                    className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold shadow-lg shadow-blue-200 hover:bg-blue-700 active:scale-95 transition-all flex items-center gap-2 disabled:opacity-50"
                                >
                                    {saveLoading ? <Loader2 size={16} className="animate-spin" /> : 'Salvar Justificativa'}
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default RelatorioOrcado;
