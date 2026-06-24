// Module-level singleton cache — sobrevive a re-mounts (mudancas de rota) sem limite de tamanho
let __SOP_CACHE_RAW: any = null;
let __SOP_CACHE_AT: Date | null = null;
// Torre de Controle S&OP - Setor Fábrica
// Reproduz exatamente os cálculos do nó AnalisePcp_Avancada do workflow n8n ProducaoPcp.
// Mudança aplicada: coluna "Meta" virou "Tendência" (média 6m vs média 6m anterior, com seta).

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { api } from '../../app_api';
import { RotateCcw, TrendingUp, TrendingDown, Minus, Search, BarChart3, LineChart as LineChartIcon, X, FilterX, Maximize2, Minimize2, FileDown, MessageSquare } from 'lucide-react';
import WhatsAppEnvioModal from '../Configuracoes/WhatsAppEnvioModal';
import KpiCard, { KpiColor, KpiGrid } from '../common/KpiCard';
import { useToast } from '../../contexts/ToastContext';
import { toast } from '../ui/Toaster';
import { MobileLandscapeHint } from '../ui/MobileLandscapeHint';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import html2canvas from 'html2canvas';
import {
    LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer
} from 'recharts';

// =============================================================================
// HELPERS (port do Code do n8n)
// =============================================================================

const safeStr = (v: any) => (v == null ? '' : String(v).trim());
const cleanKey = (v: any) => (v == null ? '' : String(v).toUpperCase().trim().replace(/[\.\-\s]/g, ''));
const cleanFloat = (v: any) => {
    if (v == null || v === '') return 0;
    let s = String(v).trim();
    if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.includes(',')) s = s.replace(',', '.');
    return parseFloat(s.replace(/[^0-9.-]/g, '')) || 0;
};
const fmt = (v: number) => (v ? Math.round(v).toLocaleString('pt-BR') : '0');
const fmtMoney = (v: number) => 'R$ ' + (v ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00');

const parseBRDate = (s: any): Date | null => {
    if (!s) return null;
    if (s instanceof Date) return s;
    let str = String(s).trim();
    if (str.includes('T')) { const d = new Date(str); return isNaN(d.getTime()) ? null : d; }
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
        const datePart = str.split(' ')[0];
        const parts = datePart.split('-');
        return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    }
    const parts = str.split(/[\/\.]/).filter(x => x.length > 0);
    if (parts.length >= 3) {
        let d = parseInt(parts[0]), m = parseInt(parts[1]), y = parseInt(parts[2]);
        if (y < 100) y += 2000;
        return new Date(y, m - 1, d);
    }
    return null;
};

const MONTHS = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

// =============================================================================
// TIPOS
// =============================================================================

interface MainRow {
    y: number; m: number; sort: number;
    cod: string; fam: string; desc: string; cls: string;
    meta: number; venda: number; fat: number;
    prod: number; cart: number; res: number; dem_liq: number; ops: number;
    sug: number;
    est_fab: number; est_log: number; est_res: number;
    md_v: number; md_p: number;
    st: string; st_desc: string;
    pct_svc: number; pct_prod: number;
    mesAno: string;
    seq_ai: number;
    // Tendência (calculada por (cod, sort))
    tend_atual: number;
    tend_anterior: number;
    tend_dir: 'up' | 'down' | 'flat';
}

interface AgingItem { label: string; total: number; count: number; ops: any[]; sortKey: number; }
interface LateOrder {
    ped: string; cli: string; cod: string; desc: string;
    dt: string; dias: number; qtd: number;
    mesAno: string; sortDt: number;
}

// =============================================================================
// PROCESSAMENTO PRINCIPAL (port do Code do n8n)
// =============================================================================

function processarDados(raw: any) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const cutoffLate = new Date(today);
    cutoffLate.setDate(cutoffLate.getDate() - 5);
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;

    // Blacklist
    const blacklist = new Set<string>();
    (raw.blacklist || []).forEach((c: any) => { const k = cleanKey(c); if (k) blacklist.add(k); });

    // Mapas estáticos
    const map: any = { est: {}, meta: {}, venda: {}, fat: {}, prod: {}, ops: {}, back: {}, abc: {}, med: {} };
    const periodosDisponiveis = new Set<string>();
    const regPeriod = (a: number, m: number) => { if (a && m) periodosDisponiveis.add(`${a}-${m}`); };

    (raw.estoque || []).forEach((i: any) => {
        const k = cleanKey(i.Codigo);
        if (k) map.est[k] = {
            fab: cleanFloat(i.Est_Fabrica),
            disp: cleanFloat(i.Est_Log_Disp),
            res: cleanFloat(i.Est_Log_Reserva),
        };
    });

    (raw.indicadores || []).forEach((i: any) => {
        const k = cleanKey(i.Codigo);
        if (k) map.med[k] = { v: cleanFloat(i.Media_Venda_44Dias), p: cleanFloat(i.Media_Prod_44Dias) };
    });

    (raw.curva_abc || []).forEach((i: any) => {
        const k = cleanKey(i.Codigo);
        if (k) map.abc[k] = { cls: i.Classe_2026, desc: safeStr(i.Descricao), fam: 'OUTROS' };
    });
    (raw.base_abc || []).forEach((i: any) => {
        const k = cleanKey(i.CODIGO_PRODUTO);
        if (k) {
            if (!map.abc[k]) map.abc[k] = { cls: '-', desc: safeStr(i.Descricao) };
            map.abc[k].fam = safeStr(i.Familia);
        }
    });

    (raw.resultados || []).forEach((i: any) => {
        const k = cleanKey(i.Codigo_Produto);
        const m = parseInt(i.Mes);
        const a = currentYear;
        if (k && m) {
            const key = `${k}_${a}_${m}`;
            map.meta[key] = (map.meta[key] || 0) + cleanFloat(i.Meta_Qtd_Projetada);
            regPeriod(a, m);
        }
    });

    (raw.realizado || []).forEach((i: any) => {
        const k = cleanKey(i.Codigo);
        const m = parseInt(i.Mes);
        const a = parseInt(i.Ano);
        const t = safeStr(i.Tipo).toUpperCase();
        if (k && m && a) {
            const key = `${k}_${a}_${m}`;
            if (t.includes('VEND')) map.venda[key] = (map.venda[key] || 0) + cleanFloat(i.Qtd_Real);
            if (t.includes('PROD')) map.prod[key] = (map.prod[key] || 0) + cleanFloat(i.Qtd_Real);
            regPeriod(a, m);
        }
    });

    (raw.faturamento || []).forEach((i: any) => {
        const k = cleanKey(i.Codigo);
        const m = parseInt(i.Mes);
        const a = parseInt(i.Ano);
        if (k && m && a) {
            const key = `${k}_${a}_${m}`;
            map.fat[key] = (map.fat[key] || 0) + cleanFloat(i.Qtd_Faturada);
            regPeriod(a, m);
        }
    });

    // Carteira com flush para mês corrente se atrasada
    (raw.carteira || []).forEach((i: any) => {
        const k = cleanKey(i.Codigo);
        let m = parseInt(i.Mes_Ref);
        let a = parseInt(i.Ano_Ref);
        if (k && a && m) {
            let useA = a, useM = m;
            if (a < currentYear || (a === currentYear && m < currentMonth)) {
                useA = currentYear; useM = currentMonth;
            }
            const key = `${k}_${useA}_${useM}`;
            map.back[key] = (map.back[key] || 0) + cleanFloat(i.Qtd_Carteira);
            regPeriod(useA, useM);
        }
    });

    (raw.ops_aberto || []).forEach((i: any) => {
        const k = cleanKey(i.Codigo);
        let a = parseInt(i.Ano_Emissao);
        let m = parseInt(i.Mes_Emissao);
        if (k) {
            if (a < currentYear || (a === currentYear && m < currentMonth)) {
                a = currentYear; m = currentMonth;
            }
            const key = `${k}_${a}_${m}`;
            map.ops[key] = (map.ops[key] || 0) + cleanFloat(i.Saldo_A_Produzir);
            regPeriod(a, m);
        }
    });

    // AI suggestions
    const aiData: any[] = [];
    const aiSeqMap: Record<string, number> = {};
    (raw.otmz_ai || []).forEach((row: any) => {
        const cod = cleanKey(row.codigo_produto);
        if (cod && !blacklist.has(cod)) {
            let peds = String(row.pedidos_atendidos || '');
            try { if (peds.includes('[')) peds = JSON.parse(peds).join(', '); } catch (e) {}
            peds = peds.replace(/['"]/g, '');
            const priority = parseInt(row.sequencia_producao) || 9999;
            aiData.push({
                seq: priority, cod,
                desc: safeStr(row.descricao_produto),
                qtd: cleanFloat(row.quantidade_necessaria),
                val_total: cleanFloat(row.total_item),
                qtd_peds: parseInt(row.contador_pedidos_atendidos) || 0,
                lista_peds: peds,
            });
            aiSeqMap[cod] = priority;
        }
    });
    aiData.sort((a, b) => a.seq - b.seq);

    // Drill-down + Late + Aging
    const drill: Record<string, { p: any[]; o_list: any[] }> = {};
    const agingMap: Record<number, AgingItem> = {};
    let totalBacklogVol = 0;

    (raw.detalhe || []).forEach((i: any) => {
        const k = cleanKey(i.Codigo);
        if (!k) return;
        if (!drill[k]) drill[k] = { p: [], o_list: [] };
        const saldo = cleanFloat(i.Saldo);
        drill[k].p.push({ ped: i.Pedido, cli: i.Cliente, sal: saldo, entr: i.Entrega });
        if (saldo > 0) totalBacklogVol += saldo;
    });

    // Late orders calculados no backend (mesma logica exata do otimizador)
    const lateOrders: LateOrder[] = (raw.late_orders_backend || []).map((o: any) => ({
        ped: o.ped, cli: o.cli, cod: o.cod,
        desc: o.desc || (map.abc[cleanKey(o.cod)] || { desc: '-' }).desc,
        dt: o.dt, dias: o.dias, qtd: o.qtd, mesAno: o.mesAno, sortDt: o.sortDt,
    }));
    const totalLateVol = lateOrders.reduce((s, o) => s + (o.qtd > 0 ? o.qtd : 0), 0);

    const mapOpsDetalhe: Record<string, any> = {};
    (raw.ops_hist || []).forEach((h: any) => {
        const op = safeStr(h.Numero_OP), cod = cleanKey(h.Codigo);
        if (op && cod) {
            mapOpsDetalhe[op] = {
                op, cod, emi: h.Data_Emissao_Full, apt: h.Ultimo_Apontamento,
                plan: cleanFloat(h.Qtd_OP_Planejada), real: cleanFloat(h.Qtd_OP_Realizada),
                saldo: 0,
            };
            if (!drill[cod]) drill[cod] = { p: [], o_list: [] };
        }
    });

    (raw.ops_aberto || []).forEach((a: any) => {
        const op = safeStr(a.Numero_OP), cod = cleanKey(a.Codigo);
        if (!op || !cod) return;
        if (!drill[cod]) drill[cod] = { p: [], o_list: [] };
        let opData;
        if (mapOpsDetalhe[op]) {
            mapOpsDetalhe[op].saldo = cleanFloat(a.Saldo_A_Produzir);
            const planAberto = cleanFloat(a.Qtd_OP_Planejada);
            if (planAberto > 0) mapOpsDetalhe[op].plan = planAberto;
            mapOpsDetalhe[op].real = cleanFloat(a.Qtd_OP_Realizada);
            opData = mapOpsDetalhe[op];
        } else {
            opData = {
                op, cod, emi: a.Data_Emissao_Full, apt: '-',
                plan: cleanFloat(a.Qtd_OP_Planejada), real: cleanFloat(a.Qtd_OP_Realizada),
                saldo: cleanFloat(a.Saldo_A_Produzir),
            };
            mapOpsDetalhe[op] = opData;
        }
        if (opData.saldo > 0 && opData.emi) {
            const dt = parseBRDate(opData.emi);
            if (dt && !isNaN(dt.getTime())) {
                const sortKey = dt.getFullYear() * 100 + (dt.getMonth() + 1);
                if (!agingMap[sortKey]) {
                    agingMap[sortKey] = {
                        label: MONTHS[dt.getMonth()] + '/' + String(dt.getFullYear()).substring(2),
                        total: 0, count: 0, ops: [], sortKey,
                    };
                }
                agingMap[sortKey].total += opData.saldo;
                agingMap[sortKey].count++;
                agingMap[sortKey].ops.push(opData);
            }
        }
    });

    Object.values(mapOpsDetalhe).forEach((o: any) => {
        if (drill[o.cod] && (o.saldo > 0 || o.real > 0 || o.plan > 0)) {
            drill[o.cod].o_list.push(o);
        }
    });

    const agingData = Object.keys(agingMap).map(k => agingMap[parseInt(k)])
        .sort((a, b) => a.sortKey - b.sortKey);

    // Períodos: Jan/2025 até Dez/ano-atual
    for (let y = 2025; y <= currentYear; y++) {
        for (let m = 1; m <= 12; m++) periodosDisponiveis.add(`${y}-${m}`);
    }
    const sortedPeriods = Array.from(periodosDisponiveis).map(p => {
        const [y, m] = p.split('-').map(Number);
        return { y, m, sort: y * 100 + m };
    }).sort((a, b) => a.sort - b.sort);

    // Universo de SKUs
    const uniqueProductCodes = new Set<string>();
    (raw.resultados || []).forEach((i: any) => uniqueProductCodes.add(cleanKey(i.Codigo_Produto)));
    (raw.estoque || []).forEach((i: any) => uniqueProductCodes.add(cleanKey(i.Codigo)));
    (raw.carteira || []).forEach((i: any) => uniqueProductCodes.add(cleanKey(i.Codigo)));

    // Flow de estoque — saldo projetado
    const mainData: MainRow[] = [];
    const kpisTopo = { meta: 0, prod: 0, ops: 0, cart: 0, venda: 0 };

    uniqueProductCodes.forEach(productCode => {
        if (blacklist.has(productCode)) return;
        const info = map.abc[productCode] || { cls: '-', desc: 'Novo', fam: 'OUTROS' };
        const stock = map.est[productCode] || { fab: 0, disp: 0, res: 0 };
        const md = map.med[productCode] || { v: 0, p: 0 };
        const currentSort = currentYear * 100 + currentMonth;
        const estoqueFisicoAtual = stock.disp + stock.fab;
        let runningStock = estoqueFisicoAtual;
        const scanList = sortedPeriods.length ? sortedPeriods : [{ y: currentYear, m: currentMonth, sort: currentYear * 100 + currentMonth }];

        scanList.forEach(per => {
            const { y, m } = per;
            const ky = `${productCode}_${y}_${m}`;
            const isPast = per.sort < currentSort;
            // No mês atual, reseta a projeção ao estoque físico REAL (a simulação dos meses
            // passados não deve contaminar o ponto de partida da projeção futura).
            if (per.sort === currentSort) runningStock = estoqueFisicoAtual;
            const hasActivity = map.meta[ky] || map.venda[ky] || map.fat[ky] || map.prod[ky] || map.ops[ky] || map.back[ky];
            const hasStock = (stock.disp > 0 || stock.fab > 0 || stock.res > 0);

            const back = map.back[ky] || 0;
            const opSal = map.ops[ky] || 0;
            const fat = map.fat[ky] || 0;
            const prod = map.prod[ky] || 0;
            const venda = map.venda[ky] || 0;
            const meta = map.meta[ky] || 0;
            const res = stock.res || 0;
            const consumoNet = Math.max(0, back - res);
            const demLiq = Math.max(0, consumoNet - runningStock);
            const gap = Math.max(0, demLiq - opSal);

            let st = 'OK', stDesc = 'Equilíbrio.';
            if (isPast) {
                // Mês histórico: planejamento de suprimento não se aplica retroativamente.
                st = 'HIST'; stDesc = 'Mês histórico (sem ação de suprimento).';
            } else if (gap > 0) {
                if (opSal === 0) { st = 'SEM OP'; stDesc = 'Falta produto e ZERO OPs.'; }
                else { st = 'CRÍTICO'; stDesc = 'Falta produto (Gap > OPs).'; }
            } else if (consumoNet > 0 && runningStock < consumoNet) {
                st = 'ATENÇÃO'; stDesc = 'Estoque físico < Carteira (Depende da OP).';
            } else if (runningStock > md.v * 90 && back === 0) {
                st = 'EXCESSO'; stDesc = 'Cobertura > 90 dias sem demanda ativa.';
            }

            const demTotal = fat + back;
            const pctServico = demTotal > 0 ? (fat / demTotal) * 100 : (fat > 0 ? 100 : 0);
            const pctProd = demTotal > 0 ? (prod / demTotal) * 100 : 0;

            if (m === currentMonth && y === currentYear) {
                kpisTopo.meta += meta; kpisTopo.prod += prod; kpisTopo.venda += venda;
            }
            kpisTopo.ops += opSal; kpisTopo.cart += back;

            if (hasActivity || hasStock) {
                // === TENDÊNCIA: projeção da demanda (entrada de pedidos) do mês ===
                // Mês corrente = run-rate (venda acumulada / dia de hoje × dias do mês);
                // mês fechado = demanda já realizada; mês futuro = meta projetada. Seta = vs mês anterior.
                let tendAtual = 0, tendAnterior = 0;
                let tendDir: 'up' | 'down' | 'flat' = 'flat';
                {
                    if (y < currentYear || (y === currentYear && m < currentMonth)) {
                        tendAtual = venda;                                            // mês fechado: demanda realizada
                    } else if (y === currentYear && m === currentMonth) {
                        const diaHoje = today.getDate();
                        const diasNoMes = new Date(y, m, 0).getDate();
                        tendAtual = diaHoje > 0 ? (venda / diaHoje) * diasNoMes : venda;   // projeção run-rate
                    } else {
                        tendAtual = map.meta[`${productCode}_${y}_${m}`] || 0;            // mês futuro: meta projetada
                    }
                    const prevY = m === 1 ? y - 1 : y;
                    const prevM = m === 1 ? 12 : m - 1;
                    tendAnterior = map.venda[`${productCode}_${prevY}_${prevM}`] || 0;
                    if (tendAnterior > 0 && Math.abs(tendAtual - tendAnterior) / tendAnterior >= 0.01) {
                        tendDir = tendAtual > tendAnterior ? 'up' : 'down';
                    }
                }

                mainData.push({
                    y, m, sort: per.sort, cod: productCode,
                    fam: info.fam, desc: info.desc, cls: info.cls,
                    meta, venda, fat, prod, cart: back, res, dem_liq: demLiq, ops: opSal,
                    sug: gap > 0 ? gap : 0,
                    est_fab: stock.fab, est_log: stock.disp, est_res: stock.res,
                    md_v: md.v, md_p: md.p,
                    st, st_desc: stDesc,
                    pct_svc: pctServico, pct_prod: pctProd,
                    mesAno: MONTHS[per.m - 1] + '/' + String(per.y).substring(2),
                    seq_ai: aiSeqMap[productCode] || 9999,
                    tend_atual: tendAtual,
                    tend_anterior: tendAnterior,
                    tend_dir: tendDir,
                });
            }
            // Projeta o estoque apenas do mês atual em diante (meses passados são histórico
            // e não devem mover o saldo projetado). Consome a carteira líquida do mês.
            if (!isPast) {
                runningStock = runningStock + opSal + prod - consumoNet;
                if (runningStock < 0) runningStock = 0;
            }
        });
    });

    return {
        mainData, drill, aiData, agingData, lateOrders,
        sortedPeriods, kpisTopo, totalBacklogVol, totalLateVol,
        currentYear, currentMonth,
    };
}

// =============================================================================
// COMPONENTE
// =============================================================================

const SopDashboard: React.FC = () => {
    // Hidrata do cache em memoria do modulo — instantaneo, sem limite de tamanho
    const [raw, setRaw] = useState<any>(__SOP_CACHE_RAW);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [updatedAt, setUpdatedAt] = useState<Date | null>(__SOP_CACHE_AT);

    const carregar = useCallback(async (forceRefresh = false, _retry = false) => {
        setLoading(true); setError(null);
        try {
            const data = await api.getSopDashboardData(forceRefresh);
            setRaw(data);
            const at = new Date(data?.meta?.updated_at || Date.now());
            setUpdatedAt(at);
            // Persiste no cache do modulo — sobrevive a navegacoes (sem quota)
            __SOP_CACHE_RAW = data;
            __SOP_CACHE_AT = at;
            setLoading(false);
        } catch (e: any) {
            // Backend lento/cold-start (ou redeploy) pode falhar na 1ª vez: tenta de novo 1x,
            // mantendo "Carregando", antes de mostrar erro/tela vazia.
            if (!_retry) { setTimeout(() => carregar(forceRefresh, true), 1500); return; }
            setError(e?.message || 'Erro ao carregar');
            setLoading(false);
        }
    }, []);

    // Carrega do cache do servidor apenas na primeira visita (sem cache local)
    // Atualização apenas quando o usuário clicar no botão Atualizar
    useEffect(() => {
        if (!__SOP_CACHE_RAW) carregar(false);
    }, [carregar]);

    const proc = useMemo(() => raw ? processarDados(raw) : null, [raw]);

    // Filtros — persistidos em localStorage (limpos só no logout ou "Limpar filtros")
    const SOP_LS_KEY = 'sop_dashboard_filters';
    const _sf = (() => { try { return JSON.parse(localStorage.getItem(SOP_LS_KEY) || '{}'); } catch { return {}; } })();
    const [fStat, setFStat] = useState(_sf.fStat ?? '');
    const [fAbc, setFAbc] = useState(_sf.fAbc ?? '');
    const [fFam, setFFam] = useState(_sf.fFam ?? '');
    const [fTxt, setFTxt] = useState(_sf.fTxt ?? '');
    const [fLate, setFLate] = useState(_sf.fLate ?? '');
    const [sortCol, setSortCol] = useState<'seq' | 'cod' | 'desc'>(_sf.sortCol ?? 'seq');
    const [sortDir, setSortDir] = useState<'asc' | 'desc'>(_sf.sortDir ?? 'asc');
    React.useEffect(() => {
        try { localStorage.setItem(SOP_LS_KEY, JSON.stringify({ fStat, fAbc, fFam, fTxt, fLate, sortCol, sortDir })); } catch { /* */ }
    }, [fStat, fAbc, fFam, fTxt, fLate, sortCol, sortDir]);
    const [chartTypeMain, setChartTypeMain] = useState<'line' | 'bar'>('line');
    const [chartTypeAdh, setChartTypeAdh] = useState<'line' | 'bar'>('line');
    const [chartTypeAging, setChartTypeAging] = useState<'line' | 'bar'>('bar');
    const [breakdown, setBreakdown] = useState<{ title: string; rows: { mes: string; valor: string; pct?: string }[] } | null>(null);

    const clearFilters = useCallback(() => {
        setFStat(''); setFAbc(''); setFFam(''); setFTxt(''); setFLate('');
        try { localStorage.removeItem(SOP_LS_KEY); } catch { /* */ }
        // Volta período ao padrão: Janeiro do ano corrente → Mês corrente
        if (proc?.sortedPeriods?.length) {
            const janSort = proc.currentYear * 100 + 1;
            const nowSort = proc.currentYear * 100 + proc.currentMonth;
            const periods = proc.sortedPeriods;
            setP1(periods.some(p => p.sort === janSort) ? janSort : periods[0].sort);
            setP2(periods.some(p => p.sort === nowSort) ? nowSort : periods[periods.length - 1].sort);
        }
    }, [proc]);

    // Conversao sort <-> "YYYY-MM" para usar <input type="month">
    const sortToMonthStr = (s: number) => `${Math.floor(s / 100)}-${String(s % 100).padStart(2, '0')}`;
    const monthStrToSort = (m: string) => {
        const [y, mm] = m.split('-');
        return parseInt(y) * 100 + parseInt(mm);
    };

    const [isFullscreen, setIsFullscreen] = useState(false);
    const containerRef = React.useRef<HTMLDivElement | null>(null);
    const toggleFullscreen = useCallback(() => {
        const el = containerRef.current as any;
        if (!document.fullscreenElement) {
            (el?.requestFullscreen || el?.webkitRequestFullscreen)?.call(el);
        } else {
            document.exitFullscreen?.();
        }
    }, []);
    useEffect(() => {
        const onChange = () => setIsFullscreen(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);

    const [exportingPdf, setExportingPdf] = useState(false);
    const [wppModalOpen, setWppModalOpen] = useState(false);
    const { showToast } = useToast();
    // exportarPdf é definido abaixo (após totais) para acessar dadosFiltrados/totais sem TDZ
    const [p1, setP1] = useState(0);
    const [p2, setP2] = useState(0);

    useEffect(() => {
        if (proc?.sortedPeriods?.length) {
            // Padrao: Janeiro do ano corrente -> Mes corrente
            const janSort = proc.currentYear * 100 + 1;
            const nowSort = proc.currentYear * 100 + proc.currentMonth;
            const periods = proc.sortedPeriods;
            const startSort = periods.some(p => p.sort === janSort) ? janSort : periods[0].sort;
            const endSort = periods.some(p => p.sort === nowSort) ? nowSort : periods[periods.length - 1].sort;
            setP1(startSort);
            setP2(endSort);
        }
    }, [proc]);

    const setarPeriodoMesAtual = useCallback(() => {
        if (!proc?.sortedPeriods?.length) return;
        const nowSort = proc.currentYear * 100 + proc.currentMonth;
        const target = proc.sortedPeriods.some(p => p.sort === nowSort)
            ? nowSort
            : proc.sortedPeriods[proc.sortedPeriods.length - 1].sort;
        setP1(target);
        setP2(target);
    }, [proc]);

    const dadosFiltrados = useMemo(() => {
        if (!proc) return [];
        return proc.mainData.filter(r => {
            if (p1 && r.sort < p1) return false;
            if (p2 && r.sort > p2) return false;
            if (fStat && !r.st.includes(fStat)) return false;
            if (fAbc && r.cls !== fAbc) return false;
            if (fFam && r.fam !== fFam) return false;
            if (fTxt) {
                const t = fTxt.toLowerCase();
                if (!r.cod.toLowerCase().includes(t) && !r.desc.toLowerCase().includes(t)) return false;
            }
            return true;
        }).sort((a, b) => {
            if (sortCol === 'cod') {
                const cmp = a.cod.localeCompare(b.cod);
                return sortDir === 'asc' ? cmp : -cmp;
            }
            if (sortCol === 'desc') {
                const cmp = (a.desc || '').localeCompare(b.desc || '');
                return sortDir === 'asc' ? cmp : -cmp;
            }
            return a.seq_ai - b.seq_ai;
        });
    }, [proc, p1, p2, fStat, fAbc, fFam, fTxt, sortCol, sortDir]);

    const totais = useMemo(() => {
        const sum = (k: keyof MainRow) => dadosFiltrados.reduce((acc, v) => acc + (Number(v[k]) || 0), 0);
        const sumPuro = (k: keyof MainRow) => {
            const seen = new Set<string>();
            return dadosFiltrados.reduce((acc, v) => {
                if (seen.has(v.cod)) return acc;
                seen.add(v.cod);
                return acc + (Number(v[k]) || 0);
            }, 0);
        };
        const meta = sum('meta'), fat = sum('fat'), prod = sum('prod');
        const cart = sum('cart'), venda = sum('venda'), ops = sum('ops');
        const sug = sum('sug'), dem_liq = sum('dem_liq');
        const res = sumPuro('res'), est_fab = sumPuro('est_fab'), est_log = sumPuro('est_log');

        // Metricas em % - mesma logica do Code do n8n
        const monthlyAgg: Record<number, { f: number; v: number; p: number; c: number; m: number }> = {};
        dadosFiltrados.forEach(r => {
            if (!monthlyAgg[r.sort]) monthlyAgg[r.sort] = { f: 0, v: 0, p: 0, c: 0, m: 0 };
            monthlyAgg[r.sort].f += r.fat;
            monthlyAgg[r.sort].v += r.venda;
            monthlyAgg[r.sort].p += r.prod;
            monthlyAgg[r.sort].c += r.cart;
            monthlyAgg[r.sort].m += r.meta;
        });
        let sumSvc = 0, sumProd = 0, sumMeta = 0, count = 0;
        Object.values(monthlyAgg).forEach(m => {
            const dem = m.f + m.c;
            if (dem > 0 || m.m > 0) {
                count++;
                if (dem > 0) {
                    sumSvc += (m.f / dem) * 100;
                    sumProd += (m.p / dem) * 100;
                } else if (m.f > 0) sumSvc += 100;
                if (m.m > 0) sumMeta += (m.f / m.m) * 100;
            }
        });
        const perfSvc = count > 0 ? sumSvc / count : 0;
        const perfProd = count > 0 ? sumProd / count : 0;
        const perfMeta = count > 0 ? sumMeta / count : 0;
        const totPlanOP = prod + ops;
        const percExec = totPlanOP > 0 ? (prod / totPlanOP) * 100 : 0;

        // Pedidos em Atraso filtrado pelos filtros ativos (fTxt, fAbc, fFam, fStat)
        const codsAtivos = new Set(dadosFiltrados.map(r => r.cod));
        const temFiltro = !!(fTxt || fAbc || fFam || fStat);
        const _lateVol = temFiltro && proc
            ? (proc.lateOrders || []).filter((o: any) => codsAtivos.has(o.cod)).reduce((s: number, o: any) => s + (o.qtd > 0 ? o.qtd : 0), 0)
            : (proc?.totalLateVol ?? 0);
        const _cartBase = temFiltro ? cart : (proc?.totalBacklogVol ?? cart);
        const _lateBacklogPct = _cartBase > 0 ? Math.round((_lateVol / _cartBase) * 100) : 0;

        return {
            meta, fat, prod, cart, venda, ops, sug, dem_liq, res, est_fab, est_log,
            perfMeta, perfSvc, perfProd, percExec,
            lateVol: _lateVol, lateBacklogPct: _lateBacklogPct,
        };
    }, [dadosFiltrados, proc, fTxt, fAbc, fFam, fStat]);

    const familias = useMemo(() => {
        if (!proc) return [];
        return Array.from(new Set(proc.mainData.map(d => d.fam))).sort();
    }, [proc]);

    const chartData = useMemo(() => {
        const agg: Record<number, any> = {};
        dadosFiltrados.forEach(r => {
            if (!agg[r.sort]) agg[r.sort] = { label: r.mesAno, sort: r.sort, Meta: 0, Venda: 0, Fat: 0, Prod: 0 };
            agg[r.sort].Meta += r.meta; agg[r.sort].Venda += r.venda;
            agg[r.sort].Fat += r.fat; agg[r.sort].Prod += r.prod;
        });
        return Object.values(agg).sort((a: any, b: any) => a.sort - b.sort);
    }, [dadosFiltrados]);

    // Captura um elemento DOM como PNG dataURL via html2canvas
    const elementToPng = async (el: HTMLElement | null): Promise<string | null> => {
        if (!el) return null;
        try {
            const canvas = await html2canvas(el, {
                backgroundColor: '#ffffff',
                scale: 2,
                useCORS: true,
                logging: false,
            });
            return canvas.toDataURL('image/png');
        } catch (e) { console.error('html2canvas error', e); return null; }
    };

    const exportarPdf = async (returnBase64: boolean = false): Promise<string | null> => {
        if (exportingPdf || !proc) return null;
        setExportingPdf(true);
        try {
            const ACCENT = [231, 76, 60] as [number, number, number];
            const DARK = [30, 41, 59] as [number, number, number];
            const SOFT = [241, 245, 249] as [number, number, number];

            const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
            const W = doc.internal.pageSize.getWidth();
            const H = doc.internal.pageSize.getHeight();

            let logoB64: string | null = null;
            try {
                const resp = await fetch('/Logo-Empresa.png');
                const blob = await resp.blob();
                logoB64 = await new Promise<string>((res) => {
                    const r = new FileReader();
                    r.onloadend = () => res(r.result as string);
                    r.readAsDataURL(blob);
                });
            } catch { /* sem logo */ }

            const periodo = (() => {
                const ini = proc.sortedPeriods.find(p => p.sort === p1);
                const fim = proc.sortedPeriods.find(p => p.sort === p2);
                if (!ini || !fim) return '-';
                return `${MONTHS[ini.m - 1]}/${ini.y} a ${MONTHS[fim.m - 1]}/${fim.y}`;
            })();

            const drawHeaderFooter = (pageNum: number, totalPages: number) => {
                // faixa vermelha topo (canto)
                doc.setFillColor(...ACCENT);
                doc.rect(0, 0, W, 3, 'F');
                // cartao do logo com fundo vermelho — logo EMPRESA e branco e precisa
                // do contraste para aparecer (mesmo padrao do site)
                if (logoB64) {
                    doc.setFillColor(...ACCENT);
                    doc.roundedRect(8, 6, 46, 18, 2, 2, 'F');
                    try { doc.addImage(logoB64, 'PNG', 10, 8, 42, 14); } catch {}
                }
                // titulo + periodo + data, deslocados a direita do logo
                doc.setTextColor(...DARK);
                doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
                doc.text('Torre de Controle S&OP', 60, 14);
                doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
                doc.setTextColor(100, 116, 139);
                doc.text(`Periodo: ${periodo}`, 60, 19);
                doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, 60, 23);
                // linha vermelha separando header do conteudo
                doc.setDrawColor(...ACCENT); doc.setLineWidth(0.4);
                doc.line(10, 28, W - 10, 28);
                // rodape
                doc.setDrawColor(...ACCENT); doc.setLineWidth(0.5);
                doc.line(10, H - 10, W - 10, H - 10);
                doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
                doc.setTextColor(120, 120, 120);
                doc.text('EMPRESA — Torre de Controle S&OP (Setor Fabrica)', 10, H - 5);
                doc.text(`Pagina ${pageNum} de ${totalPages}`, W - 10, H - 5, { align: 'right' });
                doc.setFillColor(...ACCENT);
                doc.triangle(W, H, W - 10, H, W, H - 10, 'F');
            };

            const kpiPairs = [
                { k: 'Meta Projetada', v: fmt(totais.meta) },
                { k: 'Faturado Real', v: fmt(totais.fat) },
                { k: 'Produzido', v: fmt(totais.prod) },
                { k: 'Carteira', v: fmt(totais.cart) },
                { k: 'Reservado', v: fmt(totais.res) },
                { k: 'Pedidos em Atraso', v: fmt(totais.lateVol) },
                { k: 'Atingimento', v: `${Math.round(totais.perfMeta)}%` },
                { k: 'Entrada Pedidos', v: fmt(totais.venda) },
                { k: 'Nivel Servico', v: `${Math.round(totais.perfSvc)}%` },
                { k: 'Aderencia', v: `${Math.round(totais.perfProd)}%` },
                { k: 'Execucao OPs', v: `${Math.round(totais.percExec)}%` },
            ];

            // ===== KPI Cards visuais (11 cards em grid 4x3) =====
            const cardsWithMeta: { k: string; v: string; sub: string; color: [number, number, number] }[] = [
                { k: 'META PROJETADA',     v: fmt(totais.meta),                                                   sub: 'Demanda Meta p/ Periodo',          color: [71, 85, 105] },
                { k: 'FATURADO REAL',      v: fmt(totais.fat),                                                    sub: 'Total Invoiced (Acumulado)',       color: [59, 130, 246] },
                { k: 'PRODUZIDO',          v: fmt(totais.prod),                                                   sub: 'Total Apontado (Acumulado)',       color: [16, 185, 129] },
                { k: 'CARTEIRA',           v: fmt(totais.cart),                                                   sub: 'Pedidos Venda em Aberto',          color: [6, 182, 212] },
                { k: 'RESERVADO',          v: fmt(totais.res),                                                    sub: 'Saldo Reservado Total',            color: [99, 102, 241] },
                { k: 'PEDIDOS EM ATRASO',  v: fmt(totais.lateVol),                                               sub: `${totais.lateBacklogPct}% do Backlog`, color: [239, 68, 68] },
                { k: 'ATINGIMENTO',        v: `${Math.round(totais.perfMeta)}%`,                                  sub: 'Fat Real vs Meta',                 color: [168, 85, 247] },
                { k: 'ENTRADA PEDIDOS',    v: fmt(totais.venda),                                                  sub: 'Entrada Bruta no Periodo',         color: [249, 115, 22] },
                { k: 'NIVEL SERVICO',      v: `${Math.round(totais.perfSvc)}%`,                                   sub: 'Faturado vs Demanda',              color: [16, 185, 129] },
                { k: 'ADERENCIA',          v: `${Math.round(totais.perfProd)}%`,                                  sub: 'Produzido vs Demanda',             color: [6, 182, 212] },
                { k: 'EXECUCAO OPs',       v: `${Math.round(totais.percExec)}%`,                                  sub: '% Prod / (Prod + Saldo)',          color: [100, 116, 139] },
            ];

            const COLS = 4;
            const GAP = 4;
            const PAD_X = 10;
            const cardsTopY = 35;
            const cardW = (W - PAD_X * 2 - GAP * (COLS - 1)) / COLS;
            const cardH = 26;
            cardsWithMeta.forEach((c, idx) => {
                const col = idx % COLS;
                const row = Math.floor(idx / COLS);
                const x = PAD_X + col * (cardW + GAP);
                const y = cardsTopY + row * (cardH + GAP);
                // Borda colorida no topo
                doc.setFillColor(c.color[0], c.color[1], c.color[2]);
                doc.roundedRect(x, y, cardW, 2, 1, 1, 'F');
                // Card body
                doc.setFillColor(255, 255, 255);
                doc.setDrawColor(226, 232, 240);
                doc.setLineWidth(0.2);
                doc.roundedRect(x, y + 2, cardW, cardH - 2, 1, 1, 'FD');
                // Label
                doc.setFont('helvetica', 'bold'); doc.setFontSize(7);
                doc.setTextColor(100, 116, 139);
                doc.text(c.k, x + 3, y + 8);
                // Value
                doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
                doc.setTextColor(15, 23, 42);
                doc.text(c.v, x + 3, y + 18);
                // Subtitle
                doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5);
                doc.setTextColor(148, 163, 184);
                doc.text(c.sub, x + 3, y + 24);
            });

            // ===== Graficos (capturados do DOM como imagens reais via html2canvas) =====
            // Pega o container .recharts-responsive-container (inclui SVG + estilos)
            const containers = Array.from(document.querySelectorAll('.recharts-responsive-container')) as HTMLElement[];
            const [pngTrend, pngAdh, pngAging] = await Promise.all([
                elementToPng(containers[0] || null),
                elementToPng(containers[1] || null),
                elementToPng(containers[2] || null),
            ]);

            // Tendencias de Volume — full width abaixo dos cards
            const trendsStartY = cardsTopY + 3 * (cardH + GAP) + 6;
            doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...DARK);
            doc.text('Tendencias de Volume', PAD_X, trendsStartY);
            const chartW = W - PAD_X * 2;
            const chartH = 65;
            if (pngTrend) {
                try { doc.addImage(pngTrend, 'PNG', PAD_X, trendsStartY + 3, chartW, chartH); } catch {}
            } else {
                doc.setFontSize(8); doc.setTextColor(150);
                doc.text('(grafico indisponivel)', PAD_X, trendsStartY + 10);
            }

            // Pagina 2 — Nivel de Servico/Aderencia + Aging lado a lado
            doc.addPage();
            const halfW = (W - PAD_X * 2 - 6) / 2;
            const chartH2 = 70;
            doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...DARK);
            doc.text('Nivel de Servico & Aderencia', PAD_X, 35);
            doc.text('Aging de Backlog (OPs em aberto)', PAD_X + halfW + 6, 35);
            if (pngAdh) {
                try { doc.addImage(pngAdh, 'PNG', PAD_X, 38, halfW, chartH2); } catch {}
            }
            if (pngAging) {
                try { doc.addImage(pngAging, 'PNG', PAD_X + halfW + 6, 38, halfW, chartH2); } catch {}
            }

            doc.addPage();
            autoTable(doc, {
                startY: 35,
                head: [['Mes', 'SKU', 'Desc', 'Venda', 'Fat', 'Svc%', 'Cart', 'Dem Liq', 'Prod', 'Cob%', 'Status']],
                body: dadosFiltrados.slice(0, 100).map(r => [
                    r.mesAno, r.cod, (r.desc || '').substring(0, 40),
                    fmt(r.venda), fmt(r.fat), `${Math.round(r.pct_svc)}%`,
                    fmt(r.cart), fmt(r.dem_liq), fmt(r.prod), `${Math.round(r.pct_prod)}%`, r.st
                ]),
                foot: [['TOTAL', '', '', fmt(totais.venda), fmt(totais.fat), '', fmt(totais.cart), fmt(totais.dem_liq), fmt(totais.prod), '', '']],
                theme: 'striped',
                styles: { font: 'helvetica', fontSize: 7, cellPadding: 1.5 },
                headStyles: { fillColor: DARK, textColor: 255, fontSize: 8 },
                footStyles: { fillColor: SOFT, textColor: DARK, fontStyle: 'bold' },
                margin: { top: 32, left: 10, right: 10 },
            });

            if (proc.lateOrders.length) {
                doc.addPage();
                const totalAtr = proc.lateOrders.reduce((s, o) => s + o.qtd, 0);
                autoTable(doc, {
                    startY: 35,
                    head: [['Atraso', 'Entrega', 'Pedido', 'Cliente', 'Item', 'Qtd']],
                    body: proc.lateOrders.slice(0, 200).map(o => [
                        `${o.dias}d`, o.dt, o.ped, (o.cli || '').substring(0, 30),
                        `${o.cod} ${(o.desc || '').substring(0, 25)}`, fmt(o.qtd)
                    ]),
                    foot: [['', '', '', '', 'TOTAL ATRASADO', fmt(totalAtr)]],
                    theme: 'striped',
                    styles: { font: 'helvetica', fontSize: 7, cellPadding: 1.5 },
                    headStyles: { fillColor: ACCENT, textColor: 255 },
                    footStyles: { fillColor: [254, 226, 226], textColor: ACCENT, fontStyle: 'bold' },
                    margin: { top: 32, left: 10, right: 10 },
                });
            }

            // ===== Sugestoes de IA (Production Plan) =====
            if (proc.aiData && proc.aiData.length) {
                doc.addPage();
                const totQtd = proc.aiData.reduce((s: number, r: any) => s + (r.qtd || 0), 0);
                const totVal = proc.aiData.reduce((s: number, r: any) => s + (r.val_total || 0), 0);
                const totPed = proc.aiData.reduce((s: number, r: any) => s + (r.qtd_peds || 0), 0);
                autoTable(doc, {
                    startY: 35,
                    head: [['Seq', 'SKU', 'Descricao', 'Sugestao', 'Valor (R$)', 'Qtd Peds']],
                    body: proc.aiData.slice(0, 100).map((r: any) => [
                        r.seq, r.cod, (r.desc || '').substring(0, 45),
                        fmt(r.qtd), fmtMoney(r.val_total), r.qtd_peds
                    ]),
                    foot: [['', '', 'TOTAL', fmt(totQtd), fmtMoney(totVal), totPed]],
                    theme: 'striped',
                    styles: { font: 'helvetica', fontSize: 7, cellPadding: 1.5 },
                    headStyles: { fillColor: [124, 58, 237], textColor: 255 },
                    footStyles: { fillColor: [237, 233, 254], textColor: [88, 28, 135], fontStyle: 'bold' },
                    margin: { top: 32, left: 10, right: 10 },
                });
            }

            const total = doc.getNumberOfPages();
            for (let i = 1; i <= total; i++) { doc.setPage(i); drawHeaderFooter(i, total); }

            const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
            if (returnBase64) {
                const dataUri = doc.output('datauristring');
                return dataUri.split(',')[1] || null;
            }
            doc.save(`Torre-SOP_${stamp}.pdf`);
        } catch (e) {
            console.error('Erro ao gerar PDF', e);
            if (!returnBase64) toast.error('Erro ao gerar PDF. Veja o console.');
            throw e;
        } finally {
            setExportingPdf(false);
        }
        return null;
    };

    const adhData = useMemo(() => {
        const agg: Record<number, any> = {};
        dadosFiltrados.forEach(r => {
            if (!agg[r.sort]) agg[r.sort] = { label: r.mesAno, sort: r.sort, fat: 0, prod: 0, cart: 0 };
            agg[r.sort].fat += r.fat; agg[r.sort].prod += r.prod; agg[r.sort].cart += r.cart;
        });
        return Object.values(agg).sort((a: any, b: any) => a.sort - b.sort).map((d: any) => {
            const dem = d.fat + d.cart;
            return {
                label: d.label,
                Svc: dem > 0 ? Math.round((d.fat / dem) * 100) : 0,
                Cob: dem > 0 ? Math.round((d.prod / dem) * 100) : 0,
            };
        });
    }, [dadosFiltrados]);

    // Agregação mensal por métrica para o breakdown ao clicar na lupa do KPI card
    const monthlyByMetric = useMemo(() => {
        const agg: Record<string, { sort: number; mes: string; meta: number; fat: number; prod: number; cart: number; venda: number; res: number }> = {};
        dadosFiltrados.forEach(r => {
            if (!agg[r.sort]) agg[r.sort] = { sort: r.sort, mes: r.mesAno, meta: 0, fat: 0, prod: 0, cart: 0, venda: 0, res: 0 };
            agg[r.sort].meta += r.meta || 0;
            agg[r.sort].fat += r.fat || 0;
            agg[r.sort].prod += r.prod || 0;
            agg[r.sort].cart += r.cart || 0;
            agg[r.sort].venda += r.venda || 0;
            agg[r.sort].res += r.res || 0;
        });
        return Object.values(agg).sort((a, b) => a.sort - b.sort);
    }, [dadosFiltrados]);

    const buildBreakdown = useCallback((cardKey: string): { title: string; rows: { mes: string; valor: string; pct?: string }[] } => {
        const total = (sel: (m: typeof monthlyByMetric[number]) => number) => monthlyByMetric.reduce((s, m) => s + sel(m), 0);
        const fmtPct = (n: number, t: number) => t > 0 ? `${Math.round((n / t) * 100)}%` : '0%';
        const buildVal = (sel: (m: typeof monthlyByMetric[number]) => number, includePct: boolean) => {
            const t = total(sel);
            return monthlyByMetric.map(m => ({
                mes: m.mes,
                valor: fmt(sel(m)),
                pct: includePct ? fmtPct(sel(m), t) : undefined,
            }));
        };
        const buildPctRatio = (num: (m: typeof monthlyByMetric[number]) => number, den: (m: typeof monthlyByMetric[number]) => number) =>
            monthlyByMetric.map(m => {
                const d = den(m);
                return { mes: m.mes, valor: d > 0 ? `${Math.round((num(m) / d) * 100)}%` : '0%' };
            });

        switch (cardKey) {
            case 'Meta Projetada':   return { title: 'Meta por Mês',           rows: buildVal(m => m.meta, true) };
            case 'Faturado Real':    return { title: 'Faturado por Mês',       rows: buildVal(m => m.fat, true) };
            case 'Produzido':        return { title: 'Produzido por Mês',      rows: buildVal(m => m.prod, true) };
            case 'Carteira':         return { title: 'Carteira por Mês',       rows: buildVal(m => m.cart, true) };
            case 'Reservado':        return { title: 'Reservado por Mês',      rows: buildVal(m => m.res, true) };
            case 'Entrada Pedidos':  return { title: 'Entrada por Mês',        rows: buildVal(m => m.venda, true) };
            case 'Atingimento':      return { title: 'Atingimento por Mês (Fat/Meta)', rows: buildPctRatio(m => m.fat, m => m.meta) };
            case 'Nível Serviço':    return { title: 'Nível Serviço por Mês (Fat/(Fat+Cart))', rows: buildPctRatio(m => m.fat, m => m.fat + m.cart) };
            case 'Aderência':        return { title: 'Aderência por Mês (Prod/(Fat+Cart))',   rows: buildPctRatio(m => m.prod, m => m.fat + m.cart) };
            case 'Execução OPs':     return { title: 'Execução OPs por Mês (Prod/(Prod+Cart))', rows: buildPctRatio(m => m.prod, m => m.prod + m.cart) };
            case 'Pedidos em Atraso': {
                const lateAgg: Record<string, { sort: number; mes: string; total: number; n: number }> = {};
                (proc?.lateOrders || []).forEach(o => {
                    if (!lateAgg[o.sortDt]) lateAgg[o.sortDt] = { sort: o.sortDt, mes: o.mesAno, total: 0, n: 0 };
                    lateAgg[o.sortDt].total += o.qtd; lateAgg[o.sortDt].n++;
                });
                return { title: 'Pedidos em Atraso por Mês', rows: Object.values(lateAgg).sort((a, b) => a.sort - b.sort).map(x => ({ mes: x.mes, valor: fmt(x.total), pct: `${x.n} ped.` })) };
            }
            default: return { title: cardKey, rows: [] };
        }
    }, [monthlyByMetric, proc]);

    const PerfBadge = ({ v }: { v: number }) => {
        let cls = 'text-emerald-600';
        if (v < 50) cls = 'text-red-600';
        else if (v < 80) cls = 'text-amber-600';
        return <span className={`font-bold ${cls}`}>{Math.round(v)}%</span>;
    };

    const StatusBadge = ({ s, desc }: { s: string; desc: string }) => {
        const u = s.toUpperCase();
        let cls = 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300';
        let label = s;
        if (u.includes('SEM')) { cls = 'bg-red-100 text-red-800 border border-red-300 dark:bg-red-500/20 dark:text-red-300 dark:border-red-500/40'; label = 'SEM OP'; }
        else if (u.includes('CRI')) { cls = 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300'; label = 'CRÍTICO'; }
        else if (u.includes('ATEN')) { cls = 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300'; label = 'ATENÇÃO'; }
        else if (u.includes('EXC')) { cls = 'bg-sky-100 text-sky-800 dark:bg-sky-500/20 dark:text-sky-300'; label = 'EXCESSO'; }
        else if (u.includes('HIST')) { cls = 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'; label = '—'; }
        return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${cls}`} title={desc}>{label}</span>;
    };

    const Tendencia = ({ row }: { row: MainRow }) => {
        const Icon = row.tend_dir === 'up' ? TrendingUp : row.tend_dir === 'down' ? TrendingDown : Minus;
        const color = row.tend_dir === 'up' ? 'text-emerald-600' : row.tend_dir === 'down' ? 'text-red-600' : 'text-slate-400';
        return (
            <span className="inline-flex items-center gap-1 font-mono">
                {fmt(row.tend_atual)}
                <Icon className={`w-3.5 h-3.5 ${color}`} />
            </span>
        );
    };

    if (loading && !raw) {
        return <div className="p-8 text-center text-slate-500 dark:text-slate-400">Carregando Torre S&OP…</div>;
    }
    if (error && !raw) {
        return (
            <div className="p-8 text-center">
                <p className="text-red-600 mb-3">Erro: {error}</p>
                <button onClick={() => carregar(false)} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">Tentar novamente</button>
            </div>
        );
    }
    if (!proc) return null;

    return (
        <div ref={containerRef} className={`p-4 space-y-4 bg-slate-50 dark:bg-slate-900 ${isFullscreen ? 'h-screen w-screen overflow-y-auto' : 'min-h-screen'}`}>
            {/* Header */}
            <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white p-4 rounded-xl shadow flex flex-wrap justify-between items-center gap-3">
                <div>
                    <h1 className="text-xl font-bold">Torre de Controle S&OP</h1>
                    <p className="text-xs text-slate-300">
                        Atualizado em: {updatedAt
                            ? updatedAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
                            : '-'}
                        {raw?.meta?.elapsed_seconds && ` (${raw.meta.elapsed_seconds}s)`}
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => exportarPdf()}
                        disabled={exportingPdf || !proc}
                        title="Exportar dashboard em PDF"
                        className="flex items-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg font-bold disabled:opacity-50"
                    >
                        <FileDown className={`w-4 h-4 ${exportingPdf ? 'animate-pulse' : ''}`} />
                        {exportingPdf ? 'Gerando...' : 'PDF'}
                    </button>
                    <button
                        onClick={() => setWppModalOpen(true)}
                        disabled={!proc}
                        title="Enviar dashboard via WhatsApp (HTML interativo gerado no servidor)"
                        className="flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 border border-green-500 rounded-lg font-bold disabled:opacity-50"
                    >
                        <MessageSquare className="w-4 h-4" /> WhatsApp
                    </button>
                    <button
                        onClick={toggleFullscreen}
                        title={isFullscreen ? 'Sair da tela cheia' : 'Expandir para tela cheia'}
                        className="flex items-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg font-bold"
                    >
                        {isFullscreen ? <><Minimize2 className="w-4 h-4" /> Reduzir</> : <><Maximize2 className="w-4 h-4" /> Expandir</>}
                    </button>
                    <button
                        onClick={() => carregar(true)}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg font-bold disabled:opacity-50"
                    >
                        <RotateCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        {loading ? 'Atualizando...' : 'Atualizar'}
                    </button>
                </div>
            </div>

            {/* Filtros */}
            <div className="bg-white dark:bg-slate-800 p-3 rounded-xl shadow border border-slate-200 dark:border-slate-700">
                <style>{`.sop-filter{height:32px;padding:0 8px;border:1px solid rgb(203 213 225);border-radius:6px;font-size:12px;width:100%;background:white;color:rgb(15 23 42)} .dark .sop-filter{background:rgb(51 65 85);border-color:rgb(71 85 105);color:white}`}</style>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2 text-xs">
                    <div>
                        <label className="block font-bold text-slate-500 mb-1">Início</label>
                        <input
                            type="month"
                            value={p1 ? sortToMonthStr(p1) : ''}
                            min={proc.sortedPeriods[0] ? sortToMonthStr(proc.sortedPeriods[0].sort) : undefined}
                            max={proc.sortedPeriods[proc.sortedPeriods.length - 1] ? sortToMonthStr(proc.sortedPeriods[proc.sortedPeriods.length - 1].sort) : undefined}
                            onChange={e => e.target.value && setP1(monthStrToSort(e.target.value))}
                            className="sop-filter"
                        />
                    </div>
                    <div>
                        <label className="block font-bold text-slate-500 mb-1">Fim</label>
                        <input
                            type="month"
                            value={p2 ? sortToMonthStr(p2) : ''}
                            min={proc.sortedPeriods[0] ? sortToMonthStr(proc.sortedPeriods[0].sort) : undefined}
                            max={proc.sortedPeriods[proc.sortedPeriods.length - 1] ? sortToMonthStr(proc.sortedPeriods[proc.sortedPeriods.length - 1].sort) : undefined}
                            onChange={e => e.target.value && setP2(monthStrToSort(e.target.value))}
                            className="sop-filter"
                        />
                    </div>
                    <div>
                        <label className="block font-bold text-slate-500 mb-1">Status</label>
                        <select value={fStat} onChange={e => setFStat(e.target.value)} className="sop-filter">
                            <option value="">Todos</option>
                            <option value="SEM OP">Sem OP</option>
                            <option value="CRÍTICO">Crítico</option>
                            <option value="ATENÇÃO">Atenção</option>
                            <option value="OK">Estável</option>
                        </select>
                    </div>
                    <div>
                        <label className="block font-bold text-slate-500 mb-1">Classe ABC</label>
                        <select value={fAbc} onChange={e => setFAbc(e.target.value)} className="sop-filter">
                            <option value="">Todas</option>
                            <option value="A">A</option>
                            <option value="B">B</option>
                            <option value="C">C</option>
                        </select>
                    </div>
                    <div>
                        <label className="block font-bold text-slate-500 mb-1">Família</label>
                        <select value={fFam} onChange={e => setFFam(e.target.value)} className="sop-filter">
                            <option value="">Todas</option>
                            {familias.map(f => <option key={f} value={f}>{f}</option>)}
                        </select>
                    </div>
                    <div className="md:col-span-2">
                        <label className="block font-bold text-slate-500 mb-1">Busca rápida</label>
                        <input value={fTxt} onChange={e => setFTxt(e.target.value)} placeholder="SKU ou nome..." className="sop-filter" />
                    </div>
                </div>
                <div className="mt-2 flex justify-end gap-2">
                    <button
                        onClick={setarPeriodoMesAtual}
                        className="inline-flex items-center gap-1 px-3 py-1 text-[11px] font-bold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-900/30 hover:bg-blue-100 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-700 rounded"
                        title="Filtrar periodo apenas para o mes atual"
                    >
                        Este mês
                    </button>
                    <button
                        onClick={clearFilters}
                        className="inline-flex items-center gap-1 px-3 py-1 text-[11px] font-bold text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600 rounded"
                        title="Limpar filtros (Status, ABC, Família, Busca, Backlog)"
                    >
                        <FilterX className="w-3 h-3" /> Limpar filtros
                    </button>
                </div>
            </div>

            {/* KPI Cards */}
            <KpiGrid className="grid grid-cols-2 md:grid-cols-5 gap-3">
                {([
                    { k: 'Meta Projetada', v: fmt(totais.meta), sub: 'Demanda Meta p/ Período', color: 'slate' },
                    { k: 'Faturado Real', v: fmt(totais.fat), sub: 'Total Invoiced (Acumulado)', color: 'blue' },
                    { k: 'Produzido', v: fmt(totais.prod), sub: 'Total Apontado (Acumulado)', color: 'emerald' },
                    { k: 'Carteira', v: fmt(totais.cart), sub: 'Pedidos Venda em Aberto', color: 'blue' },
                    { k: 'Reservado', v: fmt(totais.res), sub: 'Saldo Reservado Total', color: 'indigo' },
                    { k: 'Pedidos em Atraso', v: fmt(totais.lateVol), sub: `${totais.lateBacklogPct}% do Backlog Total`, color: 'red' },
                    { k: 'Atingimento', v: `${Math.round(totais.perfMeta)}%`, sub: 'Fat Real vs Meta (%)', color: 'indigo' },
                    { k: 'Entrada Pedidos', v: fmt(totais.venda), sub: 'Entrada Bruta no Período', color: 'orange' },
                    { k: 'Nível Serviço', v: `${Math.round(totais.perfSvc)}%`, sub: 'Faturado vs Demanda', color: 'emerald' },
                    { k: 'Aderência', v: `${Math.round(totais.perfProd)}%`, sub: 'Produzido vs Demanda', color: 'blue' },
                    { k: 'Execução OPs', v: `${Math.round(totais.percExec)}%`, sub: '% Prod / (Prod + Saldo)', color: 'slate' },
                ] as { k: string; v: string; sub: React.ReactNode; color: KpiColor }[]).map((c, i) => (
                    <KpiCard
                        key={i}
                        label={c.k}
                        value={c.v}
                        sub={c.sub}
                        color={c.color}
                        action={(
                            <button
                                onClick={() => setBreakdown(buildBreakdown(c.k))}
                                title={`Detalhar ${c.k} por mês`}
                                className="text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors flex-shrink-0"
                            >
                                <Search className="w-3.5 h-3.5" />
                            </button>
                        )}
                    />
                ))}
            </KpiGrid>

            {/* Charts */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-white dark:bg-slate-800 p-3 rounded-xl shadow border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs uppercase font-bold text-slate-500">Tendências de Volume</h3>
                        <button onClick={() => setChartTypeMain(chartTypeMain === 'line' ? 'bar' : 'line')} title={`Alternar para ${chartTypeMain === 'line' ? 'colunas' : 'linhas'}`} className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-600">
                            {chartTypeMain === 'line' ? <><BarChart3 className="w-3 h-3" /> Colunas</> : <><LineChartIcon className="w-3 h-3" /> Linhas</>}
                        </button>
                    </div>
                    <ResponsiveContainer width="100%" height={250}>
                        {chartTypeMain === 'line' ? (
                        <LineChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip />
                            <Legend />
                            <Line type="monotone" dataKey="Meta" stroke="#333" strokeDasharray="5 5" />
                            <Line type="monotone" dataKey="Venda" stroke="#e67e22" />
                            <Line type="monotone" dataKey="Fat" stroke="#3498db" />
                            <Line type="monotone" dataKey="Prod" stroke="#2ecc71" />
                        </LineChart>
                        ) : (
                        <BarChart data={chartData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip />
                            <Legend />
                            <Bar dataKey="Meta" fill="#333" />
                            <Bar dataKey="Venda" fill="#e67e22" />
                            <Bar dataKey="Fat" fill="#3498db" />
                            <Bar dataKey="Prod" fill="#2ecc71" />
                        </BarChart>
                        )}
                    </ResponsiveContainer>
                </div>
                <div className="bg-white dark:bg-slate-800 p-3 rounded-xl shadow border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs uppercase font-bold text-slate-500">Nível de Serviço & Aderência (%)</h3>
                        <button onClick={() => setChartTypeAdh(chartTypeAdh === 'line' ? 'bar' : 'line')} title={`Alternar para ${chartTypeAdh === 'line' ? 'colunas' : 'linhas'}`} className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-600">
                            {chartTypeAdh === 'line' ? <><BarChart3 className="w-3 h-3" /> Colunas</> : <><LineChartIcon className="w-3 h-3" /> Linhas</>}
                        </button>
                    </div>
                    <ResponsiveContainer width="100%" height={250}>
                        {chartTypeAdh === 'line' ? (
                        <LineChart data={adhData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                            <YAxis domain={[0, 120]} tick={{ fontSize: 10 }} />
                            <Tooltip />
                            <Legend />
                            <Line type="monotone" dataKey="Svc" stroke="#20c997" name="% Svc (Nível Serviço)" />
                            <Line type="monotone" dataKey="Cob" stroke="#198754" name="% Cob (Aderência Prod)" />
                        </LineChart>
                        ) : (
                        <BarChart data={adhData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                            <YAxis domain={[0, 120]} tick={{ fontSize: 10 }} />
                            <Tooltip />
                            <Legend />
                            <Bar dataKey="Svc" fill="#20c997" name="% Svc (Nível Serviço)" />
                            <Bar dataKey="Cob" fill="#198754" name="% Cob (Aderência Prod)" />
                        </BarChart>
                        )}
                    </ResponsiveContainer>
                </div>
            </div>

            <MobileLandscapeHint />
            {/* Tabela principal */}
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="overflow-x-auto" style={{ maxHeight: 600 }}>
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-700 sticky top-0 z-10">
                            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500">
                                <th className="px-2 py-2 cursor-pointer select-none whitespace-nowrap" onClick={() => { setSortCol('seq'); setSortDir('asc'); }} title="Ordenar por sequência IA">IA {sortCol === 'seq' ? '▲' : ''}</th>
                                <th className="px-2 py-2">Mês</th>
                                <th className="px-2 py-2 cursor-pointer select-none whitespace-nowrap" onClick={() => { if (sortCol === 'cod') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol('cod'); setSortDir('asc'); } }} title="Ordenar por código">Cód {sortCol === 'cod' ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</th>
                                <th className="px-2 py-2 cursor-pointer select-none whitespace-nowrap" onClick={() => { if (sortCol === 'desc') setSortDir(d => d === 'asc' ? 'desc' : 'asc'); else { setSortCol('desc'); setSortDir('asc'); } }} title="Ordenar por descrição">Produto {sortCol === 'desc' ? (sortDir === 'asc' ? '▲' : '▼') : '↕'}</th>
                                <th className="px-2 py-2 text-right" title="Tendência: média 6m atual vs anterior. Seta: tendência subindo/caindo.">Tendência</th>
                                <th className="px-2 py-2 text-right">Venda</th>
                                <th className="px-2 py-2 text-right">Fat</th>
                                <th className="px-2 py-2 text-center">Svc%</th>
                                <th className="px-2 py-2 text-right">Cart</th>
                                <th className="px-2 py-2 text-right">Res</th>
                                <th className="px-2 py-2 text-right">Dem Liq</th>
                                <th className="px-2 py-2 text-right">OPs</th>
                                <th className="px-2 py-2 text-right">Gap</th>
                                <th className="px-2 py-2 text-right">Prod</th>
                                <th className="px-2 py-2 text-center">Cob%</th>
                                <th className="px-2 py-2 text-right">Fab</th>
                                <th className="px-2 py-2 text-right">Log</th>
                                <th className="px-2 py-2 text-center">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                            {dadosFiltrados.slice(0, 300).map((r, idx) => (
                                <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    <td className="px-2 py-1 text-center text-slate-400">{r.seq_ai < 9000 ? r.seq_ai : '-'}</td>
                                    <td className="px-2 py-1 font-mono">{r.mesAno}</td>
                                    <td className="px-2 py-1">
                                        {r.cls && r.cls !== '-' && <span className="inline-block w-5 h-5 text-center font-bold text-[10px] mr-1 rounded bg-slate-100 dark:bg-slate-700">{r.cls}</span>}
                                        <b>{r.cod}</b>
                                        <div className="text-[10px] text-slate-400 truncate" style={{ maxWidth: 200 }}>{r.desc}</div>
                                    </td>
                                    <td className="px-2 py-1 text-right"><Tendencia row={r} /></td>
                                    <td className="px-2 py-1 text-right font-mono">{fmt(r.venda)}</td>
                                    <td className="px-2 py-1 text-right font-bold text-blue-600">{fmt(r.fat)}</td>
                                    <td className="px-2 py-1 text-center"><PerfBadge v={r.pct_svc} /></td>
                                    <td className="px-2 py-1 text-right font-bold text-cyan-600">{fmt(r.cart)}</td>
                                    <td className="px-2 py-1 text-right font-mono">{fmt(r.res)}</td>
                                    <td className="px-2 py-1 text-right font-bold text-red-600">{fmt(r.dem_liq)}</td>
                                    <td className="px-2 py-1 text-right font-mono">{fmt(r.ops)}</td>
                                    <td className="px-2 py-1 text-right font-bold text-red-600">{fmt(r.sug)}</td>
                                    <td className="px-2 py-1 text-right font-bold text-emerald-600">{fmt(r.prod)}</td>
                                    <td className="px-2 py-1 text-center"><PerfBadge v={r.pct_prod} /></td>
                                    <td className="px-2 py-1 text-right font-mono">{fmt(r.est_fab)}</td>
                                    <td className="px-2 py-1 text-right font-bold">{fmt(r.est_log)}</td>
                                    <td className="px-2 py-1 text-center"><StatusBadge s={r.st} desc={r.st_desc} /></td>
                                </tr>
                            ))}
                            {dadosFiltrados.length === 0 && (
                                <tr><td colSpan={17} className="text-center py-8 text-slate-400">Nenhum dado encontrado para o filtro</td></tr>
                            )}
                        </tbody>
                        <tfoot className="bg-slate-100 dark:bg-slate-700 font-bold sticky bottom-0 z-10">
                            <tr>
                                <td colSpan={3} className="px-2 py-2 text-right">TOTAL FILTRADO:</td>
                                <td className="px-2 py-2 text-right">{fmt(totais.meta)}</td>
                                <td className="px-2 py-2 text-right">{fmt(totais.venda)}</td>
                                <td className="px-2 py-2 text-right">{fmt(totais.fat)}</td>
                                <td></td>
                                <td className="px-2 py-2 text-right">{fmt(totais.cart)}</td>
                                <td className="px-2 py-2 text-right">{fmt(totais.res)}</td>
                                <td className="px-2 py-2 text-right">{fmt(totais.dem_liq)}</td>
                                <td className="px-2 py-2 text-right">{fmt(totais.ops)}</td>
                                <td className="px-2 py-2 text-right">{fmt(totais.sug)}</td>
                                <td className="px-2 py-2 text-right">{fmt(totais.prod)}</td>
                                <td></td>
                                <td className="px-2 py-2 text-right">{fmt(totais.est_fab)}</td>
                                <td className="px-2 py-2 text-right">{fmt(totais.est_log)}</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>
            </div>

            {/* Aging */}
            {proc.agingData.length > 0 && (
                <div className="bg-white dark:bg-slate-800 p-3 rounded-xl shadow border-t-4 border-red-500">
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs uppercase font-bold text-slate-500">Aging de Backlog (OPs em aberto)</h3>
                        <button onClick={() => setChartTypeAging(chartTypeAging === 'bar' ? 'line' : 'bar')} title={`Alternar para ${chartTypeAging === 'bar' ? 'linhas' : 'colunas'}`} className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 px-2 py-0.5 rounded border border-slate-200 dark:border-slate-600">
                            {chartTypeAging === 'bar' ? <><LineChartIcon className="w-3 h-3" /> Linhas</> : <><BarChart3 className="w-3 h-3" /> Colunas</>}
                        </button>
                    </div>
                    <ResponsiveContainer width="100%" height={250}>
                        {chartTypeAging === 'bar' ? (
                        <BarChart data={proc.agingData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip />
                            <Bar dataKey="total" fill="#e74c3c" name="Saldo em Aberto" />
                        </BarChart>
                        ) : (
                        <LineChart data={proc.agingData}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                            <YAxis tick={{ fontSize: 10 }} />
                            <Tooltip />
                            <Line type="monotone" dataKey="total" stroke="#e74c3c" name="Saldo em Aberto" />
                        </LineChart>
                        )}
                    </ResponsiveContainer>
                </div>
            )}

            {/* Late Orders */}
            {proc.lateOrders.length > 0 && (() => {
                const lateFiltered = proc.lateOrders.filter(o => {
                    if (!fLate) return true;
                    const t = fLate.toLowerCase();
                    return (o.ped || '').toLowerCase().includes(t)
                        || (o.cod || '').toLowerCase().includes(t)
                        || (o.cli || '').toLowerCase().includes(t)
                        || (o.desc || '').toLowerCase().includes(t);
                });
                const totalAtrasado = lateFiltered.reduce((acc, o) => acc + o.qtd, 0);

                // Resumo por (mes_ref, cod)
                const sumMap: Record<string, { sort: number; per: string; cod: string; desc: string; total: number; count: number }> = {};
                lateFiltered.forEach(o => {
                    const key = o.sortDt + '_' + o.cod;
                    if (!sumMap[key]) sumMap[key] = { sort: o.sortDt, per: o.mesAno, cod: o.cod, desc: o.desc, total: 0, count: 0 };
                    sumMap[key].total += o.qtd;
                    sumMap[key].count++;
                });
                const sumList = Object.values(sumMap).sort((a, b) => a.sort - b.sort || b.total - a.total);
                const totQtd = sumList.reduce((acc, s) => acc + s.total, 0);
                const totCount = sumList.reduce((acc, s) => acc + s.count, 0);
                let lastPer = '';

                return (
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow border border-red-200 overflow-hidden">
                        <div className="bg-red-50 dark:bg-red-900/20 px-4 py-2 border-b border-red-200 flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <span className="text-xs font-bold text-red-700 dark:text-red-400 uppercase">🚨 Backlog Vencido</span>
                                <input
                                    value={fLate}
                                    onChange={e => setFLate(e.target.value)}
                                    placeholder="Filtrar Pedido, Cliente ou SKU..."
                                    className="text-xs border border-slate-300 dark:border-slate-600 dark:bg-slate-700 rounded px-2 py-1 w-56"
                                />
                            </div>
                            <span className="text-xs font-bold bg-white dark:bg-slate-800 px-3 py-1 rounded-full text-red-700">{new Set(lateFiltered.map(o => o.ped)).size} pedidos · {lateFiltered.length} itens</span>
                        </div>
                        <div className="px-3 py-3 space-y-4">
                            <div>
                                <h4 className="text-xs font-bold text-red-700 dark:text-red-400 mb-2">📦 Pedidos Pendentes Detalhados (Transacional)</h4>
                                <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded" style={{ maxHeight: 600 }}>
                                    <table className="w-full text-xs">
                                        <thead className="bg-slate-50 dark:bg-slate-700 sticky top-0">
                                            <tr className="text-left text-[10px] uppercase text-slate-500">
                                                <th className="px-2 py-2">Atraso</th>
                                                <th className="px-2 py-2">Entrega</th>
                                                <th className="px-2 py-2">Pedido</th>
                                                <th className="px-2 py-2">Cliente</th>
                                                <th className="px-2 py-2">Item</th>
                                                <th className="px-2 py-2 text-right">Qtd</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                            {lateFiltered.map((o, i) => (
                                                <tr key={i}>
                                                    <td className="px-2 py-1 font-bold text-red-600">{o.dias} dias</td>
                                                    <td className="px-2 py-1">{parseBRDate(o.dt)?.toLocaleDateString('pt-BR') || o.dt}</td>
                                                    <td className="px-2 py-1">{o.ped}</td>
                                                    <td className="px-2 py-1">{o.cli?.substring(0, 25)}</td>
                                                    <td className="px-2 py-1">
                                                        <b>{o.cod}</b>
                                                        <div className="text-[10px] text-slate-400">{o.desc?.substring(0, 30)}</div>
                                                    </td>
                                                    <td className="px-2 py-1 text-right font-bold">{fmt(o.qtd)}</td>
                                                </tr>
                                            ))}
                                            {lateFiltered.length === 0 && (
                                                <tr><td colSpan={6} className="text-center py-4 text-slate-400">Nenhum pedido atrasado encontrado.</td></tr>
                                            )}
                                        </tbody>
                                        <tfoot className="bg-red-50 dark:bg-red-900/20 sticky bottom-0 z-10">
                                            <tr>
                                                <td colSpan={5} className="px-2 py-2 text-right font-bold text-red-700">TOTAL ATRASADO:</td>
                                                <td className="px-2 py-2 text-right font-bold text-red-700">{fmt(totalAtrasado)}</td>
                                            </tr>
                                        </tfoot>
                                    </table>
                                </div>
                            </div>

                        </div>
                    </div>
                );
            })()}

            {/* KPI Breakdown Modal */}
            {breakdown && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setBreakdown(null)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl border border-slate-200 dark:border-slate-700 max-w-md w-full max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                            <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">{breakdown.title}</h3>
                            <button onClick={() => setBreakdown(null)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><X className="w-4 h-4" /></button>
                        </div>
                        <div className="overflow-y-auto p-2">
                            {breakdown.rows.length === 0 ? (
                                <p className="text-xs text-slate-400 italic p-4 text-center">Sem dados para exibir.</p>
                            ) : (
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-50 dark:bg-slate-700">
                                        <tr className="text-left text-[10px] uppercase text-slate-500">
                                            <th className="px-3 py-2">Mês</th>
                                            <th className="px-3 py-2 text-right">VLR/%</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                        {breakdown.rows.map((r, i) => (
                                            <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                                <td className="px-3 py-1.5 font-mono">{r.mes}</td>
                                                <td className="px-3 py-1.5 text-right font-bold">
                                                    {r.valor}{r.pct ? <span className="text-slate-400 font-normal ml-2">({r.pct})</span> : null}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </div>
                </div>
            )}
            <WhatsAppEnvioModal
                open={wppModalOpen}
                onClose={() => setWppModalOpen(false)}
                titulo="Enviar Torre S&OP (HTML interativo)"
                onEnviar={(numero) => {
                    if (!proc) return Promise.reject(new Error('Dashboard ainda não carregado.'));
                    return api.enviarSopDashboardWhatsAppInterativo(numero, {
                        db_main: proc.mainData,
                        db_drill: proc.drill,
                        db_ai: proc.aiData,
                        db_aging: proc.agingData,
                        db_late: proc.lateOrders,
                        periods: proc.sortedPeriods,
                        kpis_topo: proc.kpisTopo,
                        total_late_vol: proc.totalLateVol,
                        total_backlog_vol: proc.totalBacklogVol,
                        current_year: proc.currentYear,
                        current_month: proc.currentMonth,
                    });
                }}
            />
        </div>
    );
};

export default SopDashboard;
