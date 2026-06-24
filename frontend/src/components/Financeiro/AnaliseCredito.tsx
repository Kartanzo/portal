import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ShieldCheck, Building2, CalendarDays, Hash, Search, RefreshCw, Eye, X,
  ChevronRight, ChevronDown, FileSearch, Filter, Loader2, Download,
} from 'lucide-react';
import { api } from '../../app_api';
import PageBackground from '../common/PageBackground';
import KpiCard, { KpiGrid } from '../common/KpiCard';
import { useTablePrefs, SortHeader, sortRows } from '../../hooks/useTablePrefs';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { aplicarLayoutEmpresa, temaTabelaEmpresa, EMPRESA_ACCENT } from '../exportUtils';

// ──────────────────────────────────────────────────────────
//  Análise de Crédito — consultas de bureau por CNPJ.
//  Duas abas (Maxi / Completo). Lista enxuta (data · CNPJ · razão);
//  duplo-clique (ou botão) abre o detalhe com TODAS as colunas.
// ──────────────────────────────────────────────────────────

type Tipo = 'maxi' | 'completo';

interface Registro {
  id: string;
  data_consulta: string | null;
  data_iso: string | null;
  ano: number | null;
  mes: number | null;
  cnpj: string | null;
  razao_social: string | null;
}

interface Kpis {
  total_consultas: number;
  cnpjs_distintos: number;
  ultima_consulta: string | null;
  no_mes_atual: number;
  ultima_sync?: string | null;
}

const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const PREFIXO = 'Envelope_Body_resultado_';

const fmtData = (iso: string | null, raw: string | null) => {
  if (raw && raw.trim()) return raw.trim();
  if (!iso) return '—';
  const [a, m, d] = iso.split('-');
  return d && m && a ? `${d}/${m}/${a}` : iso;
};

const fmtCnpj = (c: string | null) => {
  const d = (c || '').replace(/\D/g, '');
  if (d.length !== 14) return c || '—';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
};

// Siglas que devem aparecer em MAIÚSCULO nos rótulos/seções.
const SIGLAS = new Set(['spc', 'ccf', 'cnpj', 'cpf', 'rg', 'srs', 'pj', 'pf', 'uf']);
const _cap = (w: string): string => SIGLAS.has(w.toLowerCase()) ? w.toUpperCase() : (w.charAt(0).toUpperCase() + w.slice(1));
const _titulo = (t: string): string => t.replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).map(_cap).join(' ');

// Detecta valor no formato "chave: valor; chave: valor; ..." (sub-registro) e retorna os pares.
const parseKV = (v: string): [string, string][] | null => {
  const s = (v || '').trim();
  if (!s.includes(':')) return null;
  const pares: [string, string][] = [];
  for (const parte of s.split(';').map(x => x.trim()).filter(Boolean)) {
    const i = parte.indexOf(':');
    if (i < 0) return null;
    pares.push([parte.slice(0, i).trim(), parte.slice(i + 1).trim()]);
  }
  return pares.length ? pares : null;
};
// Formata datas ISO (2026-06-01T...) para dd/mm/aaaa; demais valores inalterados.
const fmtCell = (v: string): string => {
  const m = (v || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})T/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (v || '').trim();
};

// Seção (grupo) de um campo do detalhe, derivada do nome da coluna (1º segmento após o prefixo).
const sectionOf = (key: string): string => {
  if (!key.startsWith(PREFIXO)) return 'Identificação';
  const seg = key.slice(PREFIXO.length).split('_')[0] || 'outros';
  return _titulo(seg);
};

// Rótulo legível: remove o segmento da seção (já exibido no cabeçalho) e aplica siglas/Title Case.
const prettify = (key: string): string => {
  if (!key.startsWith(PREFIXO)) return _titulo(key);
  const semSecao = key.slice(PREFIXO.length).split('_').slice(1).join(' ');
  return _titulo(semSecao || key.slice(PREFIXO.length));
};

const AnaliseCredito: React.FC<{ user?: any }> = () => {
  const [tipo, setTipo] = useState<Tipo>('maxi');
  const [ano, setAno] = useState<number | ''>('');
  const [mes, setMes] = useState<number | ''>('');
  const [busca, setBusca] = useState('');
  const [buscaDeb, setBuscaDeb] = useState('');

  const [anos, setAnos] = useState<number[]>([]);
  const [mesesPorAno, setMesesPorAno] = useState<Record<string, number[]>>({});
  const [kpis, setKpis] = useState<Kpis | null>(null);
  const [registros, setRegistros] = useState<Registro[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [detalheId, setDetalheId] = useState<string | null>(null);
  const [anoAberto, setAnoAberto] = useState<Set<number>>(new Set());

  const { prefs, setWidth, toggleSort } = useTablePrefs('analise_credito', {
    data_consulta: 160, cnpj: 200, razao_social: 360,
  });

  // debounce da busca
  useEffect(() => {
    const t = setTimeout(() => setBuscaDeb(busca.trim()), 350);
    return () => clearTimeout(t);
  }, [busca]);

  // ao trocar de aba, zera filtros dependentes
  useEffect(() => { setAno(''); setMes(''); }, [tipo]);

  const carregarFiltros = useCallback(async () => {
    try {
      const { data } = await api.get('/financeiro/analise-credito/filtros', { params: { tipo } });
      setAnos(data.anos || []);
      setMesesPorAno(data.meses_por_ano || {});
    } catch { /* silencioso: filtros são auxiliares */ }
  }, [tipo]);

  const carregar = useCallback(async () => {
    setLoading(true); setErro(null);
    try {
      const params: any = { tipo, limit: 500 };
      if (ano !== '') params.ano = ano;
      if (mes !== '') params.mes = mes;
      if (buscaDeb) params.busca = buscaDeb;
      const [reg, kp] = await Promise.all([
        api.get('/financeiro/analise-credito/registros', { params }),
        api.get('/financeiro/analise-credito/kpis', { params: { tipo, ...(ano !== '' ? { ano } : {}), ...(mes !== '' ? { mes } : {}) } }),
      ]);
      setRegistros(reg.data.registros || []);
      setTotal(reg.data.total || 0);
      setKpis(kp.data);
    } catch (e: any) {
      setErro(e?.response?.data?.detail || 'Falha ao carregar os dados.');
      setRegistros([]); setTotal(0); setKpis(null);
    } finally {
      setLoading(false);
    }
  }, [tipo, ano, mes, buscaDeb]);

  useEffect(() => { carregarFiltros(); }, [carregarFiltros]);
  useEffect(() => { if (anos.length) setAnoAberto(s => (s.size ? s : new Set([Math.max(...anos)]))); }, [anos]);
  useEffect(() => { carregar(); }, [carregar]);

  const sincronizar = async () => {
    setSyncing(true); setErro(null);
    try {
      await api.post('/financeiro/analise-credito/sync');
      await carregarFiltros();
      await carregar();
    } catch (e: any) {
      setErro(e?.response?.data?.detail || 'Falha ao sincronizar com a planilha.');
    } finally {
      setSyncing(false);
    }
  };

  const mesesDisp = ano !== '' ? (mesesPorAno[String(ano)] || []) : [];

  const linhasOrdenadas = useMemo(
    () => sortRows(registros, prefs.sort, (r: Registro, k: string) => {
      if (k === 'data_consulta') return r.data_iso || '';
      return (r as any)[k] ?? '';
    }),
    [registros, prefs.sort],
  );

  const TabBtn: React.FC<{ id: Tipo; label: string; sub: string }> = ({ id, label, sub }) => (
    <button
      onClick={() => setTipo(id)}
      className={`flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors border
        ${tipo === id
          ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
          : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:border-blue-300'}`}
    >
      <div>{label}</div>
      <div className={`text-[11px] font-normal ${tipo === id ? 'text-blue-100' : 'text-slate-400'}`}>{sub}</div>
    </button>
  );

  return (
    <PageBackground>
      {/* Cabeçalho */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="grid place-items-center w-11 h-11 rounded-xl bg-blue-600 text-white shrink-0 shadow-sm">
            <ShieldCheck className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100">Análise de Crédito</h1>
            <p className="text-xs text-slate-500 dark:text-slate-400">Consultas de bureau por CNPJ · {total} registro(s){kpis?.ultima_sync && <span> · Última atualização: {new Date(kpis.ultima_sync).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>}</p>
          </div>
        </div>
        <button
          onClick={sincronizar}
          disabled={syncing}
          className="inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-60 text-white text-sm font-semibold shadow-sm"
        >
          {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
          {syncing ? 'Sincronizando…' : 'Sincronizar planilha'}
        </button>
      </div>

      {/* Abas */}
      <div className="flex gap-2 mb-4">
        <TabBtn id="maxi" label="Resultado Maxi" sub="resumo" />
        <TabBtn id="completo" label="Resultado Completo" sub="todos os dados" />
      </div>

      {/* KPIs */}
      <KpiGrid className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <KpiCard label="Consultas" value={kpis?.total_consultas ?? '—'} Icon={FileSearch} color="blue" />
        <KpiCard label="CNPJs distintos" value={kpis?.cnpjs_distintos ?? '—'} Icon={Building2} color="indigo" />
        <KpiCard label="Neste mês" value={kpis?.no_mes_atual ?? '—'} Icon={CalendarDays} color="emerald" />
        <KpiCard label="Última consulta" value={kpis?.ultima_consulta ? fmtData(kpis.ultima_consulta, null) : '—'} Icon={Hash} color="amber" />
      </KpiGrid>

      <div className="flex gap-4 items-start">
        {/* Menu lateral: Ano -> Mês */}
        <aside className="w-60 shrink-0 bg-white dark:bg-slate-800 rounded-2xl ring-1 ring-slate-200/70 dark:ring-slate-700 overflow-hidden self-start">
          <div className="px-4 py-2.5 border-b border-slate-200 dark:border-slate-700 text-xs font-bold uppercase tracking-wide text-slate-400">Períodos</div>
          <div className="max-h-[70vh] overflow-y-auto p-2 space-y-1">
            <button onClick={() => { setAno(''); setMes(''); }}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-sm font-medium ${ano === '' ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50'}`}>
              Todos os períodos
            </button>
            {[...anos].sort((a, b) => b - a).map(a => {
              const aberto = anoAberto.has(a);
              const meses = (mesesPorAno[String(a)] || []).slice().sort((x, y) => y - x);
              return (
                <div key={a}>
                  <button onClick={() => setAnoAberto(s => { const n = new Set(s); n.has(a) ? n.delete(a) : n.add(a); return n; })}
                    className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/50">
                    {aberto ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                    <CalendarDays className="w-4 h-4 text-blue-600" />
                    <span className="flex-1 text-left">{a}</span>
                  </button>
                  {aberto && (
                    <div className="ml-3 pl-2 border-l border-slate-200 dark:border-slate-700 space-y-0.5 py-1">
                      {meses.length === 0 && <div className="text-xs text-slate-400 px-2 py-1">Sem meses</div>}
                      {meses.map(m => {
                        const ativo = ano === a && mes === m;
                        return (
                          <button key={m} onClick={() => { setAno(a); setMes(m); }}
                            className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs ${ativo ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700/50'}`}>
                            {MESES[m] || m}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        {/* Conteúdo: busca + tabela */}
        <div className="flex-1 min-w-0 space-y-4">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar (CNPJ ou razão social)…"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 pl-9 pr-3 py-2.5 text-sm text-slate-700 dark:text-slate-200" />
          </div>

      {erro && (
        <div className="mb-4 rounded-xl bg-red-50 dark:bg-red-950/40 ring-1 ring-red-200 dark:ring-red-900 px-4 py-3 text-sm text-red-700 dark:text-red-300">
          {erro}
        </div>
      )}

      {/* Tabela */}
      <div className="bg-white dark:bg-slate-800/90 rounded-2xl ring-1 ring-slate-200/70 dark:ring-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <SortHeader label="Data da consulta" col="data_consulta" sort={prefs.sort} onSort={toggleSort} onResize={setWidth} />
                <SortHeader label="CNPJ" col="cnpj" sort={prefs.sort} onSort={toggleSort} onResize={setWidth} />
                <SortHeader label="Razão social" col="razao_social" sort={prefs.sort} onSort={toggleSort} onResize={setWidth} />
                <th className="px-3 py-2.5 w-16 text-right text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Ver</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="px-4 py-12 text-center text-slate-400">
                  <Loader2 className="w-5 h-5 animate-spin inline mr-2" />Carregando…
                </td></tr>
              ) : linhasOrdenadas.length === 0 ? (
                <tr><td colSpan={4} className="px-4 py-12 text-center text-slate-400">
                  Nenhuma consulta encontrada para os filtros atuais.
                </td></tr>
              ) : linhasOrdenadas.map(r => (
                <tr
                  key={r.id}
                  onDoubleClick={() => setDetalheId(r.id)}
                  className="border-b border-slate-100 dark:border-slate-700/60 hover:bg-blue-50/60 dark:hover:bg-slate-700/40 cursor-pointer select-none"
                  title="Duplo-clique para ver todos os dados"
                >
                  <td className="px-3 py-2.5 whitespace-nowrap text-slate-700 dark:text-slate-200 tabular-nums">{fmtData(r.data_iso, r.data_consulta)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap text-slate-700 dark:text-slate-200 tabular-nums">{fmtCnpj(r.cnpj)}</td>
                  <td className="px-3 py-2.5 text-slate-700 dark:text-slate-200">{r.razao_social || '—'}</td>
                  <td className="px-3 py-2.5 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); setDetalheId(r.id); }}
                      className="inline-grid place-items-center w-8 h-8 rounded-lg text-blue-600 hover:bg-blue-100 dark:hover:bg-blue-950/50"
                      title="Ver todos os dados"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {total > registros.length && (
          <div className="px-4 py-2.5 text-xs text-slate-400 border-t border-slate-100 dark:border-slate-700/60">
            Mostrando {registros.length} de {total}. Refine os filtros para ver registros específicos.
          </div>
        )}
      </div>

        </div>
      </div>

      {detalheId && <DetalheModal id={detalheId} onClose={() => setDetalheId(null)} />}
    </PageBackground>
  );
};

// ──────────────────────────────────────────────────────────
//  Modal de detalhe — TODAS as colunas, agrupadas por seção.
// ──────────────────────────────────────────────────────────
interface Detalhe {
  id: string; tipo: string; data_consulta: string | null; data_iso: string | null;
  cnpj: string | null; razao_social: string | null; dados: Record<string, any>;
}

const DetalheModal: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const [data, setData] = useState<Detalhe | null>(null);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filtroCampo, setFiltroCampo] = useState('');
  const [ocultarVazios, setOcultarVazios] = useState(true);
  const [aberto, setAberto] = useState<Record<string, boolean>>({});
  const [gerando, setGerando] = useState(false);

  useEffect(() => {
    let vivo = true;
    (async () => {
      setLoading(true); setErro(null);
      try {
        const r = await api.get(`/financeiro/analise-credito/registro/${id}`);
        if (vivo) setData(r.data);
      } catch (e: any) {
        if (vivo) setErro(e?.response?.data?.detail || 'Falha ao carregar o detalhe.');
      } finally {
        if (vivo) setLoading(false);
      }
    })();
    return () => { vivo = false; };
  }, [id]);

  // fecha no ESC
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  // agrupa os campos por seção, preservando a ordem das colunas
  const grupos = useMemo(() => {
    if (!data?.dados) return [] as any[];
    const f = filtroCampo.trim().toLowerCase();
    const mapa = new Map<string, [string, any][]>();
    for (const [k, v] of Object.entries(data.dados)) {
      const valor = v == null ? '' : String(v);
      if (ocultarVazios && !valor.trim()) continue;
      if (f && !(k.toLowerCase().includes(f) || valor.toLowerCase().includes(f))) continue;
      const sec = sectionOf(k);
      if (!mapa.has(sec)) mapa.set(sec, []);
      mapa.get(sec)!.push([k, v]);
    }
    const ordenadas = [...mapa.entries()].sort((a, b) => {
      if (a[0] === 'Identificação') return -1;
      if (b[0] === 'Identificação') return 1;
      return a[0].localeCompare(b[0], 'pt');
    });
    return ordenadas.map(([secao, campos]) => {
      const simples: [string, any][] = [];
      const tabMap = new Map<string, { cols: string[]; rows: Record<string, string>[]; titulo: string }>();
      for (const [k, v] of campos) {
        const pares = parseKV(v == null ? '' : String(v));
        if (pares && pares.length >= 2) {
          const cols = pares.map(p => p[0]);
          const sig = [...cols].sort().join('|');
          if (!tabMap.has(sig)) tabMap.set(sig, { cols: [...cols], rows: [], titulo: (prettify(k).replace(/\s*\d+\s*$/, '').trim()) || prettify(k) });
          const t = tabMap.get(sig)!;
          for (const c of cols) if (!t.cols.includes(c)) t.cols.push(c);
          const row: Record<string, string> = {};
          for (const [pk, pv] of pares) row[pk] = pv;
          t.rows.push(row);
        } else {
          simples.push([k, v]);
        }
      }
      return { secao, simples, tabelas: [...tabMap.values()], total: campos.length };
    });
  }, [data, filtroCampo, ocultarVazios]);

  const totalCampos = data?.dados ? Object.keys(data.dados).length : 0;
  const toggle = (sec: string) => setAberto(p => ({ ...p, [sec]: !(p[sec] ?? false) }));
  const estaAberto = (sec: string, _idx: number) => aberto[sec] ?? true;

  // Gera PDF do detalhe usando o layout padrão do portal (header/rodapé/logo EMPRESA).
  const gerarPDF = async () => {
    if (!data) return;
    setGerando(true);
    try {
      const doc = new jsPDF({ unit: 'mm', format: 'a4' });
      const W = doc.internal.pageSize.getWidth();
      const { finalizar } = await aplicarLayoutEmpresa(doc, {
        titulo: `Análise de Crédito${data.razao_social ? ' — ' + data.razao_social : ''}`,
        subtitulo: `${fmtCnpj(data.cnpj)} · ${fmtData(data.data_iso, data.data_consulta)} · ${data.tipo === 'completo' ? 'Resultado Completo' : 'Resultado Maxi'}`,
      });
      let y = 34;
      for (const g of grupos as any[]) {
        if (y > 262) { doc.addPage(); y = 34; }
        // banda colorida da seção
        doc.setFillColor(...EMPRESA_ACCENT); doc.rect(10, y, W - 20, 7, 'F');
        doc.setTextColor(255); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
        doc.text(String(g.secao), 13, y + 4.9); y += 9;
        for (const t of g.tabelas as any[]) {
          autoTable(doc, {
            startY: y,
            head: [t.cols.map((c: string) => _titulo(c))],
            body: t.rows.map((r: any) => t.cols.map((c: string) => fmtCell(String(r[c] ?? '')))),
            ...temaTabelaEmpresa,
          });
          y = (doc as any).lastAutoTable.finalY + 3;
        }
        if (g.simples.length) {
          autoTable(doc, {
            startY: y,
            head: [['Campo', 'Valor']],
            body: g.simples.map(([k, v]: [string, any]) => [prettify(k), fmtCell(String(v ?? ''))]),
            columnStyles: { 0: { cellWidth: (W - 20) * 0.4, fontStyle: 'bold' as const } },
            ...temaTabelaEmpresa,
          });
          y = (doc as any).lastAutoTable.finalY + 4;
        }
        y += 1;
      }
      finalizar();
      doc.save(`analise_credito_${(data.cnpj || '').replace(/\D/g, '') || 'consulta'}.pdf`);
    } catch (e) {
      console.error('Erro ao gerar PDF', e);
    } finally {
      setGerando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-slate-900/60 backdrop-blur-sm sm:p-4" onClick={onClose}>
      <div
        className="bg-white dark:bg-slate-900 w-full sm:max-w-6xl sm:rounded-2xl shadow-2xl flex flex-col max-h-screen sm:max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* topo */}
        <div className="flex items-start justify-between gap-3 p-4 border-b border-slate-200 dark:border-slate-700 shrink-0">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-blue-600">{data?.tipo === 'completo' ? 'Resultado Completo' : 'Resultado Maxi'} · {totalCampos} campos</div>
            <h2 className="text-base sm:text-lg font-bold text-slate-800 dark:text-slate-100 truncate">{data?.razao_social || 'Detalhe da consulta'}</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">{fmtCnpj(data?.cnpj || null)} · {fmtData(data?.data_iso || null, data?.data_consulta || null)}</p>
          </div>
          <button onClick={onClose} className="grid place-items-center w-9 h-9 rounded-lg text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* controles */}
        <div className="flex flex-col sm:flex-row gap-2 p-3 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="relative flex-1">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={filtroCampo}
              onChange={e => setFiltroCampo(e.target.value)}
              placeholder="Filtrar campos…"
              className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 pl-9 pr-3 py-2 text-sm text-slate-700 dark:text-slate-200"
            />
          </div>
          <label className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-sm text-slate-600 dark:text-slate-300 cursor-pointer select-none">
            <input type="checkbox" checked={ocultarVazios} onChange={e => setOcultarVazios(e.target.checked)} className="accent-blue-600" />
            Ocultar vazios
          </label>
          <button onClick={gerarPDF} disabled={gerando || loading || !data}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-white text-sm font-semibold disabled:opacity-60"
            style={{ backgroundColor: '#e74c3c' }}>
            {gerando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
            {gerando ? 'Gerando…' : 'Gerar PDF'}
          </button>
        </div>

        {/* corpo */}
        <div className="overflow-y-auto p-3 sm:p-4 space-y-3">
          {loading ? (
            <div className="py-16 text-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin inline mr-2" />Carregando todos os dados…</div>
          ) : erro ? (
            <div className="py-10 text-center text-red-600">{erro}</div>
          ) : grupos.length === 0 ? (
            <div className="py-10 text-center text-slate-400">Nenhum campo corresponde ao filtro.</div>
          ) : grupos.map((g, idx) => {
            const open = estaAberto(g.secao, idx);
            return (
              <div key={g.secao} className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden">
                <button
                  onClick={() => toggle(g.secao)}
                  className="w-full flex items-center justify-between gap-2 px-3 py-2.5 border-l-4 border-blue-500 bg-gradient-to-r from-blue-50 to-transparent dark:from-blue-950/40 dark:to-transparent hover:from-blue-100 dark:hover:from-blue-950/60"
                >
                  <span className="flex items-center gap-2 font-bold text-sm text-blue-800 dark:text-blue-200 uppercase tracking-wide">
                    {open ? <ChevronDown className="w-4 h-4 text-blue-600" /> : <ChevronRight className="w-4 h-4 text-blue-500" />}
                    {g.secao}
                  </span>
                  <span className="text-[11px] font-bold text-blue-500/80">{g.total}</span>
                </button>
                {open && (
                  <div className="p-3 space-y-4">
                    {g.tabelas.map((t: any, ti: number) => (
                      <div key={ti}>
                        <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-300 mb-1.5">{t.titulo} <span className="text-slate-400">({t.rows.length})</span></div>
                        <div className="overflow-x-auto rounded-lg ring-1 ring-slate-200 dark:ring-slate-700">
                          <table className="min-w-full text-xs">
                            <thead className="bg-slate-50 dark:bg-slate-800/80 text-left text-[10px] uppercase tracking-wide text-slate-400">
                              <tr>{t.cols.map((c: string) => <th key={c} className="px-2.5 py-1.5 whitespace-nowrap font-semibold">{_titulo(c)}</th>)}</tr>
                            </thead>
                            <tbody>
                              {t.rows.map((row: Record<string, string>, ri: number) => (
                                <tr key={ri} className="border-t border-slate-100 dark:border-slate-700/60">
                                  {t.cols.map((c: string) => {
                                    const cv = row[c];
                                    return <td key={c} className="px-2.5 py-1.5 whitespace-nowrap text-slate-700 dark:text-slate-200 tabular-nums">{cv != null && String(cv).trim() ? fmtCell(String(cv)) : <span className="text-slate-300 dark:text-slate-600">—</span>}</td>;
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                    {g.simples.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-x-4 gap-y-3">
                        {g.simples.map(([k, v]: [string, any]) => {
                          const valor = v == null ? '' : String(v);
                          return (
                            <div key={k} className="min-w-0">
                              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 break-words" title={k}>{prettify(k)}</div>
                              <div className="text-sm text-slate-800 dark:text-slate-100 break-words mt-0.5">{valor.trim() ? fmtCell(valor) : <span className="text-slate-300 dark:text-slate-600">—</span>}</div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default AnaliseCredito;
