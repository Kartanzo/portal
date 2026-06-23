import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { MobileLandscapeHint } from '../ui/MobileLandscapeHint';
import { User } from '../../types';
import { api } from '../../app_api';
import { useToast } from '../../contexts/ToastContext';
import { RefreshCw, AlertTriangle, CheckCircle, XCircle, Clock, BarChart2, X, Filter } from 'lucide-react';
import KpiCard, { KpiGrid } from '../common/KpiCard';
import ReactECharts from 'echarts-for-react';

interface Props { user: User; }

const gradV = (c1: string, c2: string) => ({ type: 'linear', x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: c1 }, { offset: 1, color: c2 }] });
const TOOLTIP_BASE = { backgroundColor: 'rgba(15,23,42,0.92)', borderWidth: 0, padding: [8, 12], textStyle: { color: '#fff', fontSize: 12 }, extraCssText: 'border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.18);' };
const mesAbrev = (yyyymm: string) => { const [y, m] = yyyymm.split('-'); return `${m}/${y.slice(2)}`; };

interface Produto { codigo?: string; descricao?: string; quantidade?: number; quantidade_defeito?: number; }
interface Ticket {
  id: number; protocolo: string; status: string; prioridade: string; canal: string;
  tipo_problema: string; setor_destino: string; razao_social: string; cnpj_cpf: string;
  canal_compra: string | null; criado_em: string | null; atualizado_em: string | null;
  publico: string; produtos: Produto[];
}

type Dim = 'tipo' | 'canalCompra' | 'status' | 'setor' | 'produto' | 'cliente' | 'publico';
const DIM_FIELD: Record<Exclude<Dim, 'produto'>, keyof Ticket> = {
  tipo: 'tipo_problema', canalCompra: 'canal_compra', status: 'status', setor: 'setor_destino', cliente: 'cnpj_cpf', publico: 'publico',
};
const DIM_LABEL: Record<Dim, string> = {
  tipo: 'Tipo', canalCompra: 'Canal de Compra', status: 'Status', setor: 'Setor', produto: 'Produto', cliente: 'Cliente', publico: 'Público',
};
const PUBLICO_LABEL: Record<string, string> = { cliente: 'Cliente', consumidor_final: 'Consumidor final' };

const PERIODO_OPTIONS = [
  { label: 'Hoje', value: 'hoje' },
  { label: '7 dias', value: '7d' },
  { label: '30 dias', value: '30d' },
  { label: '90 dias', value: '90d' },
  { label: 'Personalizado', value: 'custom' },
];

const STATUS_COR: Record<string, string> = {
  'Aberto': 'bg-blue-500', 'Em Análise': 'bg-yellow-500', 'Aguardando Retorno': 'bg-orange-500',
  'Em Resolução': 'bg-purple-500', 'Concluído': 'bg-green-500', 'Cancelado': 'bg-gray-400',
};
const ABERTO = (s: string) => s !== 'Concluído' && s !== 'Cancelado';

function getPeriodoDates(periodo: string): { de: string; ate: string } {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const ate = fmt(today);
  if (periodo === 'hoje') return { de: ate, ate };
  if (periodo === '7d') return { de: fmt(new Date(today.getTime() - 7 * 86400000)), ate };
  if (periodo === '30d') return { de: fmt(new Date(today.getTime() - 30 * 86400000)), ate };
  if (periodo === '90d') return { de: fmt(new Date(today.getTime() - 90 * 86400000)), ate };
  return { de: '', ate: '' };
}

const prodNome = (p: Produto) => (p.descricao || p.codigo || '—').trim();

const SacDashboard: React.FC<Props> = ({ user }) => {
  const { showToast } = useToast();
  const [periodo, setPeriodo] = useState('30d');
  const [customDe, setCustomDe] = useState('');
  const [customAte, setCustomAte] = useState('');
  const [loading, setLoading] = useState(true);
  const [dataset, setDataset] = useState<Ticket[]>([]);
  const [filters, setFilters] = useState<Partial<Record<Dim, string>>>({});
  const [mesSel, setMesSel] = useState(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
  const [series, setSeries] = useState<any>(null);

  // showToast via ref para NÃO entrar nas deps de load (evita loop: erro -> toast
  // re-renderiza o contexto -> nova identidade de load -> useEffect refaz o fetch -> ...)
  const showToastRef = useRef(showToast);
  useEffect(() => { showToastRef.current = showToast; });
  const reqIdRef = useRef(0);

  const load = useCallback(async () => {
    // custom sem datas: não dispara
    if (periodo === 'custom' && (!customDe || !customAte)) { setLoading(false); return; }
    const myId = ++reqIdRef.current;
    setLoading(true);
    const { de, ate } = periodo === 'custom' ? { de: customDe, ate: customAte } : getPeriodoDates(periodo);
    const params: any = {};
    if (de) params.de = de;
    if (ate) params.ate = ate;
    try {
      const r: any = await api.get('/sac/dashboard/dataset', { params });
      if (myId !== reqIdRef.current) return; // resposta obsoleta
      const data = r?.data ?? r;
      setDataset(Array.isArray(data) ? data : []);
    } catch {
      if (myId !== reqIdRef.current) return;
      showToastRef.current('Erro ao carregar dashboard', 'error');
      setDataset([]);
    } finally {
      if (myId === reqIdRef.current) setLoading(false);
    }
  }, [periodo, customDe, customAte]);

  useEffect(() => { load(); }, [load]);

  // Séries temporais (12 meses + dias do mês selecionado). Independente dos demais filtros.
  useEffect(() => {
    let cancelled = false;
    api.get('/sac/dashboard/series', { params: { mes: mesSel } })
      .then((r: any) => { if (!cancelled) setSeries(r?.data ?? r); })
      .catch(() => { if (!cancelled) setSeries(null); });
    return () => { cancelled = true; };
  }, [mesSel]);

  const toggle = (dim: Dim, val: string) =>
    setFilters(f => ({ ...f, [dim]: f[dim] === val ? undefined : val }));
  const clearAll = () => setFilters({});

  const matches = useCallback((t: Ticket, except?: Dim) => {
    return (Object.keys(filters) as Dim[]).every(dim => {
      if (dim === except) return true;
      const val = filters[dim];
      if (val == null) return true;
      if (dim === 'produto') return (t.produtos || []).some(p => prodNome(p) === val);
      return String(t[DIM_FIELD[dim]] ?? '—') === String(val);
    });
  }, [filters]);

  const filteredAll = useMemo(() => dataset.filter(t => matches(t)), [dataset, matches]);

  const aggBy = useCallback((except: Dim, getKeys: (t: Ticket) => string[]) => {
    const m = new Map<string, number>();
    for (const t of dataset) {
      if (!matches(t, except)) continue;
      for (const k of Array.from(new Set(getKeys(t)))) m.set(k, (m.get(k) || 0) + 1);
    }
    const total = [...m.values()].reduce((s, v) => s + v, 0) || 1;
    return [...m.entries()].map(([key, count]) => ({ key, count, pct: Math.round(count / total * 100) })).sort((a, b) => b.count - a.count);
  }, [dataset, matches]);

  const dataStatus = useMemo(() => aggBy('status', t => [t.status || '—']), [aggBy]);
  const dataTipo = useMemo(() => aggBy('tipo', t => [t.tipo_problema || '—']), [aggBy]);
  const dataCanal = useMemo(() => aggBy('canalCompra', t => [t.canal_compra || '—']), [aggBy]);
  const dataProduto = useMemo(() => aggBy('produto', t => (t.produtos || []).map(prodNome)).slice(0, 10), [aggBy]);
  const dataPublico = useMemo(() => aggBy('publico', t => [t.publico || 'cliente']), [aggBy]);

  const dataSetor = useMemo(() => {
    const map = new Map<string, { total: number; abertos: number; somaH: number; nConcl: number }>();
    for (const t of dataset) {
      if (!matches(t, 'setor')) continue;
      const k = t.setor_destino || '—';
      const o = map.get(k) || { total: 0, abertos: 0, somaH: 0, nConcl: 0 };
      o.total++;
      if (ABERTO(t.status)) o.abertos++;
      if (t.status === 'Concluído' && t.criado_em && t.atualizado_em) {
        o.somaH += (new Date(t.atualizado_em).getTime() - new Date(t.criado_em).getTime()) / 3600000;
        o.nConcl++;
      }
      map.set(k, o);
    }
    return [...map.entries()].map(([setor, o]) => ({ setor, total: o.total, abertos: o.abertos, tempo: o.nConcl ? o.somaH / o.nConcl : null })).sort((a, b) => b.total - a.total);
  }, [dataset, matches]);

  const dataCliente = useMemo(() => {
    const map = new Map<string, { razao: string; total: number; abertos: number; concl: number; tipos: Record<string, number> }>();
    for (const t of dataset) {
      if (!matches(t, 'cliente')) continue;
      const k = t.cnpj_cpf || '—';
      const o = map.get(k) || { razao: t.razao_social, total: 0, abertos: 0, concl: 0, tipos: {} };
      o.total++;
      if (ABERTO(t.status)) o.abertos++;
      if (t.status === 'Concluído') o.concl++;
      if (t.tipo_problema) o.tipos[t.tipo_problema] = (o.tipos[t.tipo_problema] || 0) + 1;
      map.set(k, o);
    }
    return [...map.entries()].map(([cnpj, o]) => ({
      cnpj, razao: o.razao, total: o.total, abertos: o.abertos, concl: o.concl,
      tipoFreq: Object.entries(o.tipos).sort((a, b) => b[1] - a[1])[0]?.[0] || '—',
    })).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [dataset, matches]);

  const paradosList = useMemo(() => {
    const lim = Date.now() - 3 * 86400000;
    return filteredAll
      .filter(t => ABERTO(t.status) && t.atualizado_em && new Date(t.atualizado_em).getTime() < lim)
      .map(t => ({ ...t, parado_dias: Math.round((Date.now() - new Date(t.atualizado_em as string).getTime()) / 86400000 * 10) / 10 }))
      .sort((a, b) => new Date(a.atualizado_em as string).getTime() - new Date(b.atualizado_em as string).getTime());
  }, [filteredAll]);

  const kpis = useMemo(() => {
    const total = filteredAll.length;
    const abertos = filteredAll.filter(t => ABERTO(t.status)).length;
    const concluidos = filteredAll.filter(t => t.status === 'Concluído').length;
    const cancelados = filteredAll.filter(t => t.status === 'Cancelado').length;
    const concl = filteredAll.filter(t => t.status === 'Concluído' && t.criado_em && t.atualizado_em);
    let tempoMedioH: number | null = null;
    if (concl.length) {
      const soma = concl.reduce((s, t) => s + (new Date(t.atualizado_em as string).getTime() - new Date(t.criado_em as string).getTime()) / 3600000, 0);
      tempoMedioH = Math.round((soma / concl.length) * 10) / 10;
    }
    return { total, abertos, concluidos, cancelados, tempoMedioH };
  }, [filteredAll]);

  const activeChips = (Object.keys(filters) as Dim[]).filter(d => filters[d] != null);
  const dimState = (dim: Dim, key: string) => {
    const sel = filters[dim];
    return { active: sel === key, dimmed: sel != null && sel !== key };
  };

  // Linha de barra clicável (cross-filter) — mesmo visual limpo do original
  const BarRow: React.FC<{ label: string; count: number; pct: number; color: string; dim: Dim; extra?: string; display?: string }> =
    ({ label, count, pct, color, dim, extra, display }) => {
      const { active, dimmed } = dimState(dim, label);
      return (
        <button onClick={() => toggle(dim, label)} className={`w-full text-left group transition-opacity ${dimmed ? 'opacity-40 hover:opacity-100' : ''}`}>
          <div className="flex justify-between text-xs mb-1">
            <span className={`font-medium ${active ? 'text-indigo-700 font-bold' : 'text-slate-600'}`}>{display ?? label}</span>
            <span className="text-slate-500">{count} ({pct}%){extra ? ` ${extra}` : ''}</span>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className={`h-2 rounded-full ${color} ${active ? 'ring-2 ring-indigo-300' : ''}`} style={{ width: `${Math.max(pct, 2)}%` }} />
          </div>
        </button>
      );
    };

  const cardCls = 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-xl p-5 shadow-md dark:shadow-[0_6px_24px_rgba(0,0,0,0.5)]';

  const lineOption = (data: { label: string; count: number }[], color: string): any => ({
    grid: { left: 6, right: 16, top: 16, bottom: 6, containLabel: true },
    tooltip: { ...TOOLTIP_BASE, trigger: 'axis' },
    xAxis: { type: 'category', boundaryGap: false, data: data.map(d => d.label), axisLabel: { color: '#94a3b8', fontSize: 10 }, axisLine: { lineStyle: { color: '#e2e8f0' } }, axisTick: { show: false } },
    yAxis: { type: 'value', minInterval: 1, splitLine: { lineStyle: { color: '#f1f5f9' } }, axisLabel: { color: '#94a3b8', fontSize: 11 } },
    series: [{
      type: 'line', smooth: true, symbol: 'circle', symbolSize: 6, data: data.map(d => d.count),
      lineStyle: { width: 3, color }, itemStyle: { color, borderColor: '#fff', borderWidth: 2 },
      areaStyle: { color: gradV(`${color}40`, `${color}00`) },
    }],
  });

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">SAC — Dashboard</h1>
          <p className="text-slate-500 text-sm">Clique nas barras, tiles ou linhas para filtrar todo o painel.</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          {PERIODO_OPTIONS.map(o => (
            <button key={o.value} onClick={() => setPeriodo(o.value)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg border transition-colors ${periodo === o.value ? 'bg-indigo-600 text-white border-indigo-600' : 'border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
              {o.label}
            </button>
          ))}
          {periodo === 'custom' && (
            <>
              <input type="date" value={customDe} onChange={e => setCustomDe(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <input type="date" value={customAte} onChange={e => setCustomAte(e.target.value)} className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              <button onClick={load} className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700">Filtrar</button>
            </>
          )}
          <button onClick={load} className="p-2 border border-slate-300 rounded-lg text-slate-600 hover:bg-slate-50">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Chips de filtros ativos */}
      {activeChips.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap bg-indigo-50 border border-indigo-100 rounded-xl px-3 py-2 mb-4">
          <Filter className="w-4 h-4 text-indigo-500" />
          <span className="text-xs font-bold text-slate-500">Filtros:</span>
          {activeChips.map(d => (
            <button key={d} onClick={() => toggle(d, filters[d] as string)}
              className="flex items-center gap-1 bg-white border border-indigo-200 text-indigo-700 text-xs font-semibold px-2 py-1 rounded-lg hover:bg-indigo-100">
              {DIM_LABEL[d]}: {filters[d]} <X className="w-3 h-3" />
            </button>
          ))}
          <button onClick={clearAll} className="text-xs text-slate-400 hover:text-red-600 underline ml-1">Limpar tudo</button>
        </div>
      )}

      {/* KPI Cards */}
      <KpiGrid className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
        <KpiCard Icon={BarChart2} label="Total" value={kpis.total} color="indigo" />
        <KpiCard Icon={AlertTriangle} label="Em aberto" value={kpis.abertos} color="blue" />
        <KpiCard Icon={CheckCircle} label="Concluídos" value={kpis.concluidos} color="emerald" />
        <KpiCard Icon={XCircle} label="Cancelados" value={kpis.cancelados} color="slate" />
        <KpiCard Icon={Clock} label="Tempo médio conclusão" value={kpis.tempoMedioH != null ? (kpis.tempoMedioH < 48 ? `${kpis.tempoMedioH}h` : `${Math.round(kpis.tempoMedioH / 24 * 10) / 10}d`) : '—'} color="orange" />
      </KpiGrid>

      {/* Evolução temporal (independente dos filtros do painel) */}
      <div className={`${cardCls} mb-4`}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
          <h3 className="font-semibold text-slate-700">Evolução de Chamados</h3>
          <div className="flex items-center gap-2 flex-wrap">
            <label className="text-xs text-slate-500 font-medium">Mês:</label>
            <input type="month" value={mesSel} onChange={e => setMesSel(e.target.value)}
              className="border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500" />
            {series?.pct != null && (
              <span className={`text-xs font-bold px-2 py-1 rounded-lg ${series.pct >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                {series.pct >= 0 ? '▲' : '▼'} {Math.abs(series.pct)}% vs mês anterior
              </span>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1">Quantidade — últimos 12 meses</p>
            {series
              ? <ReactECharts option={lineOption(series.por_mes.map((p: any) => ({ label: mesAbrev(p.mes), count: p.count })), '#6366f1')} notMerge style={{ height: 240 }} />
              : <div className="h-[240px] flex items-center justify-center text-slate-300 text-sm">Carregando…</div>}
          </div>
          <div>
            <p className="text-xs font-semibold text-slate-500 mb-1">
              Dia a dia — {mesSel}{series ? ` · ${series.total_mes} no mês (anterior: ${series.total_anterior})` : ''}
            </p>
            {series
              ? <ReactECharts option={lineOption(series.por_dia.map((d: any) => ({ label: String(d.dia), count: d.count })), '#0ea5e9')} notMerge style={{ height: 240 }} />
              : <div className="h-[240px] flex items-center justify-center text-slate-300 text-sm">Carregando…</div>}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-20"><RefreshCw className="w-8 h-8 animate-spin text-indigo-400" /></div>
      ) : dataset.length === 0 ? (
        <div className="text-center py-20 text-slate-400">Nenhum chamado no período selecionado.</div>
      ) : (
        <>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-4">
            {/* Por Status */}
            <div className={cardCls}>
              <h3 className="font-semibold text-slate-700 mb-4">Distribuição por Status</h3>
              <div className="space-y-2.5">
                {dataStatus.map(r => (
                  <BarRow key={r.key} label={r.key} count={r.count} pct={r.pct} dim="status" color={STATUS_COR[r.key] || 'bg-slate-400'} />
                ))}
              </div>
            </div>

            {/* Por Tipo */}
            <div className={cardCls}>
              <h3 className="font-semibold text-slate-700 mb-4">Por Tipo de Problema</h3>
              <div className="space-y-2.5">
                {dataTipo.map(r => (
                  <BarRow key={r.key} label={r.key} count={r.count} pct={r.pct} dim="tipo" color="bg-indigo-400" />
                ))}
              </div>
            </div>

            {/* Por Canal de Compra */}
            <div className={cardCls}>
              <h3 className="font-semibold text-slate-700 mb-4">Por Canal de Compra</h3>
              <div className="space-y-2.5">
                {dataCanal.map(r => (
                  <BarRow key={r.key} label={r.key} count={r.count} pct={r.pct} dim="canalCompra" color="bg-cyan-400" />
                ))}
              </div>
            </div>

            {/* Por Público */}
            <div className={cardCls}>
              <h3 className="font-semibold text-slate-700 mb-4">Por Público</h3>
              <div className="space-y-2.5">
                {dataPublico.map(r => (
                  <BarRow key={r.key} label={r.key} display={PUBLICO_LABEL[r.key] || r.key} count={r.count} pct={r.pct} dim="publico" color="bg-fuchsia-400" />
                ))}
              </div>
            </div>
          </div>

          {/* Top Produtos (largura total) */}
          <div className={`${cardCls} mb-4`}>
            <h3 className="font-semibold text-slate-700 mb-4">Top Produtos com mais SACs</h3>
            {dataProduto.length === 0 ? (
              <p className="text-xs text-slate-400">Sem produtos no período.</p>
            ) : (
              <div className="space-y-2.5">
                {dataProduto.map(r => (
                  <BarRow key={r.key} label={r.key} count={r.count} pct={r.pct} dim="produto" color="bg-amber-400" />
                ))}
              </div>
            )}
          </div>

          {/* Performance por Setor */}
          <div className={`${cardCls} mb-4`}>
            <h3 className="font-semibold text-slate-700 mb-4">Performance por Setor</h3>
            <MobileLandscapeHint />
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-100">
                    <th className="text-left pb-2 font-semibold">Setor</th>
                    <th className="text-center pb-2 font-semibold">Total</th>
                    <th className="text-center pb-2 font-semibold">Abertos</th>
                    <th className="text-right pb-2 font-semibold">Tempo médio</th>
                  </tr>
                </thead>
                <tbody>
                  {dataSetor.map(r => {
                    const { active, dimmed } = dimState('setor', r.setor);
                    return (
                      <tr key={r.setor} onClick={() => toggle('setor', r.setor)}
                        className={`border-b border-slate-50 cursor-pointer hover:bg-slate-50 ${active ? 'bg-indigo-50' : ''} ${dimmed ? 'opacity-40' : ''}`}>
                        <td className="py-2 font-medium text-slate-700">{r.setor}</td>
                        <td className="py-2 text-center text-slate-600">{r.total}</td>
                        <td className="py-2 text-center text-slate-600">{r.abertos}</td>
                        <td className="py-2 text-right text-slate-500">{r.tempo != null ? `${r.tempo.toFixed(1)}h` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Top Clientes */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm mb-4">
            <h3 className="font-semibold text-slate-700 mb-4">Top Clientes — Mais Chamados</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-100">
                    <th className="text-left pb-2 font-semibold">#</th>
                    <th className="text-left pb-2 font-semibold">Cliente</th>
                    <th className="text-left pb-2 font-semibold">CNPJ/CPF</th>
                    <th className="text-center pb-2 font-semibold">Total</th>
                    <th className="text-center pb-2 font-semibold">Abertos</th>
                    <th className="text-center pb-2 font-semibold">Concluídos</th>
                    <th className="text-left pb-2 font-semibold">Tipo freq.</th>
                  </tr>
                </thead>
                <tbody>
                  {dataCliente.map((r, i) => {
                    const { active, dimmed } = dimState('cliente', r.cnpj);
                    return (
                      <tr key={r.cnpj} onClick={() => toggle('cliente', r.cnpj)}
                        className={`border-b border-slate-50 cursor-pointer hover:bg-slate-50 ${active ? 'bg-indigo-50' : ''} ${dimmed ? 'opacity-40' : ''}`}>
                        <td className="py-2 text-slate-400 font-bold">{i + 1}</td>
                        <td className="py-2 font-semibold text-slate-700 max-w-[140px] truncate">{r.razao}</td>
                        <td className="py-2 text-slate-400">{r.cnpj}</td>
                        <td className="py-2 text-center font-bold text-indigo-700">{r.total}</td>
                        <td className="py-2 text-center text-blue-600">{r.abertos}</td>
                        <td className="py-2 text-center text-green-600">{r.concl}</td>
                        <td className="py-2 text-slate-500">{r.tipoFreq}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Chamados Parados */}
          {paradosList.length > 0 && (
            <div className="bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-700 rounded-xl p-5 shadow-md dark:shadow-[0_6px_24px_rgba(0,0,0,0.5)]">
              <div className="flex items-center gap-2 mb-4">
                <AlertTriangle className="w-5 h-5 text-amber-500" />
                <h3 className="font-semibold text-slate-700">Chamados Parados há mais de 3 dias</h3>
                <span className="ml-auto text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-semibold">{paradosList.length}</span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-400 border-b border-slate-100">
                      <th className="text-left pb-2 font-semibold">Protocolo</th>
                      <th className="text-left pb-2 font-semibold">Cliente</th>
                      <th className="text-left pb-2 font-semibold">Status</th>
                      <th className="text-left pb-2 font-semibold">Setor</th>
                      <th className="text-center pb-2 font-semibold">Parado há</th>
                      <th className="text-left pb-2 font-semibold">Prioridade</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paradosList.map(r => (
                      <tr key={r.id} className={`border-b border-slate-50 hover:bg-slate-50 ${['Alta', 'Urgente'].includes(r.prioridade) ? 'bg-red-50' : ''}`}>
                        <td className="py-2 font-mono font-bold text-indigo-700">{r.protocolo}</td>
                        <td className="py-2 text-slate-700 max-w-[120px] truncate">{r.razao_social}</td>
                        <td className="py-2 text-slate-500">{r.status}</td>
                        <td className="py-2 text-slate-500">{r.setor_destino}</td>
                        <td className="py-2 text-center font-semibold text-amber-700">{r.parado_dias}d</td>
                        <td className="py-2">
                          <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${
                            r.prioridade === 'Urgente' ? 'bg-red-100 text-red-700' :
                            r.prioridade === 'Alta' ? 'bg-orange-100 text-orange-700' :
                            'bg-slate-100 text-slate-600'
                          }`}>{r.prioridade}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SacDashboard;
