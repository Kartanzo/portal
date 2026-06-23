import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { api } from '../../app_api';
import { useToast } from '../../contexts/ToastContext';
import { Receipt, RefreshCw, Search, Save, SlidersHorizontal, Trash2, AlertTriangle, Clock, BadgeCheck, GitCompareArrows, X, ChevronDown, CalendarDays, Table2, ChevronLeft, ChevronRight, FileDown } from 'lucide-react';
import KpiCard, { KpiGrid } from '../common/KpiCard';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { aplicarLayoutBlackd, temaTabelaBlackd } from '../exportUtils';
import { useFiltroPersistente } from '../../hooks/useFiltroPersistente';

const fmtMoney = (v?: number | null) =>
    v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInt = (v?: number | null) => (v == null ? '—' : Number(v).toLocaleString('pt-BR'));
const fmtDt = (iso?: string | null) => {
    if (!iso) return null;
    const d = new Date(iso); if (isNaN(d.getTime())) return iso;
    return d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
// só data (sem hora) — a partir de ISO; strings DD/MM/YYYY passam direto
const fmtData = (s?: string | null) => {
    if (!s) return null;
    if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) return s.slice(0, 10);
    const d = new Date(s); if (isNaN(d.getTime())) return s;
    return d.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric' });
};
const inicioAno = () => `${new Date().getFullYear()}-01-01`;
const hojeMais10 = () => { const d = new Date(); d.setDate(d.getDate() + 10); return d.toLocaleDateString('en-CA'); };
const _pad = (n: number) => String(n).padStart(2, '0');
// dia (YYYY-MM-DD) no fuso BR a partir de um ISO
const diaKey = (iso?: string | null): string => {
    if (!iso) return '';
    const d = new Date(iso); if (isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
};
const fmtDia = (key: string) => { const [y, m, d] = key.split('-'); return d && m && y ? `${d}/${m}/${y}` : key; };

interface Produto {
    sku: string; descricao?: string; demanda?: number; valor?: number;
    estoque_disponivel?: number; reserva?: number; estoque_fisico?: number; saldo?: number;
    saldo_disponivel?: number; saldo_reserva?: number; // F10 ajuste 12/06: saldos restantes por fonte pós-cascata
    qtd_em_producao?: number; qtd_em_producao_ate_entrega?: number; saldo_producao?: number; falta?: number;
    // F10.2: consumo discriminado por fonte (item-a-item), backend popula
    consumo_disponivel?: number; consumo_reserva?: number; consumo_producao?: number;
    previsao_termino?: string | null; liberacoes?: any[];
}
interface Pedido {
    pedido: string; cliente?: string; valor_total_pedido?: number; atrasado?: boolean; dias_atraso?: number;
    emissao?: string | null; entrega?: string | null; tipo?: string;
    previsao_termino?: string | null; pronto?: boolean; produtos: Produto[]; produtos_faltando?: any[];
    motivo?: 'sem_programacao' | 'estoque_insuficiente' | 'producao_insuficiente' | 'produto_removido_configurador' | 'cliente_removido_configurador' | 'pedido_ja_alocado_em_anterior';
}

// F8.3 — chips canônicos de motivo de pedido incompleto (cores conforme D7 do plano)
const MOTIVO_CFG: Record<string, { label: string; cls: string; title: string }> = {
    sem_programacao:                 { label: 'Sem programação',          cls: 'bg-slate-100 text-slate-600 dark:bg-slate-900/40 dark:text-slate-300', title: 'SKU não tem liberação alguma na Programação oficial' },
    estoque_insuficiente:            { label: 'Estoque insuficiente',     cls: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300',    title: 'Disponível + reserva (das fontes ativas) < demanda, sem produção pra cobrir' },
    producao_insuficiente:           { label: 'Produção insuficiente',    cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300', title: 'Estoque cobre parte, mas produção programada não cobre o resto' },
    produto_removido_configurador:   { label: 'Produto removido',         cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300', title: 'SKU removido pelo usuário no Configurador' },
    cliente_removido_configurador:   { label: 'Cliente removido',         cls: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300', title: 'Cliente removido pelo usuário no Configurador' },
    pedido_ja_alocado_em_anterior:   { label: 'Saldo já alocado',         cls: 'bg-slate-200 text-slate-500 dark:bg-slate-800 dark:text-slate-400',    title: 'Saldo consumido por pedido mais prioritário na cascata' },
};
const MotivoBadge: React.FC<{ motivo?: string }> = ({ motivo }) => {
    if (!motivo) return null;
    const cfg = MOTIVO_CFG[motivo];
    if (!cfg) return null;
    return <span title={cfg.title} className={`ml-2 px-2 py-0.5 rounded-full text-[10px] font-bold ${cfg.cls}`}>{cfg.label}</span>;
};

const TIPO_CFG: Record<string, { label: string; cls: string }> = {
    'SAC':                  { label: 'SAC',        cls: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300' },
    'BONIFICACAO':          { label: 'Bonificação', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300' },
    'TROCA':                { label: 'Troca',       cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300' },
    'PENDENTE_FINANCEIRO':  { label: 'Pend. Financeiro', cls: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300' },
};
const TipoBadge: React.FC<{ tipo?: string }> = ({ tipo }) => {
    if (!tipo) return null;
    const cfg = TIPO_CFG[tipo];
    if (!cfg) return null;
    return <span title={`Tipo: ${cfg.label}`} className={`ml-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${cfg.cls}`}>{cfg.label}</span>;
};

// ---- Seleção múltipla com lista + checkboxes (popover, com filtro opcional) ----
const MultiSelectPopover: React.FC<{
    label: string;
    options: { id: string; label: string; sub?: string }[];
    selected: string[]; onChange: (ids: string[]) => void;
}> = ({ label, options, selected, onChange }) => {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState('');
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h);
    }, []);
    const n = (s: string) => (s || '').toLowerCase();
    const list = q.trim() ? options.filter(o => n(o.id).includes(n(q)) || (o.sub && n(o.sub).includes(n(q)))) : options;
    const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
    return (
        <div className="relative" ref={ref}>
            <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300 mb-1">{label}</label>
            <button type="button" onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs">
                <span className={selected.length ? 'text-slate-700 dark:text-slate-200 font-medium' : 'text-slate-400'}>
                    {selected.length ? `${selected.length} selecionado(s)` : 'Selecionar…'}
                </span>
                <ChevronDown className={`w-4 h-4 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
            </button>
            {selected.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1">
                    {selected.map(id => (
                        <span key={id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-300 text-[11px] font-mono">
                            {id}<button onClick={() => toggle(id)} className="opacity-70 hover:opacity-100"><X className="w-3 h-3" /></button>
                        </span>
                    ))}
                </div>
            )}
            {open && (
                <div className="absolute z-30 mt-1 w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg shadow-xl">
                    <div className="p-2 border-b border-slate-100 dark:border-slate-700">
                        <div className="relative">
                            <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-slate-400" />
                            <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Filtrar lista…"
                                className="w-full pl-7 pr-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs" />
                        </div>
                        <div className="flex items-center justify-between mt-1 text-[10px] text-slate-500">
                            <span>{selected.length} de {options.length} selecionado(s)</span>
                            {selected.length > 0 && <button onClick={() => onChange([])} className="text-rose-600 hover:underline">limpar</button>}
                        </div>
                    </div>
                    <div className="max-h-56 overflow-auto">
                        {list.length === 0 ? <div className="px-3 py-3 text-xs text-slate-400 text-center">Nada encontrado</div> :
                            list.map(o => {
                                const checked = selected.includes(o.id);
                                return (
                                    <button key={o.id} type="button" onClick={() => toggle(o.id)}
                                        className={`w-full text-left px-2 py-1.5 flex items-center gap-2 border-b border-slate-50 dark:border-slate-700/40 last:border-0 ${checked ? 'bg-rose-50 dark:bg-rose-900/20' : 'hover:bg-slate-50 dark:hover:bg-slate-700/30'}`}>
                                        <input type="checkbox" readOnly checked={checked} className="shrink-0 w-3.5 h-3.5 accent-rose-600" />
                                        <span className="min-w-0">
                                            <span className="block font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200">{o.label}</span>
                                            {o.sub && <span className="block text-[10px] text-slate-500 truncate">{o.sub}</span>}
                                        </span>
                                    </button>
                                );
                            })}
                    </div>
                </div>
            )}
        </div>
    );
};

// ---- Helpers do facelift 12/06 (guide for dummies) ----
const estadoPedido = (p: Pedido): { label: string; cor: string; titulo: string } => {
    if (p.motivo === 'sem_programacao' || (!p.pronto && !p.previsao_termino)) {
        return { label: 'Aguarda data de produção', cor: 'bg-rose-100 text-rose-800 dark:bg-rose-900/50 dark:text-rose-200',
                 titulo: 'Pedido precisa produzir algo que ainda não está na Programação' };
    }
    if (p.pronto) return { label: '✓ Sai hoje', cor: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
                            titulo: 'Pedido coberto 100% por estoque/reserva — pode faturar agora' };
    return { label: `Sai dia ${fmtData(p.previsao_termino)} (precisa produzir)`,
             cor: 'bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
             titulo: 'Parte vem de produção programada — sai quando a OP terminar' };
};

const deOndeVemTexto = (pr: Produto): React.ReactNode => {
    const partes: string[] = [];
    if ((pr.consumo_disponivel || 0) > 0) partes.push(`${fmtInt(pr.consumo_disponivel)} do estoque`);
    if ((pr.consumo_reserva || 0) > 0) partes.push(`${fmtInt(pr.consumo_reserva)} da reserva`);
    if ((pr.consumo_producao || 0) > 0) partes.push(`${fmtInt(pr.consumo_producao)} da produção`);
    const txt = partes.length ? partes.join(' + ') : '—';
    const sobraInfo = (pr.saldo != null && ((pr.consumo_disponivel || 0) + (pr.consumo_reserva || 0)) > 0)
        ? <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Sobra no estoque depois: {fmtInt(pr.saldo)}</div>
        : null;
    const faltaInfo = (pr.falta || 0) > 0
        ? <div className="text-[10px] text-rose-700 dark:text-rose-300 font-semibold mt-0.5">Falta {fmtInt(pr.falta)}{pr.previsao_termino ? '' : ' (sem data)'}</div>
        : null;
    return <><span>{txt}</span>{sobraInfo}{faltaInfo}</>;
};

const quandoSaiTexto = (p: Pedido, pr: Produto): React.ReactNode => {
    // F10 ajuste 12/06: se tem liberacoes multiplas (qtd + data + maquina) da Programacao,
    // mostra cada uma — fonte canonica de "quando esta parte da producao fica pronta"
    if (pr.liberacoes && pr.liberacoes.length > 1) {
        return <div className="flex flex-col gap-0.5">{pr.liberacoes.map((l: any, k: number) => (
            <span key={k} className="text-[10px] text-amber-700 dark:text-amber-300">
                <b className="tabular-nums">{fmtInt(l.qtd)}</b> em {fmtData(l.previsao_termino) || '—'}
            </span>
        ))}</div>;
    }
    if (pr.previsao_termino) return <span className="font-semibold text-amber-700 dark:text-amber-300">{fmtData(pr.previsao_termino)}</span>;
    if ((pr.falta || 0) > 0) return <span className="text-rose-700 dark:text-rose-300 font-semibold">Sem data</span>;
    if (p.pronto) return <span className="text-emerald-700 dark:text-emerald-300 font-semibold">Hoje</span>;
    return <span className="text-slate-400">—</span>;
};

// ---- Tabela de pedidos (1 bloco por pedido) — facelift 12/06 ----
const TabelaPedidos: React.FC<{ pedidos: Pedido[]; mostrarReserva?: boolean; colapsados?: Set<string>; onToggle?: (p: string) => void }> = ({ pedidos, mostrarReserva = true, colapsados, onToggle }) => {
    // F10 ajuste 12/06: detalhes tecnicos sempre on (toggle removido a pedido do Thiago)
    const modoDetalhes = true;
    const tSpan = mostrarReserva ? 8 : 7;
    const lSpan = tSpan - 2;
    const totalPedidos = pedidos.length;
    const totalValor = pedidos.reduce((a, p) => a + (p.valor_total_pedido || 0), 0);
    const totalSkus = new Set<string>();
    pedidos.forEach(p => (p.produtos || []).forEach(pr => pr.sku && totalSkus.add(pr.sku)));
    if (pedidos.length === 0) return <p className="text-sm text-slate-400 text-center py-4">Nenhum pedido.</p>;
    return (
        <div className="rounded-xl shadow border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
            <div className="flex items-center px-3 py-2 border-b border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/60">
                <span className="text-[11px] text-slate-500 dark:text-slate-400">{totalPedidos} pedido(s) · {totalSkus.size} SKU(s) · {fmtMoney(totalValor)}</span>
            </div>
            <div className="overflow-auto" style={{ maxHeight: '72vh' }}>
            <table className="w-full text-xs whitespace-nowrap">
                <thead className="sticky top-0 z-10 bg-slate-50 dark:bg-slate-700 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-300">
                    <tr>
                        {!modoDetalhes ? (<>
                            <th className="px-3 py-2 text-left">Item</th>
                            <th className="px-3 py-2 text-right">Precisa</th>
                            <th className="px-3 py-2 text-left">De onde vem</th>
                            <th className="px-3 py-2 text-left">Quando sai</th>
                        </>) : (<>
                            <th className="px-2 py-1.5 text-left">Item</th>
                            <th className="px-2 py-1.5 text-right">Precisa</th>
                            <th className="px-2 py-1.5 text-right">Estoque</th>
                            {mostrarReserva && <th className="px-2 py-1.5 text-right">Reserva</th>}
                            <th className="px-2 py-1.5 text-right">Sobra</th>
                            <th className="px-2 py-1.5 text-right">Em produção</th>
                            <th className="px-2 py-1.5 text-right">Valor</th>
                            <th className="px-2 py-1.5 text-left">Quando sai</th>
                        </>)}
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                    {pedidos.map((p, idx) => (
                        <React.Fragment key={p.pedido}>
                            {(() => { const est = estadoPedido(p); return (
                            <tr className={`bg-slate-50 dark:bg-slate-800/70 border-t-4 ${est.cor.includes('emerald') ? 'border-emerald-300 dark:border-emerald-800' : est.cor.includes('amber') ? 'border-amber-300 dark:border-amber-800' : 'border-rose-300 dark:border-rose-800'}`}>
                                <td className="px-3 py-2.5" colSpan={lSpan}>
                                    {/* Linha 1: posição + pedido + cliente + tipo */}
                                    <div className="flex items-center gap-2 flex-wrap normal-case">
                                        {onToggle && <button onClick={() => onToggle(p.pedido)} title={colapsados?.has(p.pedido) ? 'Expandir' : 'Encolher'} className="text-slate-400 hover:text-slate-600">{colapsados?.has(p.pedido) ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}</button>}
                                        {/* Fix 16/06: badge maior + cor por cobertura — guia visual da ordem crescente de faturamento */}
                                        <span title={`${idx + 1}º na fila de faturamento${p.cobertura_completa ? ' — PRONTO (cascata 100%)' : ' — INCOMPLETO (cascata < 100%)'}`} className={`inline-flex items-center justify-center min-w-[28px] h-6 px-1.5 rounded-md text-[11px] font-bold ${p.cobertura_completa === false ? 'bg-amber-200 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200' : 'bg-emerald-600 text-white'}`}>{idx + 1}º</span>
                                        <span className="font-bold text-sm text-slate-800 dark:text-slate-100">#{p.pedido}</span>
                                        <span className="text-slate-600 dark:text-slate-300 text-sm">{p.cliente}</span>
                                        <TipoBadge tipo={p.tipo} />
                                        {/* 18/06: nomenclatura 3-estados (verbalizado Thiago):
                                            - PLANO DE PRODUÇÃO: pedido estava no plano oficial (libs alocadas)
                                            - PEDIDO NOVO: veio direto da carteira fresh, não passou por plano
                                            - SALDO: faturamento parcial (algumas linhas STATUS=5 no ERP) — pode coexistir com PLANO/NOVO */}
                                        {p.no_plano === true && (
                                            <span title="Pedido estava no plano de produção oficial — libs de produção alocadas" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200 text-[10px] font-bold">PLANO DE PRODUÇÃO</span>
                                        )}
                                        {p.no_plano === false && (
                                            <span title="Pedido NOVO desde o plano oficial — fatura via estoque/reserva (sem produção pendente alocada)" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-800 dark:bg-sky-900/40 dark:text-sky-200 text-[10px] font-bold">PEDIDO NOVO</span>
                                        )}
                                        {p.saldo && (
                                            <span title="Faturamento parcial — algumas linhas do pedido já foram faturadas no ERP; restaram só os itens em aberto exibidos aqui" className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200 text-[10px] font-bold">SALDO</span>
                                        )}
                                    </div>
                                    {/* Linha 2: estado-manchete + atraso + entrega prevista */}
                                    <div className="flex items-center gap-2 flex-wrap mt-1.5 normal-case">
                                        <span title={est.titulo} className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold ${est.cor}`}>{est.label}</span>
                                        {p.atrasado && <span title="Dias de atraso em relação à entrega original" className="inline-flex items-center gap-1 text-[11px] text-rose-700 dark:text-rose-300 font-semibold"><Clock className="w-3 h-3" />Atrasado {p.dias_atraso} dia{(p.dias_atraso||0)>1?'s':''}</span>}
                                        {p.entrega && <span className="text-[11px] text-slate-500">Entrega prevista: {fmtData(p.entrega)}</span>}
                                    </div>
                                </td>
                                <td className={`px-3 py-2.5 text-right align-top`} colSpan={2}>
                                    <span className="block text-[9px] uppercase text-slate-400 normal-case">Valor a faturar</span>
                                    <span className="inline-block mt-0.5 px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-bold text-sm tabular-nums">{fmtMoney(p.valor_total_pedido)}</span>
                                </td>
                            </tr>
                            ); })()}
                            {!colapsados?.has(p.pedido) && (<>
                            {p.produtos.map((pr, j) => (
                                <tr key={`${p.pedido}-${pr.sku}-${j}`} className="hover:bg-slate-50 dark:hover:bg-slate-700/50">
                                    {!modoDetalhes ? (<>
                                        {/* MODO LEIGO — 4 colunas */}
                                        <td className="px-3 py-2 align-top">
                                            <div className="font-mono text-[11px] font-semibold text-slate-700 dark:text-slate-200">{pr.sku}</div>
                                            {pr.descricao && <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate max-w-[320px]">{pr.descricao}</div>}
                                        </td>
                                        <td className="px-3 py-2 text-right align-top">
                                            <span className="font-bold text-sm text-slate-800 dark:text-slate-100 tabular-nums">{fmtInt(pr.demanda)}</span>
                                        </td>
                                        <td className="px-3 py-2 align-top text-[12px] text-slate-700 dark:text-slate-200">
                                            {deOndeVemTexto(pr)}
                                        </td>
                                        <td className="px-3 py-2 align-top text-[12px]">
                                            {quandoSaiTexto(p, pr)}
                                        </td>
                                    </>) : (<>
                                        {/* MODO DETALHES — 8 colunas com nomes humanos */}
                                        <td className="px-2 py-1.5 align-top">
                                            <div className="font-mono text-[11px]">{pr.sku}</div>
                                            {pr.descricao && <div className="text-[10px] text-slate-500 truncate max-w-[260px]">{pr.descricao}</div>}
                                        </td>
                                        <td className="px-2 py-1.5 text-right align-top">
                                            <span className="font-semibold">{fmtInt(pr.demanda)}</span>
                                            {/* Fix 16/06: guia consumo intuitivo por linha — sempre as 3 fontes na ordem estoque→reserva→produção */}
                                            <div className="mt-1 text-[10px] text-slate-700 dark:text-slate-300">
                                                use <b className="text-sky-700 dark:text-sky-300">{fmtInt(pr.consumo_disponivel || 0)}</b> do Estoque,
                                                {' '}<b className="text-violet-700 dark:text-violet-300">{fmtInt(pr.consumo_reserva || 0)}</b> da Reserva e
                                                {' '}<b className="text-amber-700 dark:text-amber-300">{fmtInt(pr.consumo_producao || 0)}</b> da Produção
                                                {(pr.falta || 0) > 0 && <> · <span className="text-rose-700 dark:text-rose-300 font-semibold" title="Falta cobertura — pedido NÃO 100% faturável">⚠ falta {fmtInt(pr.falta)}</span></>}
                                            </div>
                                        </td>
                                        {/* F10 ajuste 12/06: colunas mostram SALDO RESTANTE por fonte (decremento cumulativo entre pedidos), nao o bruto global */}
                                        {/* Fix 16/06: cada coluna mostra "antes → depois" quando esse pedido consumiu — fica claro DE ONDE saiu o saldo */}
                                        <td className="px-2 py-1.5 text-right align-top" title="Estoque disponível antes deste pedido → restante após cascata">
                                            {(pr.consumo_disponivel || 0) > 0
                                                ? <><span className="text-slate-400 text-[10px]">{fmtInt(pr.estoque_disponivel)}</span> <span className="text-slate-400">→</span> <span className={`font-semibold ${(pr.saldo_disponivel ?? 0) === 0 ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}>{fmtInt(pr.saldo_disponivel ?? 0)}</span></>
                                                : <span className="font-semibold">{fmtInt(pr.saldo_disponivel ?? pr.estoque_disponivel ?? 0)}</span>}
                                        </td>
                                        {mostrarReserva && <td className="px-2 py-1.5 text-right align-top" title="Reserva antes deste pedido → restante após cascata">
                                            {(pr.consumo_reserva || 0) > 0
                                                ? <><span className="text-slate-400 text-[10px]">{fmtInt(pr.reserva)}</span> <span className="text-slate-400">→</span> <span className={`font-semibold ${(pr.saldo_reserva ?? 0) === 0 ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}>{fmtInt(pr.saldo_reserva ?? 0)}</span></>
                                                : <span className="text-slate-500">{fmtInt(pr.saldo_reserva ?? pr.reserva ?? 0)}</span>}
                                        </td>}
                                        <td className="px-2 py-1.5 text-right align-top" title="Físico (Estoque + Reserva) antes deste pedido → restante após cascata">
                                            {((pr.consumo_disponivel || 0) + (pr.consumo_reserva || 0)) > 0
                                                ? <><span className="text-slate-400 text-[10px]">{fmtInt(pr.estoque_fisico)}</span> <span className="text-slate-400">→</span> <span className={`font-semibold ${(pr.saldo ?? 0) === 0 ? 'text-rose-600 dark:text-rose-400' : 'text-amber-600 dark:text-amber-400'}`}>{fmtInt(pr.saldo ?? 0)}</span></>
                                                : <span className="font-semibold">{fmtInt(pr.saldo ?? pr.estoque_fisico ?? 0)}</span>}
                                        </td>
                                        <td className="px-2 py-1.5 text-right align-top" title="Produção inicial (programada) → saldo restante após cascata cumulativa">
                                            {(((pr as any).producao_inicial ?? 0) || 0) > 0 && ((pr as any).producao_inicial ?? 0) !== (pr.saldo_producao ?? 0)
                                                ? <><span className="text-slate-400 text-[10px]">{fmtInt((pr as any).producao_inicial ?? 0)}</span> <span className="text-slate-400">→</span> <span className={`font-semibold ${(pr.saldo_producao ?? 0) === 0 ? 'text-rose-600 dark:text-rose-400' : 'text-amber-700 dark:text-amber-300'}`}>{fmtInt(pr.saldo_producao ?? 0)}</span></>
                                                : <span className="font-semibold">{fmtInt((pr as any).producao_inicial ?? pr.qtd_em_producao_ate_entrega ?? 0)}</span>}
                                        </td>
                                        <td className="px-2 py-1.5 text-right align-top font-semibold text-emerald-700 dark:text-emerald-300">{fmtMoney(pr.valor)}</td>
                                        <td className="px-2 py-1.5 align-top text-[12px]">
                                            {quandoSaiTexto(p, pr)}
                                        </td>
                                    </>)}
                                </tr>
                            ))}
                            </>)}
                        </React.Fragment>
                    ))}
                </tbody>
                <tfoot className="sticky bottom-0 z-10 bg-slate-100 dark:bg-slate-700 font-bold text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-200">
                    <tr>
                        <td className="px-2 py-1.5 text-left" colSpan={lSpan}>{totalPedidos} pedido{totalPedidos !== 1 ? 's' : ''} · {totalSkus.size} SKU{totalSkus.size !== 1 ? 's' : ''}</td>
                        <td className="px-2 py-1.5 text-right text-emerald-700 dark:text-emerald-300" colSpan={2}>{fmtMoney(totalValor)}</td>
                    </tr>
                </tfoot>
            </table>
            </div>
        </div>
    );
};

// ---- Calendário mensal: pedidos faturáveis por dia (data de término) ----
// Helpers do calendário (top-level pra serem reusados na drill-down do dia).
//  • modoEntrega=false (faturáveis): pronto -> entrega futura ou HOJE; depende produção -> previsao_termino.
//  • modoEntrega=true  (não faturáveis): SEMPRE entrega; atrasada/sem -> HOJE.
const _brToIso = (s?: string | null) => {
    if (!s) return '';
    const m = String(s).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
};
const dataPedidoCalendario = (p: Pedido, hoje: string, modoEntrega: boolean): string => {
    // Regra Thiago 17/06 (CANONICAL):
    //  Atrasado (qualquer modo, faturável ou não)         → HOJE sempre
    //  No prazo + faturável via estoque/reserva (pronto)  → data entrega
    //  No prazo + faturável via produção                  → previsao_termino (data que sai)
    //  No prazo + não faturável                           → data entrega
    if (modoEntrega) {
        const ent = _brToIso(p.entrega);
        return ent && ent > hoje ? ent : hoje;
    }
    if (p.pronto) {
        const ent = _brToIso(p.entrega);
        return ent && ent > hoje ? ent : hoje;
    }
    return diaKey(p.previsao_termino);
};

const CalendarMes: React.FC<{ pedidos: Pedido[]; diaSel: string; onDia: (d: string) => void; modoEntrega?: boolean }> = ({ pedidos, diaSel, onDia, modoEntrega }) => {
    const hoje = diaKey(new Date().toISOString());
    const porDia = useMemo(() => {
        const m: Record<string, { n: number; valor: number }> = {};
        pedidos.forEach(p => {
            const k = dataPedidoCalendario(p, hoje, !!modoEntrega);
            if (!k) return;
            const e = m[k] || (m[k] = { n: 0, valor: 0 }); e.n++; e.valor += p.valor_total_pedido || 0;
        });
        return m;
    }, [pedidos, hoje, modoEntrega]);
    const diasComDados = Object.keys(porDia).sort();
    const [ref, setRef] = useState(() => {
        const f = diasComDados[0];
        const base = f ? new Date(f + 'T12:00:00') : new Date();
        return new Date(base.getFullYear(), base.getMonth(), 1);
    });
    const year = ref.getFullYear(), month = ref.getMonth();
    const primeiroDiaSemana = new Date(year, month, 1).getDay();
    const diasNoMes = new Date(year, month + 1, 0).getDate();
    const celulas: (number | null)[] = [];
    for (let i = 0; i < primeiroDiaSemana; i++) celulas.push(null);
    for (let d = 1; d <= diasNoMes; d++) celulas.push(d);
    const nomeMes = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(ref);
    const prefixoMes = `${year}-${_pad(month + 1)}`;
    const totalMes = diasComDados.filter(k => k.startsWith(prefixoMes)).reduce((a, k) => a + porDia[k].valor, 0);
    // 18/06: indicar quando existem pedidos fora do mês visível (causa #1 do gap card vs calendário)
    const forasMes = diasComDados.filter(k => !k.startsWith(prefixoMes));
    const outrosValor = forasMes.reduce((a, k) => a + porDia[k].valor, 0);
    const outrosN = forasMes.reduce((a, k) => a + porDia[k].n, 0);
    const primeiroDiaIso = `${prefixoMes}-01`;
    const ultimoDiaIso = `${prefixoMes}-${_pad(diasNoMes)}`;
    const temAntes = forasMes.some(k => k < primeiroDiaIso);
    const temDepois = forasMes.some(k => k > ultimoDiaIso);
    return (
        <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700">
                <button onClick={() => { setRef(new Date(year, month - 1, 1)); onDia(''); }} className="relative p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"><ChevronLeft className="w-4 h-4" />{temAntes && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500" title="Há pedidos em meses anteriores" />}</button>
                <div className="text-sm font-bold text-slate-700 dark:text-slate-100 capitalize flex items-center gap-2">
                    <span>{nomeMes}<span className="ml-2 text-xs font-bold text-emerald-600 dark:text-emerald-400">{fmtMoney(totalMes)}</span></span>
                    {outrosValor > 0 && (
                        <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 whitespace-nowrap" title={`Pedidos fora deste mês — use as setas ${temAntes ? '◀ ' : ''}${temDepois ? '▶' : ''} pra navegar`}>
                            + {fmtMoney(outrosValor)} em outros meses ({outrosN} ped)
                        </span>
                    )}
                </div>
                <button onClick={() => { setRef(new Date(year, month + 1, 1)); onDia(''); }} className="relative p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300"><ChevronRight className="w-4 h-4" />{temDepois && <span className="absolute top-0.5 right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500" title="Há pedidos em meses seguintes" />}</button>
            </div>
            <div className="grid grid-cols-7 text-center text-[10px] uppercase font-semibold text-slate-400 border-b border-slate-100 dark:border-slate-700/60">
                {['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'].map(d => <div key={d} className="py-1">{d}</div>)}
            </div>
            <div className="grid grid-cols-7">
                {celulas.map((d, i) => {
                    if (d === null) return <div key={i} className="min-h-[80px] border border-slate-50 dark:border-slate-800/40 bg-slate-50/40 dark:bg-slate-900/20" />;
                    const key = `${year}-${_pad(month + 1)}-${_pad(d)}`;
                    const info = porDia[key];
                    const isHoje = key === hoje;
                    const sel = key === diaSel;
                    return (
                        <button key={i} onClick={() => info && onDia(sel ? '' : key)} disabled={!info}
                            className={`min-h-[80px] text-left p-1.5 border border-slate-100 dark:border-slate-700/50 align-top transition ${sel ? 'ring-2 ring-rose-500 bg-rose-50 dark:bg-rose-900/20' : info ? 'hover:bg-rose-50/50 dark:hover:bg-rose-900/10 cursor-pointer' : 'bg-white/40 dark:bg-slate-900/10 cursor-default'}`}>
                            <div className={`text-[11px] font-bold ${isHoje ? 'text-white bg-rose-600 rounded-full w-5 h-5 grid place-items-center' : 'text-slate-500'}`}>{d}</div>
                            {info && (
                                <div className="mt-1 leading-tight">
                                    <div className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">{fmtMoney(info.valor)}</div>
                                    <div className="text-[10px] text-slate-500">{info.n} pedido{info.n > 1 ? 's' : ''}</div>
                                </div>
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

const OtimizadorFaturamento: React.FC = () => {
    const { showToast } = useToast();
    // Só usuários da Logística (ou super_user/ceo) podem definir a versão oficial.
    const podeOficial = useMemo(() => {
        try {
            const u = JSON.parse(sessionStorage.getItem('blackd_user') || '{}');
            if (['super_user', 'ceo'].includes(u.role)) return true;
            const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
            return [u.sector, ...String(u.managed_sectors || '').split(/[;,]/)].some((s: string) => norm(s) === norm('Logística'));
        } catch { return false; }
    }, []);
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [busca, setBusca] = useState('');
    const [vista, setVista] = useState<'tabela' | 'calendario'>('tabela');
    const [diaSel, setDiaSel] = useState('');
    const [colapsados, setColapsados] = useState<Set<string>>(new Set());
    const toggleColapso = (ped: string) => setColapsados(s => { const n = new Set(s); n.has(ped) ? n.delete(ped) : n.add(ped); return n; });

    // Configurador
    const [simOpen, setSimOpen] = useState(false);
    // 17/06: persistencia cross-navegacao via localStorage (mantem Configurador ao trocar de menu)
    const [fDe, setFDe] = useFiltroPersistente<string>('otimizador-faturamento:fDe', inicioAno());
    const [fAte, setFAte] = useFiltroPersistente<string>('otimizador-faturamento:fAte', hojeMais10());
    const [selProdutos, setSelProdutos] = useFiltroPersistente<string[]>('otimizador-faturamento:selProdutos', []);
    const [selClientes, setSelClientes] = useFiltroPersistente<string[]>('otimizador-faturamento:selClientes', []);
    const [selPedidos, setSelPedidos] = useFiltroPersistente<string[]>('otimizador-faturamento:selPedidos', []);
    const [selTipos, setSelTipos] = useFiltroPersistente<string[]>('otimizador-faturamento:selTipos', []);
    const [fontes, setFontes] = useFiltroPersistente<string[]>('otimizador-faturamento:fontes', ['disponivel', 'reserva', 'producao']);
    const toggleFonte = (f: string) => setFontes(prev => prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]);
    // 17/06: faturável HOJE — só pedidos prontos por estoque/reserva ou cuja última lib previsão = hoje
    const [faturavelHoje, setFaturavelHoje] = useFiltroPersistente<boolean>('otimizador-faturamento:faturavel-hoje', false);
    // 18/06: status do pedido (carteira) — 1=Em aberto, 4=Liberado. Default ambos (= comportamento atual).
    const [statusPedido, setStatusPedido] = useFiltroPersistente<string[]>('otimizador-faturamento:status', ['1', '4']);
    const toggleStatus = (s: string) => setStatusPedido(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
    // Histórico de versões (Fase B 16/06): aba com versões auto-criadas a cada Processar
    const [historicoOpen, setHistoricoOpen] = useState(false);
    const [histVersoes, setHistVersoes] = useState<any[]>([]);
    const [verConfig, setVerConfig] = useState<any | null>(null); // versão cujas configurações estão sendo visualizadas
    const [histOffset, setHistOffset] = useState(0);
    const [histTotal, setHistTotal] = useState(0);
    const histLimit = 20;
    const [histSoOficiais, setHistSoOficiais] = useState(false);
    const [histLoading, setHistLoading] = useState(false);
    const carregarHistorico = useCallback(async (offset = 0, soOficiais = false) => {
        try {
            setHistLoading(true);
            const { data: r } = await api.get('/otimizador-faturamento/versoes', {
                params: { offset, limit: histLimit, oficial_only: soOficiais },
            });
            setHistVersoes(r.versoes || []);
            setHistTotal(r.total || 0);
            setHistOffset(r.offset || 0);
        } catch (e: any) { showToast(e?.message || 'Erro ao carregar histórico', 'error'); }
        finally { setHistLoading(false); }
    }, [showToast]);
    const tornarOficialHistorico = useCallback(async (id: string, oficial: boolean) => {
        try {
            await api.put(`/otimizador-faturamento/versoes/${id}/oficial`, { oficial });
            showToast(oficial ? 'Versão marcada como oficial' : 'Oficial desmarcada', 'success');
            await carregarHistorico(histOffset, histSoOficiais);
        } catch (e: any) { showToast(e?.message || 'Erro ao alterar oficial', 'error'); }
    }, [carregarHistorico, histOffset, histSoOficiais, showToast]);
    const carregarVersaoHistorico = useCallback(async (id: string) => {
        try {
            const { data: r } = await api.get(`/otimizador-faturamento/versoes/${id}`);
            setData(r.resultado);
            // 17/06: aplica os filtros usados na versao carregada no Configurador.
            // Sem isso o painel ficava com defaults enquanto a tabela mostrava resultado
            // de outra config — confundia o operador (e o Excel exportado usava defaults).
            const f = r.filtros || {};
            if (Array.isArray(f.fontes)) setFontes(f.fontes);
            if (typeof f.faturavel_hoje === 'boolean') setFaturavelHoje(f.faturavel_hoje);
            setStatusPedido(Array.isArray(f.status) && f.status.length ? f.status : ['1', '4']);
            if (f.estrategia) setEstrategia(f.estrategia);
            setFDe(typeof f.periodo_de === 'string' ? f.periodo_de : inicioAno());
            setFAte(typeof f.periodo_ate === 'string' ? f.periodo_ate : hojeMais10());
            setSelPedidos(Array.isArray(f.remover_pedidos) ? f.remover_pedidos : []);
            setSelProdutos(Array.isArray(f.remover_produtos) ? f.remover_produtos : []);
            setSelClientes(Array.isArray(f.remover_clientes) ? f.remover_clientes : []);
            setSelTipos(Array.isArray(f.remover_tipos) ? f.remover_tipos : []);
            setHistoricoOpen(false);
            showToast('Versão carregada — Configurador atualizado com os filtros usados', 'info');
        } catch (e: any) { showToast(e?.message || 'Erro ao carregar versão', 'error'); }
    }, [showToast]);
    // Estratégia de seleção do Configurador (4 modos)
    const [estrategia, setEstrategia] = useFiltroPersistente<'completar_com_saldo' | 'max_valor' | 'max_atrasados' | 'max_combinado'>('otimizador-faturamento:estrategia', 'completar_com_saldo');
    const [cenarios, setCenarios] = useState<any[]>([]);
    const [cenarioAtivo, setCenarioAtivo] = useState<string>('');

    // Versões + comparação + aviso
    const [versoes, setVersoes] = useState<any[]>([]);
    const [aviso, setAviso] = useState<any>(null);
    const [cmpOpen, setCmpOpen] = useState(false);
    const [cmpTipo, setCmpTipo] = useState<'versoes' | 'cenarios'>('cenarios');
    const [cmpA, setCmpA] = useState('');
    const [cmpB, setCmpB] = useState('');
    const [cmpData, setCmpData] = useState<any>(null);
    const [cmpLoading, setCmpLoading] = useState(false);

    const erro = (e: any, fb: string) => showToast(e?.message || fb, 'error');

    // Opções de produtos/clientes derivadas do resultado carregado (sem chamada extra)
    const produtoOpts = useMemo(() => {
        const m = new Map<string, string>();
        const push = (sku?: string, desc?: string) => { if (sku && !m.has(sku)) m.set(sku, desc || ''); };
        (data?.pedidos || []).forEach((p: any) => (p.produtos || []).forEach((pr: any) => push(pr.sku, pr.descricao)));
        (data?.sem_data_programacao || []).forEach((p: any) => {
            (p.produtos || []).forEach((pr: any) => push(pr.sku, pr.descricao));
            (p.produtos_faltando || []).forEach((f: any) => push(f.sku, f.descricao));
        });
        return Array.from(m, ([id, sub]) => ({ id, label: id, sub })).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    }, [data]);
    const clienteOpts = useMemo(() => {
        const s = new Set<string>();
        [...(data?.pedidos || []), ...(data?.sem_data_programacao || [])].forEach((p: any) => { if (p.cliente) s.add(p.cliente); });
        return Array.from(s, c => ({ id: c, label: c })).sort((a, b) => a.label.localeCompare(b.label));
    }, [data]);
    const pedidoOpts = useMemo(() => {
        const arr = [...(data?.pedidos || []), ...(data?.sem_data_programacao || [])];
        return arr.map((p: any) => ({ id: String(p.pedido), label: String(p.pedido), sub: p.cliente }))
            .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
    }, [data]);

    const tipoOpts = [
        { id: 'SAC',                 label: 'SAC' },
        { id: 'BONIFICACAO',         label: 'Bonificação' },
        { id: 'TROCA',               label: 'Troca' },
        { id: 'PENDENTE_FINANCEIRO', label: 'Pendente Financeiro' },
    ];

    const montarFiltros = useCallback(() => {
        const f: any = { fontes, estrategia };
        if (fDe) f.periodo_de = fDe;
        if (fAte) f.periodo_ate = fAte;
        if (selProdutos.length) f.remover_produtos = selProdutos;
        if (selClientes.length) f.remover_clientes = selClientes;
        if (selPedidos.length) f.remover_pedidos = selPedidos;
        if (selTipos.length) f.remover_tipos = selTipos;
        if (faturavelHoje) f.faturavel_hoje = true;
        // status: só envia quando difere do default (ambos). Vazio cai pro default no backend.
        if (statusPedido.length && statusPedido.length < 2) f.status = statusPedido;
        return f;
    }, [fDe, fAte, selProdutos, selClientes, selPedidos, selTipos, fontes, estrategia, faturavelHoje, statusPedido]);

    const temFiltros = !!(fDe || fAte || selProdutos.length || selClientes.length || selPedidos.length || selTipos.length || fontes.length < 3 || estrategia !== 'completar_com_saldo' || faturavelHoje || statusPedido.length !== 2);

    // Refs espelho pra carregar() ler config atual sem stale closure (17/06: Atualizar agora preserva cenário do Configurador)
    const montarFiltrosRef = useRef(montarFiltros);
    const temFiltrosRef = useRef(temFiltros);
    useEffect(() => { montarFiltrosRef.current = montarFiltros; }, [montarFiltros]);
    useEffect(() => { temFiltrosRef.current = temFiltros; }, [temFiltros]);

    const carregar = useCallback(async (refresh = false, _retry = false) => {
        setLoading(true); setCenarioAtivo('');
        try {
            let data;
            const previewId = versaoPreviewIdRef.current;
            if (temFiltrosRef.current || previewId) {
                // 17/06: Atualizar com filtros ativos ou preview de rascunho vai pelo POST /simular
                const body: any = { filtros: montarFiltrosRef.current(), refresh };
                if (previewId) body.programacao_versao_id = previewId;
                const resp = await api.post('/otimizador-faturamento/simular', body);
                data = resp.data;
            } else {
                const resp = await api.get('/otimizador-faturamento/gerar', { params: { refresh } });
                data = resp.data;
            }
            setData(data); setLoading(false);
            // F11.X5: feedback visual + revalida aviso após "Atualizar"
            // 17/06: passa programacao_versao_id em uso pra que o banner suma quando já está atualizado
            if (refresh) { showToast('Faturamento recalculado', 'success'); carregarVersoes(data?.meta?.programacao_versao_id); }
        } catch (e: any) {
            // Cold start do BigQuery pode falhar/retornar vazio na 1ª vez: tenta de novo 1x antes de desistir.
            if (!_retry) { setTimeout(() => carregar(refresh, true), 1200); return; }
            erro(e, 'Erro ao gerar o faturamento'); setData(null); setLoading(false);
        }
    }, []); // eslint-disable-line

    const simular = useCallback(async () => {
        setLoading(true); setCenarioAtivo('');
        try {
            // 18/06: força refresh=true pra puxar carteira FRESH do BigQuery (V2) — sem isso
            // o backend usa snapshot do plano e os chips COMPLETO/SALDO ficam errados.
            const { data } = await api.post('/otimizador-faturamento/simular', { filtros: montarFiltros(), refresh: true });
            setData(data);
        } catch (e: any) { erro(e, 'Erro ao aplicar configuração'); }
        finally { setLoading(false); }
    }, [montarFiltros]); // eslint-disable-line

    const limparFiltros = () => { setFDe(inicioAno()); setFAte(hojeMais10()); setSelProdutos([]); setSelClientes([]); setSelPedidos([]); setSelTipos([]); setFontes(['disponivel', 'reserva', 'producao']); setEstrategia('completar_com_saldo'); setFaturavelHoje(false); setStatusPedido(['1', '4']); carregar(false); };

    const carregarCenarios = useCallback(async () => {
        try { const { data } = await api.get('/otimizador-faturamento/simulacoes'); setCenarios(data?.simulacoes || []); }
        catch (e: any) { erro(e, 'Erro ao listar cenários'); }
    }, []); // eslint-disable-line

    const salvarCenario = async () => {
        const label = window.prompt('Nome (label) para este cenário:');
        if (!label || !label.trim()) return;
        try {
            await api.post('/otimizador-faturamento/simulacoes', { label: label.trim(), filtros: montarFiltros() });
            showToast('Cenário salvo', 'success'); carregarCenarios();
        } catch (e: any) { erro(e, 'Erro ao salvar cenário'); }
    };

    const carregarCenario = async (id: string) => {
        setLoading(true);
        try {
            const { data } = await api.get(`/otimizador-faturamento/simulacoes/${id}`);
            setData(data?.resultado || null); setCenarioAtivo(id); setBusca('');
            // F4.4: restaura estado do Configurador (estratégia + fontes + filtros) se vierem do backend
            const f = data?.filtros || data?.resultado?.filtros || null;
            if (f && typeof f === 'object') {
                if (f.estrategia) setEstrategia(f.estrategia);
                if (Array.isArray(f.fontes)) setFontes(f.fontes);
                if (typeof f.faturavel_hoje === 'boolean') setFaturavelHoje(f.faturavel_hoje);
                if (Array.isArray(f.status)) setStatusPedido(f.status.length ? f.status : ['1', '4']);
                if (typeof f.periodo_de === 'string') setFDe(f.periodo_de);
                if (typeof f.periodo_ate === 'string') setFAte(f.periodo_ate);
                if (Array.isArray(f.remover_produtos)) setSelProdutos(f.remover_produtos);
                if (Array.isArray(f.remover_clientes)) setSelClientes(f.remover_clientes);
                if (Array.isArray(f.remover_pedidos)) setSelPedidos(f.remover_pedidos);
                if (Array.isArray(f.remover_tipos)) setSelTipos(f.remover_tipos);
            }
        } catch (e: any) { erro(e, 'Erro ao carregar cenário'); }
        finally { setLoading(false); }
    };

    const removerCenario = async (id: string) => {
        if (!window.confirm('Remover este cenário salvo?')) return;
        try { await api.del(`/otimizador-faturamento/simulacoes/${id}`); showToast('Cenário removido', 'success'); carregarCenarios(); if (cenarioAtivo === id) carregar(false); }
        catch (e: any) { erro(e, 'Erro ao remover cenário'); }
    };

    // 17/06: aceita programacao_versao_id_em_uso pra que Atualizar suma com o banner quando o
    // resultado atual já está rodando sobre a programação oficial mais recente.
    const carregarVersoes = useCallback(async (progVersaoIdEmUso?: string) => {
        try {
            const { data } = await api.get('/otimizador-faturamento/versoes');
            const vs = data?.versoes || []; setVersoes(vs);
            const oficial = vs.find((v: any) => v.oficial);
            if (oficial) {
                try {
                    const params: any = { faturamento_versao_id: oficial.id };
                    if (progVersaoIdEmUso) params.programacao_versao_id_em_uso = progVersaoIdEmUso;
                    const { data: a } = await api.get('/otimizador-faturamento/tem-versao-nova', { params });
                    setAviso(a?.mudou ? a : null);
                } catch { setAviso(null); }
            } else setAviso(null);
        } catch { /* silencioso */ }
    }, []);

    const salvarVersaoOficial = async () => {
        if (!window.confirm('Salvar o faturamento atual como versão OFICIAL? (congela o resultado com a configuração ativa)')) return;
        try {
            // F11.X1: propaga filtros do Configurador pro backend salvar a versão FIEL ao cenário ativo
            await api.post('/otimizador-faturamento/salvar-versao', { oficial: true, filtros: montarFiltros() });
            showToast('Versão oficial salva', 'success'); carregarVersoes();
        }
        catch (e: any) { erro(e, 'Erro ao salvar versão'); }
    };

    const marcarVersaoOficial = async (id: string) => {
        try { await api.put(`/otimizador-faturamento/versoes/${id}/oficial`, { oficial: true }); showToast('Versão marcada como oficial', 'success'); carregarVersoes(); }
        catch (e: any) { erro(e, 'Erro ao marcar oficial'); }
    };

    // 17/06: preview de rascunho (versão não-oficial) — null = usar oficial; uuid = previewar rascunho
    const [versaoPreviewId, setVersaoPreviewId] = useState<string | null>(null);
    const versaoPreviewIdRef = useRef<string | null>(null);
    useEffect(() => { versaoPreviewIdRef.current = versaoPreviewId; }, [versaoPreviewId]);

    // F11.X3: abrir uma versão salva carrega o snapshot completo no UI (resultado + restaura Configurador)
    const [versaoAtiva, setVersaoAtiva] = useState<string>('');
    const abrirVersao = async (id: string) => {
        setLoading(true);
        try {
            const { data } = await api.get(`/otimizador-faturamento/versoes/${id}`);
            const res = data?.resultado || data;
            setData(res || null); setVersaoAtiva(id); setBusca('');
            const f = res?.filtros || null;
            if (f && typeof f === 'object') {
                if (f.estrategia) setEstrategia(f.estrategia);
                if (Array.isArray(f.fontes)) setFontes(f.fontes);
                if (typeof f.faturavel_hoje === 'boolean') setFaturavelHoje(f.faturavel_hoje);
                if (Array.isArray(f.status)) setStatusPedido(f.status.length ? f.status : ['1', '4']);
                if (typeof f.periodo_de === 'string') setFDe(f.periodo_de);
                if (typeof f.periodo_ate === 'string') setFAte(f.periodo_ate);
                if (Array.isArray(f.remover_produtos)) setSelProdutos(f.remover_produtos);
                if (Array.isArray(f.remover_clientes)) setSelClientes(f.remover_clientes);
                if (Array.isArray(f.remover_pedidos)) setSelPedidos(f.remover_pedidos);
                if (Array.isArray(f.remover_tipos)) setSelTipos(f.remover_tipos);
            }
        } catch (e: any) { erro(e, 'Erro ao abrir versão'); }
        finally { setLoading(false); }
    };

    const abrirComparar = (tipo: 'versoes' | 'cenarios') => { setCmpTipo(tipo); setCmpA(''); setCmpB(''); setCmpData(null); setCmpOpen(true); };

    const executarComparacao = async () => {
        if (!cmpA || !cmpB || cmpA === cmpB) { showToast('Selecione dois itens diferentes', 'error'); return; }
        setCmpLoading(true); setCmpData(null);
        try {
            const path = cmpTipo === 'versoes' ? '/otimizador-faturamento/comparar' : '/otimizador-faturamento/simulacoes-comparar';
            const params = cmpTipo === 'versoes' ? { base: cmpA, novo: cmpB } : { a: cmpA, b: cmpB };
            const { data } = await api.get(path, { params }); setCmpData(data);
        } catch (e: any) { erro(e, 'Erro ao comparar'); }
        finally { setCmpLoading(false); }
    };

    useEffect(() => { carregar(false); carregarCenarios(); carregarVersoes(); }, []); // eslint-disable-line

    const termo = busca.trim().toLowerCase();
    const filtrarPed = (p: Pedido) => !termo
        || String(p.pedido || '').toLowerCase().includes(termo)
        || String(p.cliente || '').toLowerCase().includes(termo)
        || (p.produtos || []).some(pr => String(pr.sku || '').toLowerCase().includes(termo) || String(pr.descricao || '').toLowerCase().includes(termo));

    const pedidos: Pedido[] = (data?.pedidos || []).filter(filtrarPed);
    const semData: Pedido[] = (data?.sem_data_programacao || []).filter(filtrarPed);
    // F10 ajuste 12/06: KPIs refletem o filtro de busca — totais recalculados a partir dos pedidos filtrados
    let _vEst = 0, _vRes = 0, _vProd = 0, _vItem = 0;
    pedidos.forEach(p => (p.produtos || []).forEach(pr => {
        const dem = pr.demanda || 0; const val = pr.valor || 0;
        if (dem > 0) {
            _vEst  += val * ((pr.consumo_disponivel || 0) / dem);
            _vRes  += val * ((pr.consumo_reserva   || 0) / dem);
            _vProd += val * ((pr.consumo_producao  || 0) / dem);
        }
        _vItem += val;
    }));
    const totais = {
        ...(data?.totais || {}),
        n_pedidos_faturaveis: pedidos.length,
        n_sem_data: semData.length,
        n_pedidos_completos: pedidos.length + semData.length,
        valor_faturavel: pedidos.reduce((a, p) => a + (p.valor_total_pedido || 0), 0),
        valor_nao_faturavel: semData.reduce((a, p) => a + (p.valor_total_pedido || 0), 0),
        valor_bonificacao: pedidos.filter(p => p.tipo === 'BONIFICACAO').reduce((a, p) => a + (p.valor_total_pedido || 0), 0),
        valor_pendente_financeiro: pedidos.filter(p => p.tipo === 'PENDENTE_FINANCEIRO').reduce((a, p) => a + (p.valor_total_pedido || 0), 0),
        // F10 ajuste 12/06: card "Valor Padrão" virou "Valor Item" = soma de pr.valor de TODOS os produtos filtrados
        valor_item: _vItem,
        // Composição do valor faturável por fonte (rateio proporcional ao consumo por SKU)
        valor_por_estoque: _vEst,
        valor_por_reserva: _vRes,
        valor_por_producao: _vProd,
    };
    const hojeKey = diaKey(new Date().toISOString());
    const [calModo, setCalModo] = useState<'faturaveis' | 'nao'>('faturaveis');
    const listaCal: Pedido[] = calModo === 'faturaveis' ? pedidos : semData;
    const diaDoPedido = (p: Pedido) => dataPedidoCalendario(p, hojeKey, calModo === 'nao');
    const pedidosDoDia = diaSel ? listaCal.filter(p => diaDoPedido(p) === diaSel) : [];

    const gerarPdf = async () => {
        if (!data) return;
        const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
        const mostraReserva = data?.considerar_reserva !== false;
        const head = [['Pedido / Produto', 'Demanda', 'Disponível', ...(mostraReserva ? ['Reserva'] : []), 'Físico', 'Cons. Disp', 'Cons. Res', 'Cons. Prod', 'Prev. Produção', 'Valor', 'Previsão']];
        const ncols = head[0].length;
        const body: any[] = [];
        pedidos.forEach(p => {
            const cab = `#${p.pedido}  ${p.cliente || ''}  ·  ${p.pronto ? 'PRONTO (estoque)' : (fmtData(p.previsao_termino) || 'sem data')}  ·  ${fmtMoney(p.valor_total_pedido)}`;
            body.push([{ content: cab, colSpan: ncols, styles: { fillColor: [241, 245, 249], textColor: [190, 30, 45], fontStyle: 'bold' } }]);
            p.produtos.forEach(pr => {
                const prev = pr.previsao_termino ? (fmtData(pr.previsao_termino) || '') : ((pr.qtd_em_producao || 0) > 0 ? 'SEM PROGRAMAÇÃO' : '—');
                const row: any[] = [`${pr.sku}  ${pr.descricao || ''}`, fmtInt(pr.demanda), fmtInt(pr.estoque_disponivel)];
                if (mostraReserva) row.push(fmtInt(pr.reserva));
                // F10.7: consumo discriminado por fonte
                row.push(fmtInt(pr.estoque_fisico), fmtInt(pr.consumo_disponivel), fmtInt(pr.consumo_reserva), fmtInt(pr.consumo_producao), fmtInt(pr.qtd_em_producao), fmtMoney(pr.valor), prev);
                body.push(row);
            });
        });
        const { finalizar } = await aplicarLayoutBlackd(doc, { titulo: 'Otimizador de Faturamento', subtitulo: `${totais.n_pedidos_faturaveis || 0} pedidos faturáveis · ${fmtMoney(totais.valor_faturavel)}` });
        autoTable(doc, { startY: 35, head, body, ...temaTabelaBlackd });
        finalizar();
        doc.save(`faturamento_${new Date().toLocaleDateString('en-CA')}.pdf`);
    };

    const gerarExcel = async () => {
        if (!data) return;
        const XLSX = await import('xlsx');
        const mostraReserva = data?.considerar_reserva !== false;
        const rows: any[] = [];
        // 17/06: Excel = espelho da tela. Só pedidos faturáveis (que respeitam todos os filtros do Configurador).
        // Não-faturáveis (sem saldo, fora do dia, etc) ficam de fora pra não confundir com 'carteira completa'.
        const todosPeds = [...(data.pedidos || [])];
        todosPeds.forEach(p => {
            rows.push({
                'Pedido': p.pedido,
                'Cliente': p.cliente || '',
                'Tipo': p.tipo || 'Padrão',
                'Atrasado': p.atrasado ? 'Sim' : 'Não',
                'Dias Atraso': p.dias_atraso || 0,
                'Emissão': fmtData(p.emissao) || '',
                'Entrega': fmtData(p.entrega) || '',
                'Valor Total Pedido': p.valor_total_pedido || 0,
                'Status': p.pronto ? 'Pronto (estoque)' : p.previsao_termino ? `Prev: ${fmtData(p.previsao_termino)}` : 'Sem programação',
                'Código Produto': '',
                'Descrição Produto': '',
                'Demanda': '',
                'Disponível': '',
                ...(mostraReserva ? { 'Reserva': '' } : {}),
                'Físico': '',
                'Cons. Disp': '',
                'Cons. Reserva': '',
                'Cons. Produção': '',
                'Previsto Produção': '',
                'Valor Produto': '',
                'Previsão Término': '',
            });
            (p.produtos || []).forEach((pr: any) => {
                rows.push({
                    'Pedido': '',
                    'Cliente': '',
                    'Tipo': '',
                    'Atrasado': '',
                    'Dias Atraso': '',
                    'Emissão': '',
                    'Entrega': '',
                    'Valor Total Pedido': '',
                    'Status': '',
                    'Código Produto': pr.sku,
                    'Descrição Produto': pr.descricao || '',
                    'Demanda': pr.demanda,
                    'Disponível': pr.estoque_disponivel,
                    ...(mostraReserva ? { 'Reserva': pr.reserva ?? '' } : {}),
                    'Físico': pr.estoque_fisico,
                    'Cons. Disp': pr.consumo_disponivel ?? 0,
                    'Cons. Reserva': pr.consumo_reserva ?? 0,
                    'Cons. Produção': pr.consumo_producao ?? 0,
                    'Previsto Produção': pr.qtd_em_producao || 0,
                    'Valor Produto': pr.valor || 0,
                    'Previsão Término': fmtData(pr.previsao_termino) || '',
                });
            });
        });
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Faturamento');

        // 17/06: aba separada para pedidos incompletos no cenário (não confundir com faturáveis)
        const incompletos: any[] = [];
        ((data as any).sem_data_programacao || []).forEach((p: any) => {
            incompletos.push({
                'Pedido': p.pedido,
                'Cliente': p.cliente || '',
                'Tipo': p.tipo || 'Padrão',
                'Atrasado': p.atrasado ? 'Sim' : 'Não',
                'Dias Atraso': p.dias_atraso || 0,
                'Emissão': fmtData(p.emissao) || '',
                'Entrega': fmtData(p.entrega) || '',
                'Valor Total Pedido': p.valor_total_pedido || 0,
                'Motivo': p.motivo === 'fora_do_dia' ? 'Fora do dia (filtro Faturável hoje)' : (p.motivo || 'Sem saldo / sem programação'),
                'Código Produto': '',
                'Descrição Produto': '',
                'Demanda': '',
                'Disponível': '',
                ...(mostraReserva ? { 'Reserva': '' } : {}),
                'Físico': '',
                'Cons. Disp': '',
                'Cons. Reserva': '',
                'Cons. Produção': '',
                'Previsto Produção': '',
                'Valor Produto': '',
                'Previsão Término': '',
                'Falta': '',
            });
            (p.produtos || []).forEach((pr: any) => {
                incompletos.push({
                    'Pedido': '', 'Cliente': '', 'Tipo': '', 'Atrasado': '', 'Dias Atraso': '',
                    'Emissão': '', 'Entrega': '', 'Valor Total Pedido': '', 'Motivo': '',
                    'Código Produto': pr.sku,
                    'Descrição Produto': pr.descricao || '',
                    'Demanda': pr.demanda,
                    'Disponível': pr.estoque_disponivel,
                    ...(mostraReserva ? { 'Reserva': pr.reserva ?? '' } : {}),
                    'Físico': pr.estoque_fisico,
                    'Cons. Disp': pr.consumo_disponivel ?? 0,
                    'Cons. Reserva': pr.consumo_reserva ?? 0,
                    'Cons. Produção': pr.consumo_producao ?? 0,
                    'Previsto Produção': pr.qtd_em_producao || 0,
                    'Valor Produto': pr.valor || 0,
                    'Previsão Término': fmtData(pr.previsao_termino) || '',
                    'Falta': pr.falta || '',
                });
            });
        });
        if (incompletos.length > 0) {
            const wsInc = XLSX.utils.json_to_sheet(incompletos);
            XLSX.utils.book_append_sheet(wb, wsInc, 'Pedidos incompletos');
        }

        // 17/06: aba 'Filtros aplicados' reflete EXATAMENTE o que o Configurador enviou
        // ao backend pra gerar este resultado. Mesma terminologia do UI (labels novas).
        const estrategiaLbl: Record<string, string> = {
            completar_com_saldo: 'Por data de entrega (greedy)',
            max_valor: 'Maximizar faturamento (R$)',
            max_atrasados: 'Maximizar pedidos atrasados',
            max_combinado: 'Atrasados + faturamento',
        };
        const fontesLbl: Record<string, string> = {
            disponivel: 'Estoque disponível',
            reserva: 'Reserva',
            producao: 'Produção (respeitando previsão de término)',
        };
        const tipoPedidoLbl: Record<string, string> = {
            VENDA: 'Venda',
            BENEFICIAMENTO: 'Beneficiamento',
            SAC: 'SAC',
            BONIFICACAO: 'Bonificação',
            TROCA: 'Troca',
            PENDENTE_FINANCEIRO: 'Pendente Financeiro',
        };
        const fmtDt = (s: any) => s ? new Date(s).toLocaleString('pt-BR') : '—';
        const filtrosRows: any[][] = [
            ['Configurador — Filtros aplicados nesta geração', ''],
            [],
            ['Gerado em', new Date().toLocaleString('pt-BR')],
            ['Programação usada (snapshot oficial de)', fmtDt(data?.meta?.programacao_em)],
            ['Plano usado (versão de)', fmtDt(data?.meta?.plano_usado_em)],
            ['Board divergente do snapshot?', data?.meta?.board_divergente ? 'SIM (board foi alterado após snapshot oficial)' : 'Não'],
            ['Versão mais nova auto-salva pendente?', data?.meta?.versao_mais_nova_que_oficial ? 'SIM' : 'Não'],
            [],
            ['Estratégia', estrategiaLbl[estrategia] || estrategia],
            ['Status do pedido', statusPedido.map(s => s === '1' ? 'Em aberto (1)' : s === '4' ? 'Liberado (4)' : s).join(' • ') || 'Em aberto (1) • Liberado (4)'],
            ['Fontes ativas', fontes.map(f => fontesLbl[f] || f).join(' • ')],
            ['Período (de)', fDe || '—'],
            ['Período (até)', fAte || '—'],
            [],
            [`Produtos removidos (${selProdutos.length})`, ''],
            ...selProdutos.map(s => ['  • ' + s, '']),
            [],
            [`Clientes removidos (${selClientes.length})`, ''],
            ...selClientes.map(s => ['  • ' + s, '']),
            [],
            [`Pedidos removidos (${selPedidos.length})`, ''],
            ...selPedidos.map(s => ['  • ' + s, '']),
            [],
            [`Tipos de pedido removidos (${selTipos.length})`, ''],
            ...selTipos.map(t => ['  • ' + (tipoPedidoLbl[t] || t), '']),
            [],
            ['— Totais do resultado —', ''],
            ['Pedidos faturáveis', (data?.pedidos || []).length],
            ['Pedidos sem data de programação', (data?.sem_data_programacao || []).length],
            ['Valor total faturável (R$)', (data?.pedidos || []).reduce((acc: number, p: any) => acc + (p.valor_total_pedido || 0), 0)],
            ['Solver', data?.meta?.solver || '(greedy default)'],
        ];
        const wsFiltros = XLSX.utils.aoa_to_sheet(filtrosRows);
        wsFiltros['!cols'] = [{ wch: 50 }, { wch: 60 }];
        XLSX.utils.book_append_sheet(wb, wsFiltros, 'Filtros aplicados');

        const dataRef = data?.meta?.programacao_em
            ? new Date(data.meta.programacao_em).toLocaleDateString('en-CA')
            : new Date().toLocaleDateString('en-CA');
        XLSX.writeFile(wb, `faturamento_${estrategia}_${dataRef}.xlsx`);
    };

    return (
        <div className="p-4 sm:p-6 max-w-[1500px] mx-auto">
            {/* Cabeçalho */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <div className="flex items-center gap-2">
                    <Receipt className="w-6 h-6 text-rose-600" />
                    <div>
                        <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">Otimizador de Faturamento</h1>
                        <p className="text-xs text-slate-500">Pedidos completos sobre a Programação oficial · ordenados pela previsão de entrega
                            {cenarioAtivo && <span className="ml-1 text-violet-500 font-semibold">· vendo cenário salvo</span>}
                        </p>
                        {data && (data.calc_versao
                            ? <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">motor: {data.calc_versao}</span>
                            : <span className="inline-block mt-0.5 text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 font-bold">⚠ BACKEND ANTIGO — rebuild o app do BACKEND no EasyPanel</span>)}
                        {/* 17/06: chip indicando se está vendo Oficial ou Rascunho (preview) */}
                        {data?.meta?.versao_em_uso_em && (
                            <span className={`ml-2 inline-block mt-0.5 text-[10px] px-2 py-0.5 rounded font-bold ${
                                data.meta.versao_em_uso_oficial
                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                    : 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300'}`}
                                title={data.meta.versao_em_uso_por_nome ? `Por: ${data.meta.versao_em_uso_por_nome}` : ''}>
                                Versão: {data.meta.versao_em_uso_oficial ? 'Oficial' : 'Rascunho (preview)'} · {new Date(data.meta.versao_em_uso_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </span>
                        )}
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <div className="inline-flex rounded-lg border border-slate-300 dark:border-slate-600 overflow-hidden text-xs">
                        <button onClick={() => setVista('tabela')} className={`inline-flex items-center gap-1 px-2.5 py-1.5 font-bold ${vista === 'tabela' ? 'bg-rose-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}><Table2 className="w-3.5 h-3.5" />Tabela</button>
                        <button onClick={() => setVista('calendario')} className={`inline-flex items-center gap-1 px-2.5 py-1.5 font-bold ${vista === 'calendario' ? 'bg-rose-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}><CalendarDays className="w-3.5 h-3.5" />Calendário</button>
                    </div>
                    <button onClick={() => setSimOpen(o => !o)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 text-xs font-bold hover:bg-violet-50 dark:hover:bg-violet-900/30">
                        <SlidersHorizontal className="w-3.5 h-3.5" /> Configurador
                    </button>
                    <button onClick={async () => { if (!historicoOpen) { await carregarHistorico(0, histSoOficiais); } setHistoricoOpen(o => !o); }} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 text-xs font-bold hover:bg-amber-50 dark:hover:bg-amber-900/30">
                        <Clock className="w-3.5 h-3.5" /> Histórico
                    </button>
                    <button onClick={() => abrirComparar('cenarios')} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-700 dark:text-indigo-300 text-xs font-bold hover:bg-indigo-50 dark:hover:bg-indigo-900/30">
                        <GitCompareArrows className="w-3.5 h-3.5" /> Comparar
                    </button>
                    {podeOficial && (
                    <button onClick={salvarVersaoOficial} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 text-xs font-bold hover:bg-emerald-50 dark:hover:bg-emerald-900/30">
                        <BadgeCheck className="w-3.5 h-3.5" /> Salvar versão
                    </button>
                    )}
                    <button onClick={gerarExcel} disabled={!data} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 text-xs font-bold hover:bg-emerald-50 dark:hover:bg-emerald-900/30 disabled:opacity-50">
                        <FileDown className="w-3.5 h-3.5" /> Excel
                    </button>
                    <button onClick={gerarPdf} disabled={!data} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 text-xs font-bold hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-50">
                        <FileDown className="w-3.5 h-3.5" /> PDF
                    </button>
                    <button onClick={() => carregar(true)} disabled={loading} title="Recalcular com os saldos atuais"
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700 disabled:opacity-50">
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Atualizar
                    </button>
                </div>
            </div>

            {/* Aviso: a programação mudou */}
            {aviso?.mudou && (
                <div className="mb-4 p-3 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 flex flex-wrap items-center gap-3">
                    <div className="flex items-center gap-2 text-sm text-amber-800 dark:text-amber-200"><AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" /><span>A <b>Programação mudou</b> desde a última versão oficial de faturamento. O resultado pode estar desatualizado.</span></div>
                    <div className="flex items-center gap-2 ml-auto">
                        <button onClick={() => carregar(true)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-amber-600 text-white text-xs font-bold hover:bg-amber-700"><RefreshCw className="w-3.5 h-3.5" /> Atualizar</button>
                        {podeOficial && <button onClick={salvarVersaoOficial} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-amber-400 text-amber-800 dark:text-amber-200 text-xs font-bold hover:bg-amber-100 dark:hover:bg-amber-900/40"><BadgeCheck className="w-3.5 h-3.5" /> Salvar nova versão</button>}
                        {/* 17/06: preview do rascunho — vê o impacto SEM oficializar; volta pra oficial a qualquer momento */}
                        {data?.meta?.versao_mais_nova_que_oficial && data?.meta?.ultima_versao_id && !versaoPreviewId && (
                            <button
                                onClick={() => { setVersaoPreviewId(data.meta.ultima_versao_id); setTimeout(() => carregar(true), 0); }}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-sky-400 text-sky-800 dark:text-sky-200 text-xs font-bold hover:bg-sky-100 dark:hover:bg-sky-900/40"
                                title="Roda o otimizador sobre a programação alterada (rascunho) — sem oficializar.">
                                <GitCompareArrows className="w-3.5 h-3.5" /> Ver impacto da programação alterada
                            </button>
                        )}
                        {versaoPreviewId && (
                            <button
                                onClick={() => { setVersaoPreviewId(null); setTimeout(() => carregar(true), 0); }}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700"
                                title="Volta a usar a programação OFICIAL como base do faturamento.">
                                <BadgeCheck className="w-3.5 h-3.5" /> Voltar para programação oficial
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* F11.2 (18/06): banner de staleness removido aqui — Faturamento sempre usa a
                Programação oficial em uso. Defasagem plano→programação é responsabilidade do
                time de Produção, não do operador de Faturamento. Sinal continua disponível em
                data.meta.stale pra quem quiser surfacar em outras telas. */}

            {/* F11.2: Carimbo permanente "Plano vX → Programação vY" */}
            {data?.meta && (
                <div className="mb-4 text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-3">
                    <span>📋 Plano de <b>{data.meta.plano_usado_em ? new Date(data.meta.plano_usado_em).toLocaleDateString('pt-BR') : '—'}</b></span>
                    <span>→</span>
                    <span>🛠 Programação de <b>{data.meta.programacao_em ? new Date(data.meta.programacao_em).toLocaleDateString('pt-BR') : '—'}</b></span>
                    {/* 18/06 (V2): timestamp da carteira fresh + contadores de removidos/novos pra dar ciência da diferença vs snapshot do plano. */}
                    {data.meta.carteira_fresh_em && (
                        <span title={`Carteira atualizada do BigQuery (pedidos em aberto AGORA). ${data.meta.pedidos_removidos_qtd || 0} faturado(s) sumiu(ram) do bucket. ${data.meta.pedidos_novos_qtd || 0} novo(s) entrou(aram).`} className="text-emerald-700 dark:text-emerald-300 font-semibold">
                            🔄 Carteira: <b>{new Date(data.meta.carteira_fresh_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</b>
                            {(data.meta.pedidos_novos_qtd || 0) > 0 && <span className="ml-1 text-sky-600 dark:text-sky-400">· +{data.meta.pedidos_novos_qtd} novo(s)</span>}
                            {(data.meta.pedidos_removidos_qtd || 0) > 0 && <span className="ml-1 text-amber-600 dark:text-amber-400">· -{data.meta.pedidos_removidos_qtd} faturado(s)</span>}
                        </span>
                    )}
                    {data.meta.carteira_fresh_erro && (
                        <span title={data.meta.carteira_fresh_erro} className="text-rose-600 dark:text-rose-400 font-semibold">⚠ Carteira fresh falhou — usando snapshot</span>
                    )}
                    {data.meta.delta_vs_e1 && (
                        <span className="ml-auto text-amber-700 dark:text-amber-300">
                            ⚖ Estratégia rejeitou <b>{data.meta.delta_vs_e1.n_pedidos_rejeitados_por_restricao_temporal}</b> pedidos por restrição (ganho R$ {(data.meta.delta_vs_e1.delta_rs ?? 0).toLocaleString('pt-BR')})
                        </span>
                    )}
                </div>
            )}

            {/* Fase A (16/06) + hash 17/06: Board atual da Programação divergente do snapshot da versão oficial usada.
                Hash detecta também remanejo de qtd/máquina/ordem/lote/previsão — não só add/remove de item. */}
            {data?.meta?.board_divergente && (
                <div className="mb-4 p-2.5 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-950/30 text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <span>
                        <b>Programação foi alterada após a última versão oficial.</b>{' '}
                        Board atual tem <b>{data.meta.board_n_itens ?? 0}</b> itens, snapshot oficial tem <b>{data.meta.snapshot_n_itens ?? 0}</b>.{' '}
                        O Otimizador usa o snapshot pras <b>libs de produção</b> (datas e quantidades por SKU) — salve nova versão oficial na Programação pra refletir o board atual. <span className="text-[10px] text-amber-700 dark:text-amber-300">A carteira de pedidos já está atualizada do BigQuery.</span>
                    </span>
                </div>
            )}
            {/* 17/06: Tornar oficial mora apenas na Programação. Aqui sinalizamos só que mudou (banner aviso?.mudou acima). */}
            {/* G3.1/G3.2 (16/06): Telemetria do solver — UI vê quando ILP caiu pra greedy ou retornou sub-ótimo */}
            {data?.meta?.solver && data.meta.solver !== 'pulp_optimal' && (
                <div className="mb-4 p-2.5 rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-950/30 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                    <span>
                        {data.meta.solver === 'greedy_fallback_no_pulp' && <><b>PuLP indisponível</b> — solução veio do greedy E1 (fallback). Instale `pulp` no backend.</>}
                        {data.meta.solver === 'greedy_fallback_no_candidates' && <><b>Sem candidatos pro ILP</b> — solução veio do greedy E1 (fallback).</>}
                        {data.meta.solver === 'greedy_fallback_solver_error' && <><b>Erro no solver CBC</b> — solução veio do greedy E1 (fallback). Detalhe: {data.meta.solver_error}</>}
                        {data.meta.solver === 'pulp_partial' && <><b>Solução sub-ótima</b> — CBC retornou status <code>{data.meta.solver_status}</code> (provavelmente time-limit). Valor pode não ser o máximo.</>}
                    </span>
                </div>
            )}
            {/* G3.3 (16/06): Regressão do solver — ILP entregou menos R$ que greedy no mesmo universo */}
            {data?.meta?.regressao_solver && (
                <div className="mb-4 p-2.5 rounded-xl border border-rose-300 dark:border-rose-800 bg-rose-50/60 dark:bg-rose-950/30 text-xs text-rose-800 dark:text-rose-200 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                    <span>
                        ⚠ <b>Solver regrediu</b> vs greedy E1 no mesmo universo: ILP R$ {data.meta.regressao_solver.valor_ilp.toLocaleString('pt-BR')} vs E1 R$ {data.meta.regressao_solver.valor_e1.toLocaleString('pt-BR')} (perda R$ {data.meta.regressao_solver.delta_perda_rs.toLocaleString('pt-BR')}). Status CBC: <code>{data.meta.regressao_solver.solver_status}</code>.
                    </span>
                </div>
            )}
            {/* F11.1: Aviso quando "produção" está marcada como fonte — produção atrasada não conta */}
            {fontes.includes('producao') && (
                <div className="mb-4 p-2.5 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                    <span>
                        <b>Produção atrasada</b> (previsão &lt; hoje) <b>não entra na conta</b>. Já virou estoque ou ficou retida na fábrica.
                        {data?.meta?.producao_atrasada_ignorada && (
                            <> <b>{data.meta.producao_atrasada_ignorada.n_liberacoes}</b> liberações de <b>{data.meta.producao_atrasada_ignorada.skus?.length ?? 0}</b> SKUs ({data.meta.producao_atrasada_ignorada.qtd_total?.toLocaleString('pt-BR')} unidades) foram ignoradas.</>
                        )}
                    </span>
                </div>
            )}

            {/* Fase B (16/06): Aba Histórico — modal com versões do Otimizador Faturamento */}
            {historicoOpen && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center pt-16 px-4" onClick={() => setHistoricoOpen(false)}>
                    <div onClick={(e) => e.stopPropagation()} className="w-full max-w-6xl bg-white dark:bg-slate-900 rounded-xl shadow-2xl border border-slate-300 dark:border-slate-700 max-h-[80vh] overflow-hidden flex flex-col">
                        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 text-sm font-bold text-slate-800 dark:text-slate-100">
                                <Clock className="w-4 h-4" /> Histórico de Versões
                            </div>
                            <div className="flex items-center gap-3 text-xs">
                                <label className="flex items-center gap-1.5 cursor-pointer select-none">
                                    <input type="checkbox" checked={histSoOficiais} onChange={(e) => { setHistSoOficiais(e.target.checked); carregarHistorico(0, e.target.checked); }} />
                                    <span>Só oficiais</span>
                                </label>
                                <button onClick={() => carregarHistorico(histOffset, histSoOficiais)} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-300 dark:border-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800">
                                    <RefreshCw className="w-3 h-3" /> Atualizar
                                </button>
                                <button onClick={() => setHistoricoOpen(false)} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"><X className="w-4 h-4" /></button>
                            </div>
                        </div>
                        <div className="overflow-auto flex-1">
                            {histLoading ? (
                                <div className="p-8 text-center text-xs text-slate-500">Carregando…</div>
                            ) : histVersoes.length === 0 ? (
                                <div className="p-8 text-center text-xs text-slate-500">Sem versões ainda. Clique em "Processar" pra criar a primeira.</div>
                            ) : (
                                <table className="w-full text-xs">
                                    <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300 sticky top-0">
                                        <tr>
                                            <th className="px-3 py-2 text-left font-semibold">Quando</th>
                                            <th className="px-3 py-2 text-left font-semibold">Estratégia</th>
                                            <th className="px-3 py-2 text-right font-semibold">Pedidos</th>
                                            <th className="px-3 py-2 text-right font-semibold">Valor R$</th>
                                            <th className="px-3 py-2 text-left font-semibold">Autor</th>
                                            <th className="px-3 py-2 text-left font-semibold">Programação</th>
                                            <th className="px-3 py-2 text-center font-semibold">Oficial</th>
                                            <th className="px-3 py-2 text-center font-semibold">Ações</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {histVersoes.map((v: any) => (
                                            <tr key={v.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/30">
                                                <td className="px-3 py-2 whitespace-nowrap">{fmtDt(v.created_at) || '—'}</td>
                                                <td className="px-3 py-2 font-mono text-[10px]">{v.totais_resumo?.estrategia || v.filtros?.estrategia || '—'}</td>
                                                <td className="px-3 py-2 text-right">{fmtInt(v.totais_resumo?.n_pedidos_faturaveis)}</td>
                                                <td className="px-3 py-2 text-right">{fmtMoney(v.totais_resumo?.valor_faturavel)}</td>
                                                <td className="px-3 py-2">{v.created_by_name || '—'}</td>
                                                <td className="px-3 py-2 font-mono text-[10px]" title={`Programação: ${v.programacao_versao_id || '—'}\nPlano: ${v.plano_versao_id || '—'}`}>
                                                    {v.programacao_versao_id ? String(v.programacao_versao_id).slice(0, 8) + '…' : '—'}
                                                </td>
                                                <td className="px-3 py-2 text-center">{v.oficial ? <BadgeCheck className="inline w-4 h-4 text-emerald-600" /> : <span className="text-slate-400">—</span>}</td>
                                                <td className="px-3 py-2 text-center whitespace-nowrap">
                                                    <button onClick={() => setVerConfig(v)} className="text-violet-600 dark:text-violet-400 hover:underline mr-3 text-xs font-semibold">Ver config</button>
                                                    <button onClick={() => carregarVersaoHistorico(v.id)} className="text-rose-600 dark:text-rose-400 hover:underline mr-3 text-xs font-semibold">Carregar</button>
                                                    {podeOficial && (
                                                    <button onClick={() => tornarOficialHistorico(v.id, !v.oficial)} className="text-emerald-600 dark:text-emerald-400 hover:underline text-xs font-semibold">
                                                        {v.oficial ? 'Desmarcar' : 'Tornar oficial'}
                                                    </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )}
                        </div>
                        <div className="px-4 py-2 border-t border-slate-200 dark:border-slate-700 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                            <span>{histTotal} versão(ões){histSoOficiais ? ' (só oficiais)' : ''}</span>
                            <div className="flex items-center gap-2">
                                <button disabled={histOffset === 0 || histLoading} onClick={() => carregarHistorico(Math.max(0, histOffset - histLimit), histSoOficiais)} className="p-1 rounded border border-slate-300 dark:border-slate-600 disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-slate-800"><ChevronLeft className="w-3 h-3" /></button>
                                <span>{histTotal === 0 ? 0 : histOffset + 1}–{Math.min(histOffset + histLimit, histTotal)} de {histTotal}</span>
                                <button disabled={histOffset + histLimit >= histTotal || histLoading} onClick={() => carregarHistorico(histOffset + histLimit, histSoOficiais)} className="p-1 rounded border border-slate-300 dark:border-slate-600 disabled:opacity-30 hover:bg-slate-100 dark:hover:bg-slate-800"><ChevronRight className="w-3 h-3" /></button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {/* Modal: configuração usada na versão (do Histórico) */}
            {verConfig && (() => {
                const f = verConfig.filtros || {};
                const ESTRAT: Record<string, string> = {
                    completar_com_saldo: 'Por data de entrega (greedy)',
                    max_valor: 'Maximizar faturamento (R$)',
                    max_atrasados: 'Maximizar pedidos atrasados',
                    max_combinado: 'Atrasados + faturamento',
                };
                const FONTE: Record<string, string> = { disponivel: 'Disponível', reserva: 'Reserva', producao: 'Produção (previsto)' };
                const lista = (arr: any): any[] => Array.isArray(arr) ? arr : [];
                const vazio = !f.estrategia && !lista(f.fontes).length && !f.periodo_de && !f.periodo_ate
                    && !lista(f.remover_pedidos).length && !lista(f.remover_produtos).length && !lista(f.remover_clientes).length && !lista(f.remover_tipos).length;
                return (
                    <div className="fixed inset-0 z-[60] bg-black/40 flex items-start justify-center pt-20 px-4" onClick={() => setVerConfig(null)}>
                        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-lg max-h-[75vh] overflow-auto" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                                <h3 className="font-bold text-sm inline-flex items-center gap-2"><SlidersHorizontal className="w-4 h-4" /> Configuração da versão</h3>
                                <button onClick={() => setVerConfig(null)} className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800"><X className="w-4 h-4" /></button>
                            </div>
                            <div className="p-4 space-y-3 text-xs text-slate-700 dark:text-slate-200">
                                <div className="text-[11px] text-slate-500">{fmtDt(verConfig.created_at) || '—'}{verConfig.created_by_name ? ` · ${verConfig.created_by_name}` : ''}</div>
                                <div><span className="font-bold text-slate-500">Estratégia:</span> {ESTRAT[f.estrategia] || f.estrategia || '—'}</div>
                                <div><span className="font-bold text-slate-500">Status do pedido:</span> {lista(f.status).map((x: string) => x === '1' ? 'Em aberto (1)' : x === '4' ? 'Liberado (4)' : x).join(', ') || 'Em aberto (1), Liberado (4)'}</div>
                                <div><span className="font-bold text-slate-500">Fontes do saldo:</span> {lista(f.fontes).map((x: string) => FONTE[x] || x).join(', ') || '—'}</div>
                                {(f.periodo_de || f.periodo_ate) && (
                                    <div><span className="font-bold text-slate-500">Período:</span> {fmtData(f.periodo_de) || f.periodo_de || '—'} → {fmtData(f.periodo_ate) || f.periodo_ate || '—'}</div>
                                )}
                                {([['remover_pedidos', 'Pedidos removidos'], ['remover_produtos', 'Produtos removidos'], ['remover_clientes', 'Clientes removidos'], ['remover_tipos', 'Tipos removidos']] as const).map(([k, lbl]) => {
                                    const arr = lista(f[k]);
                                    if (!arr.length) return null;
                                    return (
                                        <div key={k}>
                                            <span className="font-bold text-slate-500">{lbl} ({arr.length}):</span>
                                            <div className="mt-1 flex flex-wrap gap-1">
                                                {arr.map((x: any, i: number) => <span key={i} className="px-1.5 py-0.5 rounded bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300">{String(x)}</span>)}
                                            </div>
                                        </div>
                                    );
                                })}
                                {vazio && <div className="text-slate-400 italic">Sem configuração registrada para esta versão (versão antiga ou processada sem filtros).</div>}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Painel do configurador */}
            {simOpen && (
                <div className="mb-4 p-3 rounded-xl shadow border border-violet-200 dark:border-violet-800 bg-violet-50/40 dark:bg-violet-950/20">
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
                        <div className="grid grid-cols-2 gap-2 lg:col-span-2">
                            <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">Entrega de
                                <input value={fDe} onChange={e => setFDe(e.target.value)} type="date" className="mt-1 w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs" /></label>
                            <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">até
                                <input value={fAte} onChange={e => setFAte(e.target.value)} type="date" className="mt-1 w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs" /></label>
                        </div>
                        <MultiSelectPopover label="Pedidos (remover do configurador)" options={pedidoOpts} selected={selPedidos} onChange={setSelPedidos} />
                        <MultiSelectPopover label="Produtos (remover do configurador)" options={produtoOpts} selected={selProdutos} onChange={setSelProdutos} />
                        <MultiSelectPopover label="Clientes (remover do configurador)" options={clienteOpts} selected={selClientes} onChange={setSelClientes} />
                        <MultiSelectPopover label="Tipo de pedido (remover do configurador)" options={tipoOpts} selected={selTipos} onChange={setSelTipos} />
                    </div>
                    <div className="mt-3 text-xs flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-semibold text-slate-600 dark:text-slate-300">Estratégia de seleção:</span>
                        {([
                            ['completar_com_saldo', 'Por data de entrega (greedy)', 'Atende pedidos em ordem cronológica de entrega (mais urgente primeiro). Se dois pedidos disputam o mesmo SKU, ganha quem entrega antes. Use quando o objetivo é cumprir prazos na ordem em que foram prometidos. É o default — comportamento mais previsível.'],
                            ['max_valor', 'Maximizar faturamento (R$)', 'O solver olha todos os pedidos juntos e escolhe o conjunto que totaliza o MAIOR valor em R$. Se dois pedidos disputam o mesmo SKU, ganha o de maior valor (mesmo que atrasado). Use quando o objetivo é faturar o máximo possível neste corte, independente de quem é o cliente ou de quanto está atrasado.'],
                            ['max_atrasados', 'Maximizar pedidos atrasados', 'O solver prioriza ABSOLUTAMENTE atender o maior número de pedidos atrasados que cabem no saldo. Pedido em dia só entra se sobrar capacidade depois de cobrir todos os atrasados possíveis. Use para "limpar a casa" — apagar incêndio de atrasos antes de seguir.'],
                            ['max_combinado', 'Atrasados + faturamento', 'Combina os dois: prioriza atrasados (peso α=0.05 por dia de atraso) E faturamento. Fórmula: valor × (1 + 0.05 × dias_atraso). Um pedido atrasado de R$ 1000 há 10 dias vale como R$ 1500 na decisão. Use quando quer balancear urgência (atraso) com retorno (R$) sem extremismo.'],
                        ] as const).map(([val, lbl, help]) => (
                            <label key={val} title={help} className="inline-flex items-center gap-1 cursor-pointer select-none text-slate-600 dark:text-slate-300">
                                <input type="radio" name="estrategia" checked={estrategia === val} onChange={() => setEstrategia(val as any)} className="w-3.5 h-3.5 accent-violet-600" />{lbl}
                            </label>
                        ))}
                    </div>
                    <div className="mt-2 text-xs flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-semibold text-slate-600 dark:text-slate-300">Fontes do saldo (cobertura):</span>
                        {([['disponivel', 'Disponível'], ['reserva', 'Reserva'], ['producao', 'Produção (previsto)']] as const).map(([f, lbl]) => (
                            <label key={f} className="inline-flex items-center gap-1 cursor-pointer select-none text-slate-600 dark:text-slate-300">
                                <input type="checkbox" checked={fontes.includes(f)} onChange={() => toggleFonte(f)} className="w-4 h-4 accent-violet-600" />{lbl}
                            </label>
                        ))}
                        <span className="text-[10px] text-slate-400">(desmarcadas saem do cálculo; reserva também some da tabela)</span>
                    </div>
                    <div className="mt-2 text-xs flex flex-wrap items-center gap-x-3 gap-y-1">
                        <label className="inline-flex items-center gap-1 cursor-pointer select-none text-slate-700 dark:text-slate-200 font-semibold">
                            <input type="checkbox" checked={faturavelHoje} onChange={() => setFaturavelHoje(!faturavelHoje)} className="w-4 h-4 accent-emerald-600" />
                            Faturável hoje
                        </label>
                        <span className="text-[10px] text-slate-400">(só pedidos que podem sair hoje: cobertos por estoque/reserva ou cuja produção fica pronta hoje)</span>
                    </div>
                    <div className="mt-2 text-xs flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-semibold text-slate-600 dark:text-slate-300">Status do pedido:</span>
                        {([['1', 'Em aberto (1)'], ['4', 'Liberado (4)']] as const).map(([s, lbl]) => (
                            <label key={s} className="inline-flex items-center gap-1 cursor-pointer select-none text-slate-600 dark:text-slate-300">
                                <input type="checkbox" checked={statusPedido.includes(s)} onChange={() => toggleStatus(s)} className="w-4 h-4 accent-violet-600" />{lbl}
                            </label>
                        ))}
                        <span className="text-[10px] text-slate-400">(quais status da carteira entram no cálculo; nenhum marcado = ambos)</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                        <button onClick={simular} disabled={loading} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-violet-600 text-white text-xs font-bold hover:bg-violet-700 disabled:opacity-50"><SlidersHorizontal className="w-3.5 h-3.5" /> Aplicar configuração</button>
                        <button onClick={salvarCenario} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-violet-300 text-violet-700 dark:text-violet-300 text-xs font-bold hover:bg-violet-50 dark:hover:bg-violet-900/30"><Save className="w-3.5 h-3.5" /> Salvar cenário</button>
                        {cenarioAtivo && <button onClick={simular} title="Recalcula este cenário sobre a Programação atual e gera um snapshot novo (não sobrescreve o salvo)" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 dark:text-amber-300 text-xs font-bold hover:bg-amber-50 dark:hover:bg-amber-900/30"><RefreshCw className="w-3.5 h-3.5" /> Recalcular sobre Programação atual</button>}
                        <button onClick={limparFiltros} className="px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 text-xs">Limpar</button>
                        {temFiltros && <span className="text-[11px] text-violet-600 dark:text-violet-300 font-semibold">filtros ativos</span>}
                    </div>
                    {cenarios.length > 0 && (
                        <div className="mt-3 pt-2 border-t border-violet-200 dark:border-violet-800">
                            <div className="text-[11px] font-bold text-slate-500 mb-1">Cenários salvos</div>
                            <div className="flex flex-wrap gap-1.5">
                                {cenarios.map(c => (
                                    <span key={c.id} className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] border ${cenarioAtivo === c.id ? 'bg-violet-600 text-white border-violet-600' : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600'}`}>
                                        <button onClick={() => carregarCenario(c.id)} title={c.created_by_name || ''}>{c.label}</button>
                                        <button onClick={() => removerCenario(c.id)} className="opacity-60 hover:opacity-100"><Trash2 className="w-3 h-3" /></button>
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                </div>
            )}

            {/* Busca + encolher/expandir */}
            {data && (
                <div className="flex flex-wrap items-center gap-2 mb-3">
                    <div className="relative flex-1 min-w-[220px] max-w-md">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar por pedido, cliente, código ou descrição…"
                            className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                    </div>
                    {/* F10 ajuste 12/06: toggle unico — label reflete a acao que vai acontecer */}
                    {(() => {
                        const todos = [...pedidos, ...semData];
                        const todosColapsados = todos.length > 0 && todos.every(p => colapsados.has(p.pedido));
                        return (
                            <button
                                onClick={() => setColapsados(todosColapsados ? new Set() : new Set(todos.map(p => p.pedido)))}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs hover:bg-slate-50 dark:hover:bg-slate-700">
                                {todosColapsados ? <><ChevronDown className="w-3.5 h-3.5" />Expandir tudo</> : <><ChevronRight className="w-3.5 h-3.5" />Encolher tudo</>}
                            </button>
                        );
                    })()}
                </div>
            )}

            {/* KPIs */}
            {data && (
                <>
                    <KpiGrid className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
                        <KpiCard label="Pedidos faturáveis" value={fmtInt(totais.n_pedidos_faturaveis)} color="emerald" />
                        <KpiCard label="Sem data de programação" value={fmtInt(totais.n_sem_data)} color="amber" />
                        <KpiCard label="Pedidos completos" value={fmtInt(totais.n_pedidos_completos)} color="indigo" />
                        <KpiCard label="Não faturáveis" value={fmtMoney((totais as any).valor_nao_faturavel)} color="red" />
                    </KpiGrid>
                    <KpiGrid className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-1">
                        <KpiCard label="Valor de pedidos (fiscal)" value={fmtMoney(totais.valor_faturavel)} color="blue" />
                        <KpiCard label="Valor Bonificação" value={fmtMoney((totais as any).valor_bonificacao)} color="orange" />
                        <KpiCard label="Valor Pend. Financeiro" value={fmtMoney((totais as any).valor_pendente_financeiro)} color="indigo" />
                        <KpiCard label="Valor de itens (saldo consumido)" value={fmtMoney((totais as any).valor_item)} color="slate" />
                    </KpiGrid>
                    {/* 18/06: legenda pra desambiguar pedido (fiscal cheio) vs item (saldo consumido). Gap = SKUs do pedido fora do escopo do solver. */}
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 mb-2 px-1">
                        <span className="font-semibold">Pedido (fiscal)</span> = valor cheio dos pedidos selecionados · <span className="font-semibold">Item (saldo)</span> = soma do saldo efetivamente consumido (estoque/reserva/produção). Diferença = SKUs do pedido fora do escopo do solver.
                    </div>
                    {/* F10 ajuste 12/06: card composto — decomposicao do valor faturavel por origem (rateio por SKU) */}
                    <div className="mb-4 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm">
                        <div className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 font-semibold mb-2">Composição do valor de itens (saldo consumido por fonte)</div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                            <div>
                                <div className="text-[10px] text-slate-500 dark:text-slate-400">Pelo estoque</div>
                                <div className="text-sm font-bold text-blue-700 dark:text-blue-300 tabular-nums">{fmtMoney((totais as any).valor_por_estoque)}</div>
                            </div>
                            <div>
                                <div className="text-[10px] text-slate-500 dark:text-slate-400">Pela reserva</div>
                                <div className="text-sm font-bold text-violet-700 dark:text-violet-300 tabular-nums">{fmtMoney((totais as any).valor_por_reserva)}</div>
                            </div>
                            <div>
                                <div className="text-[10px] text-slate-500 dark:text-slate-400">Pela produção</div>
                                <div className="text-sm font-bold text-amber-700 dark:text-amber-300 tabular-nums">{fmtMoney((totais as any).valor_por_producao)}</div>
                            </div>
                            <div className="border-l border-slate-200 dark:border-slate-700 pl-3">
                                <div className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">Total</div>
                                <div className="text-sm font-bold text-emerald-700 dark:text-emerald-300 tabular-nums">{fmtMoney(((totais as any).valor_por_estoque || 0) + ((totais as any).valor_por_reserva || 0) + ((totais as any).valor_por_producao || 0))}</div>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {loading ? (
                <p className="p-8 text-center text-slate-500 text-sm">Carregando faturamento…</p>
            ) : !data ? (
                <div className="p-10 text-center text-slate-400"><Receipt className="w-10 h-10 mx-auto mb-2 opacity-40" /><p className="text-sm">Nenhuma versão oficial da Programação. Salve uma versão oficial na Programação.</p></div>
            ) : (
                <>
                    {vista === 'calendario' ? (
                        <>
                            <div className="mb-3 px-3 py-2 rounded-lg bg-rose-600 text-white text-sm font-bold flex items-center gap-2 flex-wrap">
                                <CalendarDays className="w-4 h-4" />
                                <span>Visão Calendário</span>
                                <div className="inline-flex rounded-md overflow-hidden border border-white/40 ml-1">
                                    <button onClick={() => { setCalModo('faturaveis'); setDiaSel(''); }} className={`px-2 py-0.5 text-[11px] font-bold ${calModo === 'faturaveis' ? 'bg-white text-rose-700' : 'text-white/90 hover:bg-white/10'}`}>Faturáveis</button>
                                    <button onClick={() => { setCalModo('nao'); setDiaSel(''); }} className={`px-2 py-0.5 text-[11px] font-bold ${calModo === 'nao' ? 'bg-white text-rose-700' : 'text-white/90 hover:bg-white/10'}`}>Não faturáveis</button>
                                </div>
                                <span className="font-normal opacity-90 ml-1">
                                    {calModo === 'faturaveis'
                                        ? '(prontos: data de entrega se futura, HOJE se atrasada · depende de produção: previsão da liberação)'
                                        : '(por data de entrega · entrega atrasada/sem data cai em HOJE)'}
                                </span>
                            </div>
                            {listaCal.length === 0 ? (
                                <p className="text-sm text-slate-400 text-center py-6">{calModo === 'faturaveis' ? 'Nenhum pedido faturável neste cenário.' : 'Nenhum pedido não faturável neste cenário.'}</p>
                            ) : (
                                <>
                                    <CalendarMes pedidos={listaCal} diaSel={diaSel} onDia={setDiaSel} modoEntrega={calModo === 'nao'} />
                                    {diaSel && (
                                        <div className="mt-4">
                                            <div className="text-sm font-bold text-slate-700 dark:text-slate-100 mb-2">{calModo === 'faturaveis' ? 'Faturável' : 'Não faturável (entrega)'} em {fmtDia(diaSel)}{diaSel === hojeKey ? (calModo === 'faturaveis' ? ' · disponível agora' : ' · atrasado/sem entrega') : ''} · {pedidosDoDia.length} pedido(s)</div>
                                            <TabelaPedidos pedidos={pedidosDoDia} mostrarReserva={data?.considerar_reserva !== false} colapsados={colapsados} onToggle={toggleColapso} />
                                        </div>
                                    )}
                                    {!diaSel && <p className="text-xs text-slate-400 text-center mt-3">Clique num dia para ver os pedidos daquela data.</p>}
                                </>
                            )}
                        </>
                    ) : (
                        <TabelaPedidos pedidos={pedidos} mostrarReserva={data?.considerar_reserva !== false} colapsados={colapsados} onToggle={toggleColapso} />
                    )}

                    {/* F11.X4: Pedidos incompletos do cenário — universo completo do filtro,
                        mas SEM saldo suficiente nas fontes marcadas. Mostra item-a-item o que falta. */}
                    {!vista || vista === 'tabela' ? (semData.length > 0 && (
                        <div className="mt-6 rounded-xl border-t-4 border-amber-400 border border-amber-200 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-950/20 overflow-hidden">
                            <div className="px-3 py-2 bg-amber-100/60 dark:bg-amber-900/30 border-b border-amber-200 dark:border-amber-800 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 text-amber-600" />
                                <span className="text-xs font-bold text-amber-800 dark:text-amber-200">Pedidos incompletos no cenário · {semData.length} pedido(s) · {fmtMoney(semData.reduce((a, p) => a + (p.valor_total_pedido || 0), 0))}</span>
                                <span className="text-[10px] text-amber-700 dark:text-amber-300 ml-auto">Não fecham com as fontes marcadas. Acione o PCP para programar/replanjar.</span>
                            </div>
                            <TabelaPedidos pedidos={semData} mostrarReserva={data?.considerar_reserva !== false} colapsados={colapsados} onToggle={toggleColapso} />
                        </div>
                    )) : null}

                    {pedidos.length === 0 && semData.length === 0 && (
                        <div className="p-10 text-center text-slate-400"><Receipt className="w-10 h-10 mx-auto mb-2 opacity-40" /><p className="text-sm">Nenhum pedido faturável neste cenário.</p></div>
                    )}
                </>
            )}

            {/* Modal de comparação */}
            {cmpOpen && (
                <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={() => setCmpOpen(false)}>
                    <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-3xl max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-slate-700">
                            <div className="flex items-center gap-2 font-bold text-slate-700 dark:text-slate-100"><GitCompareArrows className="w-5 h-5 text-indigo-600" />Comparar faturamento</div>
                            <button onClick={() => setCmpOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
                        </div>
                        <div className="p-5 space-y-3">
                            <div className="inline-flex rounded-lg border border-slate-300 dark:border-slate-600 overflow-hidden text-xs">
                                {(['cenarios', 'versoes'] as const).map(t => (
                                    <button key={t} onClick={() => { setCmpTipo(t); setCmpA(''); setCmpB(''); setCmpData(null); }}
                                        className={`px-3 py-1.5 font-semibold ${cmpTipo === t ? 'bg-indigo-600 text-white' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'}`}>
                                        {t === 'cenarios' ? 'Cenários salvos' : 'Versões oficiais'}
                                    </button>
                                ))}
                            </div>
                            {(() => {
                                const opts = cmpTipo === 'versoes'
                                    ? versoes.map((v: any) => ({ id: v.id, label: `${v.oficial ? '★ ' : ''}${fmtDt(v.created_at)}${v.created_by_name ? ` · ${v.created_by_name}` : ''}` }))
                                    : cenarios.map((c: any) => ({ id: c.id, label: c.label }));
                                const sel = (val: string, set: (s: string) => void, lbl: string) => (
                                    <label className="text-xs text-slate-600 dark:text-slate-300 flex-1">{lbl}
                                        <select value={val} onChange={e => set(e.target.value)} className="mt-0.5 w-full px-2 py-1.5 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-xs">
                                            <option value="">—</option>
                                            {opts.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
                                        </select>
                                    </label>
                                );
                                return (
                                    <>
                                        <div className="flex gap-2 items-end">
                                            {sel(cmpA, setCmpA, 'Base')}
                                            {sel(cmpB, setCmpB, 'Novo')}
                                            <button onClick={executarComparacao} disabled={cmpLoading} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50">Comparar</button>
                                            {podeOficial && cmpTipo === 'versoes' && cmpB && <button onClick={() => marcarVersaoOficial(cmpB)} title="Tornar 'Novo' a versão oficial" className="px-2 py-1.5 rounded-lg border border-emerald-300 text-emerald-700 dark:text-emerald-300 text-xs font-bold"><BadgeCheck className="w-3.5 h-3.5" /></button>}
                                        </div>
                                        {opts.length === 0 && <p className="text-xs text-slate-400">Nenhum {cmpTipo === 'versoes' ? 'versão salva' : 'cenário salvo'} para comparar.</p>}
                                    </>
                                );
                            })()}

                            {cmpLoading ? <p className="text-sm text-slate-500 py-4 text-center">Comparando…</p> : cmpData && (
                                <div className="space-y-3">
                                    <div className="grid grid-cols-5 gap-2 text-center">
                                        {[['Novos', cmpData.resumo?.novos], ['Removidos', cmpData.resumo?.removidos], ['Data', cmpData.resumo?.data], ['Valor', cmpData.resumo?.valor], ['Posição', cmpData.resumo?.posicao]].map(([l, num]: any) => (
                                            <div key={l} className="rounded-lg border border-slate-200 dark:border-slate-700 py-2">
                                                <div className="text-lg font-bold text-slate-700 dark:text-slate-100">{num ?? 0}</div>
                                                <div className="text-[10px] uppercase text-slate-500">{l}</div>
                                            </div>
                                        ))}
                                    </div>
                                    <CmpList titulo="Pedidos novos" itens={cmpData.novos} render={(x: any) => `#${x.pedido} ${x.cliente || ''}`} />
                                    <CmpList titulo="Pedidos removidos" itens={cmpData.removidos} render={(x: any) => `#${x.pedido} ${x.cliente || ''}`} />
                                    <CmpList titulo="Data de término mudou" itens={cmpData.data_mudou} render={(x: any) => `#${x.pedido}: ${fmtDt(x.previsao_base) || '—'} → ${fmtDt(x.previsao_novo) || '—'}`} />
                                    <CmpList titulo="Valor mudou" itens={cmpData.valor_mudou} render={(x: any) => `#${x.pedido}: ${fmtMoney(x.valor_base)} → ${fmtMoney(x.valor_novo)} (${x.delta >= 0 ? '+' : ''}${fmtMoney(x.delta)})`} />
                                    <CmpList titulo="Posição na fila mudou" itens={cmpData.posicao_mudou} render={(x: any) => `#${x.pedido}: ${x.pos_base + 1}º → ${x.pos_novo + 1}º`} />
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const CmpList: React.FC<{ titulo: string; itens?: any[]; render: (x: any) => string }> = ({ titulo, itens, render }) => {
    if (!itens || itens.length === 0) return null;
    return (
        <div>
            <div className="text-[11px] font-bold text-slate-500 mb-1">{titulo} ({itens.length})</div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800 max-h-40 overflow-auto">
                {itens.map((x, i) => <div key={i} className="px-3 py-1 text-xs text-slate-600 dark:text-slate-300">{render(x)}</div>)}
            </div>
        </div>
    );
};

export default OtimizadorFaturamento;
