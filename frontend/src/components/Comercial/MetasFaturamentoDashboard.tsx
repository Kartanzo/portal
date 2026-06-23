import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { MobileLandscapeHint } from '../ui/MobileLandscapeHint';
import { User } from '../../types';
import { api } from '../../app_api';
import {
  ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip, Legend, CartesianGrid,
  LineChart, Line, ReferenceLine,
  PieChart, Pie, Cell,
} from 'recharts';
import { RefreshCw, Target, TrendingUp, AlertTriangle, DollarSign, X } from 'lucide-react';
import KpiCard, { KpiGrid } from '../common/KpiCard';

interface Props { user: User; }

interface KPIs {
  faturamento_total: number;
  faturamento_semst_total: number;
  carteira_total: number;
  unidades_faturadas: number;
  ticket_medio: number;
  preco_medio: number;
  positivacao: number;
  meta_total: number;
  percentual_atingimento: number;
  devolucoes_total: number;
}
interface VendedorRow { nome: string; faturamento: number; faturamento_semst: number; meta: number; percentual: number; faturamento_anterior?: number; variacao_pct?: number | null; }
interface RegionalRow { regional: string; faturamento: number; faturamento_semst: number; meta: number; faturamento_anterior?: number; variacao_pct?: number | null; }
interface SerieRow { mes: string; atual: number; anterior: number; }
interface FiltroOpts {
  vendedores: string[];
  regionais: string[];
  segmentos: string[];
  anos: number[];
  meses_disponiveis: number[];
}

const MES_LABEL: Record<number, string> = {
  1: 'Janeiro', 2: 'Fevereiro', 3: 'Março', 4: 'Abril', 5: 'Maio', 6: 'Junho',
  7: 'Julho', 8: 'Agosto', 9: 'Setembro', 10: 'Outubro', 11: 'Novembro', 12: 'Dezembro',
};

function formatBRL(v: number | null | undefined): string {
  const n = Number(v || 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function pctColor(pct: number): string {
  if (pct >= 100) return 'text-emerald-600 dark:text-emerald-400';
  if (pct >= 80) return 'text-amber-600 dark:text-amber-400';
  return 'text-red-600 dark:text-red-400';
}

const MetasFaturamentoDashboard: React.FC<Props> = ({ user: _user }) => {
  const anoAtual = new Date().getFullYear();
  const [ano, setAno] = useState<number>(anoAtual);
  const [mes, setMes] = useState<string>('');
  const [vendedor, setVendedor] = useState<string>('');
  const [regional, setRegional] = useState<string>('');
  const [segmento, setSegmento] = useState<string>('');

  const [filtros, setFiltros] = useState<FiltroOpts | null>(null);
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [porVendedor, setPorVendedor] = useState<VendedorRow[]>([]);
  const [porRegional, setPorRegional] = useState<RegionalRow[]>([]);
  const [serie, setSerie] = useState<SerieRow[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [comparar, setComparar] = useState(false);
  const [detalhe, setDetalhe] = useState<{ titulo: string; rows: any[]; loading: boolean; total: number; limite: number } | null>(null);
  const [pivot, setPivot] = useState<Array<{ regional: string; mes: number; total: number; qtd_pedidos: number }>>([]);
  const [apenasCarteira, setApenasCarteira] = useState(false);

  const abrirDetalhe = useCallback(async (tipo: 'vendedor' | 'regional', valor: string) => {
    setDetalhe({ titulo: `${tipo === 'vendedor' ? 'Vendedor' : 'Gerência Regional'}: ${valor}`, rows: [], loading: true, total: 0, limite: 2000 });
    try {
      const params: any = { ano, mes };
      if (segmento) params.segmento = segmento;
      if (tipo === 'vendedor') {
        params.vendedor = valor;
        if (regional) params.regional = regional;
      } else {
        params.regional = valor;
        if (vendedor) params.vendedor = vendedor;
      }
      const r: any = await api.get('/metas-faturamento/detalhes', { params });
      const data = (r as any).data ?? r;
      setDetalhe({ titulo: `${tipo === 'vendedor' ? 'Vendedor' : 'Gerência Regional'}: ${valor}`, rows: data.rows || [], loading: false, total: data.total || 0, limite: data.limite || 2000 });
    } catch (e: any) {
      setDetalhe({ titulo: `Erro ao carregar`, rows: [], loading: false, total: 0, limite: 2000 });
    }
  }, [ano, mes, segmento, vendedor, regional]);

  const abrirPedidosDetalhe = useCallback(async (regional: string, mesNum: number) => {
    const titulo = `${regional} — ${MES_LABEL[mesNum]} ${ano}${apenasCarteira ? ' · Carteira (status 1/4)' : ''}`;
    setDetalhe({ titulo, rows: [], loading: true, total: 0, limite: 2000 });
    try {
      const params: any = { ano, mes: mesNum, regional };
      if (segmento) params.segmento = segmento;
      if (vendedor) params.vendedor = vendedor;
      if (apenasCarteira) params.apenas_carteira = 1;
      const r: any = await api.get('/metas-faturamento/pedidos-detalhes', { params });
      const data = (r as any).data ?? r;
      setDetalhe({ titulo, rows: data.rows || [], loading: false, total: data.total || 0, limite: data.limite || 2000 });
    } catch (e: any) {
      setDetalhe({ titulo: 'Erro ao carregar', rows: [], loading: false, total: 0, limite: 2000 });
    }
  }, [ano, segmento, vendedor, apenasCarteira]);
  const [lastRefreshAt, setLastRefreshAt] = useState<string | null>(null);

  const buildParams = useCallback(() => {
    const p: Record<string, any> = {};
    if (ano) p.ano = ano;
    if (mes) p.mes = mes;
    if (vendedor) p.vendedor = vendedor;
    if (regional) p.regional = regional;
    if (segmento) p.segmento = segmento;
    return p;
  }, [ano, mes, vendedor, regional, segmento]);

  const carregar = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = buildParams();
    try {
      const [fRes, kRes, vRes, rRes, sRes, pRes] = await Promise.all([
        api.get('/metas-faturamento/filtros'),
        api.get('/metas-faturamento/kpis', { params }),
        api.get('/metas-faturamento/por-vendedor', { params: { ano: params.ano, mes: params.mes, regional: params.regional, segmento: params.segmento, comparar: comparar ? 1 : 0 } }),
        api.get('/metas-faturamento/por-regional', { params: { ano: params.ano, mes: params.mes, vendedor: params.vendedor, segmento: params.segmento, comparar: comparar ? 1 : 0 } }),
        api.get('/metas-faturamento/serie-mensal', { params: { ano: params.ano, vendedor: params.vendedor, regional: params.regional, segmento: params.segmento } }),
        api.get('/metas-faturamento/pedidos-pivot', { params: { ano: params.ano, vendedor: params.vendedor, segmento: params.segmento, apenas_carteira: apenasCarteira ? 1 : 0 } }),
      ]);
      setFiltros((fRes as any).data ?? fRes);
      setKpis((kRes as any).data ?? kRes);
      setPorVendedor(((vRes as any).data ?? vRes) || []);
      setPorRegional(((rRes as any).data ?? rRes) || []);
      setSerie(((sRes as any).data ?? sRes) || []);
      setPivot(((pRes as any).data ?? pRes) || []);
    } catch (e: any) {
      const msg = String(e?.message || '');
      if (msg.includes('503') || msg.toLowerCase().includes('failed')) {
        setError('Os dados de metas de faturamento ainda não estão disponíveis. Tente novamente em alguns instantes.');
      } else {
        setError('Erro ao carregar dados.');
      }
    } finally {
      setLoading(false);
    }
  }, [buildParams, comparar, apenasCarteira]);

  useEffect(() => { carregar(); }, [carregar]);

  // Buscar timestamp da ultima atualizacao
  const fetchStatus = useCallback(async () => {
    try {
      const r: any = await api.get('/metas-faturamento/status');
      const data = r?.data ?? r;
      setLastRefreshAt(data?.last_refresh_at || null);
    } catch { /* noop */ }
  }, []);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const refresh = async () => {
    if (refreshing) return; // bloqueio extra contra duplo-clique
    setRefreshing(true);
    try {
      const resp = await fetch(`${api.API_PREFIX}/metas-faturamento/refresh`, { method: 'POST', credentials: 'include' });
      if (resp.ok) {
        const data = await resp.json().catch(() => null);
        if (data?.last_refresh_at) setLastRefreshAt(data.last_refresh_at);
      }
    } catch { /* noop */ }
    await carregar();
    await fetchStatus();
    setRefreshing(false);
  };

  const formatLastRefresh = (iso: string | null) => {
    if (!iso) return 'Nunca atualizado';
    try {
      const d = new Date(iso);
      return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch { return iso; }
  };

  const donutData = useMemo(() => {
    if (!kpis) return [];
    const pct = Math.max(0, Math.min(100, kpis.percentual_atingimento));
    return [
      { name: 'Atingido', value: pct },
      { name: 'Restante', value: 100 - pct },
    ];
  }, [kpis]);

  const donutColor = useMemo(() => {
    const p = kpis?.percentual_atingimento ?? 0;
    if (p >= 100) return '#10b981';
    if (p >= 80) return '#f59e0b';
    return '#ef4444';
  }, [kpis]);

  return (
    <div className="p-4 md:p-6 bg-gradient-to-br from-indigo-100 via-violet-50 to-pink-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-900 min-h-screen relative">
      {/* Decorative orbs */}
      <div className="absolute top-0 left-0 w-96 h-96 bg-indigo-300/20 dark:bg-indigo-900/20 rounded-full blur-3xl pointer-events-none -translate-x-1/2 -translate-y-1/2" />
      <div className="absolute top-32 right-0 w-96 h-96 bg-pink-300/20 dark:bg-pink-900/10 rounded-full blur-3xl pointer-events-none translate-x-1/3" />
      <div className="absolute bottom-0 left-1/2 w-96 h-96 bg-violet-300/20 dark:bg-violet-900/10 rounded-full blur-3xl pointer-events-none translate-y-1/2" />
      <div className="max-w-[1400px] mx-auto relative z-10">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Target className="w-6 h-6 text-indigo-600" />
              Metas de Faturamento
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Visão consolidada do faturamento</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-slate-400 dark:text-slate-500">Última atualização</div>
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">{formatLastRefresh(lastRefreshAt)}</div>
            </div>
            <button
              onClick={refresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
              {refreshing ? 'Atualizando...' : 'Atualizar'}
            </button>
          </div>
        </div>

        {/* Overlay de aguarde durante refresh — bloqueia interacao */}
        {refreshing && (
          <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center">
            <div className="bg-white dark:bg-slate-800 rounded-xl px-6 py-5 shadow-2xl flex items-center gap-3 border border-slate-200 dark:border-slate-700">
              <RefreshCw className="w-5 h-5 text-indigo-600 animate-spin" />
              <div>
                <div className="text-sm font-bold text-slate-800 dark:text-slate-100">Atualizando dados...</div>
                <div className="text-xs text-slate-500 dark:text-slate-400">Isso pode levar alguns segundos. Por favor aguarde.</div>
              </div>
            </div>
          </div>
        )}

        {/* Filtros */}
        <div className="bg-gradient-to-r from-white via-slate-50 to-white dark:from-slate-800 dark:via-slate-800 dark:to-slate-800 rounded-xl p-4 mb-4 shadow-md border border-indigo-100 dark:border-slate-700 grid grid-cols-2 md:grid-cols-5 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Ano</label>
            <select value={ano} onChange={e => setAno(Number(e.target.value))} className="w-full text-xs border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded px-2 py-1.5">
              {(filtros?.anos ?? [anoAtual]).map(a => <option key={a} value={a}>{a}</option>)}
              {!filtros?.anos?.includes(anoAtual) && <option value={anoAtual}>{anoAtual}</option>}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Período (mês)</label>
            <MonthRangeSlider value={mes} onChange={setMes} />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Vendedor</label>
            <input
              list="lst-vendedores"
              value={vendedor}
              onChange={e => setVendedor(e.target.value)}
              placeholder="Todos"
              className="w-full text-xs border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded px-2 py-1.5"
            />
            <datalist id="lst-vendedores">
              {(filtros?.vendedores ?? []).map(v => <option key={v} value={v} />)}
            </datalist>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Regional</label>
            <select value={regional} onChange={e => setRegional(e.target.value)} className="w-full text-xs border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded px-2 py-1.5">
              <option value="">Todas</option>
              {(filtros?.regionais ?? []).map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">Segmento</label>
            <select value={segmento} onChange={e => setSegmento(e.target.value)} className="w-full text-xs border border-slate-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded px-2 py-1.5">
              <option value="">Todos</option>
              {(filtros?.segmentos ?? []).map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
        </div>

        {/* Toggle Comparar */}
        <div className="flex items-center gap-2 mb-3">
          <label className="inline-flex items-center gap-2 cursor-pointer select-none px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-indigo-200 dark:border-slate-700 hover:bg-indigo-50 dark:hover:bg-slate-700 transition-colors shadow-sm">
            <input
              type="checkbox"
              checked={comparar}
              onChange={e => setComparar(e.target.checked)}
              className="w-4 h-4 accent-indigo-600"
            />
            <span className="text-xs font-bold text-slate-700 dark:text-slate-200">
              Comparar com {ano - 1}
            </span>
          </label>
          {comparar && (
            <span className="text-[10px] text-slate-500 dark:text-slate-400">
              Mostrando colunas de {ano - 1} e variação % nas tabelas
            </span>
          )}
        </div>

        {error && (
          <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-300 dark:border-amber-700 text-amber-800 dark:text-amber-200 px-4 py-3 rounded-lg mb-4 flex items-start gap-2">
            <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
            <div className="text-sm">{error}</div>
          </div>
        )}

        {loading && !kpis ? (
          <div className="text-center py-12 text-slate-500 dark:text-slate-400">Carregando…</div>
        ) : (
          <>
            {/* KPIs */}
            <KpiGrid className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
              <KpiCard
                Icon={Target}
                label="Meta do Mês"
                value={formatBRL(kpis?.meta_total ?? 0)}
                color="red"
              />
              <KpiCard
                Icon={DollarSign}
                label="Fat. sem ST"
                value={formatBRL(kpis?.faturamento_semst_total ?? 0)}
                color="blue"
              />
              <KpiCard
                Icon={DollarSign}
                label="Carteira"
                value={formatBRL(kpis?.carteira_total ?? 0)}
                color="emerald"
              />
              <KpiCard
                Icon={TrendingUp}
                label="Unidades Faturadas"
                value={(kpis?.unidades_faturadas ?? 0).toLocaleString('pt-BR')}
                color="amber"
              />
              <KpiCard
                Icon={DollarSign}
                label="Ticket Médio Pedidos"
                value={formatBRL(kpis?.ticket_medio ?? 0)}
                color="indigo"
              />
              <KpiCard
                Icon={DollarSign}
                label="Preço Médio - Vendas"
                value={formatBRL(kpis?.preco_medio ?? 0)}
                color="red"
              />
              <KpiCard
                Icon={TrendingUp}
                label="Positivação - Vendas"
                value={(kpis?.positivacao ?? 0).toLocaleString('pt-BR')}
                color="blue"
              />
            </KpiGrid>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
              {/* Donut com % no centro */}
              <div className="bg-white dark:bg-slate-800 rounded-lg p-4 shadow-sm border border-slate-200 dark:border-slate-700 lg:col-span-1">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Atingimento da Meta</h3>
                <div style={{ position: 'relative', width: '100%', height: 250 }}>
                  <ResponsiveContainer width="100%" height={250}>
                    <PieChart>
                      <Pie
                        data={donutData}
                        dataKey="value"
                        cx="50%"
                        cy="50%"
                        innerRadius={70}
                        outerRadius={100}
                        startAngle={90}
                        endAngle={-270}
                        stroke="none"
                      >
                        <Cell fill={donutColor} />
                        <Cell fill="#e5e7eb" />
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{
                    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    pointerEvents: 'none',
                  }}>
                    <span className={`text-3xl font-bold ${pctColor(kpis?.percentual_atingimento ?? 0)}`}>
                      {(kpis?.percentual_atingimento ?? 0).toFixed(1)}%
                    </span>
                  </div>
                </div>
              </div>

              {/* Série mensal */}
              <div className="bg-white dark:bg-slate-800 rounded-lg p-4 shadow-sm border border-slate-200 dark:border-slate-700 lg:col-span-2">
                <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-2">Evolução Mensal — Ano atual vs anterior</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={serie}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
                    <XAxis dataKey="mes" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => (v / 1000).toFixed(0) + 'k'} />
                    <Tooltip formatter={(v: any) => formatBRL(Number(v))} />
                    <Legend />
                    <Line type="monotone" dataKey="atual" stroke="#4f46e5" strokeWidth={2} name={`${ano}`} />
                    <Line type="monotone" dataKey="anterior" stroke="#94a3b8" strokeWidth={2} strokeDasharray="5 5" name={`${ano - 1}`} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Tabela Regional + Vendedor lado a lado */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
              {/* Regional */}
              <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Por Gerência Regional</h3>
                </div>
                <MobileLandscapeHint />
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="bg-slate-100 dark:bg-slate-900 text-[10px] uppercase font-bold text-slate-600 dark:text-slate-300">
                      <tr>
                        <th className="px-2 py-2 text-left">#</th>
                        <th className="px-2 py-2 text-left">Gerência Regional</th>
                        <th className="px-2 py-2 text-right">Faturamento</th>
                        {comparar && <th className="px-2 py-2 text-right">{ano - 1}</th>}
                        {comparar && <th className="px-2 py-2 text-right">Var. %</th>}
                        <th className="px-2 py-2 text-right">% Fat.</th>
                        <th className="px-2 py-2 text-right">Meta</th>
                        <th className="px-2 py-2 text-right">% Atingido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const totalFat = porRegional.reduce((s, r) => s + (r.faturamento || 0), 0);
                        return porRegional.map((r, i) => {
                          const pctFat = totalFat > 0 ? (r.faturamento / totalFat * 100) : 0;
                          const pctAt = r.meta > 0 ? (r.faturamento / r.meta * 100) : 0;
                          return (
                            <tr
                              key={i}
                              onDoubleClick={() => abrirDetalhe('regional', r.regional)}
                              title="Duplo clique para ver detalhes"
                              className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30 cursor-pointer"
                            >
                              <td className="px-2 py-1.5 text-slate-500">{i + 1}.</td>
                              <td className="px-2 py-1.5 font-medium text-slate-800 dark:text-slate-100 truncate max-w-[150px]">{r.regional}</td>
                              <td className="px-2 py-1.5 text-right text-slate-700 dark:text-slate-200">{formatBRL(r.faturamento)}</td>
                              {comparar && <td className="px-2 py-1.5 text-right text-slate-500 dark:text-slate-400">{formatBRL(r.faturamento_anterior ?? 0)}</td>}
                              {comparar && <td className={`px-2 py-1.5 text-right font-bold ${(r.variacao_pct ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{r.variacao_pct == null ? '—' : `${(r.variacao_pct >= 0 ? '+' : '')}${r.variacao_pct.toFixed(1)}%`}</td>}
                              <td className="px-2 py-1.5 text-right text-slate-500">{pctFat.toFixed(2)}%</td>
                              <td className="px-2 py-1.5 text-right text-slate-700 dark:text-slate-200">{formatBRL(r.meta)}</td>
                              <td className={`px-2 py-1.5 text-right font-bold ${pctColor(pctAt)}`}>{pctAt.toFixed(1)}%</td>
                            </tr>
                          );
                        });
                      })()}
                      {porRegional.length > 0 && (() => {
                        const totFat = porRegional.reduce((s, r) => s + (r.faturamento || 0), 0);
                        const totMeta = porRegional.reduce((s, r) => s + (r.meta || 0), 0);
                        const totPct = totMeta > 0 ? (totFat / totMeta * 100) : 0;
                        return (
                          <tr className="border-t-2 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40 font-bold">
                            <td className="px-2 py-2" />
                            <td className="px-2 py-2 text-slate-800 dark:text-slate-100">Total geral</td>
                            <td className="px-2 py-2 text-right text-slate-800 dark:text-slate-100">{formatBRL(totFat)}</td>
                            <td className="px-2 py-2 text-right text-slate-500">100%</td>
                            <td className="px-2 py-2 text-right text-slate-800 dark:text-slate-100">{formatBRL(totMeta)}</td>
                            <td className={`px-2 py-2 text-right ${pctColor(totPct)}`}>{totPct.toFixed(1)}%</td>
                          </tr>
                        );
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Vendedor */}
              <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-4 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/50">
                  <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Por Vendedor</h3>
                </div>
                <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-slate-100 dark:bg-slate-900 text-[10px] uppercase font-bold text-slate-600 dark:text-slate-300 z-10">
                      <tr>
                        <th className="px-2 py-2 text-left">#</th>
                        <th className="px-2 py-2 text-left">Vendedor</th>
                        <th className="px-2 py-2 text-right">Faturamento</th>
                        {comparar && <th className="px-2 py-2 text-right">{ano - 1}</th>}
                        {comparar && <th className="px-2 py-2 text-right">Var. %</th>}
                        <th className="px-2 py-2 text-right">% Fat.</th>
                        <th className="px-2 py-2 text-right">Meta</th>
                        <th className="px-2 py-2 text-right">% Atingido</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const totalFat = porVendedor.reduce((s, r) => s + (r.faturamento || 0), 0);
                        return porVendedor.map((v, i) => {
                          const pctFat = totalFat > 0 ? (v.faturamento / totalFat * 100) : 0;
                          return (
                            <tr
                              key={i}
                              onDoubleClick={() => abrirDetalhe('vendedor', v.nome)}
                              title="Duplo clique para ver detalhes"
                              className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30 cursor-pointer"
                            >
                              <td className="px-2 py-1.5 text-slate-500">{i + 1}.</td>
                              <td className="px-2 py-1.5 font-medium text-slate-800 dark:text-slate-100 truncate max-w-[180px]">{v.nome}</td>
                              <td className="px-2 py-1.5 text-right text-slate-700 dark:text-slate-200">{formatBRL(v.faturamento)}</td>
                              {comparar && <td className="px-2 py-1.5 text-right text-slate-500 dark:text-slate-400">{formatBRL(v.faturamento_anterior ?? 0)}</td>}
                              {comparar && <td className={`px-2 py-1.5 text-right font-bold ${(v.variacao_pct ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{v.variacao_pct == null ? '—' : `${(v.variacao_pct >= 0 ? '+' : '')}${v.variacao_pct.toFixed(1)}%`}</td>}
                              <td className="px-2 py-1.5 text-right text-slate-500">{pctFat.toFixed(2)}%</td>
                              <td className="px-2 py-1.5 text-right text-slate-700 dark:text-slate-200">{formatBRL(v.meta)}</td>
                              <td className={`px-2 py-1.5 text-right font-bold ${pctColor(v.percentual)}`}>{v.percentual.toFixed(1)}%</td>
                            </tr>
                          );
                        });
                      })()}
                      {porVendedor.length > 0 && (() => {
                        const totFat = porVendedor.reduce((s, r) => s + (r.faturamento || 0), 0);
                        const totMeta = porVendedor.reduce((s, r) => s + (r.meta || 0), 0);
                        const totPct = totMeta > 0 ? (totFat / totMeta * 100) : 0;
                        return (
                          <tr className="border-t-2 border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-900/40 font-bold sticky bottom-0">
                            <td className="px-2 py-2" />
                            <td className="px-2 py-2 text-slate-800 dark:text-slate-100">Total geral</td>
                            <td className="px-2 py-2 text-right text-slate-800 dark:text-slate-100">{formatBRL(totFat)}</td>
                            <td className="px-2 py-2 text-right text-slate-500">100%</td>
                            <td className="px-2 py-2 text-right text-slate-800 dark:text-slate-100">{formatBRL(totMeta)}</td>
                            <td className={`px-2 py-2 text-right ${pctColor(totPct)}`}>{totPct.toFixed(1)}%</td>
                          </tr>
                        );
                      })()}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            {/* Pivot Pedidos por Regional × Mês (EMISSAO) */}
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 mb-4 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-slate-50 to-white dark:from-slate-900/50 dark:to-slate-800 flex items-center justify-between flex-wrap gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">Pedidos por Regional × Mês</h3>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400">Baseado em EMISSÃO (data do pedido) · clique em uma célula para abrir detalhes</p>
                </div>
                <label className="inline-flex items-center gap-2 cursor-pointer select-none px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-amber-300 dark:border-slate-600 hover:bg-amber-50 dark:hover:bg-slate-700 transition-colors">
                  <input
                    type="checkbox"
                    checked={apenasCarteira}
                    onChange={e => setApenasCarteira(e.target.checked)}
                    className="w-4 h-4 accent-amber-600"
                  />
                  <span className="text-xs font-bold text-slate-700 dark:text-slate-200">Apenas Carteira (status 1/4)</span>
                </label>
              </div>
              <div className="overflow-x-auto">
                <PivotPedidos data={pivot} onCellClick={abrirPedidosDetalhe} ano={ano} />
              </div>
            </div>

          </>
        )}
      </div>

      {/* Modal de detalhes (drill-down) */}
      {detalhe && (
        <div className="fixed inset-0 z-50 bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setDetalhe(null)}>
          <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-7xl max-h-[92vh] flex flex-col overflow-hidden" onClick={e => e.stopPropagation()}>
            {/* Header vermelho */}
            <div className="flex items-start justify-between px-6 py-4 bg-gradient-to-r from-red-600 via-red-600 to-red-700 text-white">
              <div>
                <h3 className="text-xl md:text-2xl font-black tracking-tight uppercase">{detalhe.titulo}</h3>
                {!detalhe.loading && (
                  <p className="text-xs text-red-100 mt-0.5 font-medium">
                    {detalhe.total.toLocaleString('pt-BR')} linha(s)
                    {detalhe.total >= detalhe.limite && ` · limite de ${detalhe.limite.toLocaleString('pt-BR')} aplicado`}
                  </p>
                )}
              </div>
              <button onClick={() => setDetalhe(null)} className="p-2 rounded-lg hover:bg-white/15 transition-colors">
                <X className="w-5 h-5 text-white" />
              </button>
            </div>
            {/* Body com UM unico scroll horizontal e vertical */}
            <div className="flex-1 overflow-auto bg-white dark:bg-slate-800">
              {detalhe.loading ? (
                <div className="flex items-center justify-center py-12 text-slate-500"><RefreshCw className="w-5 h-5 animate-spin mr-2" />Carregando...</div>
              ) : (
                <DetalheTable rows={detalhe.rows} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Tabela de detalhes — accordion expansivel: Mes/Ano > Vendedor > linhas
const DetalheTable: React.FC<{ rows: any[] }> = ({ rows }) => {
  const grupos = useMemo(() => {
    const map: Record<string, Record<string, any[]>> = {};
    rows.forEach(r => {
      const chave = `${String(r.ano).padStart(4, '0')}-${String(r.mes).padStart(2, '0')}`;
      const v = r.vendedor || 'Sem vendedor';
      if (!map[chave]) map[chave] = {};
      if (!map[chave][v]) map[chave][v] = [];
      map[chave][v].push(r);
    });
    return Object.keys(map).sort().map(k => {
      const vendedores = Object.keys(map[k]).sort().map(v => {
        const linhas = map[k][v];
        const tot = linhas.reduce((s, x) => s + Number(x.total_item || 0), 0);
        const totSt = linhas.reduce((s, x) => s + Number(x.faturamento_semst || 0), 0);
        const qtd = linhas.reduce((s, x) => s + Number(x.quantidade || 0), 0);
        return { vendedor: v, rows: linhas, tot, totSt, qtd };
      });
      const totMes = vendedores.reduce((s, x) => s + x.tot, 0);
      const totMesSt = vendedores.reduce((s, x) => s + x.totSt, 0);
      const qtdMes = vendedores.reduce((s, x) => s + x.qtd, 0);
      return { anoMes: k, vendedores, totMes, totMesSt, qtdMes, count: vendedores.reduce((s, x) => s + x.rows.length, 0) };
    });
  }, [rows]);

  const [openMes, setOpenMes] = useState<Record<string, boolean>>({});
  const [openVend, setOpenVend] = useState<Record<string, boolean>>({});

  if (rows.length === 0) return <div className="p-8 text-center text-slate-500 text-sm">Sem dados.</div>;

  const fmt = (v: any) => v == null || v === '' ? '—' : v;
  const fmtNum = (v: any) => v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  return (
    <div className="p-4 space-y-3">
      {grupos.map(g => {
        const isMesOpen = !!openMes[g.anoMes];
        return (
          <div key={g.anoMes} className="border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
            {/* Header Mes/Ano */}
            <button
              type="button"
              onClick={() => setOpenMes(s => ({ ...s, [g.anoMes]: !s[g.anoMes] }))}
              className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-indigo-50 to-violet-50 dark:from-indigo-900/30 dark:to-violet-900/30 hover:from-indigo-100 hover:to-violet-100 dark:hover:from-indigo-900/50 transition-colors"
            >
              <div className="flex items-center gap-3">
                <span className={`text-indigo-600 dark:text-indigo-300 font-bold text-lg w-5 text-center transition-transform ${isMesOpen ? 'rotate-90' : ''}`}>›</span>
                <span className="font-black text-indigo-900 dark:text-indigo-100 text-sm uppercase tracking-wider">{g.anoMes}</span>
                <span className="text-[11px] text-indigo-700 dark:text-indigo-300 bg-white/60 dark:bg-slate-800/60 rounded-full px-2 py-0.5">
                  {g.vendedores.length} vend · {g.count} linhas
                </span>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className="text-slate-600 dark:text-slate-300">Qtd: <strong>{g.qtdMes.toLocaleString('pt-BR')}</strong></span>
                <span className="text-slate-600 dark:text-slate-300">Total: <strong>{fmtBRL(g.totMes)}</strong></span>
                <span className="text-cyan-700 dark:text-cyan-300">Fat. s/ ST: <strong>{fmtBRL(g.totMesSt)}</strong></span>
              </div>
            </button>

            {isMesOpen && (
              <div className="bg-white dark:bg-slate-800">
                {g.vendedores.map(v => {
                  const vendKey = `${g.anoMes}__${v.vendedor}`;
                  const isVendOpen = !!openVend[vendKey];
                  return (
                    <div key={vendKey} className="border-t border-slate-100 dark:border-slate-700">
                      {/* Header Vendedor */}
                      <button
                        type="button"
                        onClick={() => setOpenVend(s => ({ ...s, [vendKey]: !s[vendKey] }))}
                        className="w-full flex items-center justify-between px-4 py-2 bg-slate-50 dark:bg-slate-900/40 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <span className={`text-slate-500 font-bold w-5 text-center transition-transform ${isVendOpen ? 'rotate-90' : ''}`}>›</span>
                          <span className="font-bold text-slate-700 dark:text-slate-100 text-xs">{v.vendedor}</span>
                          <span className="text-[10px] text-slate-500 bg-slate-200 dark:bg-slate-700 rounded-full px-2 py-0.5">{v.rows.length}</span>
                        </div>
                        <div className="flex items-center gap-4 text-[11px]">
                          <span className="text-slate-600 dark:text-slate-300">Qtd: {v.qtd.toLocaleString('pt-BR')}</span>
                          <span className="text-slate-700 dark:text-slate-200 font-semibold">{fmtBRL(v.tot)}</span>
                          <span className="text-cyan-700 dark:text-cyan-300 font-semibold">{fmtBRL(v.totSt)}</span>
                        </div>
                      </button>

                      {isVendOpen && (
                        <div className="overflow-x-auto">
                          <table className="w-full text-[11px] whitespace-nowrap">
                            <thead className="bg-slate-100 dark:bg-slate-900 text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">
                              <tr>
                                <th className="px-3 py-2 text-left">Pedido</th>
                                <th className="px-3 py-2 text-left">Status</th>
                                <th className="px-3 py-2 text-left">Cód. Produto</th>
                                <th className="px-3 py-2 text-left">Cód. Origem</th>
                                <th className="px-3 py-2 text-left">Razão</th>
                                <th className="px-3 py-2 text-right">Qtd</th>
                                <th className="px-3 py-2 text-right">Total</th>
                                <th className="px-3 py-2 text-right">Fat. s/ ST</th>
                                <th className="px-3 py-2 text-left">NF</th>
                                <th className="px-3 py-2 text-left">Família</th>
                                <th className="px-3 py-2 text-left">BU</th>
                                <th className="px-3 py-2 text-left">Área</th>
                                <th className="px-3 py-2 text-left">Categoria</th>
                                <th className="px-3 py-2 text-left">Canal</th>
                                <th className="px-3 py-2 text-left">Linha</th>
                              </tr>
                            </thead>
                            <tbody>
                              {v.rows.map((r, i) => (
                                <tr key={i} className="border-t border-slate-100 dark:border-slate-700/50 hover:bg-slate-50 dark:hover:bg-slate-700/30">
                                  <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200">{fmt(r.pedido)}</td>
                                  <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300">{fmt(r.status_pedido)}</td>
                                  <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200">{fmt(r.codigo_produto)}</td>
                                  <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200">{fmt(r.cod_origem)}</td>
                                  <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200 max-w-[220px] truncate" title={r.razao}>{fmt(r.razao)}</td>
                                  <td className="px-3 py-1.5 text-right text-slate-700 dark:text-slate-200">{fmtNum(r.quantidade)}</td>
                                  <td className="px-3 py-1.5 text-right text-slate-700 dark:text-slate-200">{fmtNum(r.total_item)}</td>
                                  <td className="px-3 py-1.5 text-right text-cyan-700 dark:text-cyan-300 font-semibold">{fmtNum(r.faturamento_semst)}</td>
                                  <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200">{fmt(r.nota_fiscal)}</td>
                                  <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200">{fmt(r.familia)}</td>
                                  <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200">{fmt(r.bu)}</td>
                                  <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200">{fmt(r.area_de_negocio)}</td>
                                  <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200">{fmt(r.categorias)}</td>
                                  <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200">{fmt(r.canal)}</td>
                                  <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200">{fmt(r.linha)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

// Pivot Regional x Mes (clicavel)
const PivotPedidos: React.FC<{
  data: Array<{ regional: string; mes: number; total: number; qtd_pedidos: number }>;
  onCellClick: (regional: string, mes: number) => void;
  ano: number;
}> = ({ data, onCellClick, ano }) => {
  const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const matriz = useMemo(() => {
    const map: Record<string, Record<number, { total: number; qtd: number }>> = {};
    const regionais = new Set<string>();
    data.forEach(d => {
      regionais.add(d.regional);
      if (!map[d.regional]) map[d.regional] = {};
      map[d.regional][d.mes] = { total: d.total, qtd: d.qtd_pedidos };
    });
    return { regionais: Array.from(regionais).sort(), map };
  }, [data]);

  if (data.length === 0) return <div className="p-6 text-center text-sm text-slate-500">Sem dados.</div>;

  const totalGeralPorMes = (m: number) => matriz.regionais.reduce((s, r) => s + (matriz.map[r][m]?.total || 0), 0);
  const totalLinha = (r: string) => Object.values(matriz.map[r] || {}).reduce((s, v) => s + v.total, 0);

  return (
    <table className="w-full text-xs whitespace-nowrap">
      <thead className="bg-slate-100 dark:bg-slate-900 text-[10px] uppercase font-bold text-slate-600 dark:text-slate-300">
        <tr>
          <th className="px-3 py-2 text-left sticky left-0 bg-slate-100 dark:bg-slate-900 z-10">Gerência Regional</th>
          {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
            <th key={m} className="px-2 py-2 text-right">{MES_LABEL[m].slice(0,3)}/{String(ano).slice(-2)}</th>
          ))}
          <th className="px-3 py-2 text-right bg-slate-200 dark:bg-slate-800">Total</th>
        </tr>
      </thead>
      <tbody>
        {matriz.regionais.map(r => (
          <tr key={r} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/30">
            <td className="px-3 py-1.5 font-medium text-slate-800 dark:text-slate-100 sticky left-0 bg-white dark:bg-slate-800 z-10">{r}</td>
            {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => {
              const cell = matriz.map[r][m];
              const has = cell && cell.total > 0;
              return (
                <td
                  key={m}
                  onClick={has ? () => onCellClick(r, m) : undefined}
                  className={`px-2 py-1.5 text-right ${has ? 'cursor-pointer hover:bg-indigo-100 dark:hover:bg-indigo-900/40 text-indigo-700 dark:text-indigo-300 font-semibold' : 'text-slate-300 dark:text-slate-600'}`}
                  title={has ? `${cell.qtd} pedidos · clique p/ detalhes` : ''}
                >
                  {has ? fmtBRL(cell.total) : '—'}
                </td>
              );
            })}
            <td className="px-3 py-1.5 text-right font-bold text-slate-800 dark:text-slate-100 bg-slate-50 dark:bg-slate-900/40">{fmtBRL(totalLinha(r))}</td>
          </tr>
        ))}
        <tr className="border-t-2 border-slate-300 dark:border-slate-600 bg-slate-100 dark:bg-slate-900 font-bold">
          <td className="px-3 py-2 sticky left-0 bg-slate-100 dark:bg-slate-900 z-10 text-slate-800 dark:text-slate-100">Total</td>
          {[1,2,3,4,5,6,7,8,9,10,11,12].map(m => (
            <td key={m} className="px-2 py-2 text-right text-slate-800 dark:text-slate-100">{fmtBRL(totalGeralPorMes(m))}</td>
          ))}
          <td className="px-3 py-2 text-right text-indigo-700 dark:text-indigo-300 bg-slate-200 dark:bg-slate-800">
            {fmtBRL(matriz.regionais.reduce((s, r) => s + totalLinha(r), 0))}
          </td>
        </tr>
      </tbody>
    </table>
  );
};

// Slider de range para selecao de meses (1..12)
const MonthRangeSlider: React.FC<{ value: string; onChange: (v: string) => void }> = ({ value, onChange }) => {
  // Parse current value: "1,2,3" -> {min: 1, max: 3}, "" -> {min: 1, max: 12}
  const parsed = value ? value.split(',').map(x => parseInt(x, 10)).filter(Boolean).sort((a, b) => a - b) : [];
  const minM = parsed.length ? parsed[0] : 1;
  const maxM = parsed.length ? parsed[parsed.length - 1] : 12;

  const update = (mn: number, mx: number) => {
    const lo = Math.min(mn, mx);
    const hi = Math.max(mn, mx);
    if (lo === 1 && hi === 12) { onChange(''); return; }
    const arr: number[] = [];
    for (let i = lo; i <= hi; i++) arr.push(i);
    onChange(arr.join(','));
  };

  const trackPctL = ((minM - 1) / 11) * 100;
  const trackPctR = ((maxM - 1) / 11) * 100;

  return (
    <div className="px-1">
      <div className="flex justify-between text-[9px] font-bold text-slate-500 dark:text-slate-400 mb-1">
        <span>Jan</span><span>Abr</span><span>Jul</span><span>Out</span><span>Dez</span>
      </div>
      <div className="relative h-6">
        {/* Track de fundo */}
        <div className="absolute top-1/2 left-0 right-0 h-1.5 -translate-y-1/2 bg-slate-200 dark:bg-slate-600 rounded" />
        {/* Track ativo */}
        <div
          className="absolute top-1/2 h-1.5 -translate-y-1/2 bg-indigo-500 rounded"
          style={{ left: `${trackPctL}%`, right: `${100 - trackPctR}%` }}
        />
        {/* Inputs */}
        <input
          type="range" min={1} max={12} step={1} value={minM}
          onChange={e => update(parseInt(e.target.value, 10), maxM)}
          className="absolute top-0 left-0 w-full h-6 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-600 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:pointer-events-auto"
          style={{ zIndex: 2 }}
        />
        <input
          type="range" min={1} max={12} step={1} value={maxM}
          onChange={e => update(minM, parseInt(e.target.value, 10))}
          className="absolute top-0 left-0 w-full h-6 appearance-none bg-transparent pointer-events-none [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-indigo-600 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:shadow [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:pointer-events-auto"
          style={{ zIndex: 3 }}
        />
      </div>
      <div className="text-[10px] text-center text-slate-600 dark:text-slate-300 font-bold mt-1">
        {MES_LABEL[minM].slice(0, 3)} — {MES_LABEL[maxM].slice(0, 3)}
        {value && <button type="button" onClick={() => onChange('')} className="ml-2 text-red-500 hover:underline">limpar</button>}
      </div>
    </div>
  );
};

export default MetasFaturamentoDashboard;
