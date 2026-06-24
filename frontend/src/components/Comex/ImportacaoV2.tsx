import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { api } from '../../app_api';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend, LabelList } from 'recharts';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import WhatsAppEnvioModal from '../Configuracoes/WhatsAppEnvioModal';
import SimuladorImportacao from './SimuladorImportacao';
import {
    RotateCcw, Save, Plus, X, TrendingUp, TrendingDown, AlertTriangle, Info,
    Package, BarChart3, Search, ListFilter, LineChart as LineChartIcon,
    HelpCircle, Sparkles, AlertCircle, CheckCircle2, Boxes, Truck,
    History, Tag, User as UserIcon, Calendar, Trash2, ArrowUpDown, ArrowUp, ArrowDown,
    Maximize2, Minimize2, FileSpreadsheet, FileDown, MessageSquare, Container,
} from 'lucide-react';

type Modo = 'corrido' | 'vendas';

interface Outlier { mes: string; valor: number; z: number; tipo: 'pico' | 'vale'; }
interface VendaMes { mes: string; valor: number; }

interface ItemResultado {
    codigo: string;
    descricao?: string;
    estoque_disponivel: number;
    pipeline: number;
    estoque_total: number;
    lead_time: number;
    nivel_servico: number;
    moq: number;
    z: number;
    qtd_meses_solicitado: number;
    meses_efetivos: number;
    total_vendas: number;
    consumo_mensal: number;
    sigma_mensal: number;
    estoque_seguranca: number;
    ponto_reposicao: number;
    cobertura_meses: number;
    cobertura_dias: number;
    status: 'RUPTURA' | 'ATENCAO' | 'OK';
    qtd_sugerida_pura: number;
    qtd_sugerida: number;
    outliers: Outlier[];
    vendas_mensais: VendaMes[];
    aviso: string;
}

interface Defaults {
    qtd_meses: number;
    modo: Modo;
    lead_time_default: number;
    nivel_servico_default: number;
    threshold_sigma: number;
    limite_global_meses: number;
    qtd_meses_max?: number;
    data_piso?: string;
    codigos_padrao: string[];
}

interface Modelo {
    id: number; nome: string; codigos: string[]; qtd_meses: number;
    modo: Modo; overrides: Record<string, any>; threshold_sigma: number; is_default?: boolean;
}

// ---------- Helpers UI ----------

const STATUS_STYLE = {
    RUPTURA: {
        badge: 'bg-rose-500 text-white shadow-rose-500/30',
        label: 'Ruptura',
        icon: AlertCircle,
        rowBorder: 'border-l-rose-500',
        rowBg: 'hover:bg-rose-50/50 dark:hover:bg-rose-900/10',
    },
    ATENCAO: {
        badge: 'bg-amber-500 text-white shadow-amber-500/30',
        label: 'Atenção',
        icon: AlertTriangle,
        rowBorder: 'border-l-amber-500',
        rowBg: 'hover:bg-amber-50/50 dark:hover:bg-amber-900/10',
    },
    OK: {
        badge: 'bg-emerald-500 text-white shadow-emerald-500/30',
        label: 'OK',
        icon: CheckCircle2,
        rowBorder: 'border-l-emerald-500',
        rowBg: 'hover:bg-emerald-50/30 dark:hover:bg-emerald-900/10',
    },
} as const;

const StatusBadge: React.FC<{ s: ItemResultado['status'] }> = ({ s }) => {
    const cfg = STATUS_STYLE[s];
    const Icon = cfg.icon;
    return (
        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold shadow ${cfg.badge}`}>
            <Icon className="w-3 h-3" />
            {cfg.label}
        </span>
    );
};

const Hint: React.FC<{ tip: string; align?: 'left' | 'right' | 'center' }> = ({ tip, align = 'center' }) => {
    const pos = align === 'left' ? 'left-0' : align === 'right' ? 'right-0' : 'left-1/2 -translate-x-1/2';
    return (
        <span className="relative inline-block group ml-1 align-middle">
            <HelpCircle className="w-3 h-3 text-slate-400 hover:text-indigo-500 cursor-help" />
            <span className={`pointer-events-none absolute z-50 ${pos} top-full mt-1.5 px-2.5 py-1.5 bg-slate-800 text-white text-[11px] rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity w-56 max-w-[calc(100vw-2rem)] leading-snug font-normal normal-case tracking-normal`}>
                {tip}
            </span>
        </span>
    );
};

const NumberCell: React.FC<{
    value: number | undefined;
    onCommit: (v: number) => void;
    step?: number;
    min?: number;
    max?: number;
    suffix?: string;
    tint?: 'amber' | 'indigo' | 'slate';
}> = ({ value, onCommit, step = 1, min, max, suffix, tint = 'slate' }) => {
    const [local, setLocal] = useState<string>(value?.toString() ?? '');
    useEffect(() => { setLocal(value?.toString() ?? ''); }, [value]);
    const tintCls = {
        amber: 'border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 focus:ring-amber-500 focus:border-amber-500',
        indigo: 'border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20 focus:ring-indigo-500 focus:border-indigo-500',
        slate: 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 focus:ring-indigo-500 focus:border-indigo-500',
    }[tint];
    return (
        <div className="flex items-center gap-1 justify-end">
            <input
                type="number"
                step={step}
                min={min}
                max={max}
                value={local}
                onChange={(e) => setLocal(e.target.value)}
                onBlur={() => {
                    const n = parseFloat(local);
                    if (!isNaN(n) && n !== value) onCommit(n);
                    else setLocal(value?.toString() ?? '');
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                className={`w-16 px-1.5 py-1 text-xs text-right border rounded focus:ring-1 ${tintCls}`}
            />
            {suffix && <span className="text-[10px] text-slate-500">{suffix}</span>}
        </div>
    );
};

// ----- Recálculo local (replica backend calc_sku para os campos editáveis) -----
// Aproximação Acklam da inversa da CDF normal padrão — usada para o Z a partir do nível de serviço.
function normInvCdf(p: number): number {
    if (p <= 0 || p >= 1) return 1.2816;
    const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    const pLow = 0.02425, pHigh = 1 - pLow;
    let q: number, r: number;
    if (p < pLow) { q = Math.sqrt(-2 * Math.log(p)); return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
    if (p <= pHigh) { q = p - 0.5; r = q * q; return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1); }
    q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1);
}

// leadTime em MESES, todas as fórmulas em escala mensal
function recalcSku(base: ItemResultado, leadTime: number, nivelServico: number, pipeline: number, moq: number): ItemResultado {
    const consumoMensal = base.consumo_mensal;
    const sigmaMensal = base.sigma_mensal;
    const z = sigmaMensal > 0 ? normInvCdf(Math.max(0.5, Math.min(0.9999, nivelServico))) : base.z;
    const safetyStock = sigmaMensal > 0 ? Math.ceil(z * sigmaMensal * Math.sqrt(leadTime)) : 0;
    const pontoReposicao = Math.ceil(leadTime * consumoMensal + safetyStock);
    const estoqueTotal = base.estoque_disponivel + pipeline;
    const coberturaMeses = consumoMensal > 0 ? estoqueTotal / consumoMensal : 999;
    const status: ItemResultado['status'] =
        estoqueTotal <= safetyStock ? 'RUPTURA' :
        estoqueTotal < pontoReposicao ? 'ATENCAO' : 'OK';
    const deficit = Math.max(0, Math.ceil(pontoReposicao - estoqueTotal));
    const qtdSugerida = deficit > 0 && moq > 0 ? Math.max(deficit, Math.ceil(moq)) : deficit;
    return {
        ...base,
        lead_time: leadTime,
        nivel_servico: nivelServico,
        pipeline,
        moq,
        z: Math.round(z * 10000) / 10000,
        estoque_total: estoqueTotal,
        estoque_seguranca: safetyStock,
        ponto_reposicao: pontoReposicao,
        cobertura_meses: Math.round(coberturaMeses * 10) / 10,
        cobertura_dias: Math.round(coberturaMeses * 30 * 10) / 10,
        status,
        qtd_sugerida_pura: deficit,
        qtd_sugerida: qtdSugerida,
    };
}

// ----- Helpers de formato -----
const MESES_PT = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
const fmtMes = (m: string) => {
    // m vem como YYYY-MM
    const [yyyy, mm] = m.split('-');
    const idx = parseInt(mm, 10) - 1;
    return `${MESES_PT[idx] || mm}/${yyyy.slice(2)}`;
};
const descricaoOutlier = (o: Outlier) => {
    const human = fmtMes(o.mes);
    const tag = o.tipo === 'pico' ? 'pico de venda' : 'venda muito baixa';
    const dir = o.tipo === 'pico' ? 'acima do normal' : 'abaixo do normal';
    return `${human}: ${tag} — vendeu ${o.valor.toLocaleString('pt-BR')} unidades (${dir})`;
};

// Mini sparkline (sem axis, ultra-compacto) — com tooltip mostrando mês + qtd
const sparkTooltip = ({ active, payload }: any) => {
    if (!active || !payload || !payload.length) return null;
    const p = payload[0];
    return (
        <div className="bg-slate-800 text-white text-[10px] px-2 py-1 rounded shadow-lg">
            <div className="font-bold">{fmtMes(p.payload.mes)}</div>
            <div>{Number(p.value).toLocaleString('pt-BR')} unidades</div>
        </div>
    );
};

const Sparkline: React.FC<{ data: VendaMes[]; status: ItemResultado['status'] }> = ({ data, status }) => {
    if (!data || data.length < 2) return <span className="text-slate-300 text-[10px]">—</span>;
    const stroke = status === 'RUPTURA' ? '#ef4444' : status === 'ATENCAO' ? '#f59e0b' : '#10b981';
    const min = Math.min(...data.map(d => d.valor));
    const max = Math.max(...data.map(d => d.valor));
    return (
        <div className="flex items-center gap-1.5 justify-center" title={`Vendas mensais (${data.length} meses) — mín ${min.toLocaleString('pt-BR')} / máx ${max.toLocaleString('pt-BR')}`}>
            <div className="w-24 h-7 inline-block">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
                        <Line type="monotone" dataKey="valor" stroke={stroke} strokeWidth={1.8} dot={false} />
                        <Tooltip content={sparkTooltip} cursor={{ stroke: '#64748b', strokeDasharray: '2 2' }} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
            <span className="text-[9px] text-slate-400 font-bold whitespace-nowrap">{data.length}m</span>
        </div>
    );
};

const CHART_COLORS = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6'];

type AbaImportacao = 'planejamento' | 'simulador';

const ImportacaoV2: React.FC<{ user: any }> = ({ user }) => {
    const [aba, setAba] = useState<AbaImportacao>('planejamento');
    const toast = useToast();
    const [defaults, setDefaults] = useState<Defaults | null>(null);
    const [modelos, setModelos] = useState<Modelo[]>([]);
    const [modeloSelecionado, setModeloSelecionado] = useState<number>(0);

    const [qtdMeses, setQtdMeses] = useState<number>(15);
    const [modo, setModo] = useState<Modo>('corrido');
    const [leadDefault, setLeadDefault] = useState<number>(3);
    const [nivelDefault, setNivelDefault] = useState<number>(0.90);
    const [threshold, setThreshold] = useState<number>(1.5);

    const [codigos, setCodigos] = useState<string[]>([]);
    const [overrides, setOverrides] = useState<Record<string, { lead_time?: number; nivel_servico?: number; pipeline?: number }>>({});
    const [novoCodigo, setNovoCodigo] = useState('');

    const [itens, setItens] = useState<ItemResultado[]>([]);
    const [loading, setLoading] = useState(false);
    const [dataCalculo, setDataCalculo] = useState<string>('');

    const [modalNome, setModalNome] = useState<string | null>(null);
    const [drawerItensOpen, setDrawerItensOpen] = useState(false);
    const [buscaItem, setBuscaItem] = useState('');

    // gráfico
    const [chartOpen, setChartOpen] = useState(false);
    const [chartCods, setChartCods] = useState<string[]>([]);

    // versões
    const [historicoOpen, setHistoricoOpen] = useState(false);
    const [versoes, setVersoes] = useState<any[]>([]);
    const [labelsPadrao, setLabelsPadrao] = useState<string[]>([]);
    const [modalVersao, setModalVersao] = useState<{ nome: string; labels: string[]; observacao: string; labelInput: string } | null>(null);
    const [filtroLabel, setFiltroLabel] = useState<string>('');

    // filtros e ordenação da tabela
    const [busca, setBusca] = useState('');
    const [statusFilter, setStatusFilter] = useState<Set<ItemResultado['status']>>(new Set());
    const [sortBy, setSortBy] = useState<string>('');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

    // ações de exportação / WhatsApp
    const tabelaRef = React.useRef<HTMLDivElement>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [waOpen, setWaOpen] = useState(false);

    // Order List (import xlsx → preenche Em Trânsito)
    const orderFileRef = React.useRef<HTMLInputElement>(null);
    const [datasChegada, setDatasChegada] = useState<Record<string, string>>({}); // YYYY-MM-DD
    const [orderPreview, setOrderPreview] = useState<null | {
        items: Array<{ codigo: string; qty: number; data?: string }>;
        precisaData: boolean;
        dataGlobal: string;
        nome: string;
        labels: string[];
        labelInput: string;
        observacao: string;
    }>(null);
    const [orderListsOpen, setOrderListsOpen] = useState(false);
    const [orderLists, setOrderLists] = useState<any[]>([]);

    // Container suggestion
    const [containerOpen, setContainerOpen] = useState(false);
    const [containerTipo, setContainerTipo] = useState<string>('40HC');
    const [containerCustomCap, setContainerCustomCap] = useState<number>(68);
    const [containerResult, setContainerResult] = useState<any | null>(null);
    const [containerLoading, setContainerLoading] = useState(false);
    const [containerModeloNome, setContainerModeloNome] = useState('');
    const [containerModeloSaving, setContainerModeloSaving] = useState(false);
    const [containerModelosOpen, setContainerModelosOpen] = useState(false);
    const [containerModelos, setContainerModelos] = useState<any[]>([]);
    const [containerModeloSaveOpen, setContainerModeloSaveOpen] = useState(false);

    const toggleStatus = (s: ItemResultado['status']) => {
        setStatusFilter(prev => {
            const n = new Set(prev);
            n.has(s) ? n.delete(s) : n.add(s);
            return n;
        });
    };
    const toggleSort = (key: string) => {
        if (sortBy === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        else { setSortBy(key); setSortDir('desc'); }
    };
    const SortIcon: React.FC<{ k: string }> = ({ k }) => {
        if (sortBy !== k) return <ArrowUpDown className="w-3 h-3 inline ml-0.5 text-slate-300 group-hover:text-slate-500" />;
        return sortDir === 'asc' ? <ArrowUp className="w-3 h-3 inline ml-0.5 text-indigo-600" /> : <ArrowDown className="w-3 h-3 inline ml-0.5 text-indigo-600" />;
    };

    // boot — restaura sessão se houver
    useEffect(() => {
        (async () => {
            try {
                const d = await api.importacaoV2Defaults();
                setDefaults(d);
                // Tenta restaurar do sessionStorage primeiro — só se schema ainda for o atual
                let restored = false;
                try {
                    const saved = sessionStorage.getItem('importacao_v2_state');
                    if (saved) {
                        const s = JSON.parse(saved);
                        // Schema 'meses' (2026-05-19) — invalida sessão antiga em dias
                        if (s.schema !== 'meses') {
                            sessionStorage.removeItem('importacao_v2_state');
                            throw new Error('schema antigo descartado');
                        }
                        if (s.codigos) setCodigos(s.codigos);
                        if (s.qtdMeses) setQtdMeses(s.qtdMeses);
                        if (s.modo) setModo(s.modo);
                        if (typeof s.leadDefault === 'number') setLeadDefault(s.leadDefault);
                        if (typeof s.nivelDefault === 'number') setNivelDefault(s.nivelDefault);
                        if (typeof s.threshold === 'number') setThreshold(s.threshold);
                        if (s.overrides) setOverrides(s.overrides);
                        if (Array.isArray(s.itens)) setItens(s.itens);
                        if (s.dataCalculo) setDataCalculo(s.dataCalculo);
                        if (s.datasChegada) setDatasChegada(s.datasChegada);
                        restored = true;
                    }
                } catch { /* sessão corrompida — ignora */ }
                if (!restored) {
                    setQtdMeses(d.qtd_meses);
                    setLeadDefault(d.lead_time_default);
                    setNivelDefault(d.nivel_servico_default);
                    setThreshold(d.threshold_sigma);
                    setCodigos(d.codigos_padrao);
                }
                const m = await api.importacaoV2ListarModelos();
                setModelos(m.modelos || []);
                try {
                    const lp = await api.importacaoV2LabelsPadrao();
                    setLabelsPadrao(lp.labels || []);
                } catch { /* não-crítico */ }
            } catch (e: any) {
                toast.showToast(e.message || 'Erro ao carregar configuração', 'error');
            }
        })();
    }, []);

    // Persiste estado entre renders/remounts
    useEffect(() => {
        if (!defaults) return;
        try {
            sessionStorage.setItem('importacao_v2_state', JSON.stringify({
                schema: 'meses',
                codigos, qtdMeses, modo, leadDefault, nivelDefault, threshold, overrides, itens, dataCalculo, datasChegada,
            }));
        } catch { /* quota etc — silencia */ }
    }, [defaults, codigos, qtdMeses, modo, leadDefault, nivelDefault, threshold, overrides, itens, dataCalculo]);

    const recarregarVersoes = async () => {
        try {
            const v = await api.importacaoV2ListarVersoes();
            setVersoes(v.versoes || []);
        } catch (e: any) { toast.showToast(e.message || 'Erro ao listar versões', 'error'); }
    };

    const abrirHistorico = async () => {
        setHistoricoOpen(true);
        await recarregarVersoes();
    };

    const abrirModalSalvarVersao = () => {
        if (itens.length === 0) { toast.showToast('Calcule antes de salvar uma versão', 'info'); return; }
        setModalVersao({ nome: '', labels: [], observacao: '', labelInput: '' });
    };

    const salvarVersao = async () => {
        if (!modalVersao || !modalVersao.nome.trim()) return;
        try {
            await api.importacaoV2SalvarVersao({
                nome: modalVersao.nome.trim(),
                labels: modalVersao.labels,
                observacao: modalVersao.observacao || undefined,
                parametros: {
                    qtd_meses: qtdMeses, modo, lead_time_default: leadDefault,
                    nivel_servico_default: nivelDefault, threshold_sigma: threshold,
                    codigos, overrides,
                },
                resultado: { data_calculo: dataCalculo, itens },
            });
            toast.showToast('Versão salva', 'success');
            setModalVersao(null);
            await recarregarVersoes();
        } catch (e: any) { toast.showToast(e.message || 'Erro ao salvar versão', 'error'); }
    };

    // Carrega snapshot completo (parametros + resultado salvo)
    const carregarVersao = async (id: number) => {
        try {
            const v = await api.importacaoV2CarregarVersao(id);
            const p = v.parametros || {};
            setQtdMeses(p.qtd_meses ?? qtdMeses);
            setModo(p.modo ?? 'corrido');
            setLeadDefault(p.lead_time_default ?? leadDefault);
            setNivelDefault(p.nivel_servico_default ?? nivelDefault);
            setThreshold(p.threshold_sigma ?? threshold);
            setCodigos(p.codigos ?? codigos);
            setOverrides(p.overrides ?? {});
            setItens(v.resultado?.itens || []);
            setDataCalculo(v.resultado?.data_calculo || '');
            setHistoricoOpen(false);
            toast.showToast(`Versão "${v.nome}" carregada (dados de ${v.resultado?.data_calculo ? new Date(v.resultado.data_calculo).toLocaleDateString('pt-BR') : 'snapshot'})`, 'success');
        } catch (e: any) { toast.showToast(e.message || 'Erro ao carregar versão', 'error'); }
    };

    // Aplica só os parametros/filtros da versao e recalcula com dados atuais do BigQuery
    const recalcularVersao = async (id: number) => {
        try {
            const v = await api.importacaoV2CarregarVersao(id);
            const p = v.parametros || {};
            const qtd = p.qtd_meses ?? qtdMeses;
            const md = p.modo ?? 'corrido';
            const lead = p.lead_time_default ?? leadDefault;
            const nivel = p.nivel_servico_default ?? nivelDefault;
            const thr = p.threshold_sigma ?? threshold;
            const cods = p.codigos ?? codigos;
            const ovs = p.overrides ?? {};
            // Aplica nos estados
            setQtdMeses(qtd); setModo(md); setLeadDefault(lead); setNivelDefault(nivel);
            setThreshold(thr); setCodigos(cods); setOverrides(ovs);
            setHistoricoOpen(false);
            // Recalcula imediatamente com BigQuery fresco
            setLoading(true);
            try {
                const res = await api.importacaoV2Calculate({
                    codigos: cods, qtd_meses: qtd, modo: md,
                    lead_time_default: lead, nivel_servico_default: nivel,
                    threshold_sigma: thr, overrides: ovs,
                });
                setItens(res.itens || []);
                setDataCalculo(res.data_calculo || '');
                toast.showToast(`Versão "${v.nome}" recalculada com dados atuais`, 'success');
            } finally { setLoading(false); }
        } catch (e: any) { toast.showToast(e.message || 'Erro ao recalcular versão', 'error'); }
    };

    const excluirVersao = async (id: number) => {
        if (!confirm('Excluir esta versão? Ação irreversível.')) return;
        try {
            await api.importacaoV2ExcluirVersao(id);
            toast.showToast('Versão excluída', 'success');
            await recarregarVersoes();
        } catch (e: any) { toast.showToast(e.message || 'Erro ao excluir', 'error'); }
    };

    const toggleLabelVersao = (l: string) => {
        if (!modalVersao) return;
        setModalVersao({
            ...modalVersao,
            labels: modalVersao.labels.includes(l) ? modalVersao.labels.filter(x => x !== l) : [...modalVersao.labels, l],
        });
    };

    const addLabelCustom = () => {
        if (!modalVersao) return;
        const l = modalVersao.labelInput.trim();
        if (!l || modalVersao.labels.includes(l)) return;
        setModalVersao({ ...modalVersao, labels: [...modalVersao.labels, l], labelInput: '' });
    };

    const labelsDisponiveis = useMemo(() => {
        const set = new Set<string>();
        versoes.forEach(v => (v.labels || []).forEach((l: string) => set.add(l)));
        return Array.from(set).sort();
    }, [versoes]);

    // Aplica overrides + recalcula tudo localmente (sem backend) → tempo real ao editar.
    const itensRecalc = useMemo(() => {
        return itens.map(it => {
            const ov = overrides[it.codigo] as any;
            const lt = ov?.lead_time ?? it.lead_time;
            const ns = ov?.nivel_servico ?? it.nivel_servico;
            const pp = ov?.pipeline ?? it.pipeline;
            const mq = ov?.moq ?? (it.moq || 0);
            if (lt === it.lead_time && ns === it.nivel_servico && pp === it.pipeline && mq === (it.moq || 0)) return it;
            return recalcSku(it, lt, ns, pp, mq);
        });
    }, [itens, overrides]);

    const resumo = useMemo(() => ({
        total: itensRecalc.length,
        ruptura: itensRecalc.filter(i => i.status === 'RUPTURA').length,
        atencao: itensRecalc.filter(i => i.status === 'ATENCAO').length,
        ok: itensRecalc.filter(i => i.status === 'OK').length,
    }), [itensRecalc]);

    const itensVisiveis = useMemo(() => {
        const q = busca.toLowerCase().trim();
        let list = itensRecalc.filter(it => {
            if (statusFilter.size > 0 && !statusFilter.has(it.status)) return false;
            if (q) {
                const cod = it.codigo.toLowerCase();
                const desc = (it.descricao || '').toLowerCase();
                if (!cod.includes(q) && !desc.includes(q)) return false;
            }
            return true;
        });
        if (sortBy) {
            const dir = sortDir === 'asc' ? 1 : -1;
            list = [...list].sort((a, b) => {
                const av = (a as any)[sortBy];
                const bv = (b as any)[sortBy];
                if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
                return String(av ?? '').localeCompare(String(bv ?? '')) * dir;
            });
        }
        return list;
    }, [itensRecalc, busca, statusFilter, sortBy, sortDir]);

    // ---- Importar Order List ----
    const parseOrderListFile = useCallback(async (file: File) => {
        try {
            const XLSX = await import('xlsx');
            const buf = await file.arrayBuffer();
            const wb = XLSX.read(buf, { type: 'array' });
            const ws = wb.Sheets[wb.SheetNames[0]];
            const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
            if (aoa.length < 2) throw new Error('Planilha vazia.');

            // Auto-detect: header pode estar na linha 1 ou 2
            // Remove acentos, lowercase e tira espaços/pontuação para robustez entre máquinas/encodings
            const norm = (s: any) => String(s ?? '')
                .normalize('NFD').replace(/[̀-ͯ]/g, '')   // remove acentos
                .toLowerCase()
                .replace(/[\s_/.\-º°]/g, '');
            const CODIGO_ALIAS = new Set([
                'itemno', 'item', 'codigo', 'cod', 'cdigo',
                'codigoempresa', 'codempresa', 'cdigoempresa',
                'codprod', 'codproduto', 'codigoproduto', 'cdigoproduto',
                'sku', 'codsku', 'productcode', 'codproduct',
            ]);
            const QTY_ALIAS = new Set([
                'qty', 'quantidade', 'qtd', 'quant', 'qtdpedida',
                'quantity', 'amount', 'volume', 'pcs', 'units',
            ]);
            const tryRow = (idx: number) => {
                const row = aoa[idx] || [];
                const cod = row.findIndex(h => CODIGO_ALIAS.has(norm(h)));
                const qty = row.findIndex(h => QTY_ALIAS.has(norm(h)));
                return { cod, qty, row };
            };
            // Tenta até as 3 primeiras linhas (alguns arquivos tem 2 linhas de cabeçalho)
            let h = tryRow(0); let dataStart = 1;
            if (h.cod < 0 || h.qty < 0) { h = tryRow(1); dataStart = 2; }
            if (h.cod < 0 || h.qty < 0) { h = tryRow(2); dataStart = 3; }
            if (h.cod < 0 || h.qty < 0) {
                // Mostra o que encontrou pra usuário entender o que ajustar
                const headersVistos = [aoa[0], aoa[1], aoa[2]]
                    .map((r, i) => r ? `Linha ${i + 1}: [${(r || []).filter(c => c != null && c !== '').map(c => JSON.stringify(String(c))).join(', ')}]` : null)
                    .filter(Boolean).join('\n');
                throw new Error(
                    `Não encontrei colunas de código + quantidade nas 3 primeiras linhas. ` +
                    `Cabeçalhos esperados: código (ITEM NO / Código / Codigo EMPRESA / SKU / ...) e quantidade (QTY / Quantidade / Qtd / ...).\n\n${headersVistos}`
                );
            }

            const idxData = h.row.findIndex(c => /previsao|previsao|datachegada|dataentrega|chegada|delivery|eta|prevista/.test(norm(c)));

            const excelDateToISO = (v: any): string | undefined => {
                if (v == null || v === '') return undefined;
                if (typeof v === 'number' && v > 1) {
                    // Excel serial date
                    const d = new Date(Math.round((v - 25569) * 86400 * 1000));
                    return d.toISOString().slice(0, 10);
                }
                const s = String(v).trim();
                // DD/MM/YYYY?
                const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
                if (m) {
                    const yy = m[3].length === 2 ? '20' + m[3] : m[3];
                    return `${yy}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
                }
                const d = new Date(s);
                if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
                return undefined;
            };

            const items: Array<{ codigo: string; qty: number; data?: string }> = [];
            for (let i = dataStart; i < aoa.length; i++) {
                const row = aoa[i] || [];
                const rawCod = row[h.cod];
                const rawQty = row[h.qty];
                if (rawCod == null || rawCod === '') continue;
                const qty = Number(rawQty);
                if (!isFinite(qty) || qty <= 0) continue;
                let cod = String(rawCod).trim();
                if (cod.endsWith('.0')) cod = cod.slice(0, -2);
                const data = idxData >= 0 ? excelDateToISO(row[idxData]) : undefined;
                items.push({ codigo: cod, qty, data });
            }
            if (items.length === 0) throw new Error('Nenhuma linha válida (precisa código + quantidade > 0).');

            setOrderPreview({
                items,
                precisaData: idxData < 0,
                dataGlobal: new Date(Date.now() + 90 * 86400 * 1000).toISOString().slice(0, 10),
                nome: file.name.replace(/\.[^.]+$/, ''),  // sugere nome do arquivo
                labels: [],
                labelInput: '',
                observacao: '',
            });
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao ler Order List', 'error');
        } finally {
            if (orderFileRef.current) orderFileRef.current.value = '';
        }
    }, []);

    const aplicarOrderList = async () => {
        if (!orderPreview) return;
        const { items, precisaData, dataGlobal, nome, labels, observacao } = orderPreview;
        if (precisaData && !dataGlobal) {
            toast.showToast('Informe a data prevista de entrega', 'error');
            return;
        }
        if (!nome.trim()) {
            toast.showToast('Informe um nome para a Order List', 'error');
            return;
        }
        const novosOverrides = { ...overrides };
        const novasDatas = { ...datasChegada };
        let codigosNovos = [...codigos];
        const itemsParaSalvar = items.map(it => ({
            codigo: it.codigo, qty: it.qty, data: it.data || dataGlobal,
        }));
        itemsParaSalvar.forEach(it => {
            const cur = (novosOverrides as any)[it.codigo] || {};
            (novosOverrides as any)[it.codigo] = { ...cur, pipeline: it.qty };
            novasDatas[it.codigo] = it.data;
            if (!codigosNovos.includes(it.codigo)) codigosNovos.push(it.codigo);
        });
        setOverrides(novosOverrides);
        setDatasChegada(novasDatas);
        setCodigos(codigosNovos);
        // Salva no banco para histórico
        try {
            await api.importacaoV2SalvarOrderList({
                nome: nome.trim(),
                labels,
                observacao: observacao || undefined,
                items: itemsParaSalvar,
                datas_chegada: novasDatas,
            });
        } catch (e: any) {
            toast.showToast('Aplicado, mas falhou ao salvar histórico: ' + (e.message || ''), 'info');
        }
        setOrderPreview(null);
        toast.showToast(`${items.length} itens carregados em 'Em Trânsito'`, 'success');
    };

    const toggleOrderLabel = (l: string) => {
        if (!orderPreview) return;
        setOrderPreview({
            ...orderPreview,
            labels: orderPreview.labels.includes(l)
                ? orderPreview.labels.filter(x => x !== l)
                : [...orderPreview.labels, l],
        });
    };
    const addOrderLabelCustom = () => {
        if (!orderPreview) return;
        const l = orderPreview.labelInput.trim();
        if (!l || orderPreview.labels.includes(l)) return;
        setOrderPreview({ ...orderPreview, labels: [...orderPreview.labels, l], labelInput: '' });
    };

    const abrirHistoricoOrderLists = async () => {
        setOrderListsOpen(true);
        try {
            const r = await api.importacaoV2ListarOrderLists();
            setOrderLists(r.order_lists || []);
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao listar order lists', 'error');
        }
    };

    const carregarOrderListSalva = async (id: number) => {
        try {
            const r = await api.importacaoV2CarregarOrderList(id);
            const items = r.items || [];
            const novosOverrides = { ...overrides };
            const novasDatas = { ...datasChegada, ...(r.datas_chegada || {}) };
            let codigosNovos = [...codigos];
            items.forEach((it: any) => {
                const cur = (novosOverrides as any)[it.codigo] || {};
                (novosOverrides as any)[it.codigo] = { ...cur, pipeline: it.qty };
                if (!codigosNovos.includes(it.codigo)) codigosNovos.push(it.codigo);
            });
            setOverrides(novosOverrides);
            setDatasChegada(novasDatas);
            setCodigos(codigosNovos);
            setOrderListsOpen(false);
            toast.showToast(`Order List "${r.nome}" aplicada`, 'success');
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao aplicar', 'error');
        }
    };

    const excluirOrderListSalva = async (id: number) => {
        if (!confirm('Excluir esta Order List do histórico?')) return;
        try {
            await api.importacaoV2ExcluirOrderList(id);
            const r = await api.importacaoV2ListarOrderLists();
            setOrderLists(r.order_lists || []);
            toast.showToast('Order List excluída', 'success');
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao excluir', 'error');
        }
    };

    // ---- PDF da Sugestão de Container (via print do navegador — suporta CJK nativo) ----
    const exportContainerPdf = useCallback(async () => {
        if (!containerResult || !containerResult.containers?.length) {
            toast.showToast('Nada para exportar', 'info');
            return;
        }
        const esc = (s: any) => String(s ?? '').replace(/[&<>"']/g, (c) =>
            ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' } as any)[c]);
        const fmt = (v: any, d = 2) => {
            const n = Number(v); if (!isFinite(n) || n === 0) return '';
            return n.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
        };
        const headers = ['ITEM NO', 'Barcode Number', 'DESCRIPTION', 'NAME', 'REMARK', 'OBS',
            'NCM', 'English Description', 'CTNS', 'UNIT/CTN', 'QTY', 'U.PRICE', 'UNIT', 'AMOUNT',
            'L', 'W', 'H', 'CBM', 'CBM TOTAL', 'G.W', 'T.G.W', 'N.W', 'T.N.W'];
        const containersHtml = containerResult.containers.map((c: any) => `
            <div class="container-block">
                <div class="container-header">
                    <strong>${esc(c.label)}</strong>
                    <span>${c.itens.length} SKUs · ${Number(c.total_qtd).toLocaleString('pt-BR')} un · ${c.total_ctns} ctns · ${Number(c.total_peso).toLocaleString('pt-BR')} kg · ${c.volume_usado_cbm}/${c.capacidade_cbm}m³ (${c.ocupacao_pct}%)</span>
                </div>
                <table>
                    <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
                    <tbody>
                        ${c.itens.map((it: any) => `<tr>
                            <td class="bold">${esc(it.codigo)}</td>
                            <td>${esc(it.barcode || '')}</td>
                            <td>${esc(it.descricao || '')}</td>
                            <td>${esc(it.name_cn || '')}</td>
                            <td>${esc(it.remark || '')}</td>
                            <td>${esc(it.obs || '')}</td>
                            <td>${esc(it.ncm || '')}</td>
                            <td>${esc(it.english_description || '')}</td>
                            <td class="num">${it.ctns || ''}</td>
                            <td class="num">${it.unit_ctn || ''}</td>
                            <td class="num">${Number(it.qtd).toLocaleString('pt-BR')}</td>
                            <td class="num">${fmt(it.price, 2)}</td>
                            <td class="ctr">${esc(it.unit || '')}</td>
                            <td class="num bold">${fmt(it.amount, 2)}</td>
                            <td class="num">${fmt(it.l, 1)}</td>
                            <td class="num">${fmt(it.w, 1)}</td>
                            <td class="num">${fmt(it.h, 1)}</td>
                            <td class="num">${fmt(it.cbm_unit, 4)}</td>
                            <td class="num">${fmt(it.cbm_total, 4)}</td>
                            <td class="num">${fmt(it.peso_unit, 2)}</td>
                            <td class="num">${fmt(it.peso_total, 2)}</td>
                            <td class="num">${fmt(it.peso_liquido_unit, 2)}</td>
                            <td class="num">${fmt(it.peso_liquido_total, 2)}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>`).join('');
        const dataHora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>Container Importação</title>
<style>
@page { size: 297mm 210mm; margin: 8mm; }
@page :first { size: 297mm 210mm; }
html, body { width: 297mm; }
* { box-sizing: border-box; }
body { font-family: 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', 'Hiragino Sans GB', Arial, sans-serif; color:#1e293b; margin:0; padding:0; }
.title { display:flex; justify-content:space-between; align-items:center; border-bottom:2px solid #e74c3c; padding:6px 0 4px; margin-bottom:8px; }
.title h1 { font-size:14px; margin:0; }
.title small { color:#64748b; font-size:9px; }
.container-block { margin-bottom:10px; page-break-inside: avoid; }
.container-header { background:#dbeafe; color:#1e40af; padding:4px 6px; font-size:10px; display:flex; justify-content:space-between; }
table { width:100%; border-collapse:collapse; table-layout:fixed; }
th, td { border:1px solid #cbd5e1; padding:2px 3px; font-size:6.5px; word-wrap:break-word; overflow:hidden; }
th { background:#e74c3c; color:#fff; text-align:center; font-size:6.5px; }
tr:nth-child(even) td { background:#f8fafc; }
.bold { font-weight:bold; }
.num { text-align:right; }
.ctr { text-align:center; }
.summary { background:#f1f5f9; padding:6px; font-size:10px; font-weight:bold; margin-top:6px; }
@media print { .noprint { display:none; } }
.noprint { position:fixed; top:10px; right:10px; }
.noprint button { background:#e74c3c; color:#fff; border:0; padding:8px 14px; border-radius:6px; cursor:pointer; font-weight:bold; }
</style></head><body>
<div class="noprint"><button onclick="window.print()">Imprimir / Salvar PDF</button></div>
<div class="title"><h1>Importação · Sugestão de Container</h1><small>Tipo: ${esc(containerResult.tipo)} · ${containerResult.total_containers} containers · ${Number(containerResult.total_qtd).toLocaleString('pt-BR')} un · Gerado em ${dataHora}</small></div>
${containersHtml}
<div class="summary">Resumo geral: ${containerResult.total_containers} containers · ${Number(containerResult.total_qtd).toLocaleString('pt-BR')} un · ¥${Number(containerResult.total_amount).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</div>
<script>window.addEventListener('load',()=>{setTimeout(()=>window.print(),300)});</script>
</body></html>`;
        const w = window.open('', '_blank');
        if (!w) { toast.showToast('Bloqueador de popup ativo — libere para gerar o PDF', 'error'); return; }
        w.document.write(html);
        w.document.close();
        toast.showToast('Use "Salvar como PDF" no diálogo de impressão', 'info');
    }, [containerResult]);

    // ---- Excel da Sugestão de Container ----
    const exportContainerExcel = useCallback(() => {
        if (!containerResult || !containerResult.containers?.length) {
            toast.showToast('Nada para exportar', 'info');
            return;
        }
        const headers = [
            'Container',
            'ITEM NO', 'Barcode Number', 'DESCRIPTION', 'NAME', 'REMARK', 'OBS',
            'NCM', 'English Description', 'CTNS', 'UNIT/CTN', 'QTY', 'U.PRICE', 'UNIT', 'AMOUNT',
            'L', 'W', 'H', 'CBM', 'CBM TOTAL', 'G.W', 'T.G.W', 'N.W', 'T.N.W',
        ];
        const rows: any[][] = [];
        for (const c of containerResult.containers) {
            for (const it of c.itens) {
                rows.push([
                    c.label,
                    it.codigo,
                    it.barcode || '',
                    it.descricao || '',
                    it.name_cn || '',
                    it.remark || '',
                    it.obs || '',
                    it.ncm || '',
                    it.english_description || '',
                    Number(it.ctns) || 0,
                    Number(it.unit_ctn) || 0,
                    Number(it.qtd) || 0,
                    Number(it.price) || 0,
                    it.unit || '',
                    Number(it.amount) || 0,
                    Number(it.l) || 0,
                    Number(it.w) || 0,
                    Number(it.h) || 0,
                    Number(it.cbm_unit) || 0,
                    Number(it.cbm_total) || 0,
                    Number(it.peso_unit) || 0,
                    Number(it.peso_total) || 0,
                    Number(it.peso_liquido_unit) || 0,
                    Number(it.peso_liquido_total) || 0,
                ]);
            }
        }
        const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
        ws['!cols'] = [
            { wch: 22 }, { wch: 12 }, { wch: 16 }, { wch: 38 }, { wch: 22 }, { wch: 22 }, { wch: 28 },
            { wch: 14 }, { wch: 22 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 8 },
            { wch: 12 }, { wch: 7 }, { wch: 7 }, { wch: 7 }, { wch: 10 }, { wch: 11 }, { wch: 9 },
            { wch: 10 }, { wch: 9 }, { wch: 10 },
        ];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Containers');
        XLSX.writeFile(wb, `Container_Importacao_${new Date().toISOString().slice(0, 10)}.xlsx`);
        toast.showToast('Excel gerado', 'success');
    }, [containerResult]);

    // Helper: recalcula totais de um container após mudança em itens
    const recalcContainer = (cont: any, capacidade_cbm: number) => {
        const total_qtd = cont.itens.reduce((s: number, it: any) => s + (it.qtd || 0), 0);
        const total_ctns = cont.itens.reduce((s: number, it: any) => s + (it.ctns || 0), 0);
        const total_peso = cont.itens.reduce((s: number, it: any) => s + (it.peso_total || 0), 0);
        const total_amount = cont.itens.reduce((s: number, it: any) => s + (it.amount || 0), 0);
        const volume_usado_cbm = cont.itens.reduce((s: number, it: any) => s + (it.cbm_total || 0), 0);
        const ocupacao_pct = capacidade_cbm > 0 ? Math.round((volume_usado_cbm / capacidade_cbm) * 1000) / 10 : 0;
        return { ...cont, total_qtd, total_ctns, total_peso, total_amount, volume_usado_cbm: Math.round(volume_usado_cbm * 100) / 100, ocupacao_pct };
    };

    const recalcGlobais = (containers: any[]) => ({
        total_containers: containers.length,
        total_qtd: containers.reduce((s, c) => s + c.total_qtd, 0),
        total_amount: containers.reduce((s, c) => s + c.total_amount, 0),
    });

    const alterarQtdItemContainer = useCallback((containerId: string, itemIdx: number, novaQtd: number) => {
        if (novaQtd < 0) return;
        setContainerResult((prev: any) => {
            if (!prev) return prev;
            const cap = prev.capacidade_cbm || prev.containers?.[0]?.capacidade_cbm || 68;
            const newConts = prev.containers.map((c: any) => {
                if (c.id !== containerId) return c;
                const novosItens = c.itens.map((it: any, i: number) => {
                    if (i !== itemIdx) return it;
                    const qtd = novaQtd;
                    const unit_ctn = it.unit_ctn || 1;
                    const cbm_unit = it.cbm_unit || 0;
                    const gw = it.gw || (it.peso_total && it.qtd ? it.peso_total / it.qtd : 0);
                    const price = it.price || (it.amount && it.qtd ? it.amount / it.qtd : 0);
                    const ctns = Math.ceil(qtd / unit_ctn);
                    const cbm_total = Math.round(ctns * cbm_unit * 1000) / 1000;
                    const peso_total = Math.round(qtd * gw * 10) / 10;
                    const amount = Math.round(qtd * price * 100) / 100;
                    return { ...it, qtd, ctns, cbm_total, peso_total, amount };
                });
                return recalcContainer({ ...c, itens: novosItens }, cap);
            });
            return { ...prev, containers: newConts, ...recalcGlobais(newConts) };
        });
    }, []);

    const removerItemContainer = useCallback((containerId: string, itemIdx: number) => {
        setContainerResult((prev: any) => {
            if (!prev) return prev;
            const cap = prev.capacidade_cbm;
            const newConts = prev.containers.map((c: any) => {
                if (c.id !== containerId) return c;
                const novosItens = c.itens.filter((_: any, i: number) => i !== itemIdx);
                return recalcContainer({ ...c, itens: novosItens }, cap);
            }).filter((c: any) => c.itens.length > 0);
            return { ...prev, containers: newConts, ...recalcGlobais(newConts) };
        });
    }, []);

    const adicionarItemContainer = useCallback(async (containerId: string, sku: any, qtd: number) => {
        // Pede ao backend pra calcular o item com as dimensões corretas (MOQ + preços)
        try {
            const res = await api.importacaoV2SugestaoContainer({
                items: [{ codigo: sku.codigo, descricao: sku.descricao || sku.nome || '', qtd }],
                tipo: containerTipo,
                capacidade_custom: containerTipo === 'custom' ? containerCustomCap : undefined,
            });
            const novoItem = res?.containers?.[0]?.itens?.[0];
            const semDim = (res?.itens_sem_dimensoes || []).find((x: any) => x.codigo === sku.codigo);
            if (!novoItem) {
                toast.showToast(`Não foi possível adicionar ${sku.codigo}: ${semDim ? 'sem dimensões cadastradas (cadastre na tela MOQ)' : 'erro'}`, 'error');
                return;
            }
            setContainerResult((prev: any) => {
                if (!prev) return prev;
                const cap = prev.capacidade_cbm;
                const newConts = prev.containers.map((c: any) => {
                    if (c.id !== containerId) return c;
                    return recalcContainer({ ...c, itens: [...c.itens, novoItem] }, cap);
                });
                return { ...prev, containers: newConts, ...recalcGlobais(newConts) };
            });
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao calcular item', 'error');
        }
    }, [containerTipo, containerCustomCap, toast]);

    // ---- Sugestão de container ----
    const calcularContainers = useCallback(async (tipo?: string, capCustom?: number) => {
        // Pega só itens com "Comprar c/ MOQ" > 0 da análise atual (filtrada)
        const items = itensVisiveis
            .filter(it => it.qtd_sugerida > 0)
            .map(it => ({
                codigo: it.codigo,
                descricao: it.descricao || '',
                qtd: it.qtd_sugerida,
            }));
        if (items.length === 0) {
            toast.showToast('Não há itens para comprar (filtrados). Atualize ou ajuste os filtros.', 'info');
            return;
        }
        setContainerLoading(true);
        try {
            const res = await api.importacaoV2SugestaoContainer({
                items,
                tipo: tipo ?? containerTipo,
                capacidade_custom: tipo === 'custom' ? (capCustom ?? containerCustomCap) : undefined,
            });
            setContainerResult(res);
            setContainerOpen(true);
        } catch (e: any) {
            toast.showToast(e.message || 'Erro na sugestão de container', 'error');
        } finally {
            setContainerLoading(false);
        }
    }, [itensVisiveis, containerTipo, containerCustomCap]);

    const salvarContainerModelo = useCallback(async () => {
        if (!containerResult || !containerModeloNome.trim()) return;
        setContainerModeloSaving(true);
        try {
            await api.importacaoV2SalvarContainerModelo({
                nome: containerModeloNome.trim(),
                tipo_container: containerTipo,
                capacidade_cbm: containerResult.containers?.[0]?.capacidade_cbm || 68,
                containers: containerResult.containers,
            });
            toast.showToast('Modelo salvo com sucesso!', 'success');
            setContainerModeloNome('');
            setContainerModeloSaveOpen(false);
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao salvar', 'error');
        } finally {
            setContainerModeloSaving(false);
        }
    }, [containerResult, containerModeloNome, containerTipo]);

    const carregarContainerModelos = useCallback(async () => {
        try {
            const data = await api.importacaoV2ListarContainerModelos();
            setContainerModelos(data.modelos || []);
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao listar modelos', 'error');
        }
    }, []);

    // Reaplica: pega códigos+qtds do modelo salvo e re-roda o packing com os
    // parâmetros atuais (medidas/CBM/peso do MOQ e tipo de container escolhido).
    const reaplicarContainerModelo = useCallback(async (id: number) => {
        try {
            const data = await api.importacaoV2CarregarContainerModelo(id);
            const containers = data.containers || [];
            // Achata itens, somando qtd por código (caso o mesmo SKU apareça em 2+ containers)
            const acc: Record<string, { codigo: string; descricao: string; qtd: number }> = {};
            for (const c of containers) {
                for (const it of (c.itens || [])) {
                    const cod = String(it.codigo);
                    const qtd = Number(it.qtd) || 0;
                    if (!cod || qtd <= 0) continue;
                    if (!acc[cod]) acc[cod] = { codigo: cod, descricao: it.descricao || '', qtd: 0 };
                    acc[cod].qtd += qtd;
                }
            }
            const items = Object.values(acc);
            if (items.length === 0) {
                toast.showToast('Modelo sem itens para reaplicar', 'info');
                return;
            }
            setContainerLoading(true);
            const res = await api.importacaoV2SugestaoContainer({
                items,
                tipo: containerTipo,
                capacidade_custom: containerTipo === 'custom' ? containerCustomCap : undefined,
            });
            setContainerResult(res);
            setContainerModelosOpen(false);
            toast.showToast(`Modelo "${data.nome}" reaplicado (${items.length} SKUs, recalculado)`, 'success');
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao reaplicar', 'error');
        } finally {
            setContainerLoading(false);
        }
    }, [containerTipo, containerCustomCap]);

    const carregarContainerModelo = useCallback(async (id: number) => {
        try {
            const data = await api.importacaoV2CarregarContainerModelo(id);
            const containers = data.containers || [];
            // Recalcula totais a partir dos containers — o modelo salvo não traz os agregados globais
            const total_qtd = containers.reduce((s: number, c: any) => s + (Number(c.total_qtd) || 0), 0);
            const total_amount = containers.reduce((s: number, c: any) => s + (Number(c.total_amount) || 0), 0);
            const total_peso = containers.reduce((s: number, c: any) => s + (Number(c.total_peso) || 0), 0);
            const capacidade_cbm = containers[0]?.capacidade_cbm || 0;
            setContainerResult({
                containers,
                tipo: data.tipo_container || containerTipo,
                capacidade_cbm,
                total_containers: containers.length,
                total_qtd,
                total_amount,
                total_peso,
                capacidades_disponiveis: {},
                itens_sem_dimensoes: [],
            });
            setContainerModelosOpen(false);
            toast.showToast(`Modelo "${data.nome}" carregado`, 'success');
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao carregar', 'error');
        }
    }, [containerTipo]);

    const excluirContainerModelo = useCallback(async (id: number) => {
        try {
            await api.importacaoV2ExcluirContainerModelo(id);
            setContainerModelos(prev => prev.filter(m => m.id !== id));
            toast.showToast('Modelo excluído', 'success');
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao excluir', 'error');
        }
    }, []);

    // ---- Exportações ----
    const toggleFullscreen = useCallback(async () => {
        const el = tabelaRef.current;
        if (!el) return;
        if (document.fullscreenElement) { try { await document.exitFullscreen(); } catch {} }
        else { try { await el.requestFullscreen(); } catch (e) { console.warn('fullscreen failed', e); } }
    }, []);
    useEffect(() => {
        const onChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);

    const exportExcel = useCallback(async () => {
        if (itensVisiveis.length === 0) { toast.showToast('Nada para exportar', 'info'); return; }
        try {
            await api.importacaoV2BaixarXlsx(
                { qtd_meses: qtdMeses, modo, lead_time_default: leadDefault, nivel_servico_default: nivelDefault, threshold_sigma: threshold, codigos, overrides },
                itensVisiveis,
            );
            toast.showToast('Excel baixado', 'success');
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao gerar Excel', 'error');
        }
    }, [itensVisiveis, qtdMeses, modo, leadDefault, nivelDefault, threshold, codigos, overrides]);

    // PDF — segue padrão visual da Torre de Controle S&OP (logo EMPRESA, faixa vermelha, header/footer)
    const exportPdf = useCallback(async () => {
        if (itensVisiveis.length === 0) { toast.showToast('Nada para exportar', 'info'); return; }
        const ACCENT: [number, number, number] = [231, 76, 60];
        const DARK: [number, number, number] = [30, 41, 59];

        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const W = doc.internal.pageSize.getWidth();
        const H = doc.internal.pageSize.getHeight();

        // Logo EMPRESA (mesmo fetch do SOP)
        let logoB64: string | null = null;
        try {
            const resp = await fetch('/Logo-EMPRESA.png');
            const blob = await resp.blob();
            logoB64 = await new Promise<string>((res) => {
                const r = new FileReader();
                r.onloadend = () => res(r.result as string);
                r.readAsDataURL(blob);
            });
        } catch { /* sem logo */ }

        const dataHora = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
        const periodoTxt = `Janela: ${qtdMeses}m (${modo === 'corrido' ? 'corrido' : 'só meses c/ venda'}) · Prazo padrão: ${leadDefault}m · Confiança: ${(nivelDefault * 100).toFixed(0)}%`;

        const drawHeaderFooter = (pageNum: number, totalPages: number) => {
            doc.setFillColor(...ACCENT);
            doc.rect(0, 0, W, 3, 'F');
            if (logoB64) {
                doc.setFillColor(...ACCENT);
                doc.roundedRect(8, 6, 46, 18, 2, 2, 'F');
                try { doc.addImage(logoB64, 'PNG', 10, 8, 42, 14); } catch { }
            }
            doc.setTextColor(...DARK);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
            doc.text('Importação · Análise de Ruptura', 60, 14);
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
            doc.setTextColor(100, 116, 139);
            doc.text(periodoTxt, 60, 19);
            doc.text(`Gerado em: ${dataHora}`, 60, 23);
            doc.setDrawColor(...ACCENT); doc.setLineWidth(0.4);
            doc.line(10, 28, W - 10, 28);
            // rodapé
            doc.setDrawColor(...ACCENT); doc.setLineWidth(0.5);
            doc.line(10, H - 10, W - 10, H - 10);
            doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
            doc.setTextColor(120, 120, 120);
            doc.text('EMPRESA — Importação v2 (Setor Logística / Comex)', 10, H - 5);
            doc.text(`Página ${pageNum} de ${totalPages}`, W - 10, H - 5, { align: 'right' });
            doc.setFillColor(...ACCENT);
            doc.triangle(W, H, W - 10, H, W, H - 10, 'F');
        };

        // KPIs (cards)
        const kpis: Array<[string, string, [number, number, number]]> = [
            ['Total', String(resumo.total), [99, 102, 241]],
            ['Ruptura', String(resumo.ruptura), [239, 68, 68]],
            ['Atenção', String(resumo.atencao), [245, 158, 11]],
            ['OK', String(resumo.ok), [16, 185, 129]],
        ];
        const cardW = (W - 20 - 12) / 4;
        kpis.forEach((k, i) => {
            const x = 10 + i * (cardW + 4);
            doc.setFillColor(...k[2]); doc.roundedRect(x, 32, cardW, 12, 2, 2, 'F');
            doc.setTextColor(255, 255, 255);
            doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.text(k[0], x + 3, 37);
            doc.setFontSize(14); doc.text(k[1], x + 3, 42.5);
        });

        autoTable(doc, {
            startY: 48,
            head: [['Código', 'Descrição', 'Estoque', 'Trânsito', 'Prazo(m)', 'Conf.', 'MOQ', 'Venda/mês', 'Variação', 'Col.Seg.', 'Quando Comprar', 'Meses p/Zerar', 'Sugerido', 'Comprar c/ MOQ', 'Status']],
            body: itensVisiveis.map(it => [
                it.codigo,
                (it.descricao || '').slice(0, 38),
                it.estoque_disponivel.toLocaleString('pt-BR'),
                it.pipeline.toLocaleString('pt-BR'),
                `${it.lead_time}m`,
                `${(it.nivel_servico * 100).toFixed(0)}%`,
                (it.moq || 0).toLocaleString('pt-BR'),
                (it.consumo_mensal || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 }),
                it.sigma_mensal.toFixed(1),
                it.estoque_seguranca.toLocaleString('pt-BR'),
                it.ponto_reposicao.toLocaleString('pt-BR'),
                (it.cobertura_meses ?? 0).toFixed(1),
                (it.qtd_sugerida_pura ?? 0) ? (it.qtd_sugerida_pura ?? 0).toLocaleString('pt-BR') : '—',
                it.qtd_sugerida ? it.qtd_sugerida.toLocaleString('pt-BR') : '—',
                STATUS_STYLE[it.status].label,
            ]),
            theme: 'grid',
            headStyles: { fillColor: ACCENT, textColor: 255, fontSize: 8, halign: 'center' },
            bodyStyles: { fontSize: 7.5, textColor: DARK },
            alternateRowStyles: { fillColor: [248, 250, 252] },
            columnStyles: {
                0: { fontStyle: 'bold' },
                2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' },
                6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' }, 9: { halign: 'right' },
                10: { halign: 'right' }, 11: { halign: 'right' }, 12: { halign: 'right' },
                13: { halign: 'right', fontStyle: 'bold' },
                14: { halign: 'center' },
            },
            didParseCell: (data) => {
                if (data.section === 'body' && data.column.index === 14) {
                    const v = String(data.cell.raw);
                    if (v === 'Ruptura') { data.cell.styles.fillColor = [254, 226, 226]; data.cell.styles.textColor = [185, 28, 28]; data.cell.styles.fontStyle = 'bold'; }
                    else if (v === 'Atenção') { data.cell.styles.fillColor = [254, 243, 199]; data.cell.styles.textColor = [180, 83, 9]; data.cell.styles.fontStyle = 'bold'; }
                    else if (v === 'OK') { data.cell.styles.fillColor = [220, 252, 231]; data.cell.styles.textColor = [21, 128, 61]; data.cell.styles.fontStyle = 'bold'; }
                }
            },
            margin: { top: 32, left: 6, right: 6 },
            didDrawPage: () => {
                const total = (doc as any).internal.getNumberOfPages();
                drawHeaderFooter((doc as any).internal.getCurrentPageInfo().pageNumber, total);
            },
        });
        // ajusta total de páginas no footer
        const totalPages = (doc as any).internal.getNumberOfPages();
        for (let i = 1; i <= totalPages; i++) {
            doc.setPage(i);
            drawHeaderFooter(i, totalPages);
        }
        doc.save(`Importacao_v2_${new Date().toISOString().slice(0, 10)}.pdf`);
        toast.showToast('PDF gerado', 'success');
    }, [itensVisiveis, resumo, qtdMeses, modo, leadDefault, nivelDefault]);

    const versoesFiltradas = useMemo(() => {
        if (!filtroLabel) return versoes;
        return versoes.filter(v => (v.labels || []).includes(filtroLabel));
    }, [versoes, filtroLabel]);

    const aplicarModelo = (id: number) => {
        setModeloSelecionado(id);
        const m = modelos.find(x => x.id === id);
        if (!m) return;
        setCodigos(m.codigos);
        setQtdMeses(m.qtd_meses);
        setModo(m.modo);
        setOverrides(m.overrides || {});
        setThreshold(m.threshold_sigma);
    };

    const calcular = useCallback(async () => {
        if (codigos.length === 0) { toast.showToast('Selecione ao menos um item', 'error'); return; }
        setLoading(true);
        try {
            const res = await api.importacaoV2Calculate({
                codigos, qtd_meses: qtdMeses, modo,
                lead_time_default: leadDefault, nivel_servico_default: nivelDefault,
                threshold_sigma: threshold, overrides,
            });
            setItens(res.itens || []);
            setDataCalculo(res.data_calculo || '');
            toast.showToast('Cálculo atualizado', 'success');
        } catch (e: any) {
            toast.showToast(e.message || 'Erro no cálculo', 'error');
        } finally { setLoading(false); }
    }, [codigos, qtdMeses, modo, leadDefault, nivelDefault, threshold, overrides]);

    const setOverride = (cod: string, key: 'lead_time' | 'nivel_servico' | 'pipeline' | 'moq', val: number) => {
        setOverrides(prev => ({ ...prev, [cod]: { ...(prev[cod] || {}), [key]: val } as any }));
    };

    const removerCodigo = (cod: string) => {
        setCodigos(prev => prev.filter(c => c !== cod));
        setOverrides(prev => { const n = { ...prev }; delete n[cod]; return n; });
    };

    const adicionarCodigo = () => {
        const c = novoCodigo.trim();
        if (!c) return;
        if (codigos.includes(c)) { toast.showToast('Código já está na lista', 'info'); return; }
        setCodigos(prev => [...prev, c]);
        setNovoCodigo('');
    };

    const restaurarPadrao = () => {
        if (!defaults) return;
        setCodigos(defaults.codigos_padrao);
        setOverrides({});
        setDatasChegada({});
        // Recalcula localmente: zera pipeline mas MANTÉM MOQ (vem do banco, não é override)
        setItens(prev => prev.map(it => {
            const moqBase = it.moq || 0;
            const recalc = recalcSku(
                { ...it, pipeline: 0 },
                defaults.lead_time_default,
                defaults.nivel_servico_default,
                0,
                moqBase
            );
            return recalc;
        }));
        setQtdMeses(defaults.qtd_meses);
        setLeadDefault(defaults.lead_time_default);
        setNivelDefault(defaults.nivel_servico_default);
        setThreshold(defaults.threshold_sigma);
        setModeloSelecionado(0);
    };

    const salvarModelo = async () => {
        if (!modalNome || modalNome.trim() === '') return;
        try {
            await api.importacaoV2SalvarModelo({
                nome: modalNome.trim(), codigos, qtd_meses: qtdMeses, modo, overrides, threshold_sigma: threshold,
            });
            const m = await api.importacaoV2ListarModelos();
            setModelos(m.modelos || []);
            toast.showToast('Modelo salvo', 'success');
            setModalNome(null);
        } catch (e: any) { toast.showToast(e.message || 'Erro ao salvar modelo', 'error'); }
    };

    const excluirModelo = async (id: number) => {
        if (!confirm('Excluir este modelo?')) return;
        try {
            await api.importacaoV2ExcluirModelo(id);
            const m = await api.importacaoV2ListarModelos();
            setModelos(m.modelos || []);
            if (modeloSelecionado === id) setModeloSelecionado(0);
            toast.showToast('Modelo excluído', 'success');
        } catch (e: any) { toast.showToast(e.message || 'Erro ao excluir', 'error'); }
    };

    const toggleChartCod = (cod: string) => {
        setChartCods(prev => prev.includes(cod) ? prev.filter(c => c !== cod) : prev.length < 5 ? [...prev, cod] : prev);
    };

    // (itensRecalc, resumo, itensVisiveis foram movidos para antes das exportações para evitar TDZ)

    const itensFiltrados = useMemo(() => {
        const q = buscaItem.toLowerCase().trim();
        if (!q) return codigos;
        return codigos.filter(c => c.toLowerCase().includes(q));
    }, [codigos, buscaItem]);

    // Dados para o gráfico (merge por mes)
    const chartData = useMemo(() => {
        if (chartCods.length === 0) return [];
        const meses = new Set<string>();
        const map: Record<string, any> = {};
        chartCods.forEach(cod => {
            const it = itens.find(i => i.codigo === cod);
            if (!it) return;
            it.vendas_mensais.forEach(v => {
                meses.add(v.mes);
                if (!map[v.mes]) map[v.mes] = { mes: v.mes };
                map[v.mes][cod] = v.valor;
            });
        });
        return Array.from(meses).sort().map(m => map[m]);
    }, [chartCods, itens]);

    if (!defaults) return (
        <div className="p-6 flex items-center justify-center h-64">
            <div className="text-slate-500 flex items-center gap-2">
                <Sparkles className="w-5 h-5 animate-pulse text-indigo-500" />
                Carregando configuração…
            </div>
        </div>
    );

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-slate-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-950">
            <div className="p-4 sm:p-6 space-y-4 max-w-[1700px] mx-auto">

                {/* HEADER */}
                <header className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/30">
                            <Package className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400 bg-clip-text text-transparent">
                                Importação · Análise de Ruptura
                            </h1>
                            <p className="text-xs text-slate-500 mt-0.5">
                                Quando comprar, quanto comprar e quais itens estão em risco
                                {dataCalculo && <> · atualizado em {new Date(dataCalculo).toLocaleDateString('pt-BR')}</>}
                            </p>
                        </div>
                    </div>
                    <div className="flex gap-1.5 flex-wrap">
                        <Button variant="secondary" size="sm" onClick={abrirHistorico} title="Histórico"><History className="w-3.5 h-3.5" /><span className="inline ml-1">Histórico</span></Button>
                        <input ref={orderFileRef} type="file" accept=".xlsx,.xls,.xlsm" className="hidden"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) parseOrderListFile(f); }} />
                        <Button variant="secondary" size="sm" onClick={() => orderFileRef.current?.click()} title="Importar Order List (preenche Em Trânsito)">
                            <Truck className="w-3.5 h-3.5" /><span className="inline ml-1">Order List</span>
                        </Button>
                        <Button variant="secondary" size="sm" onClick={abrirHistoricoOrderLists} title="Histórico de Order Lists (últimas 30)">
                            <History className="w-3.5 h-3.5" /><span className="inline ml-1">Hist. Order</span>
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => calcularContainers()} title="Sugestão de container (bin-packing dos itens a comprar)" disabled={containerLoading}>
                            <Container className="w-3.5 h-3.5" /><span className="inline ml-1">{containerLoading ? 'Calculando…' : 'Container'}</span>
                        </Button>
                        <Button variant="secondary" size="sm" onClick={restaurarPadrao} title="Restaurar padrão"><RotateCcw className="w-3.5 h-3.5" /><span className="inline ml-1">Restaurar</span></Button>
                        <Button variant="secondary" size="sm" onClick={abrirModalSalvarVersao} title="Salvar versão"><Save className="w-3.5 h-3.5" /><span className="inline ml-1">Salvar versão</span></Button>
                        <Button variant="secondary" size="sm" onClick={exportExcel} title="Exportar Excel"><FileSpreadsheet className="w-3.5 h-3.5" /><span className="inline ml-1">Excel</span></Button>
                        <Button variant="secondary" size="sm" onClick={exportPdf} title="Exportar PDF"><FileDown className="w-3.5 h-3.5" /><span className="inline ml-1">PDF</span></Button>
                        <Button variant="whatsapp" size="sm" onClick={() => setWaOpen(true)} title="WhatsApp"><MessageSquare className="w-3.5 h-3.5" /><span className="inline ml-1">WhatsApp</span></Button>
                        {/* Tela cheia só em desktop com mouse (touch screens travavam) */}
                        <Button variant="secondary" size="sm" onClick={toggleFullscreen} title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'} className="hidden xl:inline-flex">{isFullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}<span className="ml-1">{isFullscreen ? 'Sair' : 'Tela cheia'}</span></Button>
                        <Button variant="primary" size="sm" onClick={calcular} disabled={loading}>
                            {loading ? <><Sparkles className="w-3.5 h-3.5 animate-pulse" /> <span className="hidden sm:inline">Calculando…</span></> : <><BarChart3 className="w-3.5 h-3.5" /> <span className="hidden sm:inline">Atualizar</span></>}
                        </Button>
                    </div>
                </header>

                {/* ABAS */}
                <div className="flex gap-1 border-b border-slate-200 dark:border-slate-700">
                    <button onClick={() => setAba('planejamento')}
                        className={`px-4 py-2 text-xs font-bold border-b-2 transition-colors ${aba === 'planejamento'
                            ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300'
                            : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>
                        Planejamento
                    </button>
                    <button onClick={() => setAba('simulador')}
                        className={`px-4 py-2 text-xs font-bold border-b-2 transition-colors ${aba === 'simulador'
                            ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300'
                            : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>
                        Simulador
                    </button>
                </div>

                {aba === 'simulador' && <SimuladorImportacao />}
                <div style={{ display: aba === 'planejamento' ? undefined : 'none' }} className="space-y-4">

                {/* PARAMETROS */}
                <Card className="border-indigo-100 dark:border-indigo-900/40 bg-white/80 dark:bg-slate-800/80 backdrop-blur">
                    <h3 className="text-[10px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400 mb-3 flex items-center gap-1.5">
                        <ListFilter className="w-3 h-3" /> Parâmetros da Análise
                    </h3>
                    <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                        <div className="flex flex-col">
                            <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold flex items-start min-h-[28px] leading-tight">Modelo<Hint tip="Conjuntos salvos de itens + parâmetros. Padrão usa os 27 SKUs e meses padrão." /></label>
                            <select value={modeloSelecionado} onChange={(e) => aplicarModelo(Number(e.target.value))}
                                className="w-full text-sm px-2 py-1.5 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900">
                                {modelos.map(m => (
                                    <option key={m.id} value={m.id}>{m.nome}{m.is_default ? '' : ' ✦'}</option>
                                ))}
                            </select>
                            {modeloSelecionado > 0 && (
                                <button onClick={() => excluirModelo(modeloSelecionado)} className="text-[10px] text-rose-600 hover:underline mt-1">Excluir modelo</button>
                            )}
                        </div>
                        <div className="flex flex-col">
                            <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold flex items-start min-h-[28px] leading-tight">Como contar os meses<Hint tip="‘Período corrido’ inclui meses sem venda (zero). ‘Só meses com venda’ ignora meses sem movimento." /></label>
                            <select value={modo} onChange={(e) => setModo(e.target.value as Modo)}
                                className="w-full text-sm px-2 py-1.5 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900">
                                <option value="corrido">Período corrido (com zeros)</option>
                                <option value="vendas">Só meses com venda</option>
                            </select>
                        </div>
                        <div className="flex flex-col">
                            <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold flex items-start min-h-[28px] leading-tight">Histórico (meses)<Hint tip={`Quantos meses passados analisar. Máximo: ${defaults.qtd_meses_max || defaults.limite_global_meses} (limite ${defaults.data_piso ? new Date(defaults.data_piso).toLocaleDateString('pt-BR', { month: '2-digit', year: '2-digit' }) : 'jan/23'}). Se o SKU tem menos histórico, usa o que tiver.`} /></label>
                            <input type="number" min={1} max={defaults.qtd_meses_max || defaults.limite_global_meses} value={qtdMeses}
                                onChange={(e) => {
                                    const v = Number(e.target.value);
                                    const max = defaults.qtd_meses_max || defaults.limite_global_meses;
                                    setQtdMeses(Math.max(1, Math.min(v, max)));
                                }}
                                className="w-full text-sm px-2 py-1.5 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                            {defaults.data_piso && (
                                <p className="text-[9px] text-slate-400 mt-0.5">máx {defaults.qtd_meses_max || defaults.limite_global_meses}m (piso {new Date(defaults.data_piso).toLocaleDateString('pt-BR', { month: '2-digit', year: 'numeric' })})</p>
                            )}
                        </div>
                        <div className="flex flex-col">
                            <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold flex items-start min-h-[28px] leading-tight">Prazo entrega (meses)<Hint tip="Tempo padrão entre comprar e receber, em meses. Editável por item. Ex: 3 = 90 dias." /></label>
                            <input type="number" step={0.5} min={0.5} max={36} value={leadDefault}
                                onChange={(e) => setLeadDefault(Number(e.target.value))}
                                className="w-full text-sm px-2 py-1.5 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                        </div>
                        <div className="flex flex-col">
                            <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold flex items-start min-h-[28px] leading-tight">Confiança<Hint tip="Probabilidade de não faltar produto. 0,90 = 90% de garantia." /></label>
                            <input type="number" step={0.01} min={0.5} max={0.99} value={nivelDefault}
                                onChange={(e) => setNivelDefault(Number(e.target.value))}
                                className="w-full text-sm px-2 py-1.5 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                        </div>
                        <div className="flex flex-col">
                            <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold flex items-start min-h-[28px] leading-tight">Sensibilidade picos/vales<Hint align="right" tip="Define quando um mês vira pico ou vale. Mede quanto a venda fugiu da média (em desvios padrão). 1,5 = padrão equilibrado · 2,0 = só extremos fortes · 1,0 = mais sensível, marca mais meses." /></label>
                            <input type="number" step={0.1} min={0.5} max={4} value={threshold}
                                onChange={(e) => setThreshold(Number(e.target.value))}
                                className="w-full text-sm px-2 py-1.5 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                            <p className="text-[9px] text-slate-400 mt-0.5">
                                {threshold < 1 ? '🔥 muito sensível' : threshold < 1.7 ? '✓ equilibrado' : threshold < 2.5 ? '🛡️ conservador' : '🔒 só extremos'}
                            </p>
                        </div>
                    </div>

                    {/* Itens — versão compacta */}
                    <div className="mt-4 flex items-center justify-between gap-3 p-3 rounded-lg bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/20 dark:to-purple-900/20 border border-indigo-100 dark:border-indigo-900/40">
                        <div className="flex items-center gap-2">
                            <Boxes className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                            <span className="text-sm font-bold text-indigo-900 dark:text-indigo-200">{codigos.length} {codigos.length === 1 ? 'item selecionado' : 'itens selecionados'}</span>
                            {codigos.length !== defaults.codigos_padrao.length && (
                                <span className="text-[10px] px-2 py-0.5 bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200 rounded-full font-bold">customizado</span>
                            )}
                        </div>
                        <Button variant="secondary" size="sm" onClick={() => setDrawerItensOpen(true)}>
                            <ListFilter className="w-3.5 h-3.5" /> Ver / Editar itens
                        </Button>
                    </div>
                </Card>

                {/* RESUMO — cards com gradiente */}
                {itens.length > 0 && (
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <Card className="bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-800 dark:to-slate-900 border-slate-200">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Total analisado</div>
                                    <div className="text-3xl font-black text-slate-700 dark:text-slate-200">{resumo.total}</div>
                                </div>
                                <Boxes className="w-8 h-8 text-slate-300" />
                            </div>
                        </Card>
                        <Card className="bg-gradient-to-br from-rose-50 to-rose-100 dark:from-rose-900/30 dark:to-rose-900/10 border-rose-200">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-rose-700 font-bold">Em ruptura</div>
                                    <div className="text-3xl font-black text-rose-600">{resumo.ruptura}</div>
                                </div>
                                <AlertCircle className="w-8 h-8 text-rose-300" />
                            </div>
                        </Card>
                        <Card className="bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-900/30 dark:to-amber-900/10 border-amber-200">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-amber-700 font-bold">Em atenção</div>
                                    <div className="text-3xl font-black text-amber-600">{resumo.atencao}</div>
                                </div>
                                <AlertTriangle className="w-8 h-8 text-amber-300" />
                            </div>
                        </Card>
                        <Card className="bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-900/30 dark:to-emerald-900/10 border-emerald-200">
                            <div className="flex items-center justify-between">
                                <div>
                                    <div className="text-[10px] uppercase tracking-wider text-emerald-700 font-bold">No verde</div>
                                    <div className="text-3xl font-black text-emerald-600">{resumo.ok}</div>
                                </div>
                                <CheckCircle2 className="w-8 h-8 text-emerald-300" />
                            </div>
                        </Card>
                    </div>
                )}

                {/* Filtros + comparar */}
                {itens.length > 0 && (
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-2 flex-wrap">
                            <div className="relative">
                                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
                                <input
                                    value={busca}
                                    onChange={(e) => setBusca(e.target.value)}
                                    placeholder="Buscar código ou descrição…"
                                    className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 w-64"
                                />
                                {busca && (
                                    <button onClick={() => setBusca('')} className="absolute right-2 top-2 text-slate-400 hover:text-rose-500">
                                        <X className="w-3 h-3" />
                                    </button>
                                )}
                            </div>
                            <span className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Status:</span>
                            {(['RUPTURA', 'ATENCAO', 'OK'] as const).map(s => {
                                const cfg = STATUS_STYLE[s];
                                const active = statusFilter.has(s);
                                return (
                                    <button key={s} onClick={() => toggleStatus(s)}
                                        className={`px-2 py-1 rounded-full text-[11px] font-bold transition-all ${active ? cfg.badge + ' shadow' : 'bg-white dark:bg-slate-800 text-slate-500 border border-slate-300 hover:border-slate-400'}`}>
                                        {active ? '✓ ' : ''}{cfg.label}
                                    </button>
                                );
                            })}
                            {(statusFilter.size > 0 || busca || sortBy) && (
                                <button onClick={() => { setStatusFilter(new Set()); setBusca(''); setSortBy(''); }}
                                    className="text-[11px] text-slate-500 hover:text-rose-600 underline">
                                    Limpar filtros
                                </button>
                            )}
                            <span className="text-[11px] text-slate-500">
                                Mostrando <strong>{itensVisiveis.length}</strong> de {itens.length}
                            </span>
                        </div>
                        <Button variant="secondary" size="sm" onClick={() => { setChartCods([]); setChartOpen(true); }}>
                            <LineChartIcon className="w-3.5 h-3.5" /> Comparar produtos
                        </Button>
                    </div>
                )}

                {/* MOBILE — Cards (visível abaixo de md) */}
                <div className="md:hidden space-y-2">
                    {itensVisiveis.length === 0 && (
                        <Card className="text-center py-8 text-slate-400">
                            <Sparkles className="w-8 h-8 mx-auto mb-2 text-indigo-300" />
                            {itens.length === 0 ? <p>Nenhum cálculo ainda. Clique em <strong>Atualizar</strong>.</p> : <p>Nenhum item corresponde aos filtros</p>}
                        </Card>
                    )}
                    {itensVisiveis.map(it => {
                        const cfg = STATUS_STYLE[it.status];
                        return (
                            <Card key={it.codigo} className={`border-l-4 ${cfg.rowBorder} active:scale-[0.99] transition-transform`}
                                onDoubleClick={() => { setChartCods([it.codigo]); setChartOpen(true); }}
                                title="Duplo-toque para ver o gráfico">
                                <div className="flex items-start justify-between gap-2 mb-2">
                                    <div className="flex-1 min-w-0">
                                        <div className="flex items-center gap-2">
                                            <span className="font-mono font-bold text-indigo-700 dark:text-indigo-400 text-sm">{it.codigo}</span>
                                            {it.aviso && <span title={it.aviso} className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-amber-100 text-amber-700"><AlertTriangle className="w-2.5 h-2.5" /></span>}
                                        </div>
                                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 truncate">{it.descricao || '—'}</p>
                                    </div>
                                    <StatusBadge s={it.status} />
                                </div>
                                <div className="grid grid-cols-3 gap-2 text-[11px]">
                                    <div><div className="text-slate-400 uppercase tracking-wider text-[9px]">Estoque</div><div className="font-bold">{it.estoque_disponivel.toLocaleString('pt-BR')}</div></div>
                                    <div><div className="text-slate-400 uppercase tracking-wider text-[9px]">Venda/mês</div><div className="font-bold">{(it.consumo_mensal || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</div></div>
                                    <div><div className="text-slate-400 uppercase tracking-wider text-[9px]">Meses p/ Zerar</div><div className={`font-bold ${(it.cobertura_meses ?? 99) < 1 ? 'text-rose-600' : (it.cobertura_meses ?? 99) < 3 ? 'text-amber-600' : 'text-emerald-600'}`}>{(it.cobertura_meses ?? 0).toFixed(1)}</div></div>
                                    <div><div className="text-slate-400 uppercase tracking-wider text-[9px]">Col. Segurança</div><div>{it.estoque_seguranca.toLocaleString('pt-BR')}</div></div>
                                    <div><div className="text-slate-400 uppercase tracking-wider text-[9px]">Quando Comprar</div><div className="font-bold">{it.ponto_reposicao.toLocaleString('pt-BR')}</div></div>
                                    <div><div className="text-slate-400 uppercase tracking-wider text-[9px]">Comprar c/ MOQ</div><div className="font-bold text-indigo-600">{it.qtd_sugerida > 0 ? it.qtd_sugerida.toLocaleString('pt-BR') : '—'}{it.qtd_sugerida > (it.qtd_sugerida_pura ?? 0) && <span className="text-amber-500 ml-0.5">↑</span>}</div></div>
                                </div>
                                {/* Edição inline mobile (compacta) */}
                                <details className="mt-2" onClick={(e) => e.stopPropagation()}>
                                    <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-indigo-600">Editar Pipeline / Prazo / Confiança / MOQ</summary>
                                    <div className="grid grid-cols-2 gap-2 mt-2 text-[11px]">
                                        <label className="flex flex-col gap-0.5">
                                            <span className="text-[9px] uppercase tracking-wider text-slate-500">Em Trânsito</span>
                                            <NumberCell tint="amber" value={overrides[it.codigo]?.pipeline ?? it.pipeline} onCommit={(v) => setOverride(it.codigo, 'pipeline', v)} />
                                        </label>
                                        <label className="flex flex-col gap-0.5">
                                            <span className="text-[9px] uppercase tracking-wider text-slate-500">Prazo (m)</span>
                                            <NumberCell tint="amber" value={overrides[it.codigo]?.lead_time ?? it.lead_time} step={0.5} min={0.5} max={36} onCommit={(v) => setOverride(it.codigo, 'lead_time', v)} suffix="m" />
                                        </label>
                                        <label className="flex flex-col gap-0.5">
                                            <span className="text-[9px] uppercase tracking-wider text-slate-500">Confiança</span>
                                            <NumberCell tint="amber" value={overrides[it.codigo]?.nivel_servico ?? it.nivel_servico} step={0.01} min={0.5} max={0.99} onCommit={(v) => setOverride(it.codigo, 'nivel_servico', v)} />
                                        </label>
                                        <label className="flex flex-col gap-0.5">
                                            <span className="text-[9px] uppercase tracking-wider text-slate-500">MOQ</span>
                                            <NumberCell tint="amber" value={(overrides[it.codigo] as any)?.moq ?? (it.moq || 0)} min={0} onCommit={(v) => setOverride(it.codigo, 'moq', v)} />
                                        </label>
                                    </div>
                                </details>
                            </Card>
                        );
                    })}
                </div>

                {/* DESKTOP — Tabela (visível a partir de md) */}
                <Card noPadding className="hidden md:block overflow-hidden bg-white/95 dark:bg-slate-800/95 backdrop-blur shadow-lg" >
                    <div
                        ref={tabelaRef}
                        className={`overflow-auto relative ${isFullscreen ? 'bg-white dark:bg-slate-900 max-h-screen p-4' : 'max-h-[calc(100vh-260px)]'}`}
                    >
                        {isFullscreen && (
                            <button
                                onClick={toggleFullscreen}
                                className="fixed top-2 right-2 z-[9999] inline-flex items-center gap-2 px-5 py-3 rounded-full bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-bold shadow-[0_8px_30px_rgba(0,0,0,0.4)] text-base animate-pulse"
                                title="Sair da tela cheia (ESC)"
                            >
                                <Minimize2 className="w-5 h-5" /> SAIR
                            </button>
                        )}
                        <table className="w-full text-xs">
                            <thead className="bg-gradient-to-r from-indigo-50 via-purple-50 to-indigo-50 dark:from-indigo-950/40 dark:via-purple-950/40 dark:to-indigo-950/40 sticky top-0 z-30">
                                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-300 font-bold whitespace-nowrap select-none">
                                    <th onClick={() => toggleSort('codigo')} className="px-2 py-3 border-l-4 border-l-transparent cursor-pointer group hover:bg-indigo-100/40">Código<SortIcon k="codigo" /></th>
                                    <th onClick={() => toggleSort('descricao')} className="px-2 py-3 cursor-pointer group hover:bg-indigo-100/40">Descrição<SortIcon k="descricao" /></th>
                                    <th onClick={() => toggleSort('estoque_disponivel')} className="px-2 py-3 text-right cursor-pointer group hover:bg-indigo-100/40">Estoque<SortIcon k="estoque_disponivel" /></th>
                                    <th className="px-2 py-3 text-right" title="Quantidade já comprada que vai chegar">Em Trânsito <span className="text-amber-500">✎</span></th>
                                    <th className="px-2 py-3 text-right" title="Tempo entre comprar e receber, em meses">Prazo (m) <span className="text-amber-500">✎</span></th>
                                    <th className="px-2 py-3 text-right" title="Probabilidade de não faltar">Confiança <span className="text-amber-500">✎</span></th>
                                    <th className="px-2 py-3 text-right" title="Lote mínimo de compra — pré-carregado de ParametrosImportacao.xlsx (UNIT/CTN, caixa fechada). Editável.">MOQ <span className="text-amber-500">✎</span></th>
                                    <th onClick={() => toggleSort('consumo_mensal')} className="px-2 py-3 text-right cursor-pointer group hover:bg-indigo-100/40" title="Média mensal calculada sobre os meses com venda (ignora meses zerados)">Venda/mês<SortIcon k="consumo_mensal" /></th>
                                    <th onClick={() => toggleSort('sigma_mensal')} className="px-2 py-3 text-right cursor-pointer group hover:bg-indigo-100/40" title="Quanto a venda mensal varia (desvio padrão)">Variação<SortIcon k="sigma_mensal" /></th>
                                    <th onClick={() => toggleSort('estoque_seguranca')} className="px-2 py-3 text-right cursor-pointer group hover:bg-indigo-100/40" title="Colchão contra variação da demanda durante o prazo: Z × σ × √(Prazo). NÃO inclui a demanda do prazo — essa está somada em 'Quando Comprar'.">Col. Segurança<SortIcon k="estoque_seguranca" /></th>
                                    <th onClick={() => toggleSort('ponto_reposicao')} className="px-2 py-3 text-right cursor-pointer group hover:bg-indigo-100/40" title="Prazo × Venda/mês + Est. Mínimo. Quando o estoque chegar nesse número, comprar.">Quando Comprar<SortIcon k="ponto_reposicao" /></th>
                                    <th onClick={() => toggleSort('cobertura_meses')} className="px-2 py-3 text-right cursor-pointer group hover:bg-indigo-100/40" title="Quantos meses o estoque atual dura no ritmo de venda">Meses p/ Zerar<SortIcon k="cobertura_meses" /></th>
                                    <th onClick={() => toggleSort('qtd_sugerida_pura')} className="px-2 py-3 text-right cursor-pointer group hover:bg-indigo-100/40" title="Quantidade ideal a comprar (Ponto de Reposição − Estoque), sem considerar MOQ">Sugerido<SortIcon k="qtd_sugerida_pura" /></th>
                                    <th onClick={() => toggleSort('qtd_sugerida')} className="px-3 py-3 text-right cursor-pointer group hover:bg-indigo-100/40 min-w-[110px]" title="Quantidade final aplicando o lote mínimo (MOQ). Se a sugestão for menor que o MOQ, sobe pro MOQ.">Comprar c/ MOQ<SortIcon k="qtd_sugerida" /></th>
                                    <th className="px-2 py-3 text-center" title="Gráfico de vendas mensais (passe o cursor para detalhes)">Vendas por mês</th>
                                    <th className="px-2 py-3 text-center" title="Meses com pico (venda muito alta) ou vale (venda muito baixa)">Picos / Vales</th>
                                    <th onClick={() => toggleSort('status')} className="px-3 py-3 cursor-pointer group hover:bg-indigo-100/40 sticky right-0 bg-gradient-to-r from-indigo-50 via-purple-50 to-indigo-50 dark:from-indigo-950/40 dark:via-purple-950/40 dark:to-indigo-950/40 shadow-[-6px_0_10px_-4px_rgba(0,0,0,0.15)] z-40 min-w-[120px]">Status<SortIcon k="status" /></th>
                                </tr>
                            </thead>
                            <tbody>
                                {itens.length === 0 && (
                                    <tr><td colSpan={17} className="text-center py-12 text-slate-400">
                                        <Sparkles className="w-8 h-8 mx-auto mb-2 text-indigo-300" />
                                        <p>Nenhum cálculo ainda</p>
                                        <p className="text-[11px] mt-1">Clique em <strong>Atualizar</strong> para começar</p>
                                    </td></tr>
                                )}
                                {itens.length > 0 && itensVisiveis.length === 0 && (
                                    <tr><td colSpan={17} className="text-center py-8 text-slate-400">
                                        <Search className="w-6 h-6 mx-auto mb-2 text-slate-300" />
                                        <p className="text-xs">Nenhum item corresponde aos filtros</p>
                                    </td></tr>
                                )}
                                {itensVisiveis.map((it, idx) => {
                                    const cfg = STATUS_STYLE[it.status];
                                    return (
                                        <tr
                                            key={it.codigo}
                                            onDoubleClick={(e) => {
                                                const tg = e.target as HTMLElement;
                                                if (tg.tagName === 'INPUT' || tg.tagName === 'BUTTON' || tg.closest('button') || tg.closest('input')) return;
                                                setChartCods([it.codigo]); setChartOpen(true);
                                            }}
                                            title="Duplo-clique para ver o gráfico"
                                            className={`h-12 border-t border-slate-100 dark:border-slate-700 border-l-4 ${cfg.rowBorder} ${cfg.rowBg} ${idx % 2 ? 'bg-slate-50/30 dark:bg-slate-900/10' : ''} cursor-pointer transition-colors`}
                                        >
                                            <td className="px-2 py-2 font-mono font-bold text-indigo-700 dark:text-indigo-400">{it.codigo}</td>
                                            <td className="px-2 py-2 text-slate-600 dark:text-slate-300 max-w-[180px] truncate" title={it.descricao}>{it.descricao || '—'}</td>
                                            <td className="px-2 py-2 text-right font-semibold tabular-nums">{it.estoque_disponivel.toLocaleString('pt-BR')}</td>
                                            <td className="px-2 py-2 relative" title={datasChegada[it.codigo] ? `Previsão de entrega: ${new Date(datasChegada[it.codigo]).toLocaleDateString('pt-BR')}` : ''}>
                                                <div className="flex items-center gap-1 justify-end">
                                                    <NumberCell tint="amber" value={overrides[it.codigo]?.pipeline ?? it.pipeline} onCommit={(v) => setOverride(it.codigo, 'pipeline', v)} />
                                                    {datasChegada[it.codigo] && (
                                                        <span className="text-[9px] text-amber-600 dark:text-amber-400 whitespace-nowrap" title={`Previsão: ${new Date(datasChegada[it.codigo]).toLocaleDateString('pt-BR')}`}>
                                                            ⏳{new Date(datasChegada[it.codigo]).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                            <td className="px-2 py-2"><NumberCell tint="amber" value={overrides[it.codigo]?.lead_time ?? it.lead_time} step={0.5} min={0.5} max={36} onCommit={(v) => setOverride(it.codigo, 'lead_time', v)} suffix="m" /></td>
                                            <td className="px-2 py-2"><NumberCell tint="amber" value={overrides[it.codigo]?.nivel_servico ?? it.nivel_servico} step={0.01} min={0.5} max={0.99} onCommit={(v) => setOverride(it.codigo, 'nivel_servico', v)} /></td>
                                            <td className="px-2 py-2"><NumberCell tint="amber" value={(overrides[it.codigo] as any)?.moq ?? (it.moq || 0)} min={0} onCommit={(v) => setOverride(it.codigo, 'moq', v)} /></td>
                                            <td className="px-2 py-2 text-right tabular-nums">{(it.consumo_mensal || 0).toLocaleString('pt-BR', { maximumFractionDigits: 0 })}</td>
                                            <td className="px-2 py-2 text-right tabular-nums">{it.sigma_mensal.toFixed(1)}</td>
                                            <td className="px-2 py-2 text-right tabular-nums">{it.estoque_seguranca.toLocaleString('pt-BR')}</td>
                                            <td className="px-2 py-2 text-right tabular-nums font-bold text-slate-800 dark:text-slate-100">{it.ponto_reposicao.toLocaleString('pt-BR')}</td>
                                            <td className={`px-2 py-2 text-right tabular-nums font-bold ${(it.cobertura_meses ?? 99) < 1 ? 'text-rose-600' : (it.cobertura_meses ?? 99) < 3 ? 'text-amber-600' : 'text-emerald-600'}`}>{(it.cobertura_meses ?? 0).toFixed(1)}</td>
                                            <td className="px-2 py-2 text-right tabular-nums text-slate-700 dark:text-slate-300">{(it.qtd_sugerida_pura ?? 0) > 0 ? (it.qtd_sugerida_pura ?? 0).toLocaleString('pt-BR') : '—'}</td>
                                            <td className="px-3 py-2 text-right tabular-nums font-bold text-indigo-600 dark:text-indigo-400 whitespace-nowrap min-w-[110px]"
                                                title={it.qtd_sugerida > (it.qtd_sugerida_pura ?? 0) ? `Sugerido ${(it.qtd_sugerida_pura ?? 0).toLocaleString('pt-BR')} foi ajustado para o MOQ ${it.moq.toLocaleString('pt-BR')}` : ''}>
                                                {it.qtd_sugerida > 0 ? it.qtd_sugerida.toLocaleString('pt-BR') : '—'}
                                                {it.qtd_sugerida > (it.qtd_sugerida_pura ?? 0) && (
                                                    <span className="ml-0.5 inline-block text-amber-500" title="Ajustado para o MOQ">↑</span>
                                                )}
                                            </td>
                                            <td className="px-2 py-2 text-center"><Sparkline data={it.vendas_mensais} status={it.status} /></td>
                                            <td className="px-2 py-2 text-center">
                                                {it.outliers.length === 0 ? <span className="text-slate-300">—</span> : (
                                                    <div className="flex gap-1 justify-center items-center overflow-x-auto max-w-[260px] no-scrollbar" title={it.outliers.map(descricaoOutlier).join('\n')}>
                                                        {it.outliers.map((o, i) => (
                                                            <span key={i} title={descricaoOutlier(o)}
                                                                className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold shadow-sm whitespace-nowrap ${o.tipo === 'pico' ? 'bg-blue-100 text-blue-700 border border-blue-200' : 'bg-orange-100 text-orange-700 border border-orange-200'}`}>
                                                                {o.tipo === 'pico' ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                                                                {fmtMes(o.mes)}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="px-3 py-2 sticky right-0 z-20 bg-white dark:bg-slate-800 shadow-[-6px_0_10px_-4px_rgba(0,0,0,0.15)] min-w-[120px]">
                                                <div className="flex items-center gap-1.5">
                                                    <StatusBadge s={it.status} />
                                                    {it.aviso && (
                                                        <span
                                                            title={it.aviso}
                                                            className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 cursor-help hover:bg-amber-200"
                                                        >
                                                            <AlertTriangle className="w-3 h-3" />
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </Card>
            </div>

            {/* DRAWER de Itens */}
            {drawerItensOpen && (
                <div className="fixed inset-0 z-40" onClick={() => setDrawerItensOpen(false)}>
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
                    <div onClick={(e) => e.stopPropagation()} className="absolute top-16 right-0 bottom-2 rounded-l-2xl w-full max-w-md bg-white dark:bg-slate-800 shadow-2xl flex flex-col">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/30 dark:to-purple-950/30">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="font-bold text-base flex items-center gap-2"><Boxes className="w-4 h-4 text-indigo-600" /> Itens da análise</h3>
                                <button onClick={() => setDrawerItensOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X className="w-4 h-4" /></button>
                            </div>
                            <p className="text-xs text-slate-500">{codigos.length} {codigos.length === 1 ? 'item' : 'itens'} · adicione, remova ou busque</p>
                        </div>
                        <div className="p-4 space-y-3 border-b border-slate-200 dark:border-slate-700">
                            <div className="relative">
                                <Search className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-400" />
                                <input
                                    value={buscaItem}
                                    onChange={(e) => setBuscaItem(e.target.value)}
                                    placeholder="Buscar SKU..."
                                    className="w-full pl-8 pr-2 py-2 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                            </div>
                            <div className="flex gap-2">
                                <input
                                    value={novoCodigo}
                                    onChange={(e) => setNovoCodigo(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter') adicionarCodigo(); }}
                                    placeholder="Adicionar SKU…"
                                    className="flex-1 px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                                <Button variant="primary" size="sm" onClick={adicionarCodigo}><Plus className="w-3.5 h-3.5" /> Add</Button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-1">
                            {itensFiltrados.length === 0 && <p className="text-sm text-slate-400 text-center py-8">Nenhum SKU encontrado</p>}
                            {itensFiltrados.map(c => {
                                const it = itens.find(i => i.codigo === c);
                                const cfg = it ? STATUS_STYLE[it.status] : null;
                                return (
                                    <div key={c} className="flex items-center justify-between gap-2 p-2 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-900/50 group">
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <span className="font-mono text-sm font-bold text-indigo-700 dark:text-indigo-400">{c}</span>
                                                {cfg && <span className={`w-2 h-2 rounded-full ${cfg.badge.split(' ')[0]}`}></span>}
                                            </div>
                                            {it && <p className="text-[11px] text-slate-500 truncate">{it.descricao || '—'}</p>}
                                        </div>
                                        <button onClick={() => removerCodigo(c)} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/30 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                                            <X className="w-4 h-4" />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="p-3 border-t border-slate-200 dark:border-slate-700 flex justify-between gap-2">
                            <Button variant="secondary" size="sm" onClick={() => { restaurarPadrao(); setDrawerItensOpen(false); }}><RotateCcw className="w-3.5 h-3.5" /> Restaurar padrão</Button>
                            <Button variant="primary" size="sm" onClick={() => { setDrawerItensOpen(false); calcular(); }}><BarChart3 className="w-3.5 h-3.5" /> Aplicar e calcular</Button>
                        </div>
                    </div>
                </div>
            )}

            {/* MODAL Gráfico */}
            {chartOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setChartOpen(false)}>
                    <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col overflow-hidden">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-950/40 dark:to-purple-950/40 flex items-center justify-between">
                            <div>
                                <h3 className="font-bold text-lg flex items-center gap-2">
                                    <LineChartIcon className="w-5 h-5 text-indigo-600" /> Histórico de Vendas
                                </h3>
                                <p className="text-xs text-slate-500">Selecione até 5 produtos para comparar</p>
                            </div>
                            <button onClick={() => setChartOpen(false)} className="p-2 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="flex-1 overflow-hidden flex">
                            {/* lista de produtos à esquerda */}
                            <div className="w-72 border-r border-slate-200 dark:border-slate-700 overflow-y-auto p-3 bg-slate-50 dark:bg-slate-900/50">
                                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2">Selecionados: {chartCods.length}/5</p>
                                {itens.map(it => {
                                    const sel = chartCods.includes(it.codigo);
                                    const cfg = STATUS_STYLE[it.status];
                                    const color = sel ? CHART_COLORS[chartCods.indexOf(it.codigo)] : undefined;
                                    return (
                                        <button
                                            key={it.codigo}
                                            onClick={() => toggleChartCod(it.codigo)}
                                            disabled={!sel && chartCods.length >= 5}
                                            className={`w-full text-left px-2 py-1.5 rounded-lg flex items-center gap-2 mb-1 text-xs transition-all ${sel ? 'bg-white dark:bg-slate-800 shadow-md ring-2' : 'hover:bg-white/60 dark:hover:bg-slate-800/60 disabled:opacity-40'}`}
                                            style={sel ? { boxShadow: `0 0 0 2px ${color}` } : {}}
                                        >
                                            <span className={`w-2 h-2 rounded-full ${cfg.badge.split(' ')[0]}`}></span>
                                            <div className="flex-1 min-w-0">
                                                <div className="font-mono font-bold">{it.codigo}</div>
                                                <div className="text-[10px] text-slate-500 truncate">{it.descricao}</div>
                                            </div>
                                            {sel && <div className="w-3 h-3 rounded-full" style={{ background: color }}></div>}
                                        </button>
                                    );
                                })}
                            </div>
                            {/* gráfico à direita */}
                            <div className="flex-1 p-4">
                                {chartCods.length === 0 ? (
                                    <div className="h-full flex items-center justify-center text-slate-400">
                                        <div className="text-center">
                                            <LineChartIcon className="w-12 h-12 mx-auto mb-2 text-slate-300" />
                                            <p className="text-sm">Selecione produtos à esquerda para ver o histórico</p>
                                        </div>
                                    </div>
                                ) : (
                                    <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={chartData} margin={{ top: 20, right: 30, bottom: 30, left: 10 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                                            <XAxis dataKey="mes" tick={{ fontSize: 11 }} tickFormatter={fmtMes} />
                                            <YAxis tick={{ fontSize: 11 }} />
                                            <Tooltip
                                                contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0' }}
                                                labelFormatter={(m: any) => `Vendas em ${fmtMes(m)}`}
                                                formatter={(v: any) => [Number(v).toLocaleString('pt-BR') + ' un.', '']}
                                            />
                                            <Legend wrapperStyle={{ fontSize: 11 }} />
                                            {chartCods.map((cod, i) => (
                                                <Line key={cod} type="monotone" dataKey={cod} stroke={CHART_COLORS[i]} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }}>
                                                    <LabelList
                                                        dataKey={cod}
                                                        position="top"
                                                        offset={8}
                                                        style={{ fill: CHART_COLORS[i], fontSize: 10, fontWeight: 700 }}
                                                        formatter={(v: any) => (v != null ? Number(v).toLocaleString('pt-BR') : '')}
                                                    />
                                                </Line>
                                            ))}
                                        </LineChart>
                                    </ResponsiveContainer>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* DRAWER Histórico de Versões */}
            {historicoOpen && (
                <div className="fixed inset-0 z-40" onClick={() => setHistoricoOpen(false)}>
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
                    <div onClick={(e) => e.stopPropagation()} className="absolute top-16 right-0 bottom-2 rounded-l-2xl w-full max-w-xl bg-white dark:bg-slate-800 shadow-2xl flex flex-col">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-950/30 dark:to-pink-950/30">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="font-bold text-base flex items-center gap-2"><History className="w-4 h-4 text-purple-600" /> Histórico de Versões</h3>
                                <button onClick={() => setHistoricoOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X className="w-4 h-4" /></button>
                            </div>
                            <p className="text-xs text-slate-500">{versoes.length} {versoes.length === 1 ? 'versão salva' : 'versões salvas'} · todos os usuários veem todas · <span className="text-amber-600">retenção 30 dias</span></p>
                            {labelsDisponiveis.length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-2">
                                    <button onClick={() => setFiltroLabel('')} className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${!filtroLabel ? 'bg-purple-600 text-white' : 'bg-white dark:bg-slate-700 text-slate-600 border border-slate-300'}`}>todos</button>
                                    {labelsDisponiveis.map(l => (
                                        <button key={l} onClick={() => setFiltroLabel(l === filtroLabel ? '' : l)}
                                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${filtroLabel === l ? 'bg-purple-600 text-white' : 'bg-white dark:bg-slate-700 text-slate-600 border border-slate-300'}`}>{l}</button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-2">
                            {versoesFiltradas.length === 0 && (
                                <div className="text-center py-12 text-slate-400">
                                    <History className="w-12 h-12 mx-auto mb-2 text-slate-300" />
                                    <p className="text-sm">Nenhuma versão ainda</p>
                                    <p className="text-[11px] mt-1">Salve a análise atual em "Salvar versão"</p>
                                </div>
                            )}
                            {versoesFiltradas.map(v => (
                                <div key={v.id} className="p-3 rounded-xl bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800 border border-slate-200 dark:border-slate-700 hover:shadow-md transition-shadow">
                                    <div className="flex items-start justify-between gap-2 mb-1">
                                        <h4 className="font-bold text-sm flex-1 truncate" title={v.nome}>{v.nome}</h4>
                                        <button onClick={() => excluirVersao(v.id)} className="p-1 text-slate-400 hover:text-rose-600 rounded" title="Excluir"><Trash2 className="w-3.5 h-3.5" /></button>
                                    </div>
                                    <div className="flex items-center gap-3 text-[11px] text-slate-500 mb-2">
                                        <span className="flex items-center gap-1"><UserIcon className="w-3 h-3" />{v.user_nome}</span>
                                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{v.created_at ? new Date(v.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                                    </div>
                                    {v.labels && v.labels.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mb-1.5">
                                            {v.labels.map((l: string, i: number) => (
                                                <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded text-[10px] font-bold">
                                                    <Tag className="w-2.5 h-2.5" />{l}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    {v.observacao && <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1.5 italic">"{v.observacao}"</p>}
                                    {v.parametros && (
                                        <div className="text-[10px] text-slate-400 mt-1.5 flex gap-2 flex-wrap">
                                            <span>{v.parametros.codigos?.length || 0} itens</span>
                                            <span>·</span>
                                            <span>{v.parametros.qtd_meses}m {v.parametros.modo}</span>
                                            <span>·</span>
                                            <span>LT {v.parametros.lead_time_default}m</span>
                                            <span>·</span>
                                            <span>{(v.parametros.nivel_servico_default * 100).toFixed(0)}% conf</span>
                                        </div>
                                    )}
                                    <div className="flex gap-1.5 mt-2.5 pt-2 border-t border-slate-100 dark:border-slate-700">
                                        <button onClick={() => carregarVersao(v.id)}
                                            className="flex-1 px-2 py-1.5 text-[11px] bg-indigo-100 hover:bg-indigo-200 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300 rounded font-bold transition-colors"
                                            title="Carrega o snapshot completo (dados exatos do momento que foi salvo)">
                                            📥 Recarregar salvos
                                        </button>
                                        <button onClick={() => recalcularVersao(v.id)}
                                            className="flex-1 px-2 py-1.5 text-[11px] bg-emerald-100 hover:bg-emerald-200 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300 rounded font-bold transition-colors"
                                            title="Aplica os filtros salvos e recalcula com vendas/estoque atuais do BigQuery">
                                            🔄 Recalcular agora
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Modal Salvar Versão */}
            {modalVersao !== null && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setModalVersao(null)}>
                    <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 w-full max-w-lg">
                        <h3 className="font-bold text-lg mb-3 flex items-center gap-2"><Tag className="w-5 h-5 text-purple-600" /> Salvar versão</h3>
                        <p className="text-xs text-slate-500 mb-3">Salva um snapshot completo (parâmetros + resultado). Visível para todos.</p>
                        <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Nome da versão *</label>
                        <input
                            autoFocus
                            value={modalVersao.nome}
                            onChange={(e) => setModalVersao({ ...modalVersao, nome: e.target.value })}
                            placeholder="Ex: Compra Q2 2026 — fechamento"
                            className="w-full px-3 py-2 mt-1 mb-3 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                        />
                        <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Labels</label>
                        <div className="flex flex-wrap gap-1.5 mt-1 mb-2">
                            {labelsPadrao.map(l => (
                                <button key={l} onClick={() => toggleLabelVersao(l)}
                                    className={`px-2 py-1 rounded-full text-[11px] font-bold transition-all ${modalVersao.labels.includes(l) ? 'bg-purple-600 text-white shadow' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-purple-100'}`}>
                                    {modalVersao.labels.includes(l) ? '✓ ' : ''}{l}
                                </button>
                            ))}
                        </div>
                        {modalVersao.labels.filter(l => !labelsPadrao.includes(l)).length > 0 && (
                            <div className="flex flex-wrap gap-1.5 mb-2">
                                {modalVersao.labels.filter(l => !labelsPadrao.includes(l)).map(l => (
                                    <span key={l} className="inline-flex items-center gap-1 px-2 py-1 bg-pink-100 text-pink-700 rounded-full text-[11px] font-bold">
                                        ✦ {l}
                                        <button onClick={() => toggleLabelVersao(l)}><X className="w-3 h-3" /></button>
                                    </span>
                                ))}
                            </div>
                        )}
                        <div className="flex gap-2 mb-3">
                            <input
                                value={modalVersao.labelInput}
                                onChange={(e) => setModalVersao({ ...modalVersao, labelInput: e.target.value })}
                                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLabelCustom(); } }}
                                placeholder="Criar label personalizada…"
                                className="flex-1 px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                            />
                            <Button variant="secondary" size="sm" onClick={addLabelCustom}><Plus className="w-3.5 h-3.5" /></Button>
                        </div>
                        <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Observação (opcional)</label>
                        <textarea
                            value={modalVersao.observacao}
                            onChange={(e) => setModalVersao({ ...modalVersao, observacao: e.target.value })}
                            placeholder="Notas sobre essa versão…"
                            rows={3}
                            className="w-full px-3 py-2 mt-1 mb-4 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-sm"
                        />
                        <div className="flex justify-end gap-2">
                            <Button variant="secondary" size="sm" onClick={() => setModalVersao(null)}>Cancelar</Button>
                            <Button variant="primary" size="sm" onClick={salvarVersao} disabled={!modalVersao.nome.trim()}>Salvar versão</Button>
                        </div>
                    </div>
                </div>
            )}

            {/* DRAWER Sugestão de Container */}
            {containerOpen && containerResult && (
                <div className="fixed inset-0 z-40" onClick={() => setContainerOpen(false)}>
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
                    <div onClick={(e) => e.stopPropagation()} className="absolute top-16 right-0 bottom-2 rounded-l-2xl w-full max-w-3xl bg-white dark:bg-slate-800 shadow-2xl flex flex-col">
                        {/* Header — layout em 3 níveis para não cortar */}
                        <div className="border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30 flex-shrink-0">
                            {/* Nível 1: título + close + PDF */}
                            <div className="px-4 pt-3 pb-2 flex items-center justify-between gap-2">
                                <h3 className="font-bold text-base flex items-center gap-2 truncate">
                                    <Container className="w-4 h-4 text-blue-600 flex-shrink-0" /> Sugestão de Container
                                </h3>
                                <div className="flex gap-1 items-center flex-shrink-0">
                                    <button onClick={() => setContainerModeloSaveOpen(true)} className="text-xs font-bold px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg">Salvar Modelo</button>
                                    <button onClick={() => { setContainerModelosOpen(true); carregarContainerModelos(); }} className="text-xs font-bold px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg flex items-center gap-1"><History className="w-3 h-3" /> Histórico</button>
                                    <Button variant="secondary" size="sm" onClick={exportContainerExcel} title="Exportar Excel">
                                        <FileSpreadsheet className="w-3.5 h-3.5" /><span className="ml-1">Excel</span>
                                    </Button>
                                    <Button variant="secondary" size="sm" onClick={exportContainerPdf} title="Exportar PDF">
                                        <FileDown className="w-3.5 h-3.5" /><span className="ml-1">PDF</span>
                                    </Button>
                                    <button onClick={() => setContainerOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded" title="Fechar"><X className="w-4 h-4" /></button>
                                </div>
                            </div>
                            {/* Nível 2: seletor de tipo */}
                            <div className="px-4 pb-2 flex gap-1.5 flex-wrap items-center text-xs">
                                <span className="text-slate-500 uppercase tracking-wider font-bold text-[10px]">Tipo:</span>
                                {Object.keys(containerResult.capacidades_disponiveis || {}).map(t => (
                                    <button key={t} onClick={() => { setContainerTipo(t); calcularContainers(t); }}
                                        className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors ${containerTipo === t ? 'bg-blue-600 text-white shadow' : 'bg-white dark:bg-slate-800 border border-slate-300 hover:bg-blue-50'}`}>
                                        {t} · {containerResult.capacidades_disponiveis[t]}m³
                                    </button>
                                ))}
                                <button onClick={() => setContainerTipo('custom')}
                                    className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition-colors ${containerTipo === 'custom' ? 'bg-blue-600 text-white shadow' : 'bg-white dark:bg-slate-800 border border-slate-300 hover:bg-blue-50'}`}>
                                    Custom
                                </button>
                                {containerTipo === 'custom' && (
                                    <span className="flex items-center gap-1 ml-1">
                                        <input type="number" min={1} step={1} value={containerCustomCap}
                                            onChange={(e) => setContainerCustomCap(Number(e.target.value))}
                                            onBlur={() => calcularContainers('custom', containerCustomCap)}
                                            className="w-16 px-1.5 py-1 text-[11px] border border-slate-300 rounded" />
                                        <span className="text-[10px] text-slate-500">m³</span>
                                    </span>
                                )}
                            </div>
                            {/* Nível 3: resumo */}
                            <div className="px-4 pb-3 flex gap-3 text-xs text-slate-600 dark:text-slate-300 flex-wrap">
                                <span>📦 <strong>{containerResult.total_containers}</strong> {containerResult.total_containers === 1 ? 'container' : 'containers'}</span>
                                <span>· <strong>{containerResult.total_qtd.toLocaleString('pt-BR')}</strong> un</span>
                                <span>· ¥ <strong>{containerResult.total_amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</strong></span>
                            </div>
                        </div>

                        {/* Body */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0">
                            {containerResult.itens_sem_dimensoes && containerResult.itens_sem_dimensoes.length > 0 && (
                                <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 text-xs">
                                    <p className="font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1 mb-1">
                                        <AlertTriangle className="w-3.5 h-3.5" /> {containerResult.itens_sem_dimensoes.length} {containerResult.itens_sem_dimensoes.length === 1 ? 'item sem dimensões' : 'itens sem dimensões'} cadastrados
                                    </p>
                                    <p className="text-amber-700 dark:text-amber-400">
                                        Esses itens não entraram no cálculo. Cadastre CBM/UNIT por CTN em ParametrosImportacao.xlsx:
                                    </p>
                                    <ul className="mt-1 space-y-0.5">
                                        {containerResult.itens_sem_dimensoes.slice(0, 5).map((it: any, i: number) => (
                                            <li key={i} className="font-mono text-[10px]">• {it.codigo} — {it.qtd.toLocaleString('pt-BR')} un</li>
                                        ))}
                                        {containerResult.itens_sem_dimensoes.length > 5 && <li className="text-[10px]">…e mais {containerResult.itens_sem_dimensoes.length - 5}</li>}
                                    </ul>
                                </div>
                            )}

                            {containerResult.containers.map((c: any) => (
                                <div key={c.id} className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
                                    {/* Header do container */}
                                    <div className="bg-gradient-to-r from-blue-100 to-indigo-100 dark:from-blue-900/30 dark:to-indigo-900/30 p-3 flex items-center justify-between">
                                        <div>
                                            <h4 className="font-bold text-sm flex items-center gap-2">
                                                <Container className="w-4 h-4 text-blue-600" /> {c.label}
                                            </h4>
                                            <p className="text-[10px] text-slate-600 dark:text-slate-300">
                                                {c.itens.length} {c.itens.length === 1 ? 'SKU' : 'SKUs'} · {c.total_qtd.toLocaleString('pt-BR')} un · {c.total_ctns} ctns · {c.total_peso.toLocaleString('pt-BR')} kg
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <div className="text-xs font-bold">
                                                {c.volume_usado_cbm.toLocaleString('pt-BR', { minimumFractionDigits: 2 })} / {c.capacidade_cbm}m³
                                            </div>
                                            <div className="w-24 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden mt-0.5">
                                                <div className={`h-full ${c.ocupacao_pct > 95 ? 'bg-rose-500' : c.ocupacao_pct > 80 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                                                    style={{ width: `${Math.min(100, c.ocupacao_pct)}%` }} />
                                            </div>
                                            <div className="text-[10px] text-slate-500 mt-0.5">{c.ocupacao_pct}% ocupado</div>
                                        </div>
                                    </div>
                                    {/* Tabela de itens */}
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-[11px]">
                                            <thead className="bg-slate-50 dark:bg-slate-900/50">
                                                <tr className="text-left uppercase tracking-wider text-slate-500 font-bold text-[9px]">
                                                    <th className="px-2 py-1.5">Código</th>
                                                    <th className="px-2 py-1.5">Descrição</th>
                                                    <th className="px-2 py-1.5 text-right">Qtd</th>
                                                    <th className="px-2 py-1.5 text-right">CTN</th>
                                                    <th className="px-2 py-1.5 text-right">CTNs</th>
                                                    <th className="px-2 py-1.5 text-right">CBM</th>
                                                    <th className="px-2 py-1.5 text-right">Peso (kg)</th>
                                                    <th className="px-2 py-1.5 text-right">Total ¥</th>
                                                    <th className="px-2 py-1.5"></th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {c.itens.map((it: any, i: number) => (
                                                    <tr key={i} className="border-t border-slate-100 dark:border-slate-700">
                                                        <td className="px-2 py-1.5 font-mono font-bold text-blue-700">{it.codigo}</td>
                                                        <td className="px-2 py-1.5 text-slate-600 dark:text-slate-300 max-w-[180px] truncate" title={it.descricao}>{it.descricao || '—'}</td>
                                                        <td className="px-2 py-1.5 text-right">
                                                            <input
                                                                type="number" min={0}
                                                                value={it.qtd}
                                                                onChange={e => alterarQtdItemContainer(c.id, i, parseInt(e.target.value) || 0)}
                                                                className="w-16 text-right text-xs px-1 py-0.5 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 rounded tabular-nums"
                                                            />
                                                        </td>
                                                        <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{it.unit_ctn}</td>
                                                        <td className="px-2 py-1.5 text-right tabular-nums">{it.ctns}</td>
                                                        <td className="px-2 py-1.5 text-right tabular-nums">{it.cbm_total.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                                        <td className="px-2 py-1.5 text-right tabular-nums">{it.peso_total.toLocaleString('pt-BR', { minimumFractionDigits: 1 })}</td>
                                                        <td className="px-2 py-1.5 text-right tabular-nums font-bold">{it.amount.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}</td>
                                                        <td className="px-2 py-1.5 text-right">
                                                            <button onClick={() => removerItemContainer(c.id, i)}
                                                                className="text-red-500 hover:text-red-700 p-0.5" title="Remover do container">
                                                                <X className="w-3 h-3" />
                                                            </button>
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                    <div className="border-t border-slate-200 dark:border-slate-700 p-2 bg-slate-50/50 dark:bg-slate-900/30 flex justify-end">
                                        <AddItemContainer containerId={c.id} containerItensCodigos={c.itens.map((x: any) => x.codigo)}
                                            todosItens={itensVisiveis} onAdd={adicionarItemContainer} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {containerModeloSaveOpen && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setContainerModeloSaveOpen(false)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-sm w-full p-5" onClick={e => e.stopPropagation()}>
                        <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-3">Salvar Modelo de Container</h4>
                        <input
                            type="text" value={containerModeloNome} onChange={e => setContainerModeloNome(e.target.value)}
                            placeholder="Nome do modelo..."
                            className="w-full text-sm px-3 py-2 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 rounded-lg mb-3"
                            autoFocus
                        />
                        <div className="flex gap-2">
                            <button onClick={() => setContainerModeloSaveOpen(false)} className="flex-1 px-3 py-2 text-xs font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg hover:bg-slate-200">Cancelar</button>
                            <button onClick={salvarContainerModelo} disabled={containerModeloSaving || !containerModeloNome.trim()} className="flex-1 px-3 py-2 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50">
                                {containerModeloSaving ? 'Salvando...' : 'Salvar'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {containerModelosOpen && (
                <div className="fixed inset-0 z-40" onClick={() => setContainerModelosOpen(false)}>
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
                    <div onClick={e => e.stopPropagation()} className="absolute top-16 right-0 bottom-2 rounded-l-2xl w-full max-w-xl bg-white dark:bg-slate-800 shadow-2xl flex flex-col">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950/30 dark:to-indigo-950/30">
                            <div className="flex items-center justify-between">
                                <h3 className="font-bold text-base flex items-center gap-2"><History className="w-4 h-4 text-blue-600" /> Modelos de Container Salvos</h3>
                                <button onClick={() => setContainerModelosOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
                            </div>
                        </div>
                        <div className="overflow-y-auto flex-1 p-3 space-y-2">
                            {containerModelos.length === 0 && (
                                <p className="text-center text-sm text-slate-400 py-8 italic">Nenhum modelo salvo ainda.</p>
                            )}
                            {containerModelos.map(m => (
                                <div key={m.id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-3 hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="font-bold text-sm text-slate-800 dark:text-slate-100">{m.nome}</div>
                                            <div className="text-[10px] text-slate-400 mt-0.5">
                                                {m.user_nome || '—'} · {m.created_at ? new Date(m.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '—'} · {m.tipo_container}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button onClick={() => carregarContainerModelo(m.id)} className="text-[10px] font-bold px-2 py-1 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 text-blue-700 dark:text-blue-300 rounded border border-blue-200 dark:border-blue-700" title="Carrega exatamente como foi salvo">Carregar</button>
                                            <button onClick={() => reaplicarContainerModelo(m.id)} className="text-[10px] font-bold px-2 py-1 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-900/30 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 rounded border border-emerald-200 dark:border-emerald-700" title="Mantém códigos e quantidades — recalcula medidas e packing com os parâmetros atuais">Reaplicar</button>
                                            <button onClick={() => excluirContainerModelo(m.id)} className="text-[10px] font-bold px-2 py-1 bg-red-50 hover:bg-red-100 dark:bg-red-900/30 dark:hover:bg-red-900/50 text-red-700 dark:text-red-300 rounded border border-red-200 dark:border-red-700">Excluir</button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* DRAWER Histórico de Order Lists */}
            {orderListsOpen && (
                <div className="fixed inset-0 z-40" onClick={() => setOrderListsOpen(false)}>
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
                    <div onClick={(e) => e.stopPropagation()} className="absolute top-16 right-0 bottom-2 rounded-l-2xl w-full max-w-xl bg-white dark:bg-slate-800 shadow-2xl flex flex-col">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30">
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="font-bold text-base flex items-center gap-2"><Truck className="w-4 h-4 text-amber-600" /> Histórico de Order Lists</h3>
                                <button onClick={() => setOrderListsOpen(false)} className="p-1 hover:bg-slate-200 rounded"><X className="w-4 h-4" /></button>
                            </div>
                            <p className="text-xs text-slate-500">{orderLists.length} {orderLists.length === 1 ? 'order list salva' : 'order lists salvas'} · <span className="text-amber-600">mantém as 30 mais recentes</span></p>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-2">
                            {orderLists.length === 0 && (
                                <div className="text-center py-12 text-slate-400">
                                    <Truck className="w-12 h-12 mx-auto mb-2 text-slate-300" />
                                    <p className="text-sm">Nenhuma Order List salva</p>
                                    <p className="text-[11px] mt-1">Use o botão <strong>Order List</strong> pra importar uma planilha</p>
                                </div>
                            )}
                            {orderLists.map(ol => (
                                <div key={ol.id} className="p-3 rounded-xl bg-gradient-to-br from-slate-50 to-white dark:from-slate-900 dark:to-slate-800 border border-slate-200 dark:border-slate-700 hover:shadow-md transition-shadow">
                                    <div className="flex items-start justify-between gap-2 mb-1">
                                        <h4 className="font-bold text-sm flex-1 truncate" title={ol.nome}>{ol.nome}</h4>
                                        <button onClick={() => excluirOrderListSalva(ol.id)} className="p-1 text-slate-400 hover:text-rose-600 rounded" title="Excluir"><Trash2 className="w-3.5 h-3.5" /></button>
                                    </div>
                                    <div className="flex items-center gap-3 text-[11px] text-slate-500 mb-1.5">
                                        <span className="flex items-center gap-1"><UserIcon className="w-3 h-3" />{ol.user_nome}</span>
                                        <span className="flex items-center gap-1"><Calendar className="w-3 h-3" />{ol.created_at ? new Date(ol.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                                        <span className="text-amber-600 font-bold">{ol.qtd_itens} itens</span>
                                    </div>
                                    {ol.labels && ol.labels.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mb-1.5">
                                            {ol.labels.map((l: string, i: number) => (
                                                <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 rounded text-[10px] font-bold">
                                                    <Tag className="w-2.5 h-2.5" />{l}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    {ol.observacao && <p className="text-[11px] text-slate-600 dark:text-slate-300 italic mb-1.5">"{ol.observacao}"</p>}
                                    <button onClick={() => carregarOrderListSalva(ol.id)}
                                        className="w-full px-2 py-1.5 text-[11px] bg-amber-100 hover:bg-amber-200 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300 rounded font-bold transition-colors mt-1">
                                        🚚 Aplicar em Em Trânsito
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Modal preview Order List */}
            {orderPreview && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setOrderPreview(null)}>
                    <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
                        {/* HEADER fixo no topo */}
                        <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 flex-shrink-0">
                            <h3 className="font-bold text-lg flex items-center gap-2">
                                <Truck className="w-5 h-5 text-amber-600" /> Importar Order List
                            </h3>
                            <p className="text-xs text-slate-500 mt-0.5">{orderPreview.items.length} itens detectados — vão para a coluna <strong>Em Trânsito</strong></p>
                        </div>
                        {/* BODY: TUDO em um único scroll (form + lista de itens) */}
                        <div className="flex-1 overflow-y-auto min-h-0">
                            <div className="p-4 border-b border-slate-200 dark:border-slate-700 space-y-3">
                                <div>
                                    <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Nome da Order List *</label>
                                    <input
                                        value={orderPreview.nome}
                                        onChange={(e) => setOrderPreview({ ...orderPreview, nome: e.target.value })}
                                        placeholder="ex: Pedido Mai/2026 — fornecedor X"
                                        className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-sm"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Labels</label>
                                    <div className="flex flex-wrap gap-1.5 mt-1 mb-1">
                                        {labelsPadrao.map(l => (
                                            <button key={l} onClick={() => toggleOrderLabel(l)}
                                                className={`px-2 py-1 rounded-full text-[11px] font-bold transition-all ${orderPreview.labels.includes(l) ? 'bg-amber-600 text-white shadow' : 'bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-amber-100'}`}>
                                                {orderPreview.labels.includes(l) ? '✓ ' : ''}{l}
                                            </button>
                                        ))}
                                    </div>
                                    {orderPreview.labels.filter(l => !labelsPadrao.includes(l)).length > 0 && (
                                        <div className="flex flex-wrap gap-1.5 mb-1">
                                            {orderPreview.labels.filter(l => !labelsPadrao.includes(l)).map(l => (
                                                <span key={l} className="inline-flex items-center gap-1 px-2 py-1 bg-pink-100 text-pink-700 rounded-full text-[11px] font-bold">
                                                    ✦ {l}
                                                    <button onClick={() => toggleOrderLabel(l)}><X className="w-3 h-3" /></button>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                    <div className="flex gap-2">
                                        <input
                                            value={orderPreview.labelInput}
                                            onChange={(e) => setOrderPreview({ ...orderPreview, labelInput: e.target.value })}
                                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOrderLabelCustom(); } }}
                                            placeholder="Criar label personalizada…"
                                            className="flex-1 px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                                        />
                                        <Button variant="secondary" size="sm" onClick={addOrderLabelCustom}><Plus className="w-3.5 h-3.5" /></Button>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Observação (opcional)</label>
                                    <textarea
                                        value={orderPreview.observacao}
                                        onChange={(e) => setOrderPreview({ ...orderPreview, observacao: e.target.value })}
                                        rows={2}
                                        className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-sm"
                                    />
                                </div>
                            </div>
                            {orderPreview.precisaData && (
                                <div className="p-4 border-b border-slate-200 dark:border-slate-700 bg-amber-50/50 dark:bg-amber-900/10">
                                    <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold flex items-center gap-1">
                                        ⚠️ Planilha sem coluna de previsão de entrega
                                    </label>
                                    <p className="text-xs text-slate-600 dark:text-slate-300 mb-2">Data prevista aplicada a <strong>todos os itens</strong>:</p>
                                    <input
                                        type="date"
                                        value={orderPreview.dataGlobal}
                                        onChange={(e) => setOrderPreview({ ...orderPreview, dataGlobal: e.target.value })}
                                        className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-sm"
                                    />
                                </div>
                            )}
                            {/* Cabeçalho da lista — sticky dentro da área scrollavel */}
                            <div className="sticky top-0 z-10 border-b border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-900 px-4 py-2 grid grid-cols-[1fr_120px_180px] gap-2 text-[10px] uppercase tracking-wider text-slate-500 font-bold shadow-sm">
                                <div>Código ({orderPreview.items.length})</div>
                                <div className="text-right">Quantidade</div>
                                <div>Previsão entrega</div>
                            </div>
                            <div className="px-4 py-2">
                                {orderPreview.items.slice(0, 50).map((it, i) => (
                                    <div key={i} className="grid grid-cols-[1fr_120px_180px] gap-2 py-1.5 text-xs border-b border-slate-100 dark:border-slate-800">
                                        <div className="font-mono font-bold text-amber-700">{it.codigo}</div>
                                        <div className="text-right tabular-nums">{it.qty.toLocaleString('pt-BR')}</div>
                                        <div className="text-slate-500 text-[11px]">
                                            {it.data ? new Date(it.data).toLocaleDateString('pt-BR') : (
                                                orderPreview.precisaData
                                                    ? <span className="text-amber-600 italic">{new Date(orderPreview.dataGlobal).toLocaleDateString('pt-BR')} (global)</span>
                                                    : <span className="text-slate-300">—</span>
                                            )}
                                        </div>
                                    </div>
                                ))}
                                {orderPreview.items.length > 50 && (
                                    <div className="text-center py-2 text-slate-400 text-[10px]">...e mais {orderPreview.items.length - 50} itens</div>
                                )}
                            </div>
                        </div>
                        <div className="p-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                            <Button variant="secondary" size="sm" onClick={() => setOrderPreview(null)}>Cancelar</Button>
                            <Button variant="primary" size="sm" onClick={aplicarOrderList} disabled={orderPreview.precisaData && !orderPreview.dataGlobal}>
                                <Truck className="w-3.5 h-3.5" /> Aplicar nos {orderPreview.items.length} itens
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal WhatsApp — envia XLSX via WAHA (mesma infra do Plano de Produção) */}
            <WhatsAppEnvioModal
                open={waOpen}
                titulo="Enviar Importação v2 via WhatsApp"
                onClose={() => setWaOpen(false)}
                onEnviar={(numero) => api.importacaoV2EnviarWhatsApp(
                    numero,
                    { qtd_meses: qtdMeses, modo, lead_time_default: leadDefault, nivel_servico_default: nivelDefault, threshold_sigma: threshold, codigos, overrides },
                    itensVisiveis,
                )}
            />

            {/* Modal salvar */}
            {modalNome !== null && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setModalNome(null)}>
                    <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-6 w-full max-w-sm">
                        <h3 className="font-bold text-lg mb-3 flex items-center gap-2"><Save className="w-5 h-5 text-indigo-600" /> Salvar modelo</h3>
                        <p className="text-xs text-slate-500 mb-3">Salve esta combinação de itens e parâmetros para reusar depois.</p>
                        <input
                            autoFocus
                            value={modalNome}
                            onChange={(e) => setModalNome(e.target.value)}
                            placeholder="Nome do modelo"
                            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 mb-4"
                            onKeyDown={(e) => { if (e.key === 'Enter') salvarModelo(); }}
                        />
                        <div className="flex justify-end gap-2">
                            <Button variant="secondary" size="sm" onClick={() => setModalNome(null)}>Cancelar</Button>
                            <Button variant="primary" size="sm" onClick={salvarModelo} disabled={!modalNome.trim()}>Salvar</Button>
                        </div>
                    </div>
                </div>
            )}
                </div>
        </div>
    );
};

// Componente: botão "Adicionar produto" dentro de um container
const AddItemContainer: React.FC<{
    containerId: string;
    containerItensCodigos: string[];
    todosItens: any[];
    onAdd: (containerId: string, sku: any, qtd: number) => void;
}> = ({ containerId, containerItensCodigos, todosItens, onAdd }) => {
    const [aberto, setAberto] = useState(false);
    const [busca, setBusca] = useState('');
    const [codigoSel, setCodigoSel] = useState('');
    const [qtd, setQtd] = useState<number>(0);

    // Disponíveis: itens visíveis que ainda não estão neste container
    const disponiveis = (todosItens || []).filter((it: any) => {
        if (containerItensCodigos.includes(it.codigo)) return false;
        if (busca && !((it.codigo || '').toLowerCase().includes(busca.toLowerCase()) || (it.descricao || '').toLowerCase().includes(busca.toLowerCase()))) return false;
        return true;
    }).slice(0, 50);

    const skuSel = (todosItens || []).find((it: any) => it.codigo === codigoSel);

    const confirmar = () => {
        if (!skuSel || qtd <= 0) return;
        onAdd(containerId, skuSel, qtd);
        setAberto(false);
        setCodigoSel('');
        setQtd(0);
        setBusca('');
    };

    if (!aberto) {
        return (
            <button onClick={() => setAberto(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold">
                + Adicionar produto
            </button>
        );
    }
    return (
        <div className="flex flex-wrap items-center gap-2 w-full">
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar código ou descrição…"
                className="flex-1 min-w-[180px] px-2 py-1 text-xs border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-900" />
            <select value={codigoSel} onChange={(e) => { setCodigoSel(e.target.value); const s = todosItens.find((x: any) => x.codigo === e.target.value); setQtd(Number(s?.qtd_sugerida) || 0); }}
                className="text-xs px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-900 min-w-[200px]">
                <option value="">— Selecione SKU —</option>
                {disponiveis.map((it: any) => (
                    <option key={it.codigo} value={it.codigo}>{it.codigo} · {(it.descricao || '').slice(0, 50)}</option>
                ))}
            </select>
            <input type="number" min={1} value={qtd} onChange={(e) => setQtd(Number(e.target.value))}
                placeholder="Qtd"
                className="w-20 text-xs px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-900" />
            <button onClick={confirmar} disabled={!skuSel || qtd <= 0}
                className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold disabled:opacity-50">
                Adicionar
            </button>
            <button onClick={() => setAberto(false)} className="text-slate-400 hover:text-slate-700 px-1">cancelar</button>
        </div>
    );
};

export default ImportacaoV2;
