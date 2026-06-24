import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { api } from '../../app_api';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import {
  DndContext, PointerSensor, useSensor, useSensors, closestCorners, DragOverlay, useDroppable,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy, horizontalListSortingStrategy, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  CalendarClock, RefreshCw, Search, Hammer, Factory, X, GitCompareArrows, BadgeCheck, AlertTriangle, ArrowRight,
  PlusCircle, MinusCircle, ArrowUpDown, Scale, GripVertical, Layers, ClipboardList, FileDown, Inbox, Gauge, Network, Loader2,
  Package, Check, Trash2, Plus, Save, Maximize2, Minimize2, Scissors, History, RotateCcw,
} from 'lucide-react';
import EstruturaArvore, { EstruturaItem } from './EstruturaArvore';
import { useFiltroPersistente } from '../../hooks/useFiltroPersistente';

interface PlanoRow {
  SEQUENCIA: number; CODIGO_PRODUTO: string; DESCRICAO: string; QTD_PRODUZIR: number;
  ESTOQUE_FISICO: number; RESERVA_ATUAL: number; ENTREGA?: string;   // entrega mais cedo (dd/mm/aaaa) entre os pedidos do passo
  DEMANDA_POR_PEDIDO?: Record<string, number>; VALOR_POR_PEDIDO_COMPLETO?: Record<string, number>; VALOR_ITEM_POR_PEDIDO?: Record<string, number>;
}
interface OP {
  numero_op: string; codigo: string; descricao: string; unidade: string;
  qtd_op: number | null; apontada: number | null; qtd_nec_a: number | null;
  qtd_nec_material: number | null; inicio_real: string | null; k01t_001: string; k01t_002: string;
}
interface Versao { id: string; created_at: string | null; created_by_name: string | null; hoje: string | null; oficial_em?: string | null; oficial_por_nome?: string | null; }
interface VersaoSalva { id: string; plano_versao_id: string; created_at: string | null; created_by_name: string | null; oficial: boolean; oficial_em: string | null; oficial_por_nome: string | null; hash: string | null; }
interface Maquina { id: number; nome: string; cor?: string | null; }
interface Diff {
  base: Versao; novo: Versao;
  novos: { codigo: string; descricao: string; sequencia_novo: number; qtd_novo: number }[];
  removidos: { codigo: string; descricao: string; sequencia_base: number; qtd_base: number }[];
  seq_mudou: { codigo: string; descricao: string; sequencia_base: number; sequencia_novo: number }[];
  qtd_mudou: { codigo: string; descricao: string; qtd_base: number; qtd_novo: number; delta: number }[];
  resumo: { novos: number; removidos: number; seq: number; qtd: number };
}

const card = "bg-white dark:bg-slate-800/90 rounded-2xl shadow-sm ring-1 ring-slate-200/70 dark:ring-slate-700";
const input = "w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/60 focus:border-blue-500";
const selectCls = "px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/60";

const CMP_TONES: Record<string, { card: string; label: string; value: string; head: string; dot: string; title: string }> = {
  emerald: { card: 'bg-emerald-50 dark:bg-emerald-950/30', label: 'text-emerald-500/80', value: 'text-emerald-700 dark:text-emerald-300', head: 'bg-emerald-50 dark:bg-emerald-950/20', dot: 'bg-emerald-500', title: 'text-emerald-700 dark:text-emerald-300' },
  red: { card: 'bg-red-50 dark:bg-red-950/30', label: 'text-red-500/80', value: 'text-red-700 dark:text-red-300', head: 'bg-red-50 dark:bg-red-950/20', dot: 'bg-red-500', title: 'text-red-700 dark:text-red-300' },
  blue: { card: 'bg-blue-50 dark:bg-blue-950/30', label: 'text-blue-500/80', value: 'text-blue-700 dark:text-blue-300', head: 'bg-blue-50 dark:bg-blue-950/20', dot: 'bg-blue-500', title: 'text-blue-700 dark:text-blue-300' },
  amber: { card: 'bg-amber-50 dark:bg-amber-950/30', label: 'text-amber-500/80', value: 'text-amber-700 dark:text-amber-300', head: 'bg-amber-50 dark:bg-amber-950/20', dot: 'bg-amber-500', title: 'text-amber-700 dark:text-amber-300' },
};

const Portal: React.FC<{ children: React.ReactNode }> = ({ children }) => createPortal(children, document.body);

// Card de taba no Sopro: 1 por (produto × sequência), com a máquina (Sopro) que produz a taba.
interface TabaSoproCard { cod_item: string; sequencia: number; cod_componente: string; descricao: string; qtd: number; maquina_id: number; ordem: number; lote: number; inicio: string | null; }

// Deriva componentes de ENCARTE / TABA a partir de uma estrutura (mesma regra usada no detalhe do item).
const derivarEncarteTaba = (itens: EstruturaItem[]): { item: EstruturaItem; tipo: 'encarte' | 'taba' }[] => {
  const reEncarte = /\bENCARTE\b/i;
  const reTaba = /\bTABA\b/i;
  const reAlma = /\bALMA\b/i;
  return itens
    .filter(it => it.level >= 2)
    .map(it => {
      const t = it.text || '';
      if (reEncarte.test(t)) return { item: it, tipo: 'encarte' as const };
      if (reTaba.test(t) || reAlma.test(t)) return { item: it, tipo: 'taba' as const };
      return null;
    })
    .filter((x): x is { item: EstruturaItem; tipo: 'encarte' | 'taba' } => x !== null);
};

let cacheOps: OP[] | null = null;
const cachePlano: Record<string, { plano: PlanoRow[]; versao: Versao }> = {};

const userKey = (): string => { try { const s = sessionStorage.getItem('empresa_user'); if (s) return String(JSON.parse(s)?.id ?? 'anon'); } catch { /* */ } return 'anon'; };
const lsKey = () => `programacao:versao:${userKey()}`;
const num = (v: number | null | undefined) => (v === null || v === undefined) ? '—' : Number(v).toLocaleString('pt-BR');
// Helpers de tendência (espelham o Otimizador de Produção): normaliza código e parse BR.
const normCodSop = (v: any) => (v == null ? '' : String(v).toUpperCase().trim().replace(/[.\-\s]/g, '').replace(/^BR/, ''));
const cleanFloatSop = (v: any) => {
  if (v == null || v === '') return 0;
  let s = String(v).trim();
  if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = parseFloat(s); return isNaN(n) ? 0 : n;
};
const money = (v: number | null | undefined) => (v === null || v === undefined) ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDt = (iso: string | null | undefined) => {
  if (!iso) return '—';
  const d = new Date(iso); if (isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const fmtData = (s: string | undefined) => { if (!s) return '—'; const [a, m, d] = s.split('-'); return d && m && a ? `${d}/${m}/${a}` : s; };
// "dd/mm/aaaa" -> Date no fim do dia (deadline de entrega). Retorna null se inválida.
const parseDataBR = (s: string | undefined | null): Date | null => {
  if (!s) return null;
  const [d, m, a] = s.split('/');
  if (!d || !m || !a) return null;
  const dt = new Date(Number(a), Number(m) - 1, Number(d), 23, 59, 59, 999);
  return isNaN(dt.getTime()) ? null : dt;
};

const BACKLOG = 'a_programar';
const mkey = (id: number) => `m_${id}`;
// Container por LOTE: m_{maquinaId}__l_{lote}
const lkey = (id: number, lote: number) => `m_${id}__l_${lote}`;
const parseLkey = (k: string): { maqId: number; lote: number } | null => {
  const m = /^m_(\d+)__l_(\d+)$/.exec(k);
  return m ? { maqId: Number(m[1]), lote: Number(m[2]) } : null;
};
// Identificador único de card: "CODIGO_PRODUTO::SEQUENCIA"
const ckey = (cod: string, seq: number) => `${cod}::${seq}`;
const codDe = (ck: string) => ck.split('::')[0];
const seqDe = (ck: string) => Number(ck.split('::')[1] ?? 0);
// Id de arrasto de um card de taba no Sopro: "taba::cod_item::sequencia::cod_componente".
const tabaKey = (t: { cod_item: string; sequencia: number; cod_componente: string }) => `taba::${t.cod_item}::${t.sequencia}::${t.cod_componente}`;
interface LoteInfo { lote: number; data: string; dataFim?: string; ordem: number; }

const fmtHorasLote = (h: number | null) => {
  if (h === null || h <= 0) return null;
  const totalMin = Math.round(h * 60);
  const d = Math.floor(totalMin / 1440), hh = Math.floor((totalMin % 1440) / 60), mm = totalMin % 60;
  const p: string[] = [];
  if (d > 0) p.push(`${d}d`);
  if (hh > 0) p.push(`${hh}h`);
  if (mm > 0 || p.length === 0) p.push(`${mm}min`);
  return p.join(' ');
};
// Início do lote pode ser data ("YYYY-MM-DD") ou data+hora ("YYYY-MM-DDTHH:MM").
const _parseInicio = (inicio: string): Date | null => {
  if (!inicio) return null;
  const d = new Date(inicio.includes('T') ? inicio : inicio + 'T00:00:00');
  return isNaN(d.getTime()) ? null : d;
};
// ===== Calendário de produção (turno, pausas, fim de semana, feriados) =====
interface PausaCfg { inicio: string; fim: string; }
interface FeriadoCfg { data: string; folga?: boolean; inicio?: string; fim?: string; }
interface VariavelCfg { nome: string; valor: string; }
interface CalendarioCfg {
  turnos: PausaCfg[];                 // 1..N turnos por dia (união); turno que cruza a meia-noite é suportado
  turno_inicio?: string; turno_fim?: string;  // legado (migrado para turnos)
  setup_min: number;
  pausas: PausaCfg[]; dias_semana_folga: number[]; feriados: FeriadoCfg[];
  variaveis: VariavelCfg[];
}
const CALENDARIO_PADRAO: CalendarioCfg = {
  turnos: [{ inicio: '06:00', fim: '14:00' }, { inicio: '14:00', fim: '22:00' }, { inicio: '22:00', fim: '06:00' }],
  setup_min: 69,
  pausas: [{ inicio: '10:00', fim: '10:40' }, { inicio: '13:40', fim: '14:00' }, { inicio: '17:00', fim: '17:40' }, { inicio: '21:40', fim: '22:00' }],
  dias_semana_folga: [0], feriados: [], variaveis: [],
};
// Migra config antiga (turno único) para a lista de turnos.
const migrarCal = (c: any): CalendarioCfg => {
  const cfg = { ...CALENDARIO_PADRAO, ...(c || {}) };
  if (!Array.isArray(cfg.turnos) || cfg.turnos.length === 0) {
    cfg.turnos = (c?.turno_inicio || c?.turno_fim) ? [{ inicio: c.turno_inicio || '06:00', fim: c.turno_fim || '22:00' }] : CALENDARIO_PADRAO.turnos;
  }
  return cfg;
};
const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const _hm = (s: string): number => { const [h, m] = (s || '0:0').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const _minToHM = (m: number): string => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const _localKey = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const _atHM = (d: Date, min: number): Date => { const n = new Date(d); n.setHours(Math.floor(min / 60), min % 60, 0, 0); return n; };
const _nextDayHM = (d: Date, min: number): Date => { const n = new Date(d); n.setDate(n.getDate() + 1); n.setHours(Math.floor(min / 60), min % 60, 0, 0); return n; };
// Expande turnos em segmentos [ini,fim) dentro de um dia (0..1440), tratando cruzamento de meia-noite.
const _expandTurnos = (turnos: PausaCfg[]): [number, number][] => {
  const raw: [number, number][] = [];
  for (const t of turnos || []) {
    const a = _hm(t.inicio), b = _hm(t.fim);
    if (b > a) raw.push([a, b]);
    else if (b < a) { raw.push([a, 1440]); raw.push([0, b]); }   // turno noturno cruza a meia-noite
  }
  raw.sort((x, y) => x[0] - y[0]);
  // Mescla apenas turnos que se SOBREPÕEM (evita contar capacidade em dobro). Turnos adjacentes/contíguos
  // (ex.: 06-14 e 14-22) NÃO são mesclados — cada um continua um lote/slot independente.
  const segs: [number, number][] = [];
  for (const seg of raw) {
    const last = segs[segs.length - 1];
    if (last && seg[0] < last[1]) last[1] = Math.max(last[1], seg[1]);
    else segs.push([seg[0], seg[1]]);
  }
  return segs;
};
// Gera "slots" de turno (janelas de produção, com capacidade em minutos descontando pausas) a partir
// de um início — usado para dividir a programação automática por turno (cada slot = um lote).
const _gerarSlotsTurno = (inicio: string, cfg: CalendarioCfg, maxSlots = 60): { start: string; cap: number }[] => {
  const base = _parseInicio(inicio) || new Date(inicio);
  const turnosCfg = (cfg.turnos && cfg.turnos.length) ? cfg.turnos : [{ inicio: cfg.turno_inicio || '06:00', fim: cfg.turno_fim || '22:00' }];
  const segBase = _expandTurnos(turnosCfg);
  if (!segBase.length) return [];
  const folga = new Set(cfg.dias_semana_folga || []);
  const feriados = new Map((cfg.feriados || []).map(f => [f.data, f] as const));
  const pausas = (cfg.pausas || []).map(p => [_hm(p.inicio), _hm(p.fim)] as [number, number]);
  const baseMin = base.getHours() * 60 + base.getMinutes();
  const slots: { start: string; cap: number }[] = [];
  const dia0 = new Date(base); dia0.setHours(0, 0, 0, 0);
  for (let d = 0; d < 120 && slots.length < maxSlots; d++) {
    const cur = new Date(dia0); cur.setDate(cur.getDate() + d);
    const fer = feriados.get(_localKey(cur));
    if (fer?.folga || folga.has(cur.getDay())) continue;
    const segs = (fer && (fer.inicio || fer.fim))
      ? _expandTurnos([{ inicio: fer.inicio || _minToHM(segBase[0][0]), fim: fer.fim || _minToHM(segBase[segBase.length - 1][1]) }])
      : segBase;
    for (const [a, b] of segs) {
      let s = a;
      if (d === 0 && a < baseMin) { if (b <= baseMin) continue; s = baseMin; }   // turno em andamento: entra no meio
      let cap = b - s;
      for (const [pi, pf] of pausas) { const ov = Math.min(b, pf) - Math.max(s, pi); if (ov > 0) cap -= ov; }
      if (cap <= 0) continue;
      const sd = new Date(cur); sd.setHours(Math.floor(s / 60), s % 60, 0, 0);
      slots.push({ start: sd.toISOString(), cap });
      if (slots.length >= maxSlots) break;
    }
  }
  return slots;
};
// Término planejado a partir do início + (quant/peças-h), respeitando o calendário. Retorna ISO.
// incluirSetup=false quando o card é continuação do mesmo produto (sem troca) — não soma setup de novo.
const calcFimPlanejado = (inicio: string, quant: number, pecasHora: number | null, cfg: CalendarioCfg, incluirSetup = true): string | null => {
  const base = _parseInicio(inicio);
  if (!base || !quant || quant <= 0 || !pecasHora || pecasHora <= 0) return null;
  let minutos = (quant / pecasHora) * 60 + (incluirSetup ? (cfg.setup_min || 0) : 0);
  if (minutos <= 0) return null;
  const turnosCfg = (cfg.turnos && cfg.turnos.length) ? cfg.turnos : [{ inicio: cfg.turno_inicio || '06:00', fim: cfg.turno_fim || '22:00' }];
  const segBase = _expandTurnos(turnosCfg);
  if (segBase.length === 0) return null;
  const folga = new Set(cfg.dias_semana_folga || []);
  const feriados = new Map((cfg.feriados || []).map(f => [f.data, f] as const));
  let atual = new Date(base);
  let guard = 0;
  while (minutos > 0) {
    if (++guard > 3_000_000) return null;   // trava de segurança contra config inválida
    const fer = feriados.get(_localKey(atual));
    if (fer?.folga || folga.has(atual.getDay())) { atual = _nextDayHM(atual, segBase[0][0]); continue; }
    // segmentos válidos do dia: feriado com janela própria sobrescreve; senão, os turnos
    const segs = (fer && (fer.inicio || fer.fim))
      ? _expandTurnos([{ inicio: fer.inicio || _minToHM(segBase[0][0]), fim: fer.fim || _minToHM(segBase[segBase.length - 1][1]) }])
      : segBase;
    const t = atual.getHours() * 60 + atual.getMinutes();
    let estado: 'jumped' | 'inside' | 'after' = 'after';
    for (const [a, b] of segs) { if (t < a) { atual = _atHM(atual, a); estado = 'jumped'; break; } if (t < b) { estado = 'inside'; break; } }
    if (estado === 'jumped') continue;
    if (estado === 'after') { atual = _nextDayHM(atual, segs.length ? segs[0][0] : segBase[0][0]); continue; }
    // dentro do turno: respeita pausas
    let pausou = false;
    for (const p of (cfg.pausas || [])) { const pi = _hm(p.inicio), pf = _hm(p.fim); if (t >= pi && t < pf) { atual = _atHM(atual, pf); pausou = true; break; } }
    if (pausou) continue;
    atual = new Date(atual.getTime() + 60000);
    minutos -= 1;
  }
  return atual.toISOString();
};

// ISO/naive -> "YYYY-MM-DDTHH:MM" (hora local do navegador, BR) para input datetime-local.
const toLocalInput = (s: string | undefined | null): string => {
  if (!s) return '';
  const d = new Date(s); if (isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

const Card: React.FC<{
  cod: string; item: PlanoRow; pos: number; qtd: number; opN: number; ativo: boolean; temObs: boolean;
  selected: boolean; onToggleSel: (cod: string) => void;
  onDados: (cod: string) => void; onOps: (cod: string) => void; avisoTaba?: string | null;
  critico?: { qtd: number; n: number; valor: number } | null;
  concluido?: boolean; qtdProduzida?: number | null; onConcluido?: (cod: string) => void; onQtdProd?: (cod: string, v: string) => void;
  onGerarSaldo?: (cod: string) => void;
  semProgresso?: boolean;
  semCadastroPh?: boolean;
}> = ({ cod, item, pos, qtd, opN, ativo, temObs, selected, onToggleSel, onDados, onOps, avisoTaba, critico, concluido, qtdProduzida, onConcluido, onQtdProd, onGerarSaldo, semProgresso, semCadastroPh }) => {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cod });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  const displayCod = codDe(cod);
  // Duplo clique abre a tela unificada (Detalhe + Ordens em produção). Clique simples só seleciona/arrasta.
  const handleDouble = () => { onDados(cod); };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}
      className={`group flex items-start gap-1.5 px-2 py-1.5 rounded-lg ring-1 shadow-sm cursor-grab active:cursor-grabbing ${selected ? 'ring-2 ring-blue-500 bg-blue-50/60 dark:bg-blue-950/30' : concluido ? 'bg-emerald-50 dark:bg-emerald-950/30 ring-emerald-300 dark:ring-emerald-900/60' : ativo ? 'bg-white dark:bg-slate-800 ring-slate-200 dark:ring-slate-700 hover:ring-blue-300' : 'bg-red-50 dark:bg-red-950/30 ring-red-300 dark:ring-red-900/60'}`}
      onDoubleClick={handleDouble}>
      <input type="checkbox" checked={selected} onChange={() => onToggleSel(cod)}
        onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}
        className="shrink-0 w-3 h-3 mt-0.5 cursor-pointer" title="Selecionar" />
      <span className="text-slate-300 group-hover:text-slate-500 shrink-0 mt-0.5"><GripVertical className="w-3.5 h-3.5" /></span>
      <span title="Ordem na programação" className={`grid place-items-center w-5 h-5 rounded text-[10px] font-bold tabular-nums shrink-0 ${ativo ? 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300' : 'bg-red-200 dark:bg-red-900/50 text-red-700 dark:text-red-300'}`}>{pos}</span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className={`font-mono text-[10px] font-semibold truncate ${ativo ? 'text-slate-700 dark:text-slate-200' : 'text-red-600 dark:text-red-300 line-through'}`}>{displayCod}</span>
          <span className={`px-1.5 py-0.5 rounded text-[11px] font-semibold tabular-nums shrink-0 ${ativo ? 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300' : 'bg-red-100 dark:bg-red-950/40 text-red-600 dark:text-red-300 line-through'}`}>{num(qtd)}</span>
        </div>
        <div className={`text-[11px] truncate ${ativo ? 'text-slate-600 dark:text-slate-300' : 'text-red-500 dark:text-red-300 line-through'}`} title={item.DESCRICAO}>{item.DESCRICAO}</div>
        <div className="flex flex-wrap items-center gap-1 mt-0.5">
          <span title="Sequência do otimizador de produção" className="px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-[10px] font-bold tabular-nums">OTIM {item.SEQUENCIA}</span>
          {opN > 0 && <span title="OPs em produção" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-orange-500 text-white text-[10px] font-bold"><Hammer className="w-2.5 h-2.5" />{opN}</span>}
          {temObs && <span title="Tem observação" className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
          {!ativo &&<span className="px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[9px] font-bold">INATIVO</span>}
          {avisoTaba && <span title={avisoTaba} className="inline-flex items-center text-rose-500 cursor-help"><AlertTriangle className="w-3.5 h-3.5" /></span>}
          {critico && <span title={`Bloqueando faturamento: ${critico.qtd} unid. em ${critico.n} pedido(s) — R$ ${critico.valor.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-rose-600 text-white text-[9px] font-bold cursor-help">🔥 CRÍTICO</span>}
          {semCadastroPh && <span title="Sem peças/hora cadastrada em nenhuma máquina — arraste para uma máquina e o cadastro será solicitado" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-500 text-white text-[9px] font-bold cursor-help"><AlertTriangle className="w-2.5 h-2.5" />SEM PH</span>}
        </div>
        {/* Operador: marcar concluído + informar quantidade já produzida (não inicia o arraste).
            Só faz sentido quando o item já está numa máquina — escondido no "A programar". */}
        {!semProgresso && (
        <div className="flex flex-wrap items-center gap-1 mt-1" onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
          <button type="button" onClick={() => onConcluido && onConcluido(cod)} title={concluido ? 'Concluído — clique para desmarcar' : 'Marcar como concluído'}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 ${concluido ? 'bg-emerald-500 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300 hover:bg-emerald-100 dark:hover:bg-emerald-900/40'}`}>
            <Check className="w-3 h-3" />{concluido ? 'Concluído' : 'Concluir'}
          </button>
          <label className="inline-flex items-center gap-1 text-[9px] text-slate-400 ml-auto">Prod.
            <input type="number" min={0} step="any" value={qtdProduzida ?? ''} placeholder="0"
              onChange={e => onQtdProd && onQtdProd(cod, e.target.value)}
              className="w-14 px-1 py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-[10px] text-right text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500/60" />
          </label>
          {/* Gerar saldo: cria um card novo só com o que falta produzir (qtd − produzida) em "A programar". */}
          {onGerarSaldo && (qtdProduzida ?? 0) > 0 && (qtdProduzida ?? 0) < qtd && (
            <button type="button" onClick={() => onGerarSaldo(cod)}
              title={`Gerar card de saldo (${num(qtd - (qtdProduzida || 0))}) em "A programar" — o card atual fica com a qtd produzida (${num(qtdProduzida || 0)})`}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold shrink-0 bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-900/60">
              <Scissors className="w-3 h-3" />Saldo {num(qtd - (qtdProduzida || 0))}
            </button>
          )}
        </div>
        )}
      </div>
    </div>
  );
};

// Card de taba arrastável (reordenar dentro da Sopro / mover entre Sopros). Duplo clique abre o detalhe.
const TabaCard: React.FC<{ t: TabaSoproCard; onDados?: (card: TabaSoproCard) => void }> = ({ t, onDados }) => {
  const id = tabaKey(t);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners} onDoubleClick={() => onDados && onDados(t)}
      title={`Produto ${t.cod_item} · seq ${t.sequencia} — arraste para mover; duplo clique abre o detalhe`}
      className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-white dark:bg-slate-800 ring-1 ring-purple-200 dark:ring-purple-900/50 cursor-grab active:cursor-grabbing">
      <span className="text-purple-300 shrink-0"><GripVertical className="w-3.5 h-3.5" /></span>
      <span className="px-1.5 py-0.5 rounded bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 text-[9px] font-bold shrink-0">TABA</span>
      <div className="min-w-0 flex-1"><div className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200 truncate">{t.cod_componente}</div><div className="text-[11px] text-slate-500 truncate" title={t.descricao}>{t.descricao || '—'}</div><div className="text-[9px] text-purple-500/80 truncate">Prod {t.cod_item} · seq {t.sequencia}</div></div>
      <span className="px-2 py-0.5 rounded-md bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 text-xs font-semibold tabular-nums shrink-0">{num(t.qtd)}</span>
    </div>
  );
};
// Caixa droppable das tabas de UMA máquina Sopro (aceita arrastar para dentro/reordenar).
const TabaZone: React.FC<{ maqId: number; cards: TabaSoproCard[]; onTabaDados?: (card: TabaSoproCard) => void }> = ({ maqId, cards, onTabaDados }) => {
  const id = `tabazone::${maqId}`;
  const { setNodeRef, isOver } = useDroppable({ id });
  const ids = cards.map(tabaKey);
  return (
    <div className={`rounded-lg ring-1 ${isOver ? 'ring-purple-400' : 'ring-purple-200 dark:ring-purple-900/50'} bg-purple-50/50 dark:bg-purple-950/20 p-2`}>
      <div className="flex items-center gap-1.5 mb-1.5"><Package className="w-3.5 h-3.5 text-purple-600" /><span className="text-[10px] font-bold uppercase tracking-wide text-purple-600 dark:text-purple-300">Tabas geradas</span><span className="ml-auto px-1.5 py-0.5 rounded-full bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 text-[10px] font-bold">{cards.length}</span></div>
      <SortableContext id={id} items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="space-y-1.5 min-h-[40px]">
          {cards.map(t => <TabaCard key={tabaKey(t)} t={t} onDados={onTabaDados} />)}
          {cards.length === 0 && <div className="text-[10px] text-slate-400 text-center py-3 border border-dashed border-purple-200 dark:border-purple-900/50 rounded-lg">arraste tabas aqui</div>}
        </div>
      </SortableContext>
    </div>
  );
};

// Bloco droppable de UM lote dentro da máquina
const LoteBlock: React.FC<{
  contId: string; lote: LoteInfo; cods: string[]; byCod: Record<string, PlanoRow>;
  qtdDe: (c: string) => number; opCount: (c: string) => number; ativoDe: (c: string) => boolean; temObs: (c: string) => boolean;
  sel: Set<string>; onToggleSel: (c: string) => void; onDados: (c: string) => void; onOps: (c: string) => void;
  onData: (v: string) => void; onDataFim: (v: string) => void; tempoEstH: number | null; fimPlanejado?: string | null; onRemover?: () => void;
  avisoTabaDe?: (c: string) => string | null;
  criticoDe?: (c: string) => { qtd: number; n: number; valor: number } | null;
  concluidoDe?: (c: string) => boolean; qtdProdDe?: (c: string) => number | null; onConcluido?: (c: string) => void; onQtdProd?: (c: string, v: string) => void; onGerarSaldo?: (c: string) => void;
}> = ({ contId, lote, cods, byCod, qtdDe, opCount, ativoDe, temObs, sel, onToggleSel, onDados, onOps, onData, onDataFim, tempoEstH, fimPlanejado, onRemover, avisoTabaDe, criticoDe, concluidoDe, qtdProdDe, onConcluido, onQtdProd, onGerarSaldo }) => {
  const { setNodeRef, isOver } = useDroppable({ id: contId });
  return (
    <div className={`rounded-lg ring-1 ${isOver ? 'ring-blue-400' : 'ring-slate-200 dark:ring-slate-700'} bg-white/60 dark:bg-slate-900/30`}>
      <div className="px-2 py-1.5 border-b border-slate-100 dark:border-slate-700/60 space-y-1.5">
        {/* topo: rótulo do lote + contador + remover */}
        <div className="flex items-center gap-1.5">
          <CalendarClock className="w-3.5 h-3.5 text-blue-500 shrink-0" />
          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">Lote</span>
          <span className="ml-auto px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700 text-[10px] font-bold text-slate-600 dark:text-slate-200 shrink-0">{cods.length}</span>
          {onRemover && <button onClick={onRemover} disabled={cods.length > 0} title={cods.length > 0 ? 'Mova os itens antes de remover' : 'Remover lote vazio'} className="shrink-0 grid place-items-center w-5 h-5 rounded text-slate-400 hover:text-red-600 disabled:opacity-30 disabled:hover:text-slate-400"><X className="w-3.5 h-3.5" /></button>}
        </div>
        {/* início (data + hora) — input em linha própria, full-width */}
        <div>
          <label className="block text-[9px] uppercase tracking-wide text-slate-400 mb-0.5">Início</label>
          <input type="datetime-local" value={toLocalInput(lote.data)} onChange={e => onData(e.target.value ? new Date(e.target.value).toISOString() : '')} title="Início do lote (data e hora)"
            className="w-full min-w-0 px-1.5 py-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-[11px] text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/60" />
        </div>
      </div>
      <div className="px-2 py-1.5 border-b border-slate-100 dark:border-slate-700/60 bg-slate-50/80 dark:bg-slate-800/30 space-y-1.5">
        {/* estimado (só a duração) */}
        <div className="flex items-center gap-1.5 min-w-0">
          <Gauge className="w-3 h-3 text-slate-400 shrink-0" />
          <span className="text-[10px] text-slate-500 shrink-0">Estimado:</span>
          {fmtHorasLote(tempoEstH)
            ? <span className="text-[10px] font-semibold text-blue-600 dark:text-blue-300 truncate">{fmtHorasLote(tempoEstH)}</span>
            : <span className="text-[10px] text-slate-400 italic truncate">preencha peças/h</span>}
        </div>
        {/* entrega (data + hora) — calculada pelo calendário; editável p/ sobrescrever */}
        <div>
          <div className="flex items-center justify-between mb-0.5">
            <label className="block text-[9px] uppercase tracking-wide text-slate-400">Entrega</label>
            {!lote.dataFim && fimPlanejado && <span className="text-[8px] text-slate-400" title="Calculada pelo calendário">auto</span>}
          </div>
          <input type="datetime-local" value={toLocalInput(lote.dataFim || fimPlanejado)} onChange={e => onDataFim(e.target.value ? new Date(e.target.value).toISOString() : '')}
            title={lote.dataFim ? 'Entrega manual (limpe para voltar à calculada)' : 'Entrega calculada pelo calendário. Edite para sobrescrever.'}
            className={`w-full px-1.5 py-1 rounded-md border text-[10px] text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500/60 ${lote.dataFim ? 'border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30' : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900'}`} />
        </div>
      </div>
      <SortableContext id={contId} items={cods} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="min-h-[56px] p-1.5 space-y-2">
          {cods.map((c, i) => byCod[c] && <Card key={c} cod={c} item={byCod[c]} pos={i + 1} qtd={qtdDe(c)} opN={opCount(c)} ativo={ativoDe(c)} temObs={temObs(c)} selected={sel.has(c)} onToggleSel={onToggleSel} onDados={onDados} onOps={onOps} avisoTaba={avisoTabaDe ? avisoTabaDe(c) : null} critico={criticoDe ? criticoDe(c) : null} concluido={concluidoDe ? concluidoDe(c) : false} qtdProduzida={qtdProdDe ? qtdProdDe(c) : null} onConcluido={onConcluido} onQtdProd={onQtdProd} onGerarSaldo={onGerarSaldo} />)}
          {cods.length === 0 && <div className="text-[11px] text-slate-400 text-center py-4 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">arraste aqui</div>}
        </div>
      </SortableContext>
    </div>
  );
};

// Alça de redimensionar largura de coluna (arraste a borda direita).
const ResizeHandle: React.FC<{ base: number; onResize: (px: number) => void; onCommit?: () => void }> = ({ base, onResize, onCommit }) => {
  const startX = useRef(0); const baseRef = useRef(base);
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault(); e.stopPropagation();
    startX.current = e.clientX; baseRef.current = base;
    const move = (ev: PointerEvent) => onResize(Math.max(200, Math.min(760, baseRef.current + (ev.clientX - startX.current))));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); onCommit?.(); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  return <div onPointerDown={onDown} title="Arraste para ajustar a largura" className="absolute top-0 right-0 z-20 h-full w-2 cursor-col-resize hover:bg-blue-400/50 active:bg-blue-500/60 rounded-r-xl" />;
};

const Column: React.FC<{
  id: string; titulo: string; subtitulo?: string; cor: string; corHex?: string | null; Icon: React.ComponentType<{ className?: string }>;
  cods?: string[]; byCod: Record<string, PlanoRow>; qtdDe: (c: string) => number; opCount: (c: string) => number;
  ativoDe: (c: string) => boolean; temObs: (c: string) => boolean;
  sel: Set<string>; onToggleSel: (c: string) => void;
  onDados: (c: string) => void; onOps: (c: string) => void; minWidth?: string;
  widthPx?: number; onResize?: (px: number) => void; onResizeCommit?: () => void;
  // máquina (com lotes):
  maqId?: number; lotes?: LoteInfo[]; codsDoLote?: (lote: number) => string[];
  onLoteData?: (lote: number, v: string) => void; onLoteDataFim?: (lote: number, v: string) => void;
  tempoEstH?: (lote: number) => number | null; fimPlanejado?: (lote: number) => string | null;
  onNovoLote?: () => void; onRemoverLote?: (lote: number) => void;
  onPdf?: () => void; onLimpar?: () => void; onAbrir?: () => void; dragHandle?: any; realce?: 'ok' | 'no' | null;
  tabasGeradas?: TabaSoproCard[]; onTabaDados?: (card: TabaSoproCard) => void; avisoTabaDe?: (c: string) => string | null;
  criticoDe?: (c: string) => { qtd: number; n: number; valor: number } | null; ehSopro?: boolean;
  concluidoDe?: (c: string) => boolean; qtdProdDe?: (c: string) => number | null; onConcluido?: (c: string) => void; onQtdProd?: (c: string, v: string) => void; onGerarSaldo?: (c: string) => void;
  semProgresso?: boolean;
  semCadastroPhDe?: (c: string) => boolean;
}> = ({ id, titulo, subtitulo, cor, corHex, Icon, cods, byCod, qtdDe, opCount, ativoDe, temObs, sel, onToggleSel, onDados, onOps, minWidth, widthPx, onResize, onResizeCommit, maqId, lotes, codsDoLote, onLoteData, onLoteDataFim, tempoEstH, fimPlanejado, onNovoLote, onRemoverLote, onPdf, onLimpar, onAbrir, dragHandle, realce, tabasGeradas, onTabaDados, avisoTabaDe, criticoDe, ehSopro, concluidoDe, qtdProdDe, onConcluido, onQtdProd, onGerarSaldo, semProgresso, semCadastroPhDe }) => {
  const { setNodeRef, isOver } = useDroppable({ id });
  const ehMaquina = lotes !== undefined && codsDoLote !== undefined;
  const totalMaq = ehMaquina ? lotes!.reduce((s, l) => s + codsDoLote!(l.lote).length, 0) : (cods?.length || 0);
  const realceCls = realce === 'ok' ? 'ring-2 ring-emerald-400' : realce === 'no' ? 'ring-2 ring-red-300 opacity-50' : (isOver ? 'ring-blue-400' : 'ring-slate-200 dark:ring-slate-700');
  return (
    <div style={widthPx ? { width: widthPx } : undefined} className={`relative flex flex-col ${widthPx ? '' : (minWidth || 'w-64')} shrink-0 rounded-xl ring-1 ${realceCls} bg-slate-50/70 dark:bg-slate-800/50`}>
      {onResize && <ResizeHandle base={widthPx || 256} onResize={onResize} onCommit={onResizeCommit} />}
      <div style={corHex ? { background: corHex } : undefined} className={`flex items-center gap-2 px-3 py-2.5 rounded-t-xl ${corHex ? 'text-white' : cor} ${onAbrir ? 'cursor-pointer' : ''}`} onClick={onAbrir} title={onAbrir ? 'Abrir programação da máquina' : undefined}>
        {dragHandle && <span {...dragHandle} onClick={(e: any) => e.stopPropagation()} className="cursor-grab active:cursor-grabbing -ml-1 mr-0.5 opacity-80 hover:opacity-100" title="Arraste para reordenar a máquina"><GripVertical className="w-4 h-4" /></span>}
        <Icon className="w-4 h-4" />
        <span className="text-sm font-bold truncate" title={titulo}>{titulo}</span>
        <span className="px-1.5 py-0.5 rounded-full bg-white/70 dark:bg-slate-900/40 text-[11px] font-bold text-slate-600 dark:text-slate-200">{totalMaq}</span>
        <div className="ml-auto flex items-center gap-1">
          {onNovoLote && <button onClick={(e) => { e.stopPropagation(); onNovoLote(); }} title="Nova programação (novo lote/data)" className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-white/20 hover:bg-white/30"><PlusCircle className="w-4 h-4" /></button>}
          {onPdf && <button onClick={(e) => { e.stopPropagation(); onPdf(); }} title="Gerar PDF desta máquina" className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-white/20 hover:bg-white/30"><FileDown className="w-4 h-4" /></button>}
          {onLimpar && <button onClick={(e) => { e.stopPropagation(); onLimpar(); }} title="Limpar esta máquina (devolve os itens para A programar)" className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-white/20 hover:bg-white/30"><Trash2 className="w-4 h-4" /></button>}
        </div>
      </div>
      {subtitulo && <div className="px-3 pt-1.5 text-[11px] text-slate-400">{subtitulo}</div>}
      {ehMaquina ? (
        <div className="flex-1 p-2 space-y-2 overflow-auto max-h-[calc(100vh-300px)]">
          {lotes!.map(l => (
            <LoteBlock key={l.lote} contId={lkey(maqId!, l.lote)} lote={l} cods={codsDoLote!(l.lote)} byCod={byCod}
              qtdDe={qtdDe} opCount={opCount} ativoDe={ativoDe} temObs={temObs} sel={sel} onToggleSel={onToggleSel}
              onDados={onDados} onOps={onOps} onData={(v) => onLoteData!(l.lote, v)}
              onDataFim={(v) => onLoteDataFim!(l.lote, v)}
              tempoEstH={tempoEstH ? tempoEstH(l.lote) : null}
              fimPlanejado={fimPlanejado ? fimPlanejado(l.lote) : null}
              avisoTabaDe={avisoTabaDe} criticoDe={criticoDe}
              concluidoDe={concluidoDe} qtdProdDe={qtdProdDe} onConcluido={onConcluido} onQtdProd={onQtdProd} onGerarSaldo={onGerarSaldo}
              onRemover={onRemoverLote && lotes!.length > 1 ? () => onRemoverLote(l.lote) : undefined} />
          ))}
          {ehSopro && <TabaZone maqId={maqId!} cards={tabasGeradas || []} onTabaDados={onTabaDados} />}
        </div>
      ) : (
        <SortableContext id={id} items={cods || []} strategy={verticalListSortingStrategy}>
          <div ref={setNodeRef} className="flex-1 min-h-[80px] p-2 space-y-2 overflow-auto max-h-[calc(100vh-340px)]">
            {(cods || []).map((c, i) => byCod[c] && <Card key={c} cod={c} item={byCod[c]} pos={i + 1} qtd={qtdDe(c)} opN={opCount(c)} ativo={ativoDe(c)} temObs={temObs(c)} selected={sel.has(c)} onToggleSel={onToggleSel} onDados={onDados} onOps={onOps} avisoTaba={avisoTabaDe ? avisoTabaDe(c) : null} critico={criticoDe ? criticoDe(c) : null} concluido={concluidoDe ? concluidoDe(c) : false} qtdProduzida={qtdProdDe ? qtdProdDe(c) : null} onConcluido={onConcluido} onQtdProd={onQtdProd} onGerarSaldo={onGerarSaldo} semProgresso={semProgresso} semCadastroPh={semCadastroPhDe ? semCadastroPhDe(c) : false} />)}
            {(cods || []).length === 0 && <div className="text-[11px] text-slate-400 text-center py-6 border border-dashed border-slate-200 dark:border-slate-700 rounded-lg">arraste aqui</div>}
          </div>
        </SortableContext>
      )}
    </div>
  );
};

const SortableMachine: React.FC<{ m: Maquina; colProps: any }> = ({ m, colProps }) => {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging } = useSortable({ id: `col_${m.id}` });
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1 };
  return <div ref={setNodeRef} style={style} className="shrink-0"><Column {...colProps} dragHandle={{ ...attributes, ...listeners }} /></div>;
};

const ProgramacaoPage: React.FC = () => {
  // Só usuários da Fábrica (ou super_user/ceo) podem definir a versão oficial.
  const podeOficial = useMemo(() => {
    try {
      const u = JSON.parse(sessionStorage.getItem('empresa_user') || '{}');
      if (['super_user', 'ceo'].includes(u.role)) return true;
      const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
      return [u.sector, ...String(u.managed_sectors || '').split(/[;,]/)].some((s: string) => norm(s) === norm('Fábrica'));
    } catch { return false; }
  }, []);
  const { showToast } = useToast();
  const confirmar = useConfirm();

  const [oficiais, setOficiais] = useState<Versao[]>([]);
  const [versaoSel, setVersaoSel] = useState<Versao | null>(null);
  const [salvandoVersao, setSalvandoVersao] = useState(false);
  const [salvarModalOpen, setSalvarModalOpen] = useState(false);
  const [plano, setPlano] = useState<PlanoRow[]>([]);
  // Desdobramento por código (sequências + qtd do otimizador) — para o detalhe do item consolidado.
  const [linhasPorCod, setLinhasPorCod] = useState<Record<string, { seq: number; qtd: number }[]>>({});
  // Peças parciais: quando um item não cabe num turno, a qtd é dividida em vários cards (mesmo código).
  // Chave = ckey com sequência sintética (>= 900000). { cod, qtd parcial, seqOrig (p/ exibir OTIM) }.
  const [partes, setPartes] = useState<Record<string, { cod: string; qtd: number; seqOrig: number }>>({});
  const [maquinas, setMaquinas] = useState<Maquina[]>([]);
  const [ops, setOps] = useState<OP[]>([]);
  // 18/06: SKUs criticos vindos do Otim.Faturamento (sob demanda via botao).
  // Map<sku, {qtd_faltante_total, n_pedidos_afetados, valor_bloqueado, motivos}>
  const [criticosMap, setCriticosMap] = useState<Map<string, { qtd: number; n: number; valor: number; pedidos: any[] }>>(new Map());
  const [criticosTotais, setCriticosTotais] = useState<{ n_skus: number; n_pedidos: number; valor: number } | null>(null);
  const [criticosLoading, setCriticosLoading] = useState(false);
  const [items, setItems] = useState<Record<string, string[]>>({});
  const [qtdOverride, setQtdOverride] = useState<Record<string, number>>({});
  const [lotesPorMaq, setLotesPorMaq] = useState<Record<number, LoteInfo[]>>({});
  const [obs, setObs] = useState<Record<string, string>>({});
  const [ativoMap, setAtivoMap] = useState<Record<string, boolean>>({});
  // Previsão de término por linha (ckey -> ISO). Guarda só o override MANUAL; ausência = automático.
  const [previsaoTermino, setPrevisaoTermino] = useState<Record<string, string>>({});
  // Por card: concluído (produção feita) e quantidade já produzida (informada pelo operador).
  const [concluidoMap, setConcluidoMap] = useState<Record<string, boolean>>({});
  const [qtdProduzidaMap, setQtdProduzidaMap] = useState<Record<string, number>>({});
  // Calendário de produção (config global) usado no cálculo da previsão de término.
  const [calendarioCfg, setCalendarioCfg] = useState<CalendarioCfg>(CALENDARIO_PADRAO);
  // Overrides de calendário por máquina (maquina_id -> config). Ausente = usa o geral.
  const [calendariosMaq, setCalendariosMaq] = useState<Record<number, CalendarioCfg>>({});
  const [calConfigOpen, setCalConfigOpen] = useState(false);
  const [calDraft, setCalDraft] = useState<CalendarioCfg>(CALENDARIO_PADRAO);
  // Alvo da edição no modal: null = Geral; número = máquina.
  const [calAlvo, setCalAlvo] = useState<number | null>(null);
  // Calendário efetivo de uma máquina: override da máquina, senão o geral.
  const calDaMaquina = useCallback((maqId: number): CalendarioCfg => calendariosMaq[maqId] || calendarioCfg, [calendariosMaq, calendarioCfg]);
  const [maqModal, setMaqModal] = useState<Maquina | null>(null);
  const [maqTempos, setMaqTempos] = useState<Record<string, number | null>>({});
  // Ref espelha maqTempos para leitura síncrona dentro de salvarBoard (evita closure stale
  // após setPecasHora durante um onDragEnd async — Frente 0 parte 2).
  const maqTemposRef = useRef(maqTempos);
  useEffect(() => { maqTemposRef.current = maqTempos; }, [maqTempos]);
  // Frente 0 (17/06): modal obrigatório pedindo peças/hora ao mover card pra máquina sem cadastro.
  // Inclui multi-select de outras máquinas onde o produto também pode rodar (cadastra excecao).
  const [phPrompt, setPhPrompt] = useState<{ cod: string; descricao: string; maqId: number; maqNome: string; valor: string; outras: Set<number>; resolver: (v: { ph: number; outras: number[] } | null) => void } | null>(null);
  // Cards de taba no Sopro: 1 por (produto × sequência). Gerados pela programação automática.
  const [tabasSopro, setTabasSopro] = useState<TabaSoproCard[]>([]);
  // Tabas que precisariam de Sopro mas não têm máquina cadastrada (aviso ao gerar a programação).
  const [tabasSemSopro, setTabasSemSopro] = useState<{ cod: string; descricao: string; produtos: string[] }[]>([]);
  const [usoPorItem, setUsoPorItem] = useState<Record<string, { cod_componente: string; descricao: string; tipo_comp: string; qtd_usar: number }[]>>({});
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [ordemCol, setOrdemCol] = useState<number[]>([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [porCodigo, setPorCodigo] = useState<Record<string, number[]>>({});
  const [estruturaCache, setEstruturaCache] = useState<Record<string, { encontrado: boolean; itens: EstruturaItem[] }>>({});
  const [estruturaLoading, setEstruturaLoading] = useState(false);
  const [estruturaAberta, setEstruturaAberta] = useState(false);
  const [compUso, setCompUso] = useState<Record<string, number>>({});
  const [compSalvos, setCompSalvos] = useState<Record<string, boolean>>({});
  // Máquina (Sopro) onde cada taba é feita, por cod_componente (no item aberto no detalhe).
  const [compMaq, setCompMaq] = useState<Record<string, number | null>>({});
  // Registros de uso salvos do item aberto no detalhe (para identificar entradas manuais = fora da estrutura).
  const [usoSalvoDetalhe, setUsoSalvoDetalhe] = useState<{ cod_componente: string; descricao: string; tipo_comp: string; qtd_usar: number }[]>([]);
  // Formulário "adicionar encarte/taba manual"
  const [manTipo, setManTipo] = useState<'encarte' | 'taba'>('encarte');
  const [manCod, setManCod] = useState('');
  const [manDesc, setManDesc] = useState('');
  const [manQtd, setManQtd] = useState('');
  const [manErro, setManErro] = useState('');
  // Autocomplete do "adicionar manual": sugestões da base de estrutura (por código ou nome).
  const [manSug, setManSug] = useState<{ cod: string; text: string; unidade?: string }[]>([]);
  const [manSugOpen, setManSugOpen] = useState(false);
  // Seleção de qual encarte/taba usar por item no modal (key = `${cod}:${tipo}`, value = cod_componente)
  const [selectedComp, setSelectedComp] = useState<Record<string, string>>({});
  // Estado para "outro código" inline no modal da máquina
  const [outroKey, setOutroKey] = useState('');       // `${cod}:${tipo}` que está aberto
  const [outroCod, setOutroCod] = useState('');        // texto digitado
  const [outroBusca, setOutroBusca] = useState<{cod: string; text: string; unidade: string}[]>([]);
  const [loading, setLoading] = useState(false);
  // Expandir a página (ocupa a tela toda); botão alterna entre expandir e voltar ao normal.
  const [expandido, setExpandido] = useState(false);
  // Ajuste 4 (17/06): filtro persistente em localStorage (sobrevive entre navegações).
  const [filtro, setFiltro, limparFiltro] = useFiltroPersistente<string>('filtros:fabrica:programacao:busca', '');
  // Larguras (px) ajustáveis pelo usuário: colunas de máquina e a coluna "A programar".
  const [maqColW, setMaqColW] = useState(256);
  const [backlogColW, setBacklogColW] = useState(320);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [dadosCod, setDadosCod] = useState<string | null>(null);
  // Tendência mensal (run-rate do mês, S&OP realizado) por código — só p/ exibição no detalhamento.
  const [tendMensalMap, setTendMensalMap] = useState<Record<string, number>>({});
  const tendLoadedRef = useRef(false);
  useEffect(() => {
    if (!dadosCod || tendLoadedRef.current) return;
    tendLoadedRef.current = true;
    let cancel = false;
    api.getSopDashboardData(false).then((raw: any) => {
      if (cancel || !raw) return;
      const hoje = new Date();
      const y = hoje.getFullYear(), mo = hoje.getMonth() + 1;
      const diaHoje = hoje.getDate();
      const diasNoMes = new Date(y, mo, 0).getDate();
      const vendaMTD: Record<string, number> = {};
      (raw.realizado || []).forEach((it: any) => {
        if (!String(it.Tipo || '').toUpperCase().includes('VEND')) return;
        if (parseInt(it.Ano) !== y || parseInt(it.Mes) !== mo) return;
        const k = normCodSop(it.Codigo);
        if (!k) return;
        vendaMTD[k] = (vendaMTD[k] || 0) + cleanFloatSop(it.Qtd_Real);
      });
      const tend: Record<string, number> = {};
      Object.keys(vendaMTD).forEach(k => { tend[k] = diaHoje > 0 ? (vendaMTD[k] / diaHoje) * diasNoMes : vendaMTD[k]; });
      setTendMensalMap(tend);
    }).catch(() => { tendLoadedRef.current = false; });
    return () => { cancel = true; };
  }, [dadosCod]); // eslint-disable-line
  const [tabaDetalhe, setTabaDetalhe] = useState<TabaSoproCard | null>(null);
  const [opsCod, setOpsCod] = useState<string | null>(null);
  const [cmpOpen, setCmpOpen] = useState(false);
  const [cmpBase, setCmpBase] = useState(''); const [cmpNovo, setCmpNovo] = useState('');
  const [cmpData, setCmpData] = useState<Diff | null>(null); const [cmpLoading, setCmpLoading] = useState(false);
  // Histórico de versões salvas — lista todas as versões salvas do plano e permite restaurar no quadro atual.
  const [histOpen, setHistOpen] = useState(false);
  const [historico, setHistorico] = useState<VersaoSalva[]>([]);
  const [histLoading, setHistLoading] = useState(false);
  const [restaurandoId, setRestaurandoId] = useState<string | null>(null);

  const erro = (e: any, fb: string) => showToast(e?.message || fb, 'error');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // byCkey: keyed por "CODIGO_PRODUTO::SEQUENCIA" — suporta o mesmo produto em múltiplos cards
  const byCkey = useMemo(() => {
    const m: Record<string, PlanoRow> = {};
    const baseByCod: Record<string, PlanoRow> = {};
    for (const p of plano) { const cod = String(p.CODIGO_PRODUTO).trim(); m[ckey(cod, p.SEQUENCIA || 0)] = p; baseByCod[cod] = p; }
    // peças parciais (divisão por turno): cards extras do mesmo produto, com qtd parcial
    for (const ck of Object.keys(partes)) {
      const pt = partes[ck];
      const base = baseByCod[pt.cod];
      m[ck] = { ...(base || ({} as PlanoRow)), CODIGO_PRODUTO: pt.cod, SEQUENCIA: pt.seqOrig, QTD_PRODUZIR: pt.qtd } as PlanoRow;
    }
    return m;
  }, [plano, partes]);
  // byCod: keyed por CODIGO_PRODUTO — usado para lookups de estrutura, OPs, peças/hora (não dependem da sequência)
  const byCod = useMemo(() => { const m: Record<string, PlanoRow> = {}; for (const p of plano) m[String(p.CODIGO_PRODUTO).trim()] = p; return m; }, [plano]);
  const qtdDe = useCallback((c: string) => {
    const cod = codDe(c);
    return qtdOverride[c] ?? byCkey[c]?.QTD_PRODUZIR ?? byCod[cod]?.QTD_PRODUZIR ?? 0;
  }, [qtdOverride, byCkey, byCod]);

  const opsPorCodigo = useMemo(() => { const m = new Map<string, OP[]>(); for (const o of ops) { const k = (o.codigo || '').trim(); if (!m.has(k)) m.set(k, []); m.get(k)!.push(o); } return m; }, [ops]);
  const opCount = useCallback((c: string) => (opsPorCodigo.get(codDe(c))?.length || 0), [opsPorCodigo]);

  const carregarOps = useCallback(async (refresh = false) => {
    if (!refresh && cacheOps) { setOps(cacheOps); return; }
    const { data } = await api.get('/programacao/ops', { params: { refresh } });
    cacheOps = data.ops || []; setOps(cacheOps);
  }, []);

  const carregarVersao = useCallback(async (v: Versao, refresh = false) => {
    setLoading(true);
    try {
      let pl: PlanoRow[];
      if (cachePlano[v.id] && !refresh) pl = cachePlano[v.id].plano;
      else { const { data } = await api.get('/programacao/plano', { params: { versao_id: v.id } }); cachePlano[v.id] = { plano: data.plano || [], versao: data.versao || v }; pl = cachePlano[v.id].plano; }
      // Cada linha do otimizador vira um card próprio (o mesmo produto pode aparecer em sequências
      // diferentes): NÃO somamos a qtd nem consolidamos. O desdobramento por sequência é apenas
      // informação exibida no detalhe (duplo clique).
      const linhasMap: Record<string, { seq: number; qtd: number }[]> = {};
      for (const p of pl) { const c = String(p.CODIGO_PRODUTO).trim(); (linhasMap[c] = linhasMap[c] || []).push({ seq: p.SEQUENCIA || 0, qtd: Number(p.QTD_PRODUZIR) || 0 }); }
      Object.values(linhasMap).forEach(rows => rows.sort((a, b) => a.seq - b.seq));
      setLinhasPorCod(linhasMap);
      setPlano(pl); setVersaoSel(v); localStorage.setItem(lsKey(), v.id);
      const codigos = pl.map(p => String(p.CODIGO_PRODUTO).trim());
      const [{ data: sug }, { data: bd }] = await Promise.all([
        api.post('/programacao/sugestoes', { codigos }),
        api.get('/programacao/board', { params: { versao_id: v.id } }),
      ]);
      const maqs: Maquina[] = sug.maquinas || [];
      setMaquinas(maqs);
      setPorCodigo(sug.por_codigo || {});
      // Peças/hora de TODAS as máquinas, para o board calcular o término (estimado) sem abrir o modal.
      Promise.all(maqs.map(m => api.get('/programacao/tempos-maquina', { params: { maquina_id: m.id } })
        .then(r => r.data.tempos || {}).catch(() => ({}))))
        .then(arr => { const merged: Record<string, number | null> = {}; arr.forEach(t => Object.assign(merged, t)); setMaqTempos(merged); })
        .catch(() => { /* mantém vazio */ });
      await carregarOps(refresh);
      // ---- Lotes por máquina (a partir de bd.lotes; fallback bd.maquinas/legado) ----
      const maqIds = new Set(maqs.map(m => m.id));
      const lpm: Record<number, LoteInfo[]> = {};
      maqs.forEach(m => { lpm[m.id] = []; });
      (bd.lotes || []).forEach((l: any) => {
        if (!maqIds.has(l.maquina_id)) return;
        lpm[l.maquina_id].push({ lote: Number(l.lote) || 0, data: l.data_inicio || '', dataFim: l.data_fim || '', ordem: Number(l.ordem) || 0 });
      });
      // legado: máquinas com data_inicio sem lotes viram lote 0
      (bd.maquinas || []).forEach((m: any) => {
        if (!maqIds.has(m.maquina_id)) return;
        if (lpm[m.maquina_id].length === 0 && m.data_inicio) lpm[m.maquina_id].push({ lote: 0, data: m.data_inicio, ordem: 0 });
      });

      // montagem: board manda; o resto fica no backlog (sem sugestão)
      const cont: Record<string, string[]> = { [BACKLOG]: [] };
      // bmap keyed por "cod_item::sequencia" — suporta múltiplas linhas do mesmo produto
      const bmap = new Map((bd.itens || []).map((b: any) => [ckey(b.cod_item, b.sequencia || 0), b]));
      // Peças parciais salvas (sequência sintética >= 900000): cards parciais do mesmo produto (divisão por turno).
      const partesMap: Record<string, { cod: string; qtd: number; seqOrig: number }> = {};
      const splitCods = new Set<string>();
      const seqOrigMap: Record<string, number> = {};
      pl.forEach(p => { seqOrigMap[String(p.CODIGO_PRODUTO).trim()] = p.SEQUENCIA || 0; });
      (bd.itens || []).forEach((b: any) => {
        const sq = Number(b.sequencia);
        if (sq >= 900000) {                 // split por turno: substitui o card inteiro do produto
          const cod = String(b.cod_item).trim();
          splitCods.add(cod);
          partesMap[ckey(cod, sq)] = { cod, qtd: Number(b.qtd) || 0, seqOrig: seqOrigMap[cod] ?? (sq || 0) };
        } else if (sq >= 800000) {          // saldo (gerado ao informar produção): card adicional, NÃO substitui o original
          const cod = String(b.cod_item).trim();
          partesMap[ckey(cod, sq)] = { cod, qtd: Number(b.qtd) || 0, seqOrig: seqOrigMap[cod] ?? (sq || 0) };
        }
      });
      setPartes(partesMap);
      // garante lotes para todo lote referenciado por itens
      (bd.itens || []).forEach((b: any) => {
        if (!maqIds.has(b.maquina_id)) return;
        const lote = Number(b.lote) || 0;
        if (!lpm[b.maquina_id].some(l => l.lote === lote)) lpm[b.maquina_id].push({ lote, data: '', ordem: lote });
      });
      // toda máquina precisa de ao menos 1 lote (lote 0) para permitir soltar
      maqs.forEach(m => { if (lpm[m.id].length === 0) lpm[m.id].push({ lote: 0, data: '', ordem: 0 }); });
      // ordena lotes e cria containers
      maqs.forEach(m => {
        lpm[m.id].sort((a, b) => (a.ordem - b.ordem) || (a.lote - b.lote));
        lpm[m.id].forEach(l => { cont[lkey(m.id, l.lote)] = []; });
      });
      const ordSorted = [...pl].sort((a, b) => (a.SEQUENCIA || 0) - (b.SEQUENCIA || 0));
      for (const it of ordSorted) {
        const cod = String(it.CODIGO_PRODUTO).trim();
        if (splitCods.has(cod)) continue;   // produto dividido: representado pelas peças parciais
        const ck = ckey(cod, it.SEQUENCIA || 0);
        const b: any = bmap.get(ck);
        const k = b ? lkey(b.maquina_id, Number(b.lote) || 0) : null;
        if (k && cont[k]) cont[k].push(ck);
        else cont[BACKLOG].push(ck);
      }
      // posiciona as peças sintéticas salvas (split por turno >=900000 e saldo 800000–899999).
      // Saldo fica em "A programar" (salvo com maquina_id=0); se foi arrastado para uma máquina, vai para o lote.
      (bd.itens || []).forEach((b: any) => {
        const sq = Number(b.sequencia);
        if (sq < 800000) return;
        const ck = ckey(String(b.cod_item).trim(), sq);
        if (maqIds.has(b.maquina_id)) {
          const k = lkey(b.maquina_id, Number(b.lote) || 0);
          if (cont[k]) { cont[k].push(ck); return; }
        }
        cont[BACKLOG].push(ck);
      });
      // ordena itens dentro de cada lote usando a chave ckey
      Object.keys(cont).forEach(k => { if (k !== BACKLOG) cont[k].sort((c1, c2) => ((bmap.get(c1) as any)?.ordem ?? 0) - ((bmap.get(c2) as any)?.ordem ?? 0)); });
      setLotesPorMaq(lpm);
      setItems(cont);
      // overrides de quantidade, obs e ativo — keyed por ckey
      const qo: Record<string, number> = {}; const ob: Record<string, string> = {}; const at: Record<string, boolean> = {};
      const pt: Record<string, string> = {}; const cm: Record<string, boolean> = {}; const qp: Record<string, number> = {};
      (bd.itens || []).forEach((b: any) => {
        const ck = ckey(b.cod_item, b.sequencia || 0);
        if (b.qtd !== null && b.qtd !== undefined) qo[ck] = Number(b.qtd);
        if (b.observacao) ob[ck] = b.observacao;
        at[ck] = b.ativo === false ? false : true;
        if (b.previsao_termino) pt[ck] = b.previsao_termino;  // só manuais vêm preenchidos
        if (b.concluido) cm[ck] = true;
        if (b.qtd_produzida !== null && b.qtd_produzida !== undefined) qp[ck] = Number(b.qtd_produzida);
      });
      setQtdOverride(qo); setObs(ob); setAtivoMap(at); setPrevisaoTermino(pt); setConcluidoMap(cm); setQtdProduzidaMap(qp);
      return true;
    } catch (e) { erro(e, 'Erro ao carregar a versão'); return false; }
    finally { setLoading(false); }
  }, [carregarOps]); // eslint-disable-line

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data } = await api.get('/programacao/versoes-oficiais');
        const ofs: Versao[] = data.versoes || []; setOficiais(ofs);
        const saved = localStorage.getItem(lsKey());
        // Restaura a versão que o usuário estava usando (localStorage). Se houver uma versão
        // oficial mais NOVA, o aviso de "nova versão oficial" (banner + modal) aparece e o
        // usuário decide se carrega/compara — em vez de trocar a versão por baixo dele.
        // Fallback (1º acesso sem versão salva, ou versão salva inválida/apagada): oficial mais nova.
        let ok = false;
        if (saved) ok = await carregarVersao({ id: saved } as Versao);
        if (!ok && ofs.length > 0) ok = await carregarVersao(ofs[0]);
        if (!ok) setLoading(false);
      } catch (e) { erro(e, 'Erro ao carregar versões'); setLoading(false); }
    })();
  }, []); // eslint-disable-line

  const novaVersao = useMemo(() => { if (!versaoSel || oficiais.length === 0) return null; return oficiais[0].id !== versaoSel.id ? oficiais[0] : null; }, [oficiais, versaoSel]);

  // Abre o modal de aviso UMA vez por versão nova (não reabre a cada vez que entra na aba).
  useEffect(() => {
    if (!novaVersao) return;
    const k = `programacao:notif:${userKey()}`;
    if (localStorage.getItem(k) === novaVersao.id) return;
    localStorage.setItem(k, novaVersao.id);
    setNotifOpen(true);
  }, [novaVersao]); // eslint-disable-line

  const salvarBoard = useCallback((opts?: { conts?: Record<string, string[]>; qtdMap?: Record<string, number>; lotesM?: Record<number, LoteInfo[]>; obsMap?: Record<string, string>; ativoM?: Record<string, boolean>; ptMap?: Record<string, string>; concluidoM?: Record<string, boolean>; qtdProdM?: Record<string, number> }) => {
    if (!versaoSel) return;
    const conts = opts?.conts || items;
    const qtdMap = opts?.qtdMap || qtdOverride;
    const lpm = opts?.lotesM || lotesPorMaq;
    const obsMap = opts?.obsMap || obs;
    const atM = opts?.ativoM || ativoMap;
    const ptM = opts?.ptMap || previsaoTermino;
    const cM = opts?.concluidoM || concluidoMap;
    const qpM = opts?.qtdProdM || qtdProduzidaMap;
    const itensPayload: any[] = [];
    const lotesPayload: any[] = [];
    maquinas.forEach(m => {
      const cal = calDaMaquina(m.id);
      // Frente 0 (17/06): cascata data_inicio entre lotes da máquina — 1º lote sem data
      // ancora em now(); lotes seguintes sem data herdam o término do lote anterior.
      let lastFim: string | null = null;
      (lpm[m.id] || []).forEach(l => {
        const dataInicio: string | null = l.data || lastFim || new Date().toISOString();
        lotesPayload.push({ maquina_id: m.id, lote: l.lote, data_inicio: dataInicio, data_fim: l.dataFim || null, ordem: l.ordem });
        // Cursor cumulativo dentro do lote para previsão automática por item.
        let cursor: string | null = dataInicio;
        let prevCod: string | null = null;
        (conts[lkey(m.id, l.lote)] || []).forEach((c, idx) => {
          const cod = codDe(c);
          const seq = seqDe(c);
          const qty = qtdMap[c] ?? byCkey[c]?.QTD_PRODUZIR ?? byCod[cod]?.QTD_PRODUZIR ?? 0;
          const ativo = atM[c] === false ? false : true;
          const ph = maqTemposRef.current[cod] ?? null;
          // Override manual tem precedência; senão calcula via calcFimPlanejado (setup só na troca de produto).
          let pt: string | null = ptM[c] || null;
          if (!pt && ativo && cursor && ph && ph > 0) {
            const f = calcFimPlanejado(cursor, qty, ph, cal, cod !== prevCod);
            if (f) pt = f;
          }
          if (ativo && pt) { cursor = pt; prevCod = cod; }
          itensPayload.push({ cod_item: cod, sequencia: seq, maquina_id: m.id, ordem: idx, lote: l.lote, qtd: qty, observacao: obsMap[c] || null, ativo, previsao_termino: pt, concluido: cM[c] === true, qtd_produzida: qpM[c] ?? null });
        });
        if (cursor) lastFim = cursor;
      });
    });
    // Cards de saldo (peças sintéticas 800000–899999) que estão em "A programar": persistem com
    // maquina_id=0 para não se perderem no refresh (o restante do backlog é reconstruído do plano).
    (conts[BACKLOG] || []).forEach((c, idx) => {
      const seq = seqDe(c);
      if (seq < 800000 || seq >= 900000) return;
      const cod = codDe(c);
      itensPayload.push({ cod_item: cod, sequencia: seq, maquina_id: 0, ordem: idx, lote: 0, qtd: qtdMap[c] ?? byCkey[c]?.QTD_PRODUZIR ?? 0, observacao: obsMap[c] || null, ativo: atM[c] === false ? false : true, previsao_termino: ptM[c] || null, concluido: cM[c] === true, qtd_produzida: qpM[c] ?? null });
    });
    api.put('/programacao/board', { versao_id: versaoSel.id, itens: itensPayload, lotes: lotesPayload }).catch(e => erro(e, 'Erro ao salvar a montagem'));
  }, [versaoSel, items, qtdOverride, lotesPorMaq, obs, ativoMap, previsaoTermino, concluidoMap, qtdProduzidaMap, maquinas, byCkey, byCod, maqTempos]); // eslint-disable-line

  const setObservacao = (cod: string, val: string) => setObs(prev => { const n = { ...prev, [cod]: val }; setTimeout(() => salvarBoard({ obsMap: n }), 0); return n; });
  // Previsão de término manual: iso preenche (override); vazio remove (volta ao automático).
  const setPrevisao = (cod: string, iso: string) => setPrevisaoTermino(prev => { const n = { ...prev }; if (iso) n[cod] = iso; else delete n[cod]; setTimeout(() => salvarBoard({ ptMap: n }), 0); return n; });
  const toggleAtivo = (cod: string) => setAtivoMap(prev => { const n = { ...prev, [cod]: prev[cod] === false ? true : false }; setTimeout(() => salvarBoard({ ativoM: n }), 0); return n; });
  const ativoDe = (cod: string) => ativoMap[cod] !== false;
  // Concluído e quantidade já produzida por card (persistem no board).
  const toggleConcluido = (ck: string) => setConcluidoMap(prev => { const n = { ...prev, [ck]: !prev[ck] }; setTimeout(() => salvarBoard({ concluidoM: n }), 0); return n; });
  const setQtdProduzida = (ck: string, val: string) => setQtdProduzidaMap(prev => {
    const n = { ...prev }; const v = val.trim() === '' ? NaN : Number(val.replace(',', '.'));
    if (isNaN(v) || v < 0) delete n[ck]; else n[ck] = v;
    setTimeout(() => salvarBoard({ qtdProdM: n }), 0); return n;
  });
  // Gerar saldo: ao informar a qtd produzida, divide o card — o atual fica com a qtd produzida e
  // o que falta (saldo) vira um card novo em "A programar" para uma nova programação.
  // O saldo é uma "peça parcial" sintética na faixa 800000–899999 (distinta do split por turno >=900000,
  // que substitui o card inteiro). Persiste no backlog com maquina_id=0 (ver salvarBoard/carregarVersao).
  const gerarSaldo = (ck: string) => {
    const prod = qtdProduzidaMap[ck];
    const total = qtdDe(ck);
    if (!prod || prod <= 0) { showToast('Informe a quantidade produzida antes de gerar o saldo.', 'error'); return; }
    if (prod >= total) { showToast('A quantidade produzida já cobre todo o card — não há saldo a programar.', 'info'); return; }
    const saldo = Math.round((total - prod) * 1e6) / 1e6;
    const cod = codDe(ck);
    const seqOrig = byCkey[ck]?.SEQUENCIA ?? seqDe(ck);
    const usados = new Set<number>(Object.keys(partes).map(k => seqDe(k)));
    let sseq = 800000; while (usados.has(sseq)) sseq++;   // próxima sequência sintética de saldo livre
    const saldoCk = ckey(cod, sseq);
    const novasPartes = { ...partes, [saldoCk]: { cod, qtd: saldo, seqOrig } };
    // qtdOverride: original vira a qtd produzida; saldo guarda sua qtd (não depende do byCkey recalcular).
    const novoQO = { ...qtdOverride, [ck]: prod, [saldoCk]: saldo };
    const novosItems = { ...items, [BACKLOG]: [saldoCk, ...(items[BACKLOG] || [])] };
    setPartes(novasPartes);
    setQtdOverride(novoQO);
    setItems(novosItems);
    setTimeout(() => salvarBoard({ conts: novosItems, qtdMap: novoQO }), 0);
    showToast(`Saldo de ${num(saldo)} criado em "A programar".`, 'success');
  };
  const toggleSelCard = (cod: string) => setSel(prev => { const n = new Set(prev); n.has(cod) ? n.delete(cod) : n.add(cod); return n; });
  const dragRealce = (maqId: number): 'ok' | 'no' | null => {
    if (!activeId || !byCkey[activeId]) return null;
    const a = porCodigo[codDe(activeId)] || [];
    if (a.length === 0) return null;
    return a.includes(maqId) ? 'ok' : 'no';
  };
  useEffect(() => { setEstruturaAberta(false); }, [dadosCod]);

  const carregarEstrutura = async (ck: string) => {
    setEstruturaAberta(true);
    const cod = codDe(ck);
    if (estruturaCache[cod]) return;
    setEstruturaLoading(true);
    try {
      const resp = await api.estruturaProduto(cod);
      setEstruturaCache(prev => ({ ...prev, [cod]: { encontrado: !!resp?.encontrado, itens: resp?.itens || [] } }));
    } catch (e) {
      setEstruturaCache(prev => ({ ...prev, [cod]: { encontrado: false, itens: [] } }));
      erro(e, 'Erro ao carregar a estrutura');
    } finally { setEstruturaLoading(false); }
  };

  // Ao abrir o detalhe: carrega a estrutura (base do encarte/taba) e o uso salvo dos componentes.
  // Limpa o estado a cada troca de item para não vazar dados entre itens.
  useEffect(() => {
    setCompUso({});
    setCompSalvos({});
    setCompMaq({});
    setUsoSalvoDetalhe([]);
    setManTipo('encarte'); setManCod(''); setManDesc(''); setManQtd(''); setManErro(''); setManSug([]); setManSugOpen(false);
    if (!dadosCod) return;
    const cod = codDe(dadosCod);
    if (!estruturaCache[cod]) {
      api.estruturaProduto(cod)
        .then(resp => setEstruturaCache(prev => prev[cod] ? prev : ({ ...prev, [cod]: { encontrado: !!resp?.encontrado, itens: resp?.itens || [] } })))
        .catch(() => { /* silencioso: estrutura é exibida sob demanda */ });
    }
    if (versaoSel) {
      api.getUsoComponentes(String(versaoSel.id), cod)
        .then(resp => {
          const map: Record<string, number> = {};
          const maq: Record<string, number | null> = {};
          (resp?.itens || []).forEach(it => { map[it.cod_componente] = it.qtd_usar; maq[it.cod_componente] = it.maquina_id ?? null; });
          setCompUso(map);
          setCompMaq(maq);
          setUsoSalvoDetalhe((resp?.itens || []).map(it => ({ cod_componente: it.cod_componente, descricao: it.descricao, tipo_comp: it.tipo_comp, qtd_usar: it.qtd_usar })));
        })
        .catch(() => { /* sem uso salvo ainda */ });
    }
  }, [dadosCod, versaoSel]); // eslint-disable-line

  const componentesEncarteTaba = useMemo(() => {
    if (!dadosCod) return [] as { item: EstruturaItem; tipo: 'encarte' | 'taba' }[];
    return derivarEncarteTaba(estruturaCache[codDe(dadosCod)]?.itens || []);
  }, [dadosCod, estruturaCache]);

  // Máquinas Sopro (onde as tabas são produzidas) — opções do seletor de máquina da taba.
  const soproMaquinas = useMemo(() => maquinas.filter(m => /sopro/i.test(m.nome)), [maquinas]);
  // Sugestão de máquina Sopro de uma taba: se a taba já está cadastrada em alguma Sopro, sugere-a.
  const sugestaoMaqTaba = useCallback((cod: string): number | '' => {
    const sop = new Set(soproMaquinas.map(m => m.id));
    return (porCodigo[cod] || []).find(id => sop.has(id)) ?? '';
  }, [porCodigo, soproMaquinas]);

  // Tabas com Sopro definido -> cards na caixa do Sopro.
  const carregarTabasSopro = useCallback((vid?: string) => {
    const id = vid || (versaoSel ? String(versaoSel.id) : '');
    if (!id) { setTabasSopro([]); return; }
    api.getTabasSopro(id).then(r => setTabasSopro(r?.tabas || [])).catch(() => setTabasSopro([]));
  }, [versaoSel]);
  useEffect(() => { carregarTabasSopro(); }, [carregarTabasSopro]);
  // Limpa o aviso de tabas sem Sopro ao trocar de versão (é recalculado ao gerar a programação).
  useEffect(() => { setTabasSemSopro([]); }, [versaoSel]);
  // Mapa produto -> texto do aviso (tabas sem máquina Sopro), para o ícone de aviso no card.
  const avisoTabaPorProduto = useMemo(() => {
    const m: Record<string, string[]> = {};
    tabasSemSopro.forEach(t => t.produtos.forEach(p => { (m[p] = m[p] || []).push(`${t.cod} ${t.descricao}`); }));
    const out: Record<string, string> = {};
    Object.entries(m).forEach(([p, tabas]) => { out[p] = `Taba(s) sem máquina Sopro cadastrada (não geraram card): ${tabas.join('; ')}`; });
    return out;
  }, [tabasSemSopro]);
  const avisoTabaDe = useCallback((ck: string) => avisoTabaPorProduto[codDe(ck)] || null, [avisoTabaPorProduto]);
  const concluidoDe = useCallback((ck: string) => concluidoMap[ck] === true, [concluidoMap]);
  const qtdProdDe = useCallback((ck: string) => (qtdProduzidaMap[ck] ?? null), [qtdProduzidaMap]);
  // Início/término encadeado de cada card de taba por máquina Sopro (início = quando gerou; término
  // conforme peças/hora da taba + calendário). Encadeia na ordem do card dentro da máquina.
  const tabaTimes = useMemo(() => {
    const out: Record<string, { inicio: string | null; termino: string | null }> = {};
    const byMaq: Record<number, TabaSoproCard[]> = {};
    tabasSopro.forEach(t => { (byMaq[t.maquina_id] = byMaq[t.maquina_id] || []).push(t); });
    Object.values(byMaq).forEach(cards => {
      const sorted = [...cards].sort((a, b) => (a.lote - b.lote) || (a.ordem - b.ordem) || (a.sequencia - b.sequencia));
      let cursor: string | null = sorted[0]?.inicio || null; let prev: string | null = null;
      for (const c of sorted) {
        const ph = maqTempos[c.cod_componente] ?? null;
        const ini = cursor;
        const fim = (ini && ph && ph > 0) ? calcFimPlanejado(ini, c.qtd, ph, calDaMaquina(c.maquina_id), c.cod_componente !== prev) : null;
        out[`${c.cod_item}::${c.sequencia}::${c.cod_componente}`] = { inicio: ini, termino: fim };
        cursor = fim || ini; prev = c.cod_componente;   // setup só na troca de taba
      }
    });
    return out;
  }, [tabasSopro, maqTempos, calDaMaquina]);
  // Término planejado por card no board (encadeado por lote, setup só na troca) — base do aviso de atraso.
  const fimPorCard = useMemo(() => {
    const out: Record<string, string | null> = {};
    maquinas.forEach(m => {
      (lotesPorMaq[m.id] || []).forEach(l => {
        const cods = items[lkey(m.id, l.lote)] || [];
        if (!l.data) { cods.forEach(c => { out[c] = null; }); return; }
        let cursor = l.data; let prev: string | null = null;
        for (const c of cods) {
          if (!ativoDe(c)) { out[c] = null; continue; }
          const cod = codDe(c);
          const f = calcFimPlanejado(cursor, qtdDe(c), maqTempos[cod] ?? null, calDaMaquina(m.id), cod !== prev);
          out[c] = f; if (f) cursor = f; prev = cod;
        }
      });
    });
    return out;
  }, [maquinas, lotesPorMaq, items, qtdDe, ativoDe, maqTempos, calDaMaquina]);
  const tabasPorMaquina = useMemo(() => {
    const m: Record<number, TabaSoproCard[]> = {};
    [...tabasSopro].sort((a, b) => (a.lote - b.lote) || (a.ordem - b.ordem) || (a.sequencia - b.sequencia))
      .forEach(t => { (m[t.maquina_id] = m[t.maquina_id] || []).push(t); });
    return m;
  }, [tabasSopro]);

  // Ao abrir um produto: se a taba já está cadastrada numa Sopro e ainda não tem máquina salva,
  // grava a sugestão automaticamente (com a necessidade) para o card aparecer na caixa do Sopro.
  useEffect(() => {
    if (!dadosCod || !versaoSel) return;
    const codItem = codDe(dadosCod);
    componentesEncarteTaba.forEach(({ item, tipo }) => {
      if (tipo !== 'taba' || compMaq[item.cod] !== undefined) return;
      const sug = sugestaoMaqTaba(item.cod);
      if (sug === '') return;
      const nec = (item.qtdbase || 0) * qtdDe(dadosCod);
      setCompMaq(prev => ({ ...prev, [item.cod]: sug }));
      api.salvarUsoComponente({ versao_id: String(versaoSel.id), cod_item: codItem, cod_componente: item.cod, descricao: item.text, tipo_comp: 'taba', qtd_usar: compUso[item.cod] ?? nec, maquina_id: sug })
        .then(() => carregarTabasSopro())
        .catch(() => { /* silencioso */ });
    });
  }, [componentesEncarteTaba, dadosCod]); // eslint-disable-line

  // Carrega o calendário GERAL + overrides por máquina.
  useEffect(() => {
    api.getCalendarioProducao()
      .then(r => {
        setCalendarioCfg(migrarCal(r?.config));
        const pm: Record<number, CalendarioCfg> = {};
        Object.entries(r?.por_maquina || {}).forEach(([id, c]) => { pm[Number(id)] = migrarCal(c); });
        setCalendariosMaq(pm);
      })
      .catch(() => { /* mantém o padrão */ });
  }, []);

  // Carrega no modal o config do alvo (null = geral; nº = máquina).
  const carregarDraftCal = (alvo: number | null) => {
    const base = alvo == null ? calendarioCfg : (calendariosMaq[alvo] || calendarioCfg);
    setCalDraft(migrarCal(JSON.parse(JSON.stringify(base))));
    setCalAlvo(alvo);
  };
  const abrirConfigCalendario = () => { carregarDraftCal(null); setCalConfigOpen(true); };
  const salvarConfigCalendario = async () => {
    try {
      const r = await api.salvarCalendarioProducao(calDraft, calAlvo);
      if (calAlvo == null) setCalendarioCfg(r?.config || calDraft);
      else setCalendariosMaq(prev => ({ ...prev, [calAlvo]: migrarCal(r?.config || calDraft) }));
      setCalConfigOpen(false);
      showToast(calAlvo == null ? 'Calendário geral salvo' : 'Calendário da máquina salvo', 'success');
    } catch (e) { erro(e, 'Erro ao salvar calendário de produção'); }
  };
  // Remove o override da máquina (volta a usar o geral).
  const usarCalGeral = async () => {
    if (calAlvo == null) return;
    const alvo = calAlvo;
    try {
      await api.salvarCalendarioProducao(calDraft, alvo, true);
      setCalendariosMaq(prev => { const n = { ...prev }; delete n[alvo]; return n; });
      carregarDraftCal(null);
      showToast('Máquina voltou a usar o calendário geral', 'success');
    } catch (e) { erro(e, 'Erro ao limpar calendário da máquina'); }
  };

  // Gera os cards de taba no Sopro: 1 por (produto × sequência) que tenha taba na estrutura.
  // Máquina = override do detalhe OU cadastro (sugestaoMaqTaba); sem Sopro -> entra no aviso.
  // Qtd = necessidade (qtdbase × qtd do produto) OU a quantidade manual salva no detalhe.
  const gerarTabasSoproAuto = async (qtdMap: Record<string, number>) => {
    if (!versaoSel) return;
    const agora = new Date().toISOString();   // início = hora que a programação foi gerada
    const qtdDeCard = (ck: string) => qtdMap[ck] ?? byCkey[ck]?.QTD_PRODUZIR ?? byCod[codDe(ck)]?.QTD_PRODUZIR ?? 0;
    let estr: { cod_item: string; cod_componente: string; descricao: string; qtdbase: number }[] = [];
    let overrides: { cod_item: string; cod_componente: string; qtd_usar: number | null; maquina_id: number | null }[] = [];
    try {
      const [a, b] = await Promise.all([api.estruturaTabas(), api.getUsoTabas(String(versaoSel.id))]);
      estr = a?.itens || []; overrides = b?.itens || [];
    } catch { return; }   // sem estrutura: nada a gerar
    const tabasDoProduto = new Map<string, { cod: string; descricao: string; qtdbase: number }[]>();
    estr.forEach(t => { const arr = tabasDoProduto.get(t.cod_item) || []; arr.push({ cod: t.cod_componente, descricao: t.descricao, qtdbase: t.qtdbase }); tabasDoProduto.set(t.cod_item, arr); });
    const ovMap = new Map<string, { qtd: number | null; maq: number | null }>();
    overrides.forEach(o => ovMap.set(`${o.cod_item}::${o.cod_componente}`, { qtd: o.qtd_usar, maq: o.maquina_id }));

    const cards: { cod_item: string; sequencia: number; cod_componente: string; descricao: string; qtd: number; maquina_id: number; ordem: number; lote: number; inicio: string }[] = [];
    const ordemPorMaq: Record<number, number> = {};
    const semSopro = new Map<string, { descricao: string; produtos: Set<string> }>();
    const ordenadoPlano = [...plano].sort((a, b) => (a.SEQUENCIA || 0) - (b.SEQUENCIA || 0));
    for (const p of ordenadoPlano) {
      const cod = String(p.CODIGO_PRODUTO).trim();
      const seq = p.SEQUENCIA || 0;
      const q = qtdDeCard(ckey(cod, seq));
      if (q <= 0) continue;
      for (const tb of (tabasDoProduto.get(cod) || [])) {
        const ov = ovMap.get(`${cod}::${tb.cod}`);
        const maq = (ov?.maq != null ? ov.maq : sugestaoMaqTaba(tb.cod));
        if (maq === '' || maq == null) {
          const e = semSopro.get(tb.cod) || { descricao: tb.descricao, produtos: new Set<string>() };
          e.produtos.add(cod); semSopro.set(tb.cod, e);
          continue;
        }
        const nec = (tb.qtdbase || 0) * q;
        const qtd = (ov?.qtd != null ? ov.qtd : nec);
        const ordem = (ordemPorMaq[maq as number] = (ordemPorMaq[maq as number] ?? 0) + 1);
        cards.push({ cod_item: cod, sequencia: seq, cod_componente: tb.cod, descricao: tb.descricao, qtd, maquina_id: maq as number, ordem, lote: 0, inicio: agora });
      }
    }
    try {
      await api.salvarTabasSopro({ versao_id: String(versaoSel.id), cards });
      carregarTabasSopro();
    } catch (e) { erro(e, 'Erro ao gerar cards de taba no Sopro'); }
    setTabasSemSopro(Array.from(semSopro.entries()).map(([cod, v]) => ({ cod, descricao: v.descricao, produtos: Array.from(v.produtos) })));
  };

  // 18/06: handler do botao "Atualizar criticos" — busca SKUs faltantes do Otim.Faturamento
  // e popula Map pra destacar cards aqui na Programacao.
  const atualizarCriticos = async () => {
    setCriticosLoading(true);
    try {
      const { data } = await api.get('/otimizador-faturamento/itens-criticos');
      const m = new Map<string, { qtd: number; n: number; valor: number; pedidos: any[] }>();
      for (const it of (data?.itens || [])) {
        m.set(String(it.sku), { qtd: it.qtd_faltante_total, n: it.n_pedidos_afetados, valor: it.valor_bloqueado, pedidos: it.pedidos || [] });
      }
      setCriticosMap(m);
      setCriticosTotais({ n_skus: data?.totais?.n_skus_criticos || 0, n_pedidos: data?.totais?.n_pedidos_incompletos || 0, valor: data?.totais?.valor_bloqueado_total || 0 });
      showToast(`${m.size} SKU(s) críticos para o faturamento`, 'success');
    } catch (e: any) {
      showToast(e?.response?.data?.detail || 'Erro ao buscar críticos', 'error');
    } finally { setCriticosLoading(false); }
  };

  // Programação automática: distribui cada produto na máquina cadastrada (ordenado pela sequência
  // do otimizador), define o início como agora e o término encadeia (fila por máquina).
  const programacaoAutomatica = async () => {
    if (!versaoSel) return;
    const ok = await confirmar({
      title: 'Programação automática',
      message: 'Distribui os produtos nas máquinas cadastradas (ordem = sequência do otimizador), respeitando os turnos do calendário: cada turno vira um lote (o que não cabe no turno abre o próximo). A montagem atual será substituída. Continuar?',
      variant: 'danger', confirmText: 'Distribuir', cancelText: 'Cancelar',
    });
    if (!ok) return;
    // Garante as peças/hora atualizadas de todas as máquinas — sem elas não dá para dividir por turno.
    const tempos: Record<string, number | null> = { ...maqTempos };
    try {
      const arr = await Promise.all(maquinas.map(m => api.get('/programacao/tempos-maquina', { params: { maquina_id: m.id } }).then(r => r.data.tempos || {}).catch(() => ({}))));
      arr.forEach(t => Object.assign(tempos, t));
      setMaqTempos(tempos);
    } catch { /* usa o que tiver */ }
    const agora = new Date().toISOString();
    const next: Record<string, string[]> = { [BACKLOG]: [] };
    const lpm: Record<number, LoteInfo[]> = {};
    // Produtos por máquina (cadastro), ordenados por sequência; só os que têm qtd a produzir.
    const porMaq: Record<number, string[]> = {};
    let semMaq = 0;
    const ordenado = [...plano].sort((a, b) => (a.SEQUENCIA || 0) - (b.SEQUENCIA || 0));
    for (const p of ordenado) {
      const cod = String(p.CODIGO_PRODUTO).trim();
      const ck = ckey(cod, p.SEQUENCIA || 0);
      if (qtdDe(ck) <= 0) continue;
      const maq = (porCodigo[cod] || []).find(id => maquinas.some(m => m.id === id));
      if (maq) { (porMaq[maq] = porMaq[maq] || []).push(ck); }
      else { next[BACKLOG].push(ck); semMaq++; }
    }
    let usadas = 0;
    const novasPartes: Record<string, { cod: string; qtd: number; seqOrig: number }> = {};
    const qo2: Record<string, number> = {};
    let synthCounter = 900000;   // sequência sintética para os cards parciais
    maquinas.forEach(m => {
      const cks = porMaq[m.id] || [];
      if (cks.length === 0) { lpm[m.id] = [{ lote: 0, data: '', ordem: 0 }]; next[lkey(m.id, 0)] = []; return; }
      usadas++;
      const cal = calDaMaquina(m.id);   // calendário desta máquina (override ou geral)
      const setup = cal.setup_min || 0;
      const slots = _gerarSlotsTurno(agora, cal, 80);
      const lotes: LoteInfo[] = [];
      const porLote: Record<number, string[]> = {};
      let slotIdx = 0, used = 0, loteNum = 0;
      const abrirLote = (startISO: string) => { const ln = loteNum++; lotes.push({ lote: ln, data: startISO, ordem: ln }); porLote[ln] = []; used = 0; return ln; };
      let cur = abrirLote(slots[0]?.start || agora);
      let prevCod: string | null = null;
      for (const ck of cks) {
        const cod = codDe(ck);
        const ph = tempos[cod] ?? null;
        const seqOrig = byCkey[ck]?.SEQUENCIA ?? 0;
        const setupCard = (cod === prevCod) ? 0 : setup;   // setup só na troca de produto
        prevCod = cod;
        if (!ph || ph <= 0) { porLote[cur].push(ck); continue; }   // sem peças/hora: não dá pra dividir
        // Divide a quantidade pelos turnos: enche o turno atual; o que não couber vira nova peça no próximo.
        // Setup entra só no 1º pedaço do job; retomada no turno seguinte (mesmo job) não re-seta.
        let rest = qtdDe(ck);
        const pedacos: { qtd: number; lote: number }[] = [];
        let guard = 0;
        let primeiro = true;
        while (rest > 0.0001 && guard++ < 500) {
          const su = primeiro ? setupCard : 0;
          const cap = slots[slotIdx]?.cap ?? Infinity;
          const avail = cap - used;
          const needAll = (rest / ph) * 60 + su;
          if (needAll <= avail || slotIdx + 1 >= slots.length) {
            pedacos.push({ qtd: rest, lote: cur }); used += needAll; rest = 0;
          } else {
            const unitsFit = Math.floor(((avail - su) * ph) / 60);
            if (unitsFit <= 0) { slotIdx++; cur = abrirLote(slots[slotIdx].start); continue; }
            pedacos.push({ qtd: unitsFit, lote: cur }); used += (unitsFit / ph) * 60 + su; rest -= unitsFit;
            slotIdx++; cur = abrirLote(slots[slotIdx].start);
          }
          primeiro = false;
        }
        if (pedacos.length <= 1) {
          porLote[(pedacos[0]?.lote ?? cur)].push(ck);            // coube inteiro: usa o card original
        } else {
          pedacos.forEach(pc => {                                 // dividiu: cria cards parciais
            const ck2 = ckey(cod, synthCounter++);
            novasPartes[ck2] = { cod, qtd: Math.round(pc.qtd), seqOrig };
            qo2[ck2] = Math.round(pc.qtd);
            porLote[pc.lote].push(ck2);
          });
        }
      }
      // Descarta lotes que ficaram vazios (ex.: sobra de minutos no fim do turno onde nada coube).
      const lotesUsados = lotes.filter(l => (porLote[l.lote] || []).length > 0);
      lpm[m.id] = lotesUsados.length ? lotesUsados : [{ lote: 0, data: '', ordem: 0 }];
      lpm[m.id].forEach(l => { next[lkey(m.id, l.lote)] = porLote[l.lote] || []; });
    });
    next[BACKLOG].sort((a, b) => (byCkey[a]?.SEQUENCIA ?? 0) - (byCkey[b]?.SEQUENCIA ?? 0));
    setPartes(novasPartes);
    const qoFinal = { ...qtdOverride, ...qo2 };
    setQtdOverride(qoFinal);
    setItems(next); setLotesPorMaq(lpm);
    setTimeout(() => salvarBoard({ conts: next, lotesM: lpm, qtdMap: qoFinal }), 0);
    await gerarTabasSoproAuto(qoFinal);
    showToast(`Programação automática: ${usadas} máquina(s) dividida(s) por turno${semMaq ? `, ${semMaq} sem máquina (em A programar)` : ''}`, 'success');
  };

  // Limpa a programação: devolve todos os itens para "A programar" e zera datas dos lotes.
  const limparProgramacao = async () => {
    if (!versaoSel) return;
    const ok = await confirmar({
      title: 'Limpar programação',
      message: 'Move todos os itens de volta para "A programar" e limpa as datas (início/entrega) dos lotes. Continuar?',
      variant: 'danger', confirmText: 'Limpar', cancelText: 'Cancelar',
    });
    if (!ok) return;
    // Descarta as peças sintéticas (split por turno e saldo) — o card inteiro do produto volta para "A programar".
    const allCk = Object.values(items).flat().filter(c => seqDe(c) < 800000);
    const next: Record<string, string[]> = { [BACKLOG]: [...allCk] };
    const lpm: Record<number, LoteInfo[]> = {};
    maquinas.forEach(m => {
      // Reseta para o padrão: um único lote por máquina (remove os lotes extras dos turnos).
      lpm[m.id] = [{ lote: 0, data: '', ordem: 0 }];
      next[lkey(m.id, 0)] = [];
    });
    next[BACKLOG].sort((a, b) => (byCkey[a]?.SEQUENCIA ?? 0) - (byCkey[b]?.SEQUENCIA ?? 0));
    // Desfaz os "Gerar saldo": restaura a qtd cheia dos originais cujo saldo será descartado.
    const qoNext = { ...qtdOverride };
    Object.keys(partes).forEach(sck => {
      const sq = seqDe(sck);
      if (sq < 800000 || sq >= 900000) return;       // só os cards de saldo
      delete qoNext[ckey(partes[sck].cod, partes[sck].seqOrig)];  // original volta a QTD_PRODUZIR cheia
      delete qoNext[sck];
    });
    setPartes({});
    setQtdOverride(qoNext);
    setItems(next); setLotesPorMaq(lpm);
    setTimeout(() => salvarBoard({ conts: next, lotesM: lpm, qtdMap: qoNext }), 0);
    showToast('Programação limpa', 'success');
  };

  // 18/06: limpar SÓ uma máquina — devolve os cards dela pra "A programar" sem afetar as outras.
  const limparMaquina = async (maqId: number) => {
    const m = maquinas.find(x => x.id === maqId);
    const nomeMaq = m?.nome || `Máquina ${maqId}`;
    const ok = await confirmar({
      title: `Limpar ${nomeMaq}`,
      message: `Move todos os itens de "${nomeMaq}" de volta para "A programar" e zera as datas dos lotes desta máquina. As outras máquinas não são afetadas. Continuar?`,
      variant: 'danger', confirmText: 'Limpar máquina', cancelText: 'Cancelar',
    });
    if (!ok) return;
    // Coleta cards da máquina (todos lotes) — descarta sintéticos (split/saldo), card cheio volta pro backlog.
    const cardsMaq: string[] = [];
    (lotesPorMaq[maqId] || []).forEach(l => (items[lkey(maqId, l.lote)] || []).forEach(c => { if (seqDe(c) < 800000) cardsMaq.push(c); }));
    const next: Record<string, string[]> = { ...items };
    (lotesPorMaq[maqId] || []).forEach(l => { next[lkey(maqId, l.lote)] = []; });
    next[BACKLOG] = [...(next[BACKLOG] || []), ...cardsMaq].sort((a, b) => (byCkey[a]?.SEQUENCIA ?? 0) - (byCkey[b]?.SEQUENCIA ?? 0));
    const lpm = { ...lotesPorMaq, [maqId]: [{ lote: 0, data: '', ordem: 0 }] };
    // Desfaz saldos sintéticos dos cards da própria máquina (sem mexer nos das outras).
    const qoNext = { ...qtdOverride };
    Object.keys(partes).forEach(sck => {
      const sq = seqDe(sck);
      if (sq < 800000 || sq >= 900000) return;
      // saldo desta máquina? está no items[lkey(maqId,*)] OU já foi removido acima — checar se o cod estava lá
      const codSaldo = partes[sck].cod;
      const tinhaNaMaq = cardsMaq.some(c => codDe(c) === codSaldo);
      if (!tinhaNaMaq) return;
      delete qoNext[ckey(partes[sck].cod, partes[sck].seqOrig)];
      delete qoNext[sck];
    });
    setQtdOverride(qoNext);
    setItems(next); setLotesPorMaq(lpm);
    setTimeout(() => salvarBoard({ conts: next, lotesM: lpm, qtdMap: qoNext }), 0);
    showToast(`${nomeMaq}: ${cardsMaq.length} card(s) movido(s) para "A programar"`, 'success');
  };

  // Exporta a programação para Excel estilizado: uma aba por máquina (só as que têm itens), lotes/turnos separados.
  const gerarExcel = async () => {
    if (!versaoSel) return;
    // Pré-carrega as estruturas (encarte/taba) de todos os itens a exportar.
    const todosCods = new Set<string>();
    ordemMaquinas.forEach(m => (lotesPorMaq[m.id] || []).forEach(l => (items[lkey(m.id, l.lote)] || []).forEach(c => { if (qtdDe(c) > 0) todosCods.add(codDe(c)); })));
    if (todosCods.size === 0) { showToast('Nenhuma máquina com programação para exportar', 'info'); return; }
    const estr: Record<string, { encontrado: boolean; itens: EstruturaItem[] }> = { ...estruturaCache };
    const faltam = [...todosCods].filter(cod => !estr[cod]);
    if (faltam.length) {
      showToast('Preparando Excel (carregando estruturas)…', 'info');
      const res = await Promise.all(faltam.map(cod => api.estruturaProduto(cod).then(r => ({ cod, r })).catch(() => ({ cod, r: null as any }))));
      res.forEach(({ cod, r }) => { estr[cod] = { encontrado: !!r?.encontrado, itens: r?.itens || [] }; });
      setEstruturaCache(estr);
    }
    // Separa encarte/taba em colunas (código, nome, qtd padrão, unidade), uma linha por componente.
    const compsCols = (cod: string, tipo: 'encarte' | 'taba', qty: number) => {
      const lista = derivarEncarteTaba(estr[cod]?.itens || []).filter(x => x.tipo === tipo).map(x => x.item);
      return {
        cod: lista.map(i => i.cod).join('\n'),
        nome: lista.map(i => i.text || '').join('\n'),
        qtd: lista.map(i => num((i.qtdbase || 0) * qty)).join('\n'),
        un: lista.map(i => i.unidade || '').join('\n'),
      };
    };
    const maquinasPayload = ordemMaquinas.map(m => {
      const lotes = (lotesPorMaq[m.id] || []).map((l, li) => {
        const cods = (items[lkey(m.id, l.lote)] || []).filter(c => qtdDe(c) > 0);
        const fimMap: Record<string, string | null> = {}; const inicioMap: Record<string, string | null> = {}; let cursor = l.data;
        for (const c of cods) { if (ativoDe(c)) { inicioMap[c] = cursor; const f = calcFimPlanejado(cursor, qtdDe(c), maqTempos[codDe(c)] ?? null, calDaMaquina(m.id)); fimMap[c] = f; if (f) cursor = f; } }
        return {
          titulo: `Lote ${li + 1} — Início: ${l.data ? fmtDt(l.data) : 'sem data'}`,
          itens: cods.map((c, idx) => {
            const cod = codDe(c);
            const qty = qtdDe(c);
            return {
              ordem: idx + 1,
              seq: byCkey[c]?.SEQUENCIA ?? null,
              codigo: cod,
              produto: byCkey[c]?.DESCRICAO || byCod[cod]?.DESCRICAO || '',
              qtd: qty,
              pecas_hora: maqTempos[cod] ?? null,
              inicio: inicioMap[c] ? fmtDt(inicioMap[c]) : '',
              termino: fimMap[c] ? fmtDt(fimMap[c]) : '',
              ops: (opsPorCodigo.get(cod) || []).map(o => o.numero_op).filter(Boolean).join(', '),
              pedidos: Object.keys(byCod[cod]?.DEMANDA_POR_PEDIDO || {}).join(', '),
              ...(() => { const e = compsCols(cod, 'encarte', qty), t = compsCols(cod, 'taba', qty);
                return {
                  encarte_cod: e.cod, encarte_nome: e.nome, encarte_qtd: e.qtd, encarte_un: e.un,
                  taba_cod: t.cod, taba_nome: t.nome, taba_qtd: t.qtd, taba_un: t.un,
                }; })(),
            };
          }),
        };
      }).filter(lt => lt.itens.length > 0);
      return { nome: m.nome, lotes };
    }).filter(mq => mq.lotes.length > 0);
    if (maquinasPayload.length === 0) { showToast('Nenhuma máquina com programação para exportar', 'info'); return; }
    try {
      const blob = await api.gerarExcelProgramacao({ maquinas: maquinasPayload });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = 'programacao.xlsx';
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
    } catch (e) { erro(e, 'Erro ao gerar Excel'); }
  };

  // Entradas MANUAIS do item aberto: registros salvos cujo código NÃO está entre os derivados da estrutura.
  const manuaisDetalhe = useMemo(() => {
    const estruturais = new Set(componentesEncarteTaba.map(c => c.item.cod));
    return usoSalvoDetalhe.filter(u => !estruturais.has(u.cod_componente));
  }, [usoSalvoDetalhe, componentesEncarteTaba]);

  // Recarrega o uso salvo do item aberto no detalhe (após adicionar/remover manual).
  const recarregarUsoDetalhe = useCallback((ck: string) => {
    if (!versaoSel) return;
    const cod = codDe(ck);
    api.getUsoComponentes(String(versaoSel.id), cod)
      .then(resp => {
        const map: Record<string, number> = {};
        const maq: Record<string, number | null> = {};
        (resp?.itens || []).forEach(it => { map[it.cod_componente] = it.qtd_usar; maq[it.cod_componente] = it.maquina_id ?? null; });
        setCompUso(map);
        setCompMaq(maq);
        setUsoSalvoDetalhe((resp?.itens || []).map(it => ({ cod_componente: it.cod_componente, descricao: it.descricao, tipo_comp: it.tipo_comp, qtd_usar: it.qtd_usar })));
      })
      .catch(() => { /* */ });
    // mantém o modal da máquina sincronizado, se aberto
    if (maqModal) {
      api.getUsoComponentes(String(versaoSel.id), cod)
        .then(r => setUsoPorItem(prev => ({ ...prev, [cod]: (r?.itens || []).map(it => ({ cod_componente: it.cod_componente, descricao: it.descricao, tipo_comp: it.tipo_comp, qtd_usar: it.qtd_usar })) })))
        .catch(() => { /* */ });
    }
  }, [versaoSel, maqModal]); // eslint-disable-line

  const adicionarManual = () => {
    if (!versaoSel || !dadosCod) return;
    const cod = manCod.trim();
    if (!cod) { setManErro('Informe o código do encarte/taba.'); return; }
    const qtd = manQtd.trim() === '' ? 0 : Number(manQtd.replace(',', '.'));
    if (isNaN(qtd) || qtd < 0) { setManErro('Quantidade inválida.'); return; }
    setManErro('');
    api.salvarUsoComponente({
      versao_id: String(versaoSel.id), cod_item: codDe(dadosCod), cod_componente: cod,
      descricao: manDesc.trim() || undefined, tipo_comp: manTipo, qtd_usar: qtd,
    })
      .then(() => {
        setManCod(''); setManDesc(''); setManQtd('');
        recarregarUsoDetalhe(dadosCod);
        showToast('Encarte/taba manual adicionado', 'success');
      })
      .catch(e => erro(e, 'Erro ao adicionar encarte/taba manual'));
  };

  const salvarManual = (cod_componente: string, tipo: 'encarte' | 'taba', descricao: string, valor: string) => {
    if (!versaoSel || !dadosCod) return;
    const v = valor.trim() === '' ? 0 : Number(valor.replace(',', '.'));
    if (isNaN(v) || v < 0) return;
    api.salvarUsoComponente({ versao_id: String(versaoSel.id), cod_item: codDe(dadosCod), cod_componente, descricao: descricao || undefined, tipo_comp: tipo, qtd_usar: v, maquina_id: compMaq[cod_componente] ?? null })
      .then(() => recarregarUsoDetalhe(dadosCod))
      .catch(e => erro(e, 'Erro ao salvar quantidade a utilizar'));
  };

  const removerManual = async (cod_componente: string) => {
    if (!versaoSel || !dadosCod) return;
    const ok = await confirmar({ title: 'Remover encarte/taba manual', message: `Remover a entrada manual "${cod_componente}" deste item?`, variant: 'danger', confirmText: 'Remover', cancelText: 'Cancelar' });
    if (!ok) return;
    api.removerUsoComponente({ versao_id: String(versaoSel.id), cod_item: codDe(dadosCod), cod_componente })
      .then(() => { recarregarUsoDetalhe(dadosCod); showToast('Entrada manual removida', 'success'); })
      .catch(e => erro(e, 'Erro ao remover entrada manual'));
  };

  // Ao abrir o modal da máquina: garante a estrutura de cada item no cache e busca a "qtd a utilizar" salva (em paralelo).
  useEffect(() => {
    if (!maqModal || !versaoSel) { setUsoPorItem({}); return; }
    const lotes = lotesPorMaq[maqModal.id] || [];
    const cods = Array.from(new Set(lotes.flatMap(l => items[lkey(maqModal.id, l.lote)] || [])));
    if (cods.length === 0) { setUsoPorItem({}); return; }
    let cancelado = false;
    (async () => {
      // estruturas faltantes — buscadas por cod (produto), não por ckey
      const codsSemEstrutura = Array.from(new Set(cods.map(codDe))).filter(cod => !estruturaCache[cod]);
      if (codsSemEstrutura.length) {
        const resps = await Promise.all(codsSemEstrutura.map(cod =>
          api.estruturaProduto(cod)
            .then(r => ({ cod, encontrado: !!r?.encontrado, itens: r?.itens || [] }))
            .catch(() => ({ cod, encontrado: false, itens: [] as EstruturaItem[] }))
        ));
        if (!cancelado) setEstruturaCache(prev => {
          const n = { ...prev };
          resps.forEach(r => { if (!n[r.cod]) n[r.cod] = { encontrado: r.encontrado, itens: r.itens }; });
          return n;
        });
      }
      // uso salvo (qtd a utilizar) por cod de produto (não por ckey)
      const codsUnicos = Array.from(new Set(cods.map(codDe)));
      const usos = await Promise.all(codsUnicos.map(cod =>
        api.getUsoComponentes(String(versaoSel.id), cod)
          .then(r => ({ cod, itens: (r?.itens || []).map(it => ({ cod_componente: it.cod_componente, descricao: it.descricao, tipo_comp: it.tipo_comp, qtd_usar: it.qtd_usar })) }))
          .catch(() => ({ cod, itens: [] as { cod_componente: string; descricao: string; tipo_comp: string; qtd_usar: number }[] }))
      ));
      if (!cancelado) setUsoPorItem(() => { const m: Record<string, { cod_componente: string; descricao: string; tipo_comp: string; qtd_usar: number }[]> = {}; usos.forEach(u => { m[u.cod] = u.itens; }); return m; });
    })().catch(() => { /* silencioso */ });
    return () => { cancelado = true; };
  }, [maqModal, versaoSel]); // eslint-disable-line

  const salvarUsoComp = (item: EstruturaItem, tipo: 'encarte' | 'taba', valor: string) => {
    if (!versaoSel || !dadosCod) return;
    const v = valor.trim() === '' ? 0 : Number(valor.replace(',', '.'));
    if (isNaN(v) || v < 0) return;
    api.salvarUsoComponente({
      versao_id: String(versaoSel.id), cod_item: codDe(dadosCod), cod_componente: item.cod,
      descricao: item.text, tipo_comp: tipo, qtd_usar: v, maquina_id: compMaq[item.cod] ?? null,
    })
      .then(() => {
        setCompSalvos(prev => ({ ...prev, [item.cod]: true }));
        setTimeout(() => setCompSalvos(prev => { const n = { ...prev }; delete n[item.cod]; return n; }), 1500);
      })
      .catch(e => erro(e, 'Erro ao salvar quantidade a utilizar'));
  };

  // Salva a máquina (Sopro) de uma taba, preservando a qtd a utilizar já gravada.
  const salvarCompMaquina = (cod_componente: string, tipo: 'encarte' | 'taba', descricao: string, valor: string) => {
    if (!versaoSel || !dadosCod) return;
    const mid = valor.trim() === '' ? null : Number(valor);
    setCompMaq(prev => ({ ...prev, [cod_componente]: mid }));
    api.salvarUsoComponente({
      versao_id: String(versaoSel.id), cod_item: codDe(dadosCod), cod_componente,
      descricao: descricao || undefined, tipo_comp: tipo, qtd_usar: compUso[cod_componente] ?? 0, maquina_id: mid,
    })
      .then(() => {
        setCompSalvos(prev => ({ ...prev, [cod_componente]: true }));
        setTimeout(() => setCompSalvos(prev => { const n = { ...prev }; delete n[cod_componente]; return n; }), 1500);
        carregarTabasSopro();
      })
      .catch(e => erro(e, 'Erro ao salvar máquina da taba'));
  };

  // ordem das colunas (máquinas) por usuário
  useEffect(() => {
    if (maquinas.length === 0) { setOrdemCol([]); return; }
    let saved: number[] = [];
    try { const raw = localStorage.getItem(`programacao:colordem:${userKey()}`); if (raw) saved = JSON.parse(raw); } catch { /* */ }
    const ids = maquinas.map(m => m.id);
    setOrdemCol(saved.filter(id => ids.includes(id)).concat(ids.filter(id => !saved.includes(id))));
  }, [maquinas]);
  const persistOrdemCol = (arr: number[]) => { try { localStorage.setItem(`programacao:colordem:${userKey()}`, JSON.stringify(arr)); } catch { /* */ } };
  // Larguras das colunas — carrega e persiste por usuário.
  useEffect(() => {
    try { const raw = localStorage.getItem(`programacao:colw:${userKey()}`); if (raw) { const v = JSON.parse(raw); if (v.maq) setMaqColW(v.maq); if (v.bl) setBacklogColW(v.bl); } } catch { /* */ }
  }, []);
  const persistColW = (maq: number, bl: number) => { try { localStorage.setItem(`programacao:colw:${userKey()}`, JSON.stringify({ maq, bl })); } catch { /* */ } };
  const colwInit = useRef(false);
  useEffect(() => { if (!colwInit.current) { colwInit.current = true; return; } persistColW(maqColW, backlogColW); }, [maqColW, backlogColW]); // eslint-disable-line
  const ordemMaquinas = useMemo(() => ordemCol.map(id => maquinas.find(m => m.id === id)).filter(Boolean) as Maquina[], [ordemCol, maquinas]);

  const abrirMaquina = async (m: Maquina) => {
    setMaqModal(m);
    try { const { data } = await api.get('/programacao/tempos-maquina', { params: { maquina_id: m.id } }); setMaqTempos(prev => ({ ...prev, ...(data.tempos || {}) })); }
    catch (e) { erro(e, 'Erro ao carregar peças/hora'); }
  };
  // Frente 0 (17/06): abre modal pedindo peças/hora pra (cod, máquina). Retorna o valor digitado
  // (ou null se o usuário cancelar). Quando o valor é gravado, atualiza maqTempos local e persiste
  // em maquina_produto_tempo via PUT /maquinas/:id/tempo.
  const pedirPh = useCallback((cod: string, descricao: string, maqId: number, maqNome: string): Promise<{ ph: number; outras: number[] } | null> => {
    return new Promise<{ ph: number; outras: number[] } | null>(resolver => setPhPrompt({ cod, descricao, maqId, maqNome, valor: '', outras: new Set<number>(), resolver }));
  }, []);

  // Frente 0 (17/06): lista única (cod, maquina) de cards no board cuja peças/hora não está cadastrada.
  const itensSemPh = useMemo(() => {
    const result: Array<{ cod: string; descricao: string; maqId: number; maqNome: string }> = [];
    const seen = new Set<string>();
    maquinas.forEach(m => {
      (lotesPorMaq[m.id] || []).forEach(l => {
        (items[lkey(m.id, l.lote)] || []).forEach(c => {
          const cod = codDe(c);
          const key = `${cod}::${m.id}`;
          if (seen.has(key)) return;
          seen.add(key);
          const ph = maqTempos[cod];
          if (ph == null || ph <= 0) result.push({ cod, descricao: byCod[cod]?.DESCRICAO || cod, maqId: m.id, maqNome: m.nome });
        });
      });
    });
    return result;
  }, [items, lotesPorMaq, maquinas, maqTempos, byCod]);

  // Cadastra peças/hora em fila para todos os itens sem ph (banner amber "Cadastrar agora").
  const cadastrarPhFaltantes = useCallback(async () => {
    for (const item of itensSemPh) {
      const v = await pedirPh(item.cod, item.descricao, item.maqId, item.maqNome);
      if (v && v.ph > 0) {
        await setPecasHora(item.maqId, item.cod, String(v.ph));
        if (v.outras.length > 0) await cadastrarExcecoes(item.cod, v.outras);
      }
    }
    setTimeout(() => salvarBoard(), 50);
  }, [itensSemPh, pedirPh, salvarBoard]); // eslint-disable-line

  const setPecasHora = async (maqId: number, ck: string, valor: string) => {
    const cod = codDe(ck);
    const v = valor.trim() === '' ? null : Number(valor.replace(',', '.'));
    if (v !== null && (isNaN(v) || v < 0)) return;
    // Atualiza ref síncrono ANTES do setState para que re-saves imediatos enxerguem o novo valor.
    maqTemposRef.current = { ...maqTemposRef.current, [cod]: v };
    setMaqTempos(prev => ({ ...prev, [cod]: v }));
    try {
      await api.put(`/maquinas/${maqId}/tempo`, { cod_item: cod, pecas_hora: v });
      // Frente 0 (17/06): cadastra também a relação produto↔máquina (excecao 'incluir') para
      // que a programação automática considere essa máquina no próximo solver. Idempotente.
      if (v !== null && v > 0) {
        try {
          await api.post(`/maquinas/${maqId}/excecoes`, { cod_item: cod, acao: 'incluir' });
          setPorCodigo(prev => { const arr = prev[cod] || []; return arr.includes(maqId) ? prev : { ...prev, [cod]: [...arr, maqId] }; });
        } catch { /* silencioso: se a excecao já existe, ok */ }
      }
    } catch (e2) { erro(e2, 'Erro ao salvar peças/hora'); }
  };

  // Cadastra excecao 'incluir' nas máquinas adicionais selecionadas no modal (sem ph).
  const cadastrarExcecoes = async (cod: string, maquinaIds: number[]) => {
    for (const mId of maquinaIds) {
      try {
        await api.post(`/maquinas/${mId}/excecoes`, { cod_item: cod, acao: 'incluir' });
        setPorCodigo(prev => { const arr = prev[cod] || []; return arr.includes(mId) ? prev : { ...prev, [cod]: [...arr, mId] }; });
      } catch { /* idempotente */ }
    }
  };
  const tempoHoras = (ck: string) => { const cod = codDe(ck); const ph = maqTempos[cod]; if (!ph || ph <= 0) return null; return qtdDe(ck) / ph; };
  const fmtHoras = (h: number | null) => { if (h === null) return '—'; return fmtHorasLote(h) || '0min'; };

  // Término planejado do lote (último item da fila), via calendário. ISO ou null.
  const fimLote = (maqId: number, lote: number): string | null => {
    const cods = items[lkey(maqId, lote)] || [];
    const li = (lotesPorMaq[maqId] || []).find(l => l.lote === lote);
    if (!li || !li.data) return null;
    let cursor = li.data; let prev: string | null = null;
    for (const c of cods) {
      if (!ativoDe(c)) continue;
      const cod = codDe(c);
      const f = calcFimPlanejado(cursor, qtdDe(c), maqTempos[cod] ?? null, calDaMaquina(maqId), cod !== prev);
      if (f) cursor = f;
      prev = cod;   // setup só na troca de produto (cards seguidos do mesmo produto não re-setam)
    }
    return cursor !== li.data ? cursor : null;
  };

  // Salva qtd a utilizar de um componente direto do modal da máquina e atualiza usoPorItem.
  const salvarQtdModal = useCallback(async (cod_item: string, cod_comp: string, tipo: 'encarte' | 'taba', desc: string, valor: string) => {
    if (!versaoSel) return;
    const v = valor.trim() === '' ? 0 : Number(valor.replace(',', '.'));
    if (isNaN(v) || v < 0) return;
    await api.salvarUsoComponente({ versao_id: String(versaoSel.id), cod_item, cod_componente: cod_comp, descricao: desc, tipo_comp: tipo, qtd_usar: v });
    const r = await api.getUsoComponentes(String(versaoSel.id), cod_item);
    setUsoPorItem(prev => ({ ...prev, [cod_item]: (r?.itens || []).map((it: { cod_componente: string; descricao: string; tipo_comp: string; qtd_usar: number }) => ({ cod_componente: it.cod_componente, descricao: it.descricao, tipo_comp: it.tipo_comp, qtd_usar: it.qtd_usar })) }));
  }, [versaoSel]);

  // Adiciona "outro código" como entrada manual direto do modal e recarrega usoPorItem.
  const adicionarOutroModal = useCallback(async (cod_item: string, tipo: 'encarte' | 'taba', cod_comp: string, desc: string) => {
    if (!versaoSel || !cod_comp.trim()) return;
    await api.salvarUsoComponente({ versao_id: String(versaoSel.id), cod_item, cod_componente: cod_comp.trim(), descricao: desc, tipo_comp: tipo, qtd_usar: 0 });
    const r = await api.getUsoComponentes(String(versaoSel.id), cod_item);
    setUsoPorItem(prev => ({ ...prev, [cod_item]: (r?.itens || []).map((it: { cod_componente: string; descricao: string; tipo_comp: string; qtd_usar: number }) => ({ cod_componente: it.cod_componente, descricao: it.descricao, tipo_comp: it.tipo_comp, qtd_usar: it.qtd_usar })) }));
    setOutroKey(''); setOutroCod(''); setOutroBusca([]);
  }, [versaoSel]);

  // Autocomplete do "adicionar manual" — busca por código OU nome na base de estrutura.
  const buscarManSug = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setManSug([]); setManSugOpen(false); return; }
    try { const r = await api.estruturaBuscarItem(q.trim()); setManSug(r?.itens || []); setManSugOpen(true); }
    catch { setManSug([]); }
  }, []);

  // Busca itens na base de estrutura para o campo "outro código".
  const buscarItemModal = useCallback(async (q: string) => {
    if (q.trim().length < 2) { setOutroBusca([]); return; }
    try { const r = await api.estruturaBuscarItem(q.trim()); setOutroBusca(r?.itens || []); }
    catch { setOutroBusca([]); }
  }, []);

  // Componentes (encarte ou taba) de um item, com necessidade e qtd a utilizar salva — para o modal da máquina e o PDF.
  // Aceita ckey ("cod::seq") ou cod puro — extrai sempre o código do produto para lookups.
  const compsDoItem = useCallback((ck: string, tipo: 'encarte' | 'taba') => {
    const cod = codDe(ck);
    const lista = derivarEncarteTaba(estruturaCache[cod]?.itens || []).filter(x => x.tipo === tipo);
    const salvos = usoPorItem[cod] || [];
    const estruturais = new Set(lista.map(x => x.item.cod));
    const daEstrutura = lista.map(({ item }) => ({
      cod: item.cod,
      text: item.text || '',
      unidade: item.unidade || '',
      necessidade: (item.qtdbase || 0) * qtdDe(ck) as number | undefined,
      qtdUsar: salvos.find(s => s.cod_componente === item.cod)?.qtd_usar,
      manual: false,
    }));
    // Entradas manuais salvas (fora da estrutura) do tipo solicitado.
    const manuais = salvos
      .filter(s => !estruturais.has(s.cod_componente) && s.tipo_comp === tipo)
      .map(s => ({ cod: s.cod_componente, text: s.descricao || '', unidade: '', necessidade: undefined as number | undefined, qtdUsar: s.qtd_usar, manual: true }));
    return [...daEstrutura, ...manuais];
  }, [estruturaCache, usoPorItem, qtdDe]);

  const findContainer = (id: string): string | undefined => { if (items[id]) return id; return Object.keys(items).find(k => items[k].includes(id)); };

  const onDragEnd = async (event: any) => {
    setActiveId(null);
    const { active, over } = event;
    if (!over) return;
    const aid = String(active.id), oid = String(over.id);

    // Reordenar colunas (máquinas)
    if (aid.startsWith('col_')) {
      if (!oid.startsWith('col_')) return;
      const from = ordemCol.indexOf(Number(aid.slice(4)));
      const to = ordemCol.indexOf(Number(oid.slice(4)));
      if (from < 0 || to < 0 || from === to) return;
      const next = arrayMove(ordemCol, from, to);
      setOrdemCol(next); persistOrdemCol(next);
      return;
    }

    // Mover/reordenar cards de taba no Sopro (reordenar dentro da máquina ou mover entre Sopros)
    if (aid.startsWith('taba::')) {
      if (!versaoSel) return;
      if (!tabasSopro.some(t => tabaKey(t) === aid)) return;
      let targetMaq: number | null = null; let overKey: string | null = null;
      if (oid.startsWith('tabazone::')) targetMaq = Number(oid.slice('tabazone::'.length));
      else if (oid.startsWith('taba::')) { const ov = tabasSopro.find(t => tabaKey(t) === oid); if (ov) { targetMaq = ov.maquina_id; overKey = oid; } }
      else if (oid.startsWith('col_')) targetMaq = Number(oid.slice(4));
      else { const p = parseLkey(oid); if (p) targetMaq = p.maqId; }
      if (targetMaq == null) return;
      if (!soproMaquinas.some(m => m.id === targetMaq)) { showToast('Cards de taba só podem ir para máquinas Sopro', 'error'); return; }
      setTabasSopro(prev => {
        const mov = prev.find(t => tabaKey(t) === aid);
        if (!mov) return prev;
        const rest = prev.filter(t => tabaKey(t) !== aid);
        const alvo = rest.filter(t => t.maquina_id === targetMaq).sort((a, b) => (a.lote - b.lote) || (a.ordem - b.ordem) || (a.sequencia - b.sequencia));
        let idx = alvo.length;
        if (overKey) { const i = alvo.findIndex(t => tabaKey(t) === overKey); if (i >= 0) idx = i; }
        alvo.splice(idx, 0, { ...mov, maquina_id: targetMaq! });
        const alvoOrdenado = alvo.map((t, i) => ({ ...t, maquina_id: targetMaq!, ordem: i, lote: 0 }));
        const next = [...rest.filter(t => t.maquina_id !== targetMaq), ...alvoOrdenado];
        const cards = next.map(t => ({ cod_item: t.cod_item, sequencia: t.sequencia, cod_componente: t.cod_componente, descricao: t.descricao, qtd: t.qtd, maquina_id: t.maquina_id, ordem: t.ordem, lote: t.lote, inicio: t.inicio }));
        setTimeout(() => api.salvarTabasSopro({ versao_id: String(versaoSel.id), cards }).catch((e: any) => erro(e, 'Erro ao salvar tabas do Sopro')), 0);
        return next;
      });
      setSel(new Set());
      return;
    }

    // Mover itens (com multi-seleção)
    // Se soltou sobre o cabeçalho/área da coluna da máquina (id 'col_X'), mapeia para o 1º lote da máquina.
    let overC = findContainer(oid) || (items[oid] ? oid : undefined);
    if (!overC && oid.startsWith('col_')) {
      const mId = Number(oid.slice(4));
      const primeiro = (lotesPorMaq[mId] || [])[0];
      if (primeiro) overC = lkey(mId, primeiro.lote);
    }
    if (!findContainer(aid) || !overC) return;
    const movingSet = new Set<string>(sel.has(aid) && sel.size > 1 ? sel : []);
    movingSet.add(aid);
    let movingOrdered = Array.from(movingSet).sort((a, b) => (byCkey[a]?.SEQUENCIA ?? 0) - (byCkey[b]?.SEQUENCIA ?? 0));

    // Validação: só pode soltar em máquina cadastrada (quando o produto tem cadastro)
    let semCadastro: string[] = [];
    let maqId = 0;
    const parsed = parseLkey(overC);
    if (parsed) {
      maqId = parsed.maqId;
      // Sem bloqueio por cadastro: qualquer produto pode ir para qualquer máquina
      semCadastro = movingOrdered.filter(c => (porCodigo[codDe(c)] || []).length === 0);
    }

    const movSet = new Set(movingOrdered);
    const fromC = findContainer(aid);
    // Captura o items pós-drop pra reusar no save após cadastro de peças/hora (evita stale closure).
    let nextItemsRef: Record<string, string[]> | null = null;
    setItems(prev => {
      const next: Record<string, string[]> = {};
      Object.keys(prev).forEach(k => { next[k] = prev[k].filter(c => !movSet.has(c)); });
      let idx = next[overC].indexOf(oid);
      if (idx < 0) idx = next[overC].length;
      else if (fromC === overC) {
        // Mesmo container: se arrastando para BAIXO (origem antes do alvo), insere DEPOIS do alvo
        // — corrige o off-by-one que impedia mover um card para baixo.
        const oFrom = (prev[overC] || []).indexOf(aid);
        const oOver = (prev[overC] || []).indexOf(oid);
        if (oFrom !== -1 && oOver !== -1 && oFrom < oOver) idx += 1;
      }
      next[overC].splice(idx, 0, ...movingOrdered);
      nextItemsRef = next;
      setTimeout(() => salvarBoard({ conts: next }), 0);
      return next;
    });
    setSel(new Set());

    // Sugestão de início: ao colocar produto numa máquina cujo lote ainda não tem início,
    // assume agora (data e hora em que começou a programar). O usuário pode editar depois.
    if (parsed) {
      const { maqId: mId, lote } = parsed;
      const loteInfo = (lotesPorMaq[mId] || []).find(l => l.lote === lote);
      if (loteInfo && !loteInfo.data) {
        const agora = new Date().toISOString();
        setLotesPorMaq(prev => {
          const n = { ...prev, [mId]: (prev[mId] || []).map(l => l.lote === lote ? { ...l, data: agora } : l) };
          setTimeout(() => salvarBoard({ lotesM: n }), 0); return n;
        });
      }
    }

    // Frente 0 parte 2 (17/06): se algum cod movido vai pra máquina sem peças/hora cadastrada,
    // obriga cadastro inline (modal). Atualiza maqTempos + grava em maquina_produto_tempo via PUT
    // /maquinas/:id/tempo. Depois re-salva o board pra popular previsao_termino com a nova ph.
    // 17/06 (bug 1): modal SÓ abre quando o drag veio do BACKLOG (reposição entre máquinas/posições
    // já cadastradas não dispara o gate). 17/06 (bug 2): cancelar devolve o card pra ORIGEM real
    // (fromC) e não pra BACKLOG hardcoded.
    const origemDrag = fromC; // preserva origem antes do setItems async
    if (parsed && maqId && fromC === BACKLOG) {
      const nomeMaq = maquinas.find(m => m.id === maqId)?.nome || `Máquina ${maqId}`;
      const codsSemPh = Array.from(new Set(movingOrdered.map(codDe))).filter(cod => {
        const ph = maqTempos[cod]; return ph == null || ph <= 0;
      });
      let cadastrouAlguma = false;
      const codsCancelados: string[] = [];
      for (const cod of codsSemPh) {
        const desc = byCod[cod]?.DESCRICAO || cod;
        const v = await pedirPh(cod, desc, maqId, nomeMaq);
        if (v && v.ph > 0) {
          await setPecasHora(maqId, cod, String(v.ph));
          if (v.outras.length > 0) await cadastrarExcecoes(cod, v.outras);
          cadastrouAlguma = true;
        } else {
          // Cancelou: devolve o(s) card(s) desse cod pra origem do drag.
          codsCancelados.push(cod);
        }
      }
      if (codsCancelados.length > 0) {
        const setCanc = new Set(codsCancelados);
        const destino = origemDrag || BACKLOG; // fallback defensivo
        setItems(prev => {
          const next: Record<string, string[]> = { ...prev };
          const cksReverter = (next[overC] || []).filter(ck => setCanc.has(codDe(ck)));
          next[overC] = (next[overC] || []).filter(ck => !setCanc.has(codDe(ck)));
          next[destino] = [...(next[destino] || []), ...cksReverter];
          nextItemsRef = next;
          setTimeout(() => salvarBoard({ conts: next }), 0);
          return next;
        });
        cadastrouAlguma = false; // o save de reverter já cobre
      }
      if (cadastrouAlguma) setTimeout(() => salvarBoard(nextItemsRef ? { conts: nextItemsRef } : undefined), 50);
    }

    // Produtos sem máquina cadastrada: pergunta se quer cadastrar nesta máquina
    if (semCadastro.length > 0 && maqId) {
      const nomeMaq = maquinas.find(m => m.id === maqId)?.nome || 'esta máquina';
      const ok = await confirmar({
        title: 'Cadastrar máquina para o produto',
        message: `${semCadastro.length} produto(s) não têm máquina cadastrada. Deseja cadastrá-lo(s) em "${nomeMaq}" para que da próxima vez seja automático?`,
        variant: 'info', confirmText: 'Sim, cadastrar', cancelText: 'Não',
      });
      if (ok) {
        try {
          const codsParaCadastrar = Array.from(new Set(semCadastro.map(codDe)));
          await Promise.all(codsParaCadastrar.map(c => api.post(`/maquinas/${maqId}/excecoes`, { cod_item: c, acao: 'incluir' })));
          setPorCodigo(prev => { const n = { ...prev }; codsParaCadastrar.forEach(c => { n[c] = [...(n[c] || []), maqId]; }); return n; });
          showToast('Produto(s) cadastrado(s) na máquina', 'success');
        } catch (e) { erro(e, 'Erro ao cadastrar na máquina'); }
      }
    }
  };

  const setQtd = (cod: string, valor: string) => {
    const v = valor.trim() === '' ? NaN : Number(valor.replace(',', '.'));
    if (isNaN(v) || v < 0) return;
    setQtdOverride(prev => { const n = { ...prev, [cod]: v }; setTimeout(() => salvarBoard({ qtdMap: n }), 0); return n; });
  };
  const setLoteData = (maqId: number, lote: number, valor: string) => {
    setLotesPorMaq(prev => {
      const n = { ...prev, [maqId]: (prev[maqId] || []).map(l => l.lote === lote ? { ...l, data: valor } : l) };
      setTimeout(() => salvarBoard({ lotesM: n }), 0); return n;
    });
  };
  const setLoteDataFim = (maqId: number, lote: number, valor: string) => {
    setLotesPorMaq(prev => {
      const n = { ...prev, [maqId]: (prev[maqId] || []).map(l => l.lote === lote ? { ...l, dataFim: valor } : l) };
      setTimeout(() => salvarBoard({ lotesM: n }), 0); return n;
    });
  };
  const novoLote = (maqId: number) => {
    setLotesPorMaq(prev => {
      const arr = prev[maqId] || [];
      const proximo = arr.length ? Math.max(...arr.map(l => l.lote)) + 1 : 0;
      const novo: LoteInfo = { lote: proximo, data: '', ordem: arr.length };
      const n = { ...prev, [maqId]: [...arr, novo] };
      setItems(it => { const ni = { ...it, [lkey(maqId, proximo)]: [] }; setTimeout(() => salvarBoard({ conts: ni, lotesM: n }), 0); return ni; });
      return n;
    });
  };
  const removerLote = (maqId: number, lote: number) => {
    if ((items[lkey(maqId, lote)] || []).length > 0) { showToast('O lote tem itens. Mova-os antes de remover.', 'error'); return; }
    setLotesPorMaq(prev => {
      const arr = (prev[maqId] || []).filter(l => l.lote !== lote);
      if (arr.length === 0) return prev; // sempre ao menos 1 lote
      const reordenado = arr.map((l, i) => ({ ...l, ordem: i }));
      const n = { ...prev, [maqId]: reordenado };
      setItems(it => { const ni = { ...it }; delete ni[lkey(maqId, lote)]; setTimeout(() => salvarBoard({ conts: ni, lotesM: n }), 0); return ni; });
      return n;
    });
  };

  const filtroUpper = filtro.trim().toUpperCase();
  const visivel = useCallback((ck: string) => {
    if (qtdDe(ck) <= 0) return false;                 // produtos sem quantidade a produzir não aparecem na programação
    if (!filtroUpper) return true;
    const cod = codDe(ck); const it = byCod[cod];
    return cod.toUpperCase().includes(filtroUpper) || (it?.DESCRICAO || '').toUpperCase().includes(filtroUpper);
  }, [filtroUpper, byCod, qtdDe]);
  const colCods = (id: string) => (items[id] || []).filter(visivel);
  // Ajuste 1 (17/06): ao filtrar por código/nome, esconde máquinas sem nenhum item correspondente
  // — vê só o(s) equipamento(s) onde o produto buscado está + o BACKLOG. Quando o produto NÃO está
  // em máquina nenhuma (só no BACKLOG ou ausente), mantém todas as máquinas visíveis pra que o
  // usuário possa arrastar o card do BACKLOG pra uma delas.
  const ordemMaquinasVisiveis = useMemo(() => {
    if (!filtroUpper) return ordemMaquinas;
    const filtradas = ordemMaquinas.filter(m => (lotesPorMaq[m.id] || []).some(l => (items[lkey(m.id, l.lote)] || []).some(visivel)));
    return filtradas.length > 0 ? filtradas : ordemMaquinas;
  }, [ordemMaquinas, filtroUpper, lotesPorMaq, items, visivel]);

  const kpis = useMemo(() => ({
    total: plano.length,
    alocados: Object.keys(items).reduce((s, k) => s + (parseLkey(k) ? items[k].length : 0), 0),
    backlog: items[BACKLOG]?.length || 0,
  }), [plano, items]);

  // ---- PDF por máquina ----
  const gerarPdf = async (m: Maquina) => {
    const lotes = (lotesPorMaq[m.id] || []);
    const totalAtivos = lotes.reduce((s, l) => s + (items[lkey(m.id, l.lote)] || []).filter(c => ativoDe(c)).length, 0);
    if (totalAtivos === 0) { showToast('Sem itens ativos nesta máquina.', 'info'); return; }
    const ACCENT: [number, number, number] = [231, 76, 60];
    const DARK: [number, number, number] = [30, 41, 59];
    const SOFT: [number, number, number] = [241, 245, 249];
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth();
    const H = doc.internal.pageSize.getHeight();

    let logoB64: string | null = null;
    try {
      const resp = await fetch('/Logo-EMPRESA.png'); const blob = await resp.blob();
      logoB64 = await new Promise<string>((res) => { const r = new FileReader(); r.onloadend = () => res(r.result as string); r.readAsDataURL(blob); });
    } catch { /* sem logo */ }

    const subInfo = `Lotes: ${lotes.length}    |    Versão: ${fmtDt(versaoSel?.oficial_em || versaoSel?.created_at)}    |    Itens: ${totalAtivos}`;
    const drawHeaderFooter = (pageNum: number, totalPages: number) => {
      doc.setFillColor(...ACCENT); doc.rect(0, 0, W, 3, 'F');
      if (logoB64) { doc.setFillColor(...ACCENT); doc.roundedRect(8, 6, 46, 18, 2, 2, 'F'); try { doc.addImage(logoB64, 'PNG', 10, 8, 42, 14); } catch { /* */ } }
      doc.setTextColor(...DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
      doc.text(`Programação — ${m.nome}`, 60, 14);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
      doc.text(subInfo, 60, 19);
      doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, 60, 23);
      doc.setDrawColor(...ACCENT); doc.setLineWidth(0.4); doc.line(10, 28, W - 10, 28);
      doc.setDrawColor(...ACCENT); doc.setLineWidth(0.5); doc.line(10, H - 10, W - 10, H - 10);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120, 120, 120);
      doc.text('EMPRESA — Programação de Produção (Setor Fábrica)', 10, H - 5);
      doc.text(`Página ${pageNum} de ${totalPages}`, W - 10, H - 5, { align: 'right' });
      doc.setFillColor(...ACCENT); doc.triangle(W, H, W - 10, H, W, H - 10, 'F');
    };

    let startY = 35;
    // Uma SEÇÃO por lote (com sua data)
    lotes.forEach((l, li) => {
      const codsL = (items[lkey(m.id, l.lote)] || []).filter(c => ativoDe(c));
      if (codsL.length === 0) return;
      let totProd = 0, totOp = 0, totAp = 0;
      const fmtComps = (cod: string, tp: 'encarte' | 'taba') => {
        const comps = compsDoItem(cod, tp);
        if (comps.length === 0) return '—';
        return comps.map(cp => `${cp.cod}${cp.manual ? ' [manual]' : ''}: ${cp.necessidade === undefined ? '—' : num(cp.necessidade)}${cp.unidade ? ` ${cp.unidade}` : ''}${cp.qtdUsar !== undefined ? ` (usar ${num(cp.qtdUsar)})` : ''}`).join('\n');
      };
      // Calcula início/término por item (cumulativo dentro do lote, setup só na troca de produto).
      const cal = calDaMaquina(m.id);
      let cursor: string | null = l.data || null;
      let prevCod: string | null = null;
      const inicioMap: Record<string, string | null> = {};
      const fimMap: Record<string, string | null> = {};
      for (const ck of codsL) {
        const cod = codDe(ck);
        inicioMap[ck] = cursor;
        const ph = maqTempos[cod] ?? null;
        const f = cursor && ph && ph > 0 ? calcFimPlanejado(cursor, qtdDe(ck), ph, cal, cod !== prevCod) : null;
        fimMap[ck] = f;
        if (f) cursor = f;
        prevCod = cod;
      }
      const body = codsL.map((ck, i) => {
        const cod = codDe(ck);
        const it = byCod[cod]; const lista = opsPorCodigo.get(cod) || [];
        const nops = lista.map(o => o.numero_op).join(', ') || '—';
        const tot = lista.reduce((s, o) => s + (o.qtd_op || 0), 0);
        const ap = lista.reduce((s, o) => s + (o.apontada || 0), 0);
        totProd += qtdDe(ck); totOp += tot; totAp += ap;
        return [String(i + 1), String(it?.SEQUENCIA ?? '—'), cod, it?.DESCRICAO || '', num(qtdDe(ck)), inicioMap[ck] ? fmtDt(inicioMap[ck]) : '—', fimMap[ck] ? fmtDt(fimMap[ck]) : '—', fmtComps(ck, 'encarte'), fmtComps(ck, 'taba'), nops, lista.length ? num(tot) : '—', lista.length ? num(ap) : '—'];
      });
      const titulo = `Programação ${li + 1} — Início: ${l.data ? (l.data.includes('T') ? fmtDt(l.data) : fmtData(l.data)) : 'sem data'}  (${codsL.length} item${codsL.length > 1 ? 's' : ''})`;
      autoTable(doc, {
        startY,
        head: [[{ content: titulo, colSpan: 12, styles: { halign: 'left', fillColor: ACCENT, textColor: 255, fontStyle: 'bold', fontSize: 9 } }],
               ['Ordem', 'Seq. otim.', 'Código', 'Produto', 'Qtd. a produzir', 'Início', 'Término', 'Encarte', 'Taba', 'Nº das OPs', 'Qtd. total OP', 'Qtd. apontada']],
        body,
        foot: [['', '', '', 'TOTAL', num(totProd), '', '', '', '', '', num(totOp), num(totAp)]],
        theme: 'striped',
        styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, overflow: 'linebreak' },
        headStyles: { fillColor: DARK, textColor: 255, fontSize: 8 },
        footStyles: { fillColor: SOFT, textColor: DARK, fontStyle: 'bold' },
        columnStyles: { 0: { halign: 'center', cellWidth: 12 }, 1: { halign: 'center', cellWidth: 14 }, 2: { cellWidth: 20 }, 4: { halign: 'right', cellWidth: 18 }, 5: { halign: 'center', cellWidth: 22, fontSize: 7 }, 6: { halign: 'center', cellWidth: 22, fontSize: 7 }, 7: { cellWidth: 28, fontSize: 7 }, 8: { cellWidth: 28, fontSize: 7 }, 10: { halign: 'right', cellWidth: 16 }, 11: { halign: 'right', cellWidth: 16 } },
        margin: { top: 32, left: 10, right: 10 },
      });
      startY = (doc as any).lastAutoTable.finalY + 8;
    });
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) { doc.setPage(i); drawHeaderFooter(i, total); }
    doc.save(`Programacao_${m.nome.replace(/[^A-Za-z0-9]+/g, '_')}.pdf`);
  };

  // ---- PDF geral (todas as máquinas) ----
  const gerarPdfGeral = async () => {
    const maqsComItens = maquinas.filter(m => (lotesPorMaq[m.id] || []).some(l => (items[lkey(m.id, l.lote)] || []).filter(c => ativoDe(c)).length > 0));
    if (maqsComItens.length === 0) { showToast('Nenhuma máquina com itens ativos.', 'info'); return; }
    const ACCENT: [number, number, number] = [231, 76, 60];
    const DARK: [number, number, number] = [30, 41, 59];
    const SOFT: [number, number, number] = [241, 245, 249];
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    const W = doc.internal.pageSize.getWidth(); const H = doc.internal.pageSize.getHeight();
    let logoB64: string | null = null;
    try { const resp = await fetch('/Logo-EMPRESA.png'); const blob = await resp.blob(); logoB64 = await new Promise<string>((res) => { const r = new FileReader(); r.onloadend = () => res(r.result as string); r.readAsDataURL(blob); }); } catch { /* */ }
    const drawHF = (pageNum: number, total: number) => {
      doc.setFillColor(...ACCENT); doc.rect(0, 0, W, 3, 'F');
      if (logoB64) { doc.setFillColor(...ACCENT); doc.roundedRect(8, 6, 46, 18, 2, 2, 'F'); try { doc.addImage(logoB64, 'PNG', 10, 8, 42, 14); } catch { /* */ } }
      doc.setTextColor(...DARK); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
      doc.text('Programação Geral — Todas as Máquinas', 60, 14);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(100, 116, 139);
      doc.text(`Versão: ${fmtDt(versaoSel?.oficial_em || versaoSel?.created_at)}    |    Máquinas: ${maqsComItens.length}`, 60, 19);
      doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`, 60, 23);
      doc.setDrawColor(...ACCENT); doc.setLineWidth(0.4); doc.line(10, 28, W - 10, 28);
      doc.setDrawColor(...ACCENT); doc.setLineWidth(0.5); doc.line(10, H - 10, W - 10, H - 10);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(120, 120, 120);
      doc.text('EMPRESA — Programação de Produção (Setor Fábrica)', 10, H - 5);
      doc.text(`Página ${pageNum} de ${total}`, W - 10, H - 5, { align: 'right' });
      doc.setFillColor(...ACCENT); doc.triangle(W, H, W - 10, H, W, H - 10, 'F');
    };
    let primeiraPage = true;
    for (const m of maqsComItens) {
      const lotes = lotesPorMaq[m.id] || [];
      if (!primeiraPage) doc.addPage();
      primeiraPage = false;
      let startY = 35;
      doc.setFillColor(...DARK); doc.roundedRect(10, startY, W - 20, 8, 1, 1, 'F');
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      doc.text(`Máquina: ${m.nome}`, 14, startY + 5.5);
      startY += 12;
      lotes.forEach((l, li) => {
        const codsL = (items[lkey(m.id, l.lote)] || []).filter(c => ativoDe(c));
        if (codsL.length === 0) return;
        let totProd = 0, totOp = 0, totAp = 0;
        const fmtComps = (cod: string, tp: 'encarte' | 'taba') => { const comps = compsDoItem(cod, tp); if (comps.length === 0) return '—'; return comps.map(cp => `${cp.cod}${cp.manual ? ' [manual]' : ''}: ${cp.necessidade === undefined ? '—' : num(cp.necessidade)}${cp.unidade ? ` ${cp.unidade}` : ''}${cp.qtdUsar !== undefined ? ` (usar ${num(cp.qtdUsar)})` : ''}`).join('\n'); };
        // Calcula início/término por item (cumulativo dentro do lote).
        const cal = calDaMaquina(m.id);
        let cursor: string | null = l.data || null;
        let prevCod: string | null = null;
        const inicioMap: Record<string, string | null> = {};
        const fimMap: Record<string, string | null> = {};
        for (const ck of codsL) {
          const cod = codDe(ck);
          inicioMap[ck] = cursor;
          const ph = maqTempos[cod] ?? null;
          const f = cursor && ph && ph > 0 ? calcFimPlanejado(cursor, qtdDe(ck), ph, cal, cod !== prevCod) : null;
          fimMap[ck] = f;
          if (f) cursor = f;
          prevCod = cod;
        }
        const body = codsL.map((ck, idx2) => { const cod = codDe(ck); const it = byCod[cod]; const lista = opsPorCodigo.get(cod) || []; const nops = lista.map(o => o.numero_op).join(', ') || '—'; const tot = lista.reduce((s, o) => s + (o.qtd_op || 0), 0); const ap = lista.reduce((s, o) => s + (o.apontada || 0), 0); totProd += qtdDe(ck); totOp += tot; totAp += ap; return [String(idx2 + 1), String(it?.SEQUENCIA ?? '—'), cod, it?.DESCRICAO || '', num(qtdDe(ck)), inicioMap[ck] ? fmtDt(inicioMap[ck]) : '—', fimMap[ck] ? fmtDt(fimMap[ck]) : '—', fmtComps(ck, 'encarte'), fmtComps(ck, 'taba'), nops, lista.length ? num(tot) : '—', lista.length ? num(ap) : '—']; });
        const titulo = `Programação ${li + 1} — Início: ${l.data ? (l.data.includes('T') ? fmtDt(l.data) : fmtData(l.data)) : 'sem data'}  (${codsL.length} item${codsL.length > 1 ? 's' : ''})`;
        autoTable(doc, { startY, head: [[{ content: titulo, colSpan: 12, styles: { halign: 'left', fillColor: ACCENT, textColor: 255, fontStyle: 'bold', fontSize: 9 } }], ['Ordem', 'Seq. otim.', 'Código', 'Produto', 'Qtd. a produzir', 'Início', 'Término', 'Encarte', 'Taba', 'Nº das OPs', 'Qtd. total OP', 'Qtd. apontada']], body, foot: [['', '', '', 'TOTAL', num(totProd), '', '', '', '', '', num(totOp), num(totAp)]], theme: 'striped', styles: { font: 'helvetica', fontSize: 8, cellPadding: 2, overflow: 'linebreak' }, headStyles: { fillColor: DARK, textColor: 255, fontSize: 8 }, footStyles: { fillColor: SOFT, textColor: DARK, fontStyle: 'bold' }, columnStyles: { 0: { halign: 'center', cellWidth: 12 }, 1: { halign: 'center', cellWidth: 14 }, 2: { cellWidth: 20 }, 4: { halign: 'right', cellWidth: 18 }, 5: { halign: 'center', cellWidth: 22, fontSize: 7 }, 6: { halign: 'center', cellWidth: 22, fontSize: 7 }, 7: { cellWidth: 28, fontSize: 7 }, 8: { cellWidth: 28, fontSize: 7 }, 10: { halign: 'right', cellWidth: 16 }, 11: { halign: 'right', cellWidth: 16 } }, margin: { top: 32, left: 10, right: 10 } });
        startY = (doc as any).lastAutoTable.finalY + 8;
      });
    }
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) { doc.setPage(i); drawHF(i, total); }
    doc.save(`Programacao_Geral_${new Date().toISOString().slice(0, 10)}.pdf`);
  };

  // ---- comparação ----
  const labelVersao = (v: Versao) => `${fmtDt(v.oficial_em || v.created_at)}${v.created_by_name ? ` · ${v.created_by_name}` : ''}`;
  const abrirComparar = (b?: string, n?: string) => { setCmpData(null); setCmpBase(b || versaoSel?.id || oficiais[1]?.id || ''); setCmpNovo(n || novaVersao?.id || oficiais[0]?.id || ''); setCmpOpen(true); };
  const executarComparar = async () => {
    if (!cmpBase || !cmpNovo || cmpBase === cmpNovo) { showToast('Selecione duas versões diferentes', 'error'); return; }
    setCmpLoading(true);
    try { const { data } = await api.get('/programacao/comparar', { params: { base: cmpBase, novo: cmpNovo } }); setCmpData(data); }
    catch (e) { erro(e, 'Erro ao comparar'); } finally { setCmpLoading(false); }
  };
  const carregarNova = async () => { if (!novaVersao) return; setCmpOpen(false); await carregarVersao(novaVersao); showToast('Nova versão carregada', 'success'); };
  // Save explícito da operação: congela a programação atual numa versão oficial (consumida pelo Faturamento).
  const executarSalvar = async (oficial: boolean) => {
    if (!versaoSel) return;
    setSalvarModalOpen(false);
    setSalvandoVersao(true);
    try {
      const { data } = await api.post('/programacao/salvar-versao', { plano_versao_id: versaoSel.id, oficial });
      showToast(
        data?.criada === false
          ? 'Nenhuma mudança desde a última versão salva'
          : (oficial ? 'Versão da programação salva como oficial' : 'Versão da programação salva (não oficial)'),
        'success'
      );
    } catch (e) { erro(e, 'Erro ao salvar versão da programação'); }
    finally { setSalvandoVersao(false); }
  };

  // Histórico: lista todas as versões que foram sendo salvas neste plano.
  const abrirHistorico = async () => {
    if (!versaoSel) return;
    setHistOpen(true); setHistLoading(true);
    try {
      const { data } = await api.get('/programacao/versoes-salvas', { params: { plano_versao_id: versaoSel.id } });
      setHistorico(data?.versoes || []);
    } catch (e) { erro(e, 'Erro ao carregar histórico de versões'); }
    finally { setHistLoading(false); }
  };
  // Restaura a versão escolhida de volta no quadro atual (sobrescreve a montagem atual).
  const restaurarVersaoSalva = async (v: VersaoSalva) => {
    if (!versaoSel) return;
    const ok = await confirmar({
      title: 'Restaurar versão da programação',
      message: `Restaurar a versão de ${fmtDt(v.created_at)}${v.created_by_name ? ` (${v.created_by_name})` : ''} no quadro atual? A montagem atual será SUBSTITUÍDA por esta versão. Salve a montagem atual antes se quiser preservá-la.`,
      variant: 'danger', confirmText: 'Restaurar', cancelText: 'Cancelar',
    });
    if (!ok) return;
    setRestaurandoId(v.id);
    try {
      await api.post(`/programacao/versoes-salvas/${v.id}/restaurar`, {});
      setHistOpen(false);
      await carregarVersao(versaoSel, true);
      showToast('Versão restaurada no quadro atual', 'success');
    } catch (e) { erro(e, 'Erro ao restaurar versão'); }
    finally { setRestaurandoId(null); }
  };

  const dadosItem = dadosCod ? byCod[codDe(dadosCod)] : null;
  const opsItem = opsCod ? byCod[codDe(opsCod)] : null;
  // OPs em produção do item aberto no detalhe (tela unificada).
  const opsList = dadosCod ? (opsPorCodigo.get(codDe(dadosCod)) || []) : [];

  const PedidosTabela: React.FC<{ it: PlanoRow }> = ({ it }) => {
    const dem = it.DEMANDA_POR_PEDIDO || {};
    const val = it.VALOR_ITEM_POR_PEDIDO || it.VALOR_POR_PEDIDO_COMPLETO || {};
    const pedidos = Array.from(new Set([...Object.keys(dem), ...Object.keys(val)]));
    const totQtd = pedidos.reduce((s, p) => s + (dem[p] || 0), 0);
    const totVal = pedidos.reduce((s, p) => s + (val[p] || 0), 0);
    return (
      <>
        <div className="flex items-center gap-2 mb-2"><ClipboardList className="w-4 h-4 text-blue-600" /><span className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">Pedidos do item</span><span className="px-2 py-0.5 rounded-full bg-blue-500 text-white text-xs font-bold">{pedidos.length}</span></div>
        {pedidos.length === 0 ? <div className="text-sm text-slate-400 py-4 text-center rounded-xl ring-1 ring-slate-200 dark:ring-slate-700">Sem pedidos vinculados.</div> : (
          <div className="overflow-auto rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 max-h-56">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-700/40 sticky top-0"><tr>
                <th className="text-left px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500">Pedido</th>
                <th className="text-right px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500">Qtd. no pedido</th>
                <th className="text-right px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500">Valor do produto</th>
              </tr></thead>
              <tbody>
                {pedidos.map(p => (
                  <tr key={p} className="border-t border-slate-100 dark:border-slate-700">
                    <td className="px-3 py-2 font-mono text-slate-700 dark:text-slate-200">{p}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{num(dem[p])}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-300">{money(val[p])}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="sticky bottom-0">
                <tr className="border-t-2 border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700/60 font-bold">
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-200">TOTAL</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700 dark:text-slate-200">{num(totQtd)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-emerald-700 dark:text-emerald-300">{money(totVal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </>
    );
  };

  return (
    <div className={`overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50/60 to-indigo-50 dark:from-slate-900 dark:via-blue-950/40 dark:to-indigo-950/40 ${expandido ? 'fixed inset-0 z-[100] overflow-y-auto' : 'relative -m-4 md:-m-6 lg:-m-8 min-h-[calc(100vh-2rem)]'}`}>
      <div className="pointer-events-none absolute -top-32 -left-32 w-[480px] h-[480px] rounded-full bg-blue-300/40 blur-3xl dark:bg-blue-700/20" />
      <div className="pointer-events-none absolute top-1/3 -right-40 w-[520px] h-[520px] rounded-full bg-indigo-300/40 blur-3xl dark:bg-indigo-700/20" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.04] dark:opacity-[0.08]" style={{ backgroundImage: 'linear-gradient(rgb(30,58,138) 1px, transparent 1px), linear-gradient(90deg, rgb(30,58,138) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

      <div className={`relative p-4 sm:p-6 mx-auto ${expandido ? 'max-w-none' : 'max-w-[1700px]'}`}>
        <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="grid place-items-center w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/25"><CalendarClock className="w-6 h-6" /></div>
            <div><h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Programação</h1><p className="text-sm text-slate-500 dark:text-slate-400">Arraste os itens para as máquinas e monte a ordem de produção.</p></div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {versaoSel && <span className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"><BadgeCheck className="w-4 h-4 text-emerald-600" />Versão: {fmtDt(versaoSel.oficial_em || versaoSel.created_at)}</span>}
            <button onClick={() => abrirComparar()} disabled={oficiais.length < 2} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer disabled:opacity-50"><GitCompareArrows className="w-4 h-4 text-indigo-600" />Comparar</button>
            <button onClick={() => setSalvarModalOpen(true)} disabled={salvandoVersao || !versaoSel} title="Salvar a programação atual como uma nova versão (oficial ou não)" className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 cursor-pointer disabled:opacity-50"><Save className={`w-4 h-4 ${salvandoVersao ? 'animate-pulse' : ''}`} />Salvar versão</button>
            <button onClick={abrirHistorico} disabled={!versaoSel} title="Ver todas as versões salvas e restaurar uma delas no quadro atual" className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/30 cursor-pointer disabled:opacity-50"><History className="w-4 h-4" />Histórico</button>
            <button onClick={gerarPdfGeral} disabled={!versaoSel} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium border border-rose-300 dark:border-rose-700 text-rose-700 dark:text-rose-300 hover:bg-rose-50 dark:hover:bg-rose-900/30 cursor-pointer disabled:opacity-50"><FileDown className="w-4 h-4" />PDF Geral</button>
            <button onClick={abrirConfigCalendario} title="Configurar o calendário de produção (turno, pausas, fim de semana, feriados)" className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 cursor-pointer"><CalendarClock className="w-4 h-4" />Calendário</button>
            <button onClick={programacaoAutomatica} disabled={!versaoSel} title="Distribuir os produtos nas máquinas cadastradas, definir início e calcular término automaticamente" className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer disabled:opacity-50"><Layers className="w-4 h-4" />Programação automática</button>
            <button onClick={atualizarCriticos} disabled={criticosLoading} title="Buscar SKUs que estão segurando pedidos no Otimizador de Faturamento e destacar nos cards" className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium bg-rose-600 text-white hover:bg-rose-700 cursor-pointer disabled:opacity-50"><AlertTriangle className="w-4 h-4" />{criticosLoading ? 'Carregando…' : 'Atualizar críticos'}</button>
            <button onClick={gerarExcel} disabled={!versaoSel} title="Exportar a programação para Excel (uma aba por máquina)" className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-900/30 cursor-pointer disabled:opacity-50"><FileDown className="w-4 h-4" />Excel</button>
            <button onClick={limparProgramacao} disabled={!versaoSel} title="Devolver todos os itens para A programar e limpar as datas dos lotes" className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"><Trash2 className="w-4 h-4" />Limpar</button>
            <button onClick={() => setExpandido(e => !e)} title={expandido ? 'Voltar ao tamanho normal' : 'Expandir a página (ocupar a tela toda)'} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer">{expandido ? <Minimize2 className="w-4 h-4 text-indigo-600" /> : <Maximize2 className="w-4 h-4 text-indigo-600" />}{expandido ? 'Voltar ao normal' : 'Expandir'}</button>
            <button onClick={() => versaoSel && carregarVersao(versaoSel, true)} disabled={loading || !versaoSel} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 shadow-sm shadow-blue-600/20 disabled:opacity-50 cursor-pointer"><RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />Atualizar</button>
          </div>
        </div>

        {itensSemPh.length > 0 && (
          <div className="mb-2 flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 ring-1 ring-amber-200 dark:ring-amber-900/50 flex-wrap">
            <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200">
              <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
              <span><b>{itensSemPh.length} ite{itensSemPh.length === 1 ? 'm' : 'ns'}</b> sem peças/hora cadastrada nas máquinas onde estão — a previsão de término deles ficará vazia até cadastrar.</span>
            </div>
            <button onClick={cadastrarPhFaltantes} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-amber-300 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 cursor-pointer">Cadastrar agora</button>
          </div>
        )}

        {/* 18/06: aviso separado pra itens em "A programar" — clarear que kpis.backlog representa
            cards aguardando distribuição (sem máquina cadastrada ou ainda não arrastados). */}
        {kpis.backlog > 0 && (
          <div className="mb-4 flex items-center gap-2 px-4 py-3 rounded-xl bg-amber-50/60 dark:bg-amber-950/20 ring-1 ring-amber-200/60 dark:ring-amber-900/40 text-sm text-amber-800 dark:text-amber-200">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" />
            <span><b>{kpis.backlog} ite{kpis.backlog === 1 ? 'm' : 'ns'}</b> em <b>"A programar"</b> — arraste para uma máquina (use a busca abaixo para filtrar por código ou nome).</span>
          </div>
        )}

        {novaVersao && (
          <div className="mb-4 flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 ring-1 ring-amber-200 dark:ring-amber-900/50 flex-wrap">
            <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200"><AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" /><span>Há uma <b>nova versão oficial</b> ({labelVersao(novaVersao)}).</span></div>
            <div className="flex items-center gap-2">
              <button onClick={() => abrirComparar(versaoSel?.id, novaVersao.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium border border-amber-300 text-amber-800 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 cursor-pointer"><GitCompareArrows className="w-4 h-4" />Comparar</button>
              <button onClick={carregarNova} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-500 text-white hover:bg-amber-600 cursor-pointer">Carregar nova</button>
            </div>
          </div>
        )}

        <div className={`grid ${criticosTotais ? 'grid-cols-4' : 'grid-cols-3'} gap-3 mb-4`}>
          {[
            ['Itens no plano', kpis.total, Layers, 'blue'],
            ['Alocados em máquinas', kpis.alocados, Factory, 'emerald'],
            ['A programar', kpis.backlog, Inbox, 'amber'],
            ...(criticosTotais ? [[`Bloqueando faturamento`, `${criticosTotais.n_skus} SKUs · R$ ${(criticosTotais.valor || 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`, AlertTriangle, 'amber']] : []),
          ].map(([l, n, Ic, c]: any) => (
            <div key={l} className={`${card} relative overflow-hidden p-4 flex items-center gap-3`}>
              <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${CMP_TONES[c].dot}`} />
              <div className={`grid place-items-center w-11 h-11 rounded-xl ${CMP_TONES[c].card} ${CMP_TONES[c].title}`}><Ic className="w-5 h-5" /></div>
              <div><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{l}</div><div className="text-2xl font-bold text-slate-800 dark:text-slate-100 tabular-nums">{num(n)}</div></div>
            </div>
          ))}
        </div>

        {!loading && !versaoSel ? (
          <div className={`${card} text-center text-slate-400 py-16 text-sm`}>
            Nenhuma versão oficial encontrada.<br />Gere o plano no Otimizador de Produção e marque uma versão como oficial.
          </div>
        ) : loading ? (
          <div className={`${card} text-center text-slate-400 py-16 text-sm`}>Carregando…</div>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={(e) => setActiveId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
            <div className="flex gap-3 items-start">
              <div className="shrink-0 space-y-2" style={{ width: backlogColW }}>
                {/* Busca por código ou nome — acima da coluna "A programar" */}
                <div className="relative">
                  <Search className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    className="w-full pl-11 pr-9 py-3 rounded-xl border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500/60"
                    placeholder="Buscar por código ou nome do produto"
                    value={filtro} onChange={e => setFiltro(e.target.value)} />
                  {filtro && <button onClick={limparFiltro} title="Limpar busca (e remover do storage)" className="absolute right-2 top-1/2 -translate-y-1/2 grid place-items-center w-6 h-6 rounded text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>}
                </div>
                <Column id={BACKLOG} titulo="A programar" subtitulo="Arraste para uma máquina" cor="bg-slate-200/80 dark:bg-slate-700 text-slate-700 dark:text-slate-200" Icon={Inbox}
                  cods={[...(items[BACKLOG] || [])].filter(visivel).sort((a, b) => (byCkey[a]?.SEQUENCIA ?? 0) - (byCkey[b]?.SEQUENCIA ?? 0))}
                  byCod={byCkey} qtdDe={qtdDe} opCount={opCount} ativoDe={ativoDe} temObs={(c) => !!obs[c]} sel={sel} onToggleSel={toggleSelCard} onDados={setDadosCod} onOps={setOpsCod} avisoTabaDe={avisoTabaDe} criticoDe={(c) => criticosMap.get(codDe(c)) || null} concluidoDe={concluidoDe} qtdProdDe={qtdProdDe} onConcluido={toggleConcluido} onQtdProd={setQtdProduzida} minWidth="w-full" widthPx={backlogColW} onResize={setBacklogColW} semProgresso semCadastroPhDe={(c) => { const ph = maqTempos[codDe(c)]; return ph == null || ph <= 0; }} />
              </div>
              <div className="flex-1 overflow-x-auto pb-2">
                {maquinas.length === 0 ? <div className="text-sm text-slate-400 py-8">Nenhuma máquina cadastrada. Cadastre em Fábrica › Cadastro de Máquinas.</div> : (
                  <SortableContext items={ordemMaquinas.map(m => `col_${m.id}`)} strategy={horizontalListSortingStrategy}>
                    <div className="flex gap-3">
                      {ordemMaquinasVisiveis.map(m => (
                        <SortableMachine key={m.id} m={m} colProps={{
                          id: mkey(m.id), titulo: m.nome, cor: 'bg-blue-600 text-white', corHex: m.cor, Icon: Factory,
                          byCod: byCkey, qtdDe, opCount, ativoDe, temObs: (c: string) => !!obs[c], sel, onToggleSel: toggleSelCard,
                          onDados: setDadosCod, onOps: setOpsCod,
                          maqId: m.id,
                          // Ajuste 1 (17/06): com filtro, esconde lotes sem item correspondente.
                          // Se a máquina não tem nenhum lote com item filtrado, mantém todos os lotes
                          // visíveis (drop target para arrastar o card do BACKLOG).
                          lotes: (() => {
                            const lts = lotesPorMaq[m.id] || [];
                            if (!filtroUpper) return lts;
                            const comItem = lts.filter(l => colCods(lkey(m.id, l.lote)).length > 0);
                            return comItem.length > 0 ? comItem : lts;
                          })(),
                          codsDoLote: (lote: number) => colCods(lkey(m.id, lote)),
                          onLoteData: (lote: number, v: string) => setLoteData(m.id, lote, v),
                          onLoteDataFim: (lote: number, v: string) => setLoteDataFim(m.id, lote, v),
                          tempoEstH: (lote: number) => {
                            const cs = (lotesPorMaq[m.id] || []).find(l => l.lote === lote) ? (items[lkey(m.id, lote)] || []) : [];
                            const t = cs.filter(c => ativoDe(codDe(c))).reduce((s, c) => { const ph = maqTempos[codDe(c)]; return s + (ph && ph > 0 ? qtdDe(c) / ph : 0); }, 0);
                            return t > 0 ? t : null;
                          },
                          fimPlanejado: (lote: number) => fimLote(m.id, lote),
                          onNovoLote: () => novoLote(m.id), onRemoverLote: (lote: number) => removerLote(m.id, lote),
                          onPdf: () => gerarPdf(m), onLimpar: () => limparMaquina(m.id), onAbrir: () => abrirMaquina(m), realce: dragRealce(m.id),
                          tabasGeradas: tabasPorMaquina[m.id] || [],
                          onTabaDados: setTabaDetalhe,
                          ehSopro: soproMaquinas.some(s => s.id === m.id),
                          avisoTabaDe, criticoDe: (c: string) => criticosMap.get(codDe(c)) || null,
                          concluidoDe, qtdProdDe, onConcluido: toggleConcluido, onQtdProd: setQtdProduzida, onGerarSaldo: gerarSaldo,
                          widthPx: maqColW, onResize: setMaqColW,
                        }} />
                      ))}
                    </div>
                  </SortableContext>
                )}
              </div>
            </div>
            <DragOverlay>
              {activeId && byCod[codDe(activeId)] ? (
                <div className="relative flex items-center gap-2 px-2.5 py-2 rounded-lg bg-white dark:bg-slate-800 ring-2 ring-blue-400 shadow-lg w-60">
                  {sel.has(activeId) && sel.size > 1 && <span className="absolute -top-2 -right-2 grid place-items-center min-w-[22px] h-[22px] px-1 rounded-full bg-blue-600 text-white text-xs font-bold shadow">{sel.size}</span>}
                  <GripVertical className="w-4 h-4 text-slate-300" />
                  <div className="min-w-0 flex-1"><div className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200">{codDe(activeId)}</div><div className="text-xs text-slate-500 truncate">{byCod[codDe(activeId)].DESCRICAO}</div></div>
                  <span className="px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 text-xs font-semibold">{sel.has(activeId) && sel.size > 1 ? `${sel.size} itens` : num(qtdDe(activeId))}</span>
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      <Portal>
      {/* MODAL Frente 0 (17/06): cadastro obrigatório de peças/hora ao mover card pra máquina sem cadastro */}
      {phPrompt && (
        <div className="fixed inset-0 z-[1100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="text-base font-semibold text-slate-900 dark:text-slate-100 mb-1">Cadastrar peças/hora</div>
            <div className="text-sm text-slate-600 dark:text-slate-300 mb-4">
              O produto <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">{phPrompt.cod}</span>
              {phPrompt.descricao && phPrompt.descricao !== phPrompt.cod ? <> — <span className="italic">{phPrompt.descricao}</span></> : null}
              {' '}não tem peças/hora cadastrada em <span className="font-semibold">{phPrompt.maqNome}</span>. Informe agora para que a previsão de término seja calculada e o cadastro fique salvo.
            </div>
            <label className="block text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Peças por hora em {phPrompt.maqNome}</label>
            <input
              type="number" min="0" step="any" autoFocus
              value={phPrompt.valor}
              onChange={e => setPhPrompt(p => p ? { ...p, valor: e.target.value } : p)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  const v = Number((phPrompt.valor || '').replace(',', '.'));
                  if (!isNaN(v) && v > 0 && phPrompt) { phPrompt.resolver({ ph: v, outras: Array.from(phPrompt.outras) }); setPhPrompt(null); }
                }
                // Esc desabilitado: use os botões abaixo.
              }}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="ex.: 120"
            />
            <div className="mt-4">
              <div className="text-xs font-medium text-slate-700 dark:text-slate-200 mb-1">Este produto também pode ser feito em (opcional):</div>
              <div className="max-h-40 overflow-y-auto rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 p-2 space-y-1 bg-slate-50/50 dark:bg-slate-900/30">
                {maquinas.filter(m => m.id !== phPrompt.maqId).map(m => (
                  <label key={m.id} className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 rounded px-1.5 py-0.5">
                    <input
                      type="checkbox"
                      checked={phPrompt.outras.has(m.id)}
                      onChange={e => setPhPrompt(p => {
                        if (!p) return p;
                        const next = new Set(p.outras);
                        if (e.target.checked) next.add(m.id); else next.delete(m.id);
                        return { ...p, outras: next };
                      })}
                    />
                    <span>{m.nome}</span>
                  </label>
                ))}
                {maquinas.filter(m => m.id !== phPrompt.maqId).length === 0 && <div className="text-[11px] text-slate-400 px-1.5">Nenhuma outra máquina cadastrada.</div>}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">As máquinas marcadas serão registradas como aptas para o produto (sem peças/hora — pode definir depois em cada uma).</div>
            </div>
            <div className="text-[11px] text-amber-700 dark:text-amber-300 mt-3">⚠️ Salvar é obrigatório para calcular a previsão de término. <b>Cancelar</b> devolve o card para "A programar".</div>
            <div className="flex justify-end gap-2 mt-4">
              <button
                className="px-3 py-1.5 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700"
                onClick={() => { phPrompt.resolver(null); setPhPrompt(null); }}
              >Cancelar e devolver para A programar</button>
              <button
                className="px-3 py-1.5 rounded-lg text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                disabled={!phPrompt.valor || isNaN(Number((phPrompt.valor || '').replace(',', '.'))) || Number((phPrompt.valor || '').replace(',', '.')) <= 0}
                onClick={() => {
                  const v = Number((phPrompt.valor || '').replace(',', '.'));
                  if (!isNaN(v) && v > 0) { phPrompt.resolver({ ph: v, outras: Array.from(phPrompt.outras) }); setPhPrompt(null); }
                }}
              >Salvar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL configuração do calendário de produção */}
      {calConfigOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={() => setCalConfigOpen(false)}>
          <div className={`${card} w-full max-w-5xl h-[88vh] max-h-[88vh] overflow-hidden flex flex-col`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 px-5 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
              <div className="flex items-center gap-3 min-w-0"><div className="grid place-items-center w-10 h-10 rounded-xl bg-white/20"><CalendarClock className="w-5 h-5" /></div><div className="min-w-0"><div className="text-xs font-medium text-white/80">Configuração</div><div className="text-lg font-bold">Calendário de produção</div></div></div>
              <button onClick={() => setCalConfigOpen(false)} className="text-white/80 hover:text-white shrink-0"><X className="w-5 h-5" /></button>
            </div>
            <div className="flex flex-1 min-h-0">
              {/* Sidebar: escolha o que configurar — Geral ou uma máquina (cada um é salvo separadamente) */}
              <aside className="w-56 shrink-0 overflow-auto border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 p-3 space-y-1">
                <div className="px-2 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Configurar</div>
                <button onClick={() => carregarDraftCal(null)} className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left ${calAlvo == null ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700/60'}`}>
                  <CalendarClock className="w-4 h-4 shrink-0" />
                  <div className="min-w-0"><div className="text-sm font-semibold truncate">Geral</div><div className={`text-[10px] truncate ${calAlvo == null ? 'text-white/80' : 'text-slate-400'}`}>vale para todas</div></div>
                </button>
                <div className="px-2 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wide text-slate-400">Máquinas</div>
                {maquinas.map(m => {
                  const proprio = !!calendariosMaq[m.id]; const ativo = calAlvo === m.id;
                  return (
                    <button key={m.id} onClick={() => carregarDraftCal(m.id)} className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left ${ativo ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-200/70 dark:hover:bg-slate-700/60'}`}>
                      <Factory className={`w-4 h-4 shrink-0 ${ativo ? '' : 'opacity-60'}`} />
                      <span className="text-sm font-semibold truncate flex-1">{m.nome}</span>
                      {proprio
                        ? <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-bold ${ativo ? 'bg-white/25 text-white' : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300'}`}>PRÓPRIO</span>
                        : <span className={`shrink-0 text-[9px] ${ativo ? 'text-white/70' : 'text-slate-400'}`}>geral</span>}
                    </button>
                  );
                })}
              </aside>
              {/* Painel: configuração do alvo selecionado */}
              <div className="flex-1 overflow-auto p-5 space-y-6 min-w-0">
                <div>
                  <div className="text-base font-bold text-slate-800 dark:text-slate-100">{calAlvo == null ? 'Calendário Geral' : `Calendário — ${maquinas.find(m => m.id === calAlvo)?.nome || 'Máquina'}`}</div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    {calAlvo == null
                      ? 'Define o cálculo da previsão de término (início + qtd ÷ peças/hora, respeitando turno, pausas, fim de semana e feriados). Vale para toda máquina que não tem calendário próprio.'
                      : (calendariosMaq[calAlvo] ? 'Esta máquina tem calendário próprio — as alterações valem só para ela.' : 'Esta máquina usa o Geral. Ao salvar aqui, você cria um calendário próprio só para ela.')}
                  </p>
                </div>
              {/* Turnos + setup */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] font-bold uppercase tracking-wide text-slate-500">Turnos</label>
                    <button onClick={() => setCalDraft(c => ({ ...c, turnos: [...(c.turnos || []), { inicio: '', fim: '' }] }))} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700"><Plus className="w-3.5 h-3.5" />Turno</button>
                  </div>
                  {(calDraft.turnos || []).length === 0 && <div className="text-xs text-slate-400 mb-1">Nenhum turno. Adicione ao menos um.</div>}
                  {(calDraft.turnos || []).map((tn, i) => (
                    <div key={i} className="flex items-center gap-2 mb-1.5">
                      <span className="text-[10px] text-slate-400 w-12 shrink-0">{i + 1}º turno</span>
                      <input type="time" value={tn.inicio} onChange={e => setCalDraft(c => ({ ...c, turnos: c.turnos.map((x, j) => j === i ? { ...x, inicio: e.target.value } : x) }))} className="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm" />
                      <span className="text-xs text-slate-400">até</span>
                      <input type="time" value={tn.fim} onChange={e => setCalDraft(c => ({ ...c, turnos: c.turnos.map((x, j) => j === i ? { ...x, fim: e.target.value } : x) }))} className="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm" />
                      <button onClick={() => setCalDraft(c => ({ ...c, turnos: c.turnos.filter((_, j) => j !== i) }))} className="grid place-items-center w-7 h-7 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"><Trash2 className="w-4 h-4" /></button>
                    </div>
                  ))}
                  <p className="text-[10px] text-slate-400 mt-1">Turno noturno (ex.: 22:00 até 06:00) é aceito — cruza a meia-noite automaticamente.</p>
                </div>
                <div><label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500 mb-1">Setup (min)</label><input type="number" min={0} step="1" value={calDraft.setup_min} onChange={e => setCalDraft(d => ({ ...d, setup_min: Number(e.target.value) || 0 }))} className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-right tabular-nums" /></div>
              </div>
              {/* Dias de folga */}
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">Dias sem produção (semana)</div>
                <div className="flex flex-wrap gap-2">
                  {DIAS_SEMANA.map((dl, i) => {
                    const on = calDraft.dias_semana_folga.includes(i);
                    return <button key={i} type="button" onClick={() => setCalDraft(c => ({ ...c, dias_semana_folga: on ? c.dias_semana_folga.filter(x => x !== i) : [...c.dias_semana_folga, i] }))}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium ${on ? 'bg-red-100 text-red-700 ring-1 ring-red-300 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-900' : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300'}`}>{dl}</button>;
                  })}
                </div>
              </div>
              {/* Pausas */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Pausas</span>
                  <button onClick={() => setCalDraft(c => ({ ...c, pausas: [...c.pausas, { inicio: '', fim: '' }] }))} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700"><Plus className="w-3.5 h-3.5" />Pausa</button>
                </div>
                {calDraft.pausas.length === 0 && <div className="text-xs text-slate-400">Nenhuma pausa.</div>}
                {calDraft.pausas.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 mb-1.5">
                    <input type="time" value={p.inicio} onChange={e => setCalDraft(c => ({ ...c, pausas: c.pausas.map((x, j) => j === i ? { ...x, inicio: e.target.value } : x) }))} className="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm" />
                    <span className="text-xs text-slate-400">até</span>
                    <input type="time" value={p.fim} onChange={e => setCalDraft(c => ({ ...c, pausas: c.pausas.map((x, j) => j === i ? { ...x, fim: e.target.value } : x) }))} className="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm" />
                    <button onClick={() => setCalDraft(c => ({ ...c, pausas: c.pausas.filter((_, j) => j !== i) }))} className="grid place-items-center w-7 h-7 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
              {/* Feriados / dias especiais */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Feriados / dias especiais</span>
                  <button onClick={() => setCalDraft(c => ({ ...c, feriados: [...c.feriados, { data: '', folga: true }] }))} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700"><Plus className="w-3.5 h-3.5" />Dia</button>
                </div>
                {calDraft.feriados.length === 0 && <div className="text-xs text-slate-400">Nenhum feriado/dia especial.</div>}
                {calDraft.feriados.map((f, i) => (
                  <div key={i} className="flex flex-wrap items-center gap-2 mb-1.5">
                    <input type="date" value={f.data} onChange={e => setCalDraft(c => ({ ...c, feriados: c.feriados.map((x, j) => j === i ? { ...x, data: e.target.value } : x) }))} className="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm" />
                    <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer select-none"><input type="checkbox" checked={!!f.folga} onChange={e => setCalDraft(c => ({ ...c, feriados: c.feriados.map((x, j) => j === i ? { ...x, folga: e.target.checked } : x) }))} className="w-3.5 h-3.5" />Folga (dia todo)</label>
                    {!f.folga && (
                      <span className="inline-flex items-center gap-2">
                        <input type="time" value={f.inicio || ''} onChange={e => setCalDraft(c => ({ ...c, feriados: c.feriados.map((x, j) => j === i ? { ...x, inicio: e.target.value } : x) }))} className="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm" />
                        <span className="text-xs text-slate-400">até</span>
                        <input type="time" value={f.fim || ''} onChange={e => setCalDraft(c => ({ ...c, feriados: c.feriados.map((x, j) => j === i ? { ...x, fim: e.target.value } : x) }))} className="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm" />
                      </span>
                    )}
                    <button onClick={() => setCalDraft(c => ({ ...c, feriados: c.feriados.filter((_, j) => j !== i) }))} className="grid place-items-center w-7 h-7 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
              {/* Variáveis personalizadas (config livre) */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Variáveis personalizadas</span>
                  <button onClick={() => setCalDraft(c => ({ ...c, variaveis: [...(c.variaveis || []), { nome: '', valor: '' }] }))} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700"><Plus className="w-3.5 h-3.5" />Variável</button>
                </div>
                {(calDraft.variaveis || []).length === 0 && <div className="text-xs text-slate-400">Nenhuma variável personalizada. Use para registrar regras/parâmetros próprios.</div>}
                {(calDraft.variaveis || []).map((v, i) => (
                  <div key={i} className="flex items-center gap-2 mb-1.5">
                    <input type="text" value={v.nome} placeholder="Nome" onChange={e => setCalDraft(c => ({ ...c, variaveis: c.variaveis.map((x, j) => j === i ? { ...x, nome: e.target.value } : x) }))} className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm" />
                    <input type="text" value={v.valor} placeholder="Valor" onChange={e => setCalDraft(c => ({ ...c, variaveis: c.variaveis.map((x, j) => j === i ? { ...x, valor: e.target.value } : x) }))} className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm" />
                    <button onClick={() => setCalDraft(c => ({ ...c, variaveis: c.variaveis.filter((_, j) => j !== i) }))} className="grid place-items-center w-7 h-7 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"><Trash2 className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-100 dark:border-slate-700">
              {calAlvo != null && calendariosMaq[calAlvo] && <button onClick={usarCalGeral} title="Remove o calendário próprio: a máquina volta a usar o Geral" className="mr-auto inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 hover:bg-amber-50 dark:hover:bg-amber-900/30"><Trash2 className="w-4 h-4" />Usar o geral</button>}
              <button onClick={() => setCalConfigOpen(false)} className="px-3.5 py-2 rounded-lg text-sm font-medium border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800">Cancelar</button>
              <button onClick={salvarConfigCalendario} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-700"><Save className="w-4 h-4" />Salvar{calAlvo != null ? ' (máquina)' : ' (geral)'}</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL dados (clique) */}
      {dadosItem && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={() => setDadosCod(null)}>
          <div className={`${card} w-full max-w-5xl max-h-[92vh] overflow-hidden flex flex-col`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 px-5 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
              <div className="min-w-0"><div className="text-xs font-medium text-white/80 font-mono">{codDe(dadosCod!)}</div><div className="text-lg font-bold truncate" title={dadosItem.DESCRICAO}>{dadosItem.DESCRICAO}</div></div>
              <button onClick={() => setDadosCod(null)} className="text-white/80 hover:text-white shrink-0"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 overflow-auto">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
                <div className="rounded-xl bg-emerald-50 dark:bg-emerald-950/30 px-3 py-2.5"><div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-500/80">Estoque físico</div><div className="text-xl font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">{num(dadosItem.ESTOQUE_FISICO)}</div></div>
                <div className="rounded-xl bg-amber-50 dark:bg-amber-950/30 px-3 py-2.5"><div className="text-[11px] font-semibold uppercase tracking-wide text-amber-500/80">Saldo reserva</div><div className="text-xl font-bold text-amber-700 dark:text-amber-300 tabular-nums">{num(dadosItem.RESERVA_ATUAL)}</div></div>
                <div className="rounded-xl bg-orange-50 dark:bg-orange-950/30 px-3 py-2.5"><div className="text-[11px] font-semibold uppercase tracking-wide text-orange-500/80">OPs em produção</div><div className="text-xl font-bold text-orange-700 dark:text-orange-300 tabular-nums">{num(opCount(dadosCod!))}</div></div>
              </div>
              {(() => {
                const tend5d = Math.round((tendMensalMap[normCodSop(codDe(dadosCod!))] || 0) / 30 * 5);
                const tendProd = tend5d + (qtdDe(dadosCod!) || 0);
                return (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                    <div className="rounded-xl bg-purple-50 dark:bg-purple-950/30 px-3 py-2.5" title="Tendência de demanda de ~5 dias (projeção do mês ÷ 30 × 5), do S&OP realizado"><div className="text-[11px] font-semibold uppercase tracking-wide text-purple-500/80">Tendência (5d)</div><div className="text-xl font-bold text-purple-700 dark:text-purple-300 tabular-nums">{num(tend5d)}</div></div>
                    <div className="rounded-xl bg-indigo-50 dark:bg-indigo-950/30 px-3 py-2.5" title="Tendência 5d + Qtd a produzir"><div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-500/80">Tendência + Produzir</div><div className="text-xl font-bold text-indigo-700 dark:text-indigo-300 tabular-nums">{num(tendProd)}</div></div>
                  </div>
                );
              })()}
              {/* Quantidade programada — no mesmo formato de tabela do Encarte/Taba */}
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-2"><Hammer className="w-4 h-4 text-blue-600" /><span className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">Quantidade programada</span></div>
                <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200 dark:ring-slate-700">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-900/50">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500 whitespace-nowrap">Código</th>
                        <th className="text-left px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500">Descrição</th>
                        <th className="text-right px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500 whitespace-nowrap">Qtd. a produzir</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-t border-slate-100 dark:border-slate-800">
                        <td className="px-3 py-1.5 font-mono text-slate-700 dark:text-slate-200 whitespace-nowrap">{codDe(dadosCod!)}</td>
                        <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200 max-w-[280px] truncate" title={dadosItem.DESCRICAO}>{dadosItem.DESCRICAO}</td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap">
                          <input type="number" min={0} step="any" value={qtdDe(dadosCod!)} onChange={e => setQtd(dadosCod!, e.target.value)}
                            className="w-28 text-right bg-transparent tabular-nums font-semibold text-slate-800 dark:text-slate-100 rounded px-2 py-1 ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/50" />
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
              {/* Desdobramento do otimizador (quando o produto aparece em mais de uma sequência) */}
              {(linhasPorCod[codDe(dadosCod!)]?.length || 0) > 1 && (
                <div className="mb-5">
                  <div className="flex items-center gap-2 mb-2"><Layers className="w-4 h-4 text-indigo-600" /><span className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">Otimizador de Produção (sequências onde aparece)</span></div>
                  <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200 dark:ring-slate-700">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 dark:bg-slate-900/50">
                        <tr>
                          <th className="text-left px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500 whitespace-nowrap">Sequência</th>
                          <th className="text-right px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500 whitespace-nowrap">Qtd. a produzir</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(linhasPorCod[codDe(dadosCod!)] || []).map((l, i) => (
                          <tr key={i} className="border-t border-slate-100 dark:border-slate-800">
                            <td className="px-3 py-1.5 tabular-nums font-semibold text-indigo-700 dark:text-indigo-300">{l.seq}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-200">{num(l.qtd)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
              {/* Estrutura */}
              <div className="mb-5">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2"><Network className="w-4 h-4 text-blue-600" /><span className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">Estrutura</span></div>
                  {!estruturaAberta && (
                    <button onClick={() => carregarEstrutura(dadosCod!)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 cursor-pointer"><Network className="w-3.5 h-3.5" />Ver estrutura</button>
                  )}
                </div>
                {estruturaAberta && (
                  estruturaLoading || !estruturaCache[codDe(dadosCod!)] ? (
                    <div className="flex items-center gap-2 text-sm text-slate-500 rounded-xl bg-slate-50 dark:bg-slate-900/40 px-3 py-4"><Loader2 className="w-4 h-4 animate-spin" />Carregando estrutura...</div>
                  ) : !estruturaCache[codDe(dadosCod!)].encontrado ? (
                    <div className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300 rounded-xl bg-amber-50 dark:bg-amber-950/30 ring-1 ring-amber-200 dark:ring-amber-900/50 px-3 py-2.5"><AlertTriangle className="w-4 h-4" />Estrutura não encontrada para este código.</div>
                  ) : (
                    <EstruturaArvore itens={estruturaCache[codDe(dadosCod!)].itens} qtdProgramada={qtdDe(dadosCod!)} />
                  )
                )}
              </div>
              {/* Encarte / Taba */}
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-2"><Package className="w-4 h-4 text-indigo-600" /><span className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">Encarte / Taba</span></div>
                {componentesEncarteTaba.length === 0 && manuaisDetalhe.length === 0 ? (
                  <div className="text-sm text-slate-500 rounded-xl bg-slate-50 dark:bg-slate-900/40 px-3 py-3">Sem encarte/taba na estrutura deste item.</div>
                ) : (
                  <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200 dark:ring-slate-700">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 dark:bg-slate-900/50">
                        <tr>
                          <th className="text-left px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500 whitespace-nowrap">Tipo</th>
                          <th className="text-left px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500 whitespace-nowrap">Código</th>
                          <th className="text-left px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500">Descrição</th>
                          <th className="text-left px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500 whitespace-nowrap">Máquina (Sopro)</th>
                          <th className="text-right px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500 whitespace-nowrap">Necessidade</th>
                          <th className="text-right px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500 whitespace-nowrap">Qtd a utilizar</th>
                          <th className="px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {componentesEncarteTaba.map(({ item, tipo }) => {
                          const nec = (item.qtdbase || 0) * qtdDe(dadosCod!);
                          return (
                            <tr key={item.cod} className="border-t border-slate-100 dark:border-slate-800">
                              <td className="px-3 py-1.5 whitespace-nowrap"><span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${tipo === 'encarte' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>{tipo === 'encarte' ? 'Encarte' : 'Taba'}</span></td>
                              <td className="px-3 py-1.5 font-mono text-slate-700 dark:text-slate-200 whitespace-nowrap">{item.cod}</td>
                              <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200 max-w-[220px] truncate" title={item.text}>{item.text}</td>
                              <td className="px-3 py-1.5 whitespace-nowrap">
                                {tipo === 'taba' ? (
                                  <select value={compMaq[item.cod] ?? sugestaoMaqTaba(item.cod)} onChange={e => salvarCompMaquina(item.cod, tipo, item.text, e.target.value)} className={selectCls}>
                                    <option value="">— máquina —</option>
                                    {soproMaquinas.map(m => <option key={m.id} value={m.id}>{m.nome}</option>)}
                                  </select>
                                ) : <span className="text-slate-400 text-xs">—</span>}
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-slate-700 dark:text-slate-200 whitespace-nowrap">{num(nec)}{item.unidade ? ` ${item.unidade}` : ''}</td>
                              <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                <div className="inline-flex items-center gap-1.5">
                                  {compSalvos[item.cod] && <Check className="w-3.5 h-3.5 text-emerald-600" />}
                                  <input type="number" min={0} step="any"
                                    defaultValue={compUso[item.cod] ?? ''}
                                    key={`${item.cod}-${compUso[item.cod] ?? ''}`}
                                    onBlur={e => salvarUsoComp(item, tipo, e.target.value)}
                                    className="w-24 text-right bg-transparent tabular-nums font-semibold text-slate-800 dark:text-slate-100 rounded px-2 py-1 ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" />
                                </div>
                              </td>
                              <td className="px-3 py-1.5"></td>
                            </tr>
                          );
                        })}
                        {manuaisDetalhe.map(m => {
                          const tipo = (m.tipo_comp === 'taba' ? 'taba' : 'encarte') as 'encarte' | 'taba';
                          return (
                            <tr key={`man-${m.cod_componente}`} className="border-t border-slate-100 dark:border-slate-800 bg-amber-50/40 dark:bg-amber-950/10">
                              <td className="px-3 py-1.5 whitespace-nowrap">
                                <span className={`px-2 py-0.5 rounded-md text-[11px] font-semibold ${tipo === 'encarte' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'}`}>{tipo === 'encarte' ? 'Encarte' : 'Taba'}</span>
                                <span className="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 text-[9px] font-bold">manual</span>
                              </td>
                              <td className="px-3 py-1.5 font-mono text-slate-700 dark:text-slate-200 whitespace-nowrap">{m.cod_componente}</td>
                              <td className="px-3 py-1.5 text-slate-700 dark:text-slate-200 max-w-[220px] truncate" title={m.descricao}>{m.descricao || '—'}</td>
                              <td className="px-3 py-1.5 whitespace-nowrap">
                                {tipo === 'taba' ? (
                                  <select value={compMaq[m.cod_componente] ?? sugestaoMaqTaba(m.cod_componente)} onChange={e => salvarCompMaquina(m.cod_componente, tipo, m.descricao, e.target.value)} className={selectCls}>
                                    <option value="">— máquina —</option>
                                    {soproMaquinas.map(mm => <option key={mm.id} value={mm.id}>{mm.nome}</option>)}
                                  </select>
                                ) : <span className="text-slate-400 text-xs">—</span>}
                              </td>
                              <td className="px-3 py-1.5 text-right tabular-nums text-slate-400 whitespace-nowrap">—</td>
                              <td className="px-3 py-1.5 text-right whitespace-nowrap">
                                <input type="number" min={0} step="any"
                                  defaultValue={m.qtd_usar ?? ''}
                                  key={`man-${m.cod_componente}-${m.qtd_usar ?? ''}`}
                                  onBlur={e => salvarManual(m.cod_componente, tipo, m.descricao, e.target.value)}
                                  className="w-24 text-right bg-transparent tabular-nums font-semibold text-slate-800 dark:text-slate-100 rounded px-2 py-1 ring-1 ring-slate-200 dark:ring-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-500/50" />
                              </td>
                              <td className="px-3 py-1.5 text-center">
                                <button onClick={() => removerManual(m.cod_componente)} title="Remover entrada manual" className="grid place-items-center w-7 h-7 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"><Trash2 className="w-4 h-4" /></button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
                {/* Adicionar encarte/taba manual */}
                <div className="mt-3 rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 bg-slate-50/70 dark:bg-slate-900/40 p-3">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500 mb-2">Adicionar encarte/taba manual</div>
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Tipo</label>
                      <select value={manTipo} onChange={e => setManTipo(e.target.value as 'encarte' | 'taba')} className={selectCls}>
                        <option value="encarte">Encarte</option>
                        <option value="taba">Taba</option>
                      </select>
                    </div>
                    <div className="flex-1 min-w-[120px]">
                      <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Código</label>
                      <input value={manCod} onChange={e => { setManCod(e.target.value); if (manErro) setManErro(''); buscarManSug(e.target.value); }} placeholder="Digite o código…"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/60" />
                    </div>
                    <div className="flex-1 min-w-[140px]">
                      <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Nome do produto</label>
                      <input value={manDesc} onChange={e => { setManDesc(e.target.value); buscarManSug(e.target.value); }} placeholder="Digite o nome…"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/60" />
                    </div>
                    <div className="w-28">
                      <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Qtd a utilizar</label>
                      <input type="number" min={0} step="any" value={manQtd} onChange={e => setManQtd(e.target.value)} placeholder="0"
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-right text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/60" />
                    </div>
                    <button onClick={adicionarManual} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700"><Plus className="w-4 h-4" />Adicionar</button>
                  </div>
                  {manSugOpen && manSug.length > 0 && (
                    <div className="mt-2 max-h-56 overflow-auto rounded-lg ring-1 ring-slate-200 dark:ring-slate-700 bg-white dark:bg-slate-900 divide-y divide-slate-100 dark:divide-slate-800">
                      {manSug.map(s => (
                        <button key={s.cod} type="button" onClick={() => { setManCod(s.cod); setManDesc(s.text || ''); setManSug([]); setManSugOpen(false); }}
                          className="w-full text-left px-3 py-2 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 flex items-center gap-2">
                          <span className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200 shrink-0">{s.cod}</span>
                          <span className="text-xs text-slate-500 truncate">{s.text}</span>
                          {s.unidade && <span className="ml-auto text-[10px] text-slate-400 shrink-0">{s.unidade}</span>}
                        </button>
                      ))}
                    </div>
                  )}
                  {manErro && <div className="mt-2 text-xs text-red-600 dark:text-red-400">{manErro}</div>}
                </div>
              </div>
              {/* Ordens em produção — unificado nesta mesma tela */}
              <div className="mb-5">
                <div className="flex items-center gap-2 mb-2"><Hammer className="w-4 h-4 text-orange-600" /><span className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">Ordens em produção</span><span className="px-2 py-0.5 rounded-full bg-orange-500 text-white text-xs font-bold">{opsList.length}</span></div>
                {opsList.length === 0 ? <div className="text-sm text-slate-400 py-6 text-center rounded-xl ring-1 ring-slate-200 dark:ring-slate-700">Nenhuma OP em produção para este item.</div> : (
                  <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200 dark:ring-slate-700">
                    <table className="text-xs min-w-[1000px] w-full">
                      <thead className="bg-slate-50 dark:bg-slate-700/40"><tr>
                        {['Nº OP', 'Início real', 'UN', 'K01T 001', 'K01T 002'].map(h => <th key={h} className="text-left px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500 whitespace-nowrap">{h}</th>)}
                        {['Qtd. da OP', 'Qtd. nec. material', 'Qtd. necessária'].map(h => <th key={h} className="text-right px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500 whitespace-nowrap">{h}</th>)}
                        <th className="text-left px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500 whitespace-nowrap">Progresso</th>
                      </tr></thead>
                      <tbody>
                        {opsList.map(o => {
                          const meta = o.qtd_op || 0; const feito = o.apontada || 0; const pct = meta > 0 ? Math.min(100, Math.round((feito / meta) * 100)) : 0; const done = pct >= 100;
                          return (
                            <tr key={o.numero_op} className="border-t border-slate-100 dark:border-slate-700">
                              <td className="px-3 py-2 font-mono font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">{o.numero_op}</td>
                              <td className="px-3 py-2 whitespace-nowrap text-slate-500">{fmtDt(o.inicio_real)}</td>
                              <td className="px-3 py-2 whitespace-nowrap">{o.unidade}</td>
                              <td className="px-3 py-2 whitespace-nowrap truncate max-w-[150px] text-slate-600 dark:text-slate-300" title={o.k01t_001}>{o.k01t_001}</td>
                              <td className="px-3 py-2 whitespace-nowrap truncate max-w-[150px] text-slate-600 dark:text-slate-300" title={o.k01t_002}>{o.k01t_002}</td>
                              <td className="px-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap">{num(o.qtd_op)}</td>
                              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap">{num(o.qtd_nec_material)}</td>
                              <td className="px-3 py-2 text-right tabular-nums whitespace-nowrap text-slate-500">{num(o.qtd_nec_a)}</td>
                              <td className="px-3 py-2 whitespace-nowrap w-44"><div className="flex items-center gap-2"><div className="flex-1 h-1.5 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden min-w-[60px]"><div className={`h-full rounded-full ${done ? 'bg-emerald-500' : 'bg-orange-500'}`} style={{ width: `${pct}%` }} /></div><span className={`text-[11px] font-semibold tabular-nums ${done ? 'text-emerald-600' : 'text-orange-600'}`}>{pct}%</span></div></td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              <PedidosTabela it={dadosItem} />
            </div>
          </div>
        </div>
      )}

      {/* MODAL programação da máquina (clique no cabeçalho) */}
      {maqModal && (() => {
        const lotes = lotesPorMaq[maqModal.id] || [];
        const allCods = lotes.flatMap(l => items[lkey(maqModal.id, l.lote)] || []);
        const totalH = allCods.reduce((s, c) => s + (ativoDe(c) ? (tempoHoras(c) || 0) : 0), 0);
        return (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={() => setMaqModal(null)}>
            <div className={`${card} w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col`} onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between gap-3 px-5 py-4 bg-gradient-to-r from-blue-600 to-indigo-600 text-white">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="grid place-items-center w-10 h-10 rounded-xl bg-white/20"><Factory className="w-5 h-5" /></div>
                  <div className="min-w-0"><div className="text-xs font-medium text-white/80">Programação da máquina</div><div className="text-lg font-bold truncate" title={maqModal.nome}>{maqModal.nome}</div></div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white/90">{lotes.length} lote{lotes.length > 1 ? 's' : ''}</span>
                  <button onClick={() => gerarPdf(maqModal)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-sm font-medium"><FileDown className="w-4 h-4" />PDF</button>
                  <button onClick={() => setMaqModal(null)} className="text-white/80 hover:text-white"><X className="w-5 h-5" /></button>
                </div>
              </div>
              <div className="px-5 py-2 bg-blue-50/60 dark:bg-blue-950/20 text-sm text-slate-600 dark:text-slate-300 flex items-center gap-2 border-b border-slate-100 dark:border-slate-700">
                <Gauge className="w-4 h-4 text-blue-600" />Tempo total estimado (itens ativos): <b className="text-blue-700 dark:text-blue-300">{fmtHoras(totalH)}</b>
              </div>
              <div className="p-5 overflow-auto">
                {allCods.length === 0 ? <div className="text-sm text-slate-400 py-8 text-center">Nenhum item nesta máquina. Arraste itens para ela.</div> : (
                  <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200 dark:ring-slate-700">
                    <table className="w-full text-sm min-w-[1000px]">
                      <thead className="bg-slate-50 dark:bg-slate-700/40 sticky top-0">
                        <tr>
                          <th className="text-left px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500" title="Ordem na programação">Ordem</th>
                          <th className="text-left px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500" title="Sequência do otimizador">Seq. otim.</th>
                          <th className="text-left px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500">Código</th>
                          <th className="text-left px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500">Produto</th>
                          <th className="text-right px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500">Qtd. produzir</th>
                          <th className="text-left px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500">Encarte</th>
                          <th className="text-left px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500">Taba</th>
                          <th className="text-right px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500">Peças/h</th>
                          <th className="text-right px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500">Tempo estimado</th>
                          <th className="text-left px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500" title="Manual ou calculada pelo calendário de produção (turno, pausas, fim de semana, feriados)">Previsão término</th>
                          <th className="text-left px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500">Observação</th>
                          <th className="text-center px-3 py-2 font-semibold text-[11px] uppercase tracking-wide text-slate-500">Ativo</th>
                        </tr>
                      </thead>
                      {lotes.map((l, li) => {
                        const codsL = items[lkey(maqModal.id, l.lote)] || [];
                        // Término encadeado (fila): cada item começa quando o anterior termina.
                        const fimPorCk: Record<string, string | null> = {};
                        { let cursor = l.data; let prev: string | null = null; for (const cc of codsL) { if (ativoDe(cc)) { const cod = codDe(cc); const f = calcFimPlanejado(cursor, qtdDe(cc), maqTempos[cod] ?? null, calDaMaquina(maqModal.id), cod !== prev); fimPorCk[cc] = f; if (f) cursor = f; prev = cod; } else fimPorCk[cc] = null; } }
                        return (
                      <tbody key={l.lote}>
                        <tr className="bg-blue-50 dark:bg-blue-950/30"><td colSpan={12} className="px-3 py-1.5 text-xs font-bold text-blue-700 dark:text-blue-300"><span className="inline-flex items-center gap-1.5"><CalendarClock className="w-3.5 h-3.5" />Programação {li + 1} — Início: {l.data ? (l.data.includes('T') ? fmtDt(l.data) : fmtData(l.data)) : 'sem data'} · {codsL.length} item{codsL.length > 1 ? 's' : ''}</span></td></tr>
                        {codsL.length === 0 && <tr><td colSpan={12} className="px-3 py-2 text-xs text-slate-400 text-center">Sem itens neste lote.</td></tr>}
                        {codsL.map((c, i) => {
                          const at = ativoDe(c);
                          const prodCod = codDe(c);
                          const prodItem = byCod[prodCod];
                          return (
                            <tr key={c} className={`border-t border-slate-100 dark:border-slate-700 ${at ? '' : 'bg-slate-50 dark:bg-slate-900/40 opacity-70'}`}>
                              <td className="px-3 py-2 tabular-nums text-slate-500">{i + 1}</td>
                              <td className="px-3 py-2 tabular-nums font-semibold text-indigo-700 dark:text-indigo-300">{prodItem?.SEQUENCIA ?? '—'}</td>
                              <td className="px-3 py-2 font-mono text-xs font-semibold text-slate-700 dark:text-slate-200 whitespace-nowrap">{prodCod}</td>
                              <td className="px-3 py-2 truncate max-w-[260px] text-slate-600 dark:text-slate-300" title={prodItem?.DESCRICAO}>{prodItem?.DESCRICAO}</td>
                              <td className="px-3 py-2 text-right">
                                <input type="number" min={0} step="any"
                                  key={`qty-${c}-${qtdDe(c)}`}
                                  defaultValue={qtdDe(c)}
                                  onBlur={e => { if (Number(e.target.value) !== qtdDe(c)) setQtd(c, e.target.value); }}
                                  className="w-20 px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-right tabular-nums font-semibold" />
                              </td>
                              {(['encarte', 'taba'] as const).map(tp => {
                                const comps = compsDoItem(c, tp);
                                const ck = `${prodCod}:${tp}`;
                                const outroAberto = outroKey === ck;
                                // Seleção: usa estado explícito ou o primeiro com qtdUsar > 0 ou o primeiro
                                const selCod = selectedComp[ck]
                                  ?? comps.find(cp => cp.qtdUsar !== undefined && cp.qtdUsar > 0)?.cod
                                  ?? comps[0]?.cod
                                  ?? '';
                                const multiOpcoes = comps.length > 1;
                                return (
                                  <td key={tp} className="px-2 py-1 align-middle min-w-[180px] max-w-[220px]">
                                    {comps.length === 0 && !outroAberto ? (
                                      <div className="flex items-center gap-1">
                                        <span className="text-slate-400 text-xs">—</span>
                                        <button onClick={() => { setOutroKey(ck); setOutroCod(''); setOutroBusca([]); }}
                                          className="text-indigo-400 hover:text-indigo-600 text-[11px] leading-none" title="Adicionar código">＋</button>
                                      </div>
                                    ) : (
                                      <div className="space-y-0.5">
                                        {comps.map(cp => {
                                          const isSel = cp.cod === selCod;
                                          return (
                                            <div key={cp.cod} className={`flex items-center gap-1 min-w-0 ${multiOpcoes && !isSel ? 'opacity-40' : ''}`}>
                                              {multiOpcoes && (
                                                <input type="radio" name={ck} checked={isSel}
                                                  onChange={() => setSelectedComp(prev => ({ ...prev, [ck]: cp.cod }))}
                                                  className="shrink-0 accent-indigo-600 w-3 h-3 cursor-pointer" />
                                              )}
                                              {cp.manual && <span className="shrink-0 px-0.5 rounded bg-amber-100 text-amber-700 text-[9px] font-bold">M</span>}
                                              <span className={`font-mono font-semibold shrink-0 ${isSel ? 'text-[11px] text-slate-700 dark:text-slate-200' : 'text-[10px] text-slate-500 dark:text-slate-400'}`}
                                                title={`${cp.text}${cp.necessidade !== undefined ? ` · Nec.: ${num(cp.necessidade)}${cp.unidade ? ' ' + cp.unidade : ''}` : ''}`}>{cp.cod}</span>
                                              {isSel && (
                                                <>
                                                  <span className="text-[10px] text-slate-500 dark:text-slate-400 truncate flex-1" title={cp.text}>{cp.text}</span>
                                                  <input type="number" min={0} step="any"
                                                    key={`${cp.cod}-${cp.qtdUsar}`}
                                                    defaultValue={cp.qtdUsar ?? ''} placeholder="—"
                                                    onBlur={e => salvarQtdModal(prodCod, cp.cod, tp, cp.text, e.target.value)}
                                                    className="w-14 px-1 py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs text-right shrink-0" />
                                                  {cp.unidade && <span className="text-[9px] text-slate-400 shrink-0">{cp.unidade}</span>}
                                                  {!outroAberto && (
                                                    <button onClick={() => { setOutroKey(ck); setOutroCod(''); setOutroBusca([]); }}
                                                      className="shrink-0 text-indigo-400 hover:text-indigo-600 text-[11px] leading-none" title="Adicionar outro código">＋</button>
                                                  )}
                                                </>
                                              )}
                                            </div>
                                          );
                                        })}
                                        {outroAberto && (
                                          <div className="mt-1 border border-indigo-200 dark:border-indigo-700 rounded-lg p-1.5 bg-indigo-50/60 dark:bg-indigo-950/30 space-y-1">
                                            <input autoFocus type="text" value={outroCod}
                                              onChange={e => { setOutroCod(e.target.value); buscarItemModal(e.target.value); }}
                                              placeholder="Código ou descrição…"
                                              className="w-full px-2 py-0.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-[11px]" />
                                            {outroBusca.length > 0 && (
                                              <div className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded shadow-sm max-h-20 overflow-y-auto">
                                                {outroBusca.map(it => (
                                                  <button key={it.cod} onClick={() => adicionarOutroModal(prodCod, tp, it.cod, it.text)}
                                                    className="w-full text-left px-2 py-0.5 text-[11px] hover:bg-indigo-50 dark:hover:bg-indigo-900/40 flex gap-1.5">
                                                    <span className="font-mono font-semibold shrink-0">{it.cod}</span>
                                                    <span className="text-slate-500 truncate">{it.text}</span>
                                                  </button>
                                                ))}
                                              </div>
                                            )}
                                            <div className="flex gap-1">
                                              <button onClick={() => adicionarOutroModal(prodCod, tp, outroCod, '')}
                                                className="flex-1 px-2 py-0.5 rounded bg-indigo-600 text-white text-[11px] font-medium hover:bg-indigo-700">Confirmar</button>
                                              <button onClick={() => { setOutroKey(''); setOutroCod(''); setOutroBusca([]); }}
                                                className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-[11px]">✕</button>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                  </td>
                                );
                              })}
                              <td className="px-3 py-2 text-right">
                                <input type="number" min={0} step="any" defaultValue={maqTempos[prodCod] ?? ''} placeholder="—"
                                  onBlur={e => { if (e.target.value !== String(maqTempos[prodCod] ?? '')) setPecasHora(maqModal.id, c, e.target.value); }}
                                  className="w-20 px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-right" />
                              </td>
                              <td className="px-3 py-2 text-right tabular-nums font-medium text-blue-700 dark:text-blue-300 whitespace-nowrap">{fmtHoras(tempoHoras(c))}</td>
                              <td className="px-3 py-2">
                                {(() => {
                                  const manual = previsaoTermino[c];
                                  const auto = fimPorCk[c] ?? null;
                                  const eff = manual || auto;
                                  return (
                                    <div className="flex items-center gap-1">
                                      <input type="datetime-local" value={toLocalInput(eff)}
                                        onChange={e => setPrevisao(c, e.target.value ? new Date(e.target.value).toISOString() : '')}
                                        title={manual ? 'Previsão manual (limpe para voltar ao automático)' : (auto ? 'Calculada pelo calendário de produção (turno, pausas, fim de semana, feriados). Edite para sobrescrever.' : 'Defina peças/h e o início do lote, ou informe manualmente.')}
                                        className={`w-44 px-2 py-1 rounded-md border text-sm ${manual ? 'border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30' : 'border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900'}`} />
                                      {manual
                                        ? <button onClick={() => setPrevisao(c, '')} title="Voltar ao automático" className="shrink-0 px-1 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">M</button>
                                        : (auto ? <span className="shrink-0 text-[9px] text-slate-400" title="Calculada automaticamente">auto</span> : null)}
                                    </div>
                                  );
                                })()}
                              </td>
                              <td className="px-3 py-2">
                                <input type="text" defaultValue={obs[c] || ''} placeholder="Anotar problema…"
                                  onBlur={e => { if (e.target.value !== (obs[c] || '')) setObservacao(c, e.target.value); }}
                                  className="w-full min-w-[180px] px-2 py-1 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm" />
                              </td>
                              <td className="px-3 py-2 text-center">
                                <button onClick={() => toggleAtivo(c)} title={at ? 'Desativar item' : 'Ativar item'}
                                  className={`px-2.5 py-1 rounded-lg text-xs font-bold ${at ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : 'bg-slate-200 text-slate-500 dark:bg-slate-700'}`}>
                                  {at ? 'Ativo' : 'Inativo'}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                        );
                      })}
                    </table>
                  </div>
                )}
                <p className="text-[11px] text-slate-400 mt-2">O tempo estimado usa as peças/hora cadastradas na máquina; editar aqui altera o cadastro. Itens inativos não entram no tempo total nem no PDF.</p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL detalhe do card de taba (produto vinculado, máquina, início, término, quantidade) */}
      {tabaDetalhe && (() => {
        const tt = tabaTimes[`${tabaDetalhe.cod_item}::${tabaDetalhe.sequencia}::${tabaDetalhe.cod_componente}`] || { inicio: tabaDetalhe.inicio, termino: null };
        const maq = maquinas.find(m => m.id === tabaDetalhe.maquina_id);
        const prodDesc = byCod[tabaDetalhe.cod_item]?.DESCRICAO || '';
        const Linha = ({ rotulo, valor }: { rotulo: string; valor: string }) => (
          <div className="flex items-start justify-between gap-3 py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
            <span className="text-xs uppercase tracking-wide text-slate-400 shrink-0">{rotulo}</span>
            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200 text-right">{valor}</span>
          </div>
        );
        return (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={() => setTabaDetalhe(null)}>
            <div className="w-full max-w-md rounded-2xl bg-white dark:bg-slate-900 shadow-2xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2 px-5 py-3.5 bg-gradient-to-br from-purple-600 to-indigo-600 text-white">
                <Package className="w-5 h-5" />
                <div className="min-w-0"><div className="text-sm font-bold truncate">Taba {tabaDetalhe.cod_componente}</div><div className="text-[11px] text-white/80 truncate">{tabaDetalhe.descricao}</div></div>
                <button onClick={() => setTabaDetalhe(null)} className="ml-auto text-white/80 hover:text-white shrink-0"><X className="w-5 h-5" /></button>
              </div>
              <div className="px-5 py-3">
                <Linha rotulo="Produto" valor={`${tabaDetalhe.cod_item}${prodDesc ? ' — ' + prodDesc : ''}`} />
                <Linha rotulo="Sequência" valor={String(tabaDetalhe.sequencia)} />
                <Linha rotulo="Máquina" valor={maq?.nome || '—'} />
                <Linha rotulo="Início" valor={tt.inicio ? fmtDt(tt.inicio) : '—'} />
                <Linha rotulo="Término" valor={tt.termino ? fmtDt(tt.termino) : 'defina peças/hora da taba na máquina'} />
                <Linha rotulo="Quantidade" valor={num(tabaDetalhe.qtd)} />
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL aviso de nova versão (abre uma vez) */}
      {notifOpen && novaVersao && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={() => setNotifOpen(false)}>
          <div className={`${card} w-full max-w-md overflow-hidden`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 px-5 py-4 bg-gradient-to-r from-amber-500 to-orange-500 text-white">
              <div className="grid place-items-center w-10 h-10 rounded-xl bg-white/20"><AlertTriangle className="w-5 h-5" /></div>
              <div><div className="text-xs font-medium text-white/80">Aviso</div><div className="text-lg font-bold">Nova versão oficial disponível</div></div>
            </div>
            <div className="p-5">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Foi publicada uma nova versão oficial da programação ({labelVersao(novaVersao)}).
                Você está com a versão anterior carregada. Carregue a nova ou compare as mudanças.
              </p>
              <div className="flex justify-end gap-2 mt-5">
                <button onClick={() => setNotifOpen(false)} className="px-3.5 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer">Depois</button>
                <button onClick={() => { setNotifOpen(false); abrirComparar(versaoSel?.id, novaVersao.id); }} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium border border-indigo-300 text-indigo-700 dark:text-indigo-300 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 cursor-pointer"><GitCompareArrows className="w-4 h-4" />Comparar</button>
                <button onClick={() => { setNotifOpen(false); carregarNova(); }} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium bg-amber-500 text-white hover:bg-amber-600 cursor-pointer">Carregar nova</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL salvar versão (oficial ou não) */}
      {salvarModalOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={() => setSalvarModalOpen(false)}>
          <div className={`${card} w-full max-w-md overflow-hidden`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 px-5 py-4 bg-gradient-to-r from-emerald-600 to-teal-600 text-white">
              <h3 className="inline-flex items-center gap-2 text-lg font-bold"><Save className="w-5 h-5" />Salvar versão da programação</h3>
              <button onClick={() => setSalvarModalOpen(false)} className="text-white/80 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-slate-500 dark:text-slate-400">Congela a programação atual como uma nova versão. Escolha como deseja salvar:</p>
              <div className="space-y-2.5">
                {podeOficial && (
                <button onClick={() => executarSalvar(true)} disabled={salvandoVersao} className="w-full text-left px-4 py-3 rounded-xl ring-1 ring-emerald-300 dark:ring-emerald-700 bg-emerald-50 dark:bg-emerald-900/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 disabled:opacity-50 cursor-pointer">
                  <span className="inline-flex items-center gap-2 text-sm font-bold text-emerald-700 dark:text-emerald-300"><BadgeCheck className="w-4 h-4" />Salvar como oficial</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">Passa a ser a versão usada pelo Otimizador de Faturamento.</span>
                </button>
                )}
                <button onClick={() => executarSalvar(false)} disabled={salvandoVersao} className="w-full text-left px-4 py-3 rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/60 disabled:opacity-50 cursor-pointer">
                  <span className="inline-flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200"><Save className="w-4 h-4" />Salvar sem ser oficial</span>
                  <span className="block text-xs text-slate-500 dark:text-slate-400 mt-0.5">Guarda no histórico de versões, mas não altera a versão oficial.</span>
                </button>
              </div>
              <div className="flex justify-end">
                <button onClick={() => setSalvarModalOpen(false)} className="px-4 py-2 rounded-lg text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer">Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MODAL comparação */}
      {histOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={() => setHistOpen(false)}>
          <div className={`${card} w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 px-5 py-4 bg-gradient-to-r from-violet-600 to-indigo-600 text-white">
              <h3 className="inline-flex items-center gap-2 text-lg font-bold"><History className="w-5 h-5" />Histórico de versões salvas</h3>
              <button onClick={() => setHistOpen(false)} className="text-white/80 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 overflow-auto">
              <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Selecione uma versão para restaurá-la no quadro atual. <b className="text-amber-600 dark:text-amber-400">Restaurar substitui a montagem atual</b> — salve antes se quiser preservá-la.</p>
              {histLoading ? (
                <div className="flex items-center justify-center gap-2 py-12 text-slate-400"><Loader2 className="w-5 h-5 animate-spin" />Carregando…</div>
              ) : historico.length === 0 ? (
                <div className="text-sm text-slate-400 py-12 text-center">Nenhuma versão salva ainda. Use “Salvar versão” para criar a primeira.</div>
              ) : (
                <ul className="space-y-2">
                  {historico.map(v => (
                    <li key={v.id} className="flex items-center gap-3 px-4 py-3 rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 hover:ring-violet-300 dark:hover:ring-violet-700 transition">
                      <div className="grid place-items-center w-9 h-9 rounded-lg bg-violet-100 dark:bg-violet-900/40 text-violet-600 dark:text-violet-300 shrink-0"><CalendarClock className="w-4.5 h-4.5" /></div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">{fmtDt(v.created_at)}</span>
                          {v.oficial && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500 text-white text-[10px] font-bold"><BadgeCheck className="w-3 h-3" />Oficial</span>}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">{v.created_by_name || 'Autor desconhecido'}{v.oficial && v.oficial_em ? ` · oficial em ${fmtDt(v.oficial_em)}${v.oficial_por_nome ? ` por ${v.oficial_por_nome}` : ''}` : ''}</div>
                      </div>
                      <button onClick={() => restaurarVersaoSalva(v)} disabled={restaurandoId !== null} title="Restaurar esta versão no quadro atual" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 hover:bg-violet-50 dark:hover:bg-violet-900/30 cursor-pointer disabled:opacity-50 shrink-0">{restaurandoId === v.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}Restaurar</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      )}

      {cmpOpen && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={() => setCmpOpen(false)}>
          <div className={`${card} w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col`} onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-3 px-5 py-4 bg-gradient-to-r from-indigo-600 to-blue-600 text-white">
              <h3 className="inline-flex items-center gap-2 text-lg font-bold"><GitCompareArrows className="w-5 h-5" />Comparar versões</h3>
              <button onClick={() => setCmpOpen(false)} className="text-white/80 hover:text-white"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 overflow-auto">
              <div className="flex items-end gap-3 flex-wrap mb-4">
                <div><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Versão base</div><select className={selectCls} value={cmpBase} onChange={e => setCmpBase(e.target.value)}><option value="">Selecione…</option>{oficiais.map(v => <option key={v.id} value={v.id}>{labelVersao(v)}</option>)}</select></div>
                <ArrowRight className="w-5 h-5 text-slate-400 mb-2" />
                <div><div className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-1">Versão nova</div><select className={selectCls} value={cmpNovo} onChange={e => setCmpNovo(e.target.value)}><option value="">Selecione…</option>{oficiais.map(v => <option key={v.id} value={v.id}>{labelVersao(v)}</option>)}</select></div>
                <button onClick={executarComparar} disabled={cmpLoading} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50 cursor-pointer mb-0.5"><GitCompareArrows className="w-4 h-4" />{cmpLoading ? 'Comparando…' : 'Comparar'}</button>
              </div>
              {cmpData && (() => {
                const removidos = cmpData.removidos.map(x => { const lista = opsPorCodigo.get((x.codigo || '').trim()) || []; return { ...x, opN: lista.length, opQtd: lista.reduce((s, o) => s + (o.qtd_op || 0), 0) }; });
                const removidosComOp = removidos.filter(r => r.opN > 0);
                const semDiff = cmpData.resumo.novos + cmpData.resumo.removidos + cmpData.resumo.seq + cmpData.resumo.qtd === 0;
                return (
                  <>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">Comparando <b className="text-slate-700 dark:text-slate-200">{labelVersao(cmpData.base)}</b><ArrowRight className="inline w-4 h-4 mx-1 -mt-0.5 text-slate-400" /><b className="text-slate-700 dark:text-slate-200">{labelVersao(cmpData.novo)}</b>.</p>
                    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
                      <CmpKpi color="emerald" Icon={PlusCircle} n={cmpData.resumo.novos} label="Itens novos" desc="Entraram no plano" />
                      <CmpKpi color="red" Icon={MinusCircle} n={cmpData.resumo.removidos} label="Removidos" desc="Saíram do plano" />
                      <CmpKpi color="blue" Icon={ArrowUpDown} n={cmpData.resumo.seq} label="Sequência" desc="Mudaram de posição" />
                      <CmpKpi color="amber" Icon={Scale} n={cmpData.resumo.qtd} label="Quantidade" desc="Qtd. a produzir mudou" />
                    </div>
                    {removidosComOp.length > 0 && (
                      <div className="mb-4 rounded-xl border border-red-200 dark:border-red-900/50 bg-red-50/60 dark:bg-red-950/20 overflow-hidden">
                        <div className="flex items-center gap-2 px-4 py-2.5 bg-red-100/70 dark:bg-red-950/40"><AlertTriangle className="w-4 h-4 text-red-600" /><span className="text-sm font-bold text-red-700 dark:text-red-300">Atenção: {removidosComOp.length} item(ns) removido(s) têm OP em produção</span></div>
                        <ul className="divide-y divide-red-100 dark:divide-red-900/30 max-h-44 overflow-auto">
                          {removidosComOp.map(r => (<li key={r.codigo} className="flex items-center gap-2 px-4 py-2 text-sm"><span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200 shrink-0">{r.codigo}</span><span className="truncate text-slate-600 dark:text-slate-300 flex-1" title={r.descricao}>{r.descricao}</span><span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500 text-white text-[11px] font-bold shrink-0"><Hammer className="w-3 h-3" />{r.opN} OP{r.opN > 1 ? 's' : ''} · {num(r.opQtd)}</span></li>))}
                        </ul>
                      </div>
                    )}
                    {semDiff ? <div className="text-sm text-slate-400 py-8 text-center">Nenhuma diferença entre as versões.</div> : (
                      <div className="grid lg:grid-cols-2 gap-4">
                        <CatCard color="emerald" Icon={PlusCircle} title="Itens novos" desc="Entraram no plano" items={cmpData.novos.map(x => ({ code: x.codigo, desc: x.descricao, right: `Seq ${x.sequencia_novo ?? '—'} · ${num(x.qtd_novo)}` }))} />
                        <CatCard color="red" Icon={MinusCircle} title="Itens removidos" desc="Saíram do plano" items={removidos.map(x => ({ code: x.codigo, desc: x.descricao, right: `Seq ${x.sequencia_base ?? '—'} · ${num(x.qtd_base)}`, warn: x.opN > 0 ? `${x.opN} OP · ${num(x.opQtd)}` : undefined }))} />
                        <CatCard color="blue" Icon={ArrowUpDown} title="Sequência alterada" desc="Posição mudou" items={cmpData.seq_mudou.map(x => ({ code: x.codigo, desc: x.descricao, right: `${x.sequencia_base ?? '—'} → ${x.sequencia_novo ?? '—'}` }))} />
                        <CatCard color="amber" Icon={Scale} title="Quantidade alterada" desc="Qtd. a produzir mudou" items={cmpData.qtd_mudou.map(x => ({ code: x.codigo, desc: x.descricao, right: `${num(x.qtd_base)} → ${num(x.qtd_novo)} (${x.delta > 0 ? '+' : ''}${num(x.delta)})` }))} />
                      </div>
                    )}
                    {novaVersao && cmpNovo === novaVersao.id && (<div className="flex justify-end mt-4"><button onClick={carregarNova} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-amber-500 text-white hover:bg-amber-600 cursor-pointer">Carregar versão nova</button></div>)}
                  </>
                );
              })()}
            </div>
          </div>
        </div>
      )}
      </Portal>
    </div>
  );
};

const CmpKpi: React.FC<{ color: string; Icon: React.ComponentType<{ className?: string }>; n: number; label: string; desc: string }> = ({ color, Icon, n, label, desc }) => (
  <div className={`rounded-xl px-3 py-2.5 ${CMP_TONES[color].card}`}>
    <div className="flex items-center gap-2"><Icon className={`w-4 h-4 ${CMP_TONES[color].title}`} /><span className={`text-[11px] font-semibold uppercase tracking-wide ${CMP_TONES[color].label}`}>{label}</span></div>
    <div className={`text-2xl font-bold tabular-nums ${CMP_TONES[color].value}`}>{n.toLocaleString('pt-BR')}</div>
    <div className="text-[11px] text-slate-400">{desc}</div>
  </div>
);

interface CatItem { code: string; desc: string; right: string; warn?: string }
const CatCard: React.FC<{ color: string; Icon: React.ComponentType<{ className?: string }>; title: string; desc: string; items: CatItem[] }> = ({ color, Icon, title, desc, items }) => {
  if (items.length === 0) return null;
  return (
    <div className="rounded-xl ring-1 ring-slate-200 dark:ring-slate-700 overflow-hidden self-start">
      <div className={`flex items-center gap-2 px-4 py-2.5 ${CMP_TONES[color].head}`}><Icon className={`w-4 h-4 ${CMP_TONES[color].title}`} /><span className={`text-sm font-bold ${CMP_TONES[color].title}`}>{title}</span><span className="px-2 py-0.5 rounded-full bg-white/70 dark:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300">{items.length}</span><span className="text-[11px] text-slate-400 ml-auto">{desc}</span></div>
      <ul className="max-h-56 overflow-auto divide-y divide-slate-100 dark:divide-slate-700">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-2 px-4 py-2 text-sm">
            <span className="font-mono text-xs font-semibold text-slate-700 dark:text-slate-200 shrink-0">{it.code}</span>
            <span className="truncate text-slate-600 dark:text-slate-300 flex-1" title={it.desc}>{it.desc}</span>
            {it.warn && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-[11px] font-bold shrink-0" title="Tem OP em produção"><AlertTriangle className="w-3 h-3" />{it.warn}</span>}
            <span className="font-medium tabular-nums text-slate-700 dark:text-slate-200 shrink-0">{it.right}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default ProgramacaoPage;
