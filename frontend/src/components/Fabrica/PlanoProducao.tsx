// Plano de Produção - Setor Fábrica
// Otimizador PuLP (lex: atrasados -> total -> faturamento) + versionamento.
// Sem auto-refresh: usuario sempre clica "Atualizar Dados" (com modal de confirmacao).

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { api } from '../../app_api';
import { useConfirm } from '../../contexts/ConfirmContext';
import { RotateCcw, FileDown, History, AlertTriangle, X, Clock, User as UserIcon, ArrowLeft, ArrowUp, ArrowDown, Search, Maximize2, Minimize2, MessageSquare, ChevronDown } from 'lucide-react';
import WhatsAppEnvioModal from '../Configuracoes/WhatsAppEnvioModal';
import TableScroll from '../common/TableScroll';

// Botao reutilizavel: expande um elemento para tela cheia + tenta travar paisagem (mobile)
const ExpandButton: React.FC<{ targetRef: React.RefObject<HTMLDivElement> }> = ({ targetRef }) => {
    const [fs, setFs] = useState(false);
    useEffect(() => {
        const onChange = () => setFs(!!document.fullscreenElement);
        document.addEventListener('fullscreenchange', onChange);
        return () => document.removeEventListener('fullscreenchange', onChange);
    }, []);
    const toggle = useCallback(async () => {
        if (document.fullscreenElement) {
            try { await document.exitFullscreen?.(); } catch {}
            try { (screen.orientation as any)?.unlock?.(); } catch {}
            return;
        }
        const el = targetRef.current;
        if (!el) return;
        try {
            await (el.requestFullscreen?.() || (el as any).webkitRequestFullscreen?.());
            try { await (screen.orientation as any)?.lock?.('landscape'); } catch {}
        } catch (e) { console.warn('Fullscreen falhou', e); }
    }, [targetRef]);
    return (
        <button
            onClick={toggle}
            title={fs ? 'Sair da tela cheia' : 'Expandir tabela (gira para paisagem no celular)'}
            className="inline-flex items-center gap-1 px-2 py-1 text-[10px] font-bold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-700 hover:bg-slate-100 dark:hover:bg-slate-600 border border-slate-200 dark:border-slate-600 rounded"
        >
            {fs ? <><Minimize2 className="w-3 h-3" /> Reduzir</> : <><Maximize2 className="w-3 h-3" /> Expandir</>}
        </button>
    );
};

// Cache em memoria de modulo (sobrevive a re-mount da rota)
let __PP_LAST_VERSAO: any = null;
let __PP_HISTORICO: any[] | null = null;

const fmt = (v: number) => (v ? Math.round(v).toLocaleString('pt-BR') : '0');
// Normaliza código p/ casar com os dados realizados do S&OP (mesma regra do dashboard + remove 'BR' inicial).
const normCod = (v: any) => (v == null ? '' : String(v).toUpperCase().trim().replace(/[.\-\s]/g, '').replace(/^BR/, ''));
// Parse numérico tolerante a formato BR (1.234,56) — espelha o cleanFloat do dashboard.
const cleanFloatPP = (v: any) => {
    if (v == null || v === '') return 0;
    let s = String(v).trim();
    if (s.includes(',') && s.includes('.')) s = s.replace(/\./g, '').replace(',', '.');
    else if (s.includes(',')) s = s.replace(',', '.');
    return parseFloat(s.replace(/[^0-9.-]/g, '')) || 0;
};
const fmtMoney = (v: number) =>
    'R$ ' + (v ? v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '0,00');

const TIPO_COR: Record<string, string> = {
    SAC: '#dc2626',          // vermelho
    BONIFICACAO: '#f59e0b',  // amarelo/âmbar
    TROCA: '#f97316',        // laranja
    PENDENTE_FINANCEIRO: '#7c3aed', // roxo
    INTERNO: '#059669',      // verde — EMPRESA Pedidos Internos
};
const COR_PADRAO = '#2563eb'; // azul — cliente padrão
const GRUPO_INFO: Record<string, { label: string; cor: string }> = {
    atraso_deposito: { label: 'Máx. Prioridade', cor: '#a21caf' }, // fúcsia — atraso + depósito antecipado
    atrasado: { label: 'Atraso', cor: '#dc2626' },     // vermelho
    imediato: { label: 'Imediato', cor: '#d97706' },   // âmbar
    programado: { label: 'Programado', cor: '#2563eb' },// azul
};

const TIPO_CLASS: Record<string, string> = {
    SAC: 'text-red-700 dark:text-red-300 font-extrabold',
    BONIFICACAO: 'text-amber-700 dark:text-amber-300 font-extrabold',
    TROCA: 'text-orange-700 dark:text-orange-300 font-extrabold',
    PENDENTE_FINANCEIRO: 'text-violet-700 dark:text-violet-300 font-extrabold',
    INTERNO: 'text-emerald-700 dark:text-emerald-300 font-extrabold',
};
const CLASS_PADRAO = 'text-blue-700 dark:text-blue-300 font-extrabold';
const classPorTipo = (tipo?: string) => (tipo && TIPO_CLASS[tipo]) || CLASS_PADRAO;

// Tipo efetivo: situacao=1 (pendente financeiro) tem prioridade sobre DESC_TIPODOCUMENTO
const tipoEfetivo = (
    pedido: string,
    tipos?: Record<string, string>,
    situacao?: Record<string, string>,
): string => {
    if (situacao && String(situacao[pedido]) === '1') return 'PENDENTE_FINANCEIRO';
    return tipos?.[pedido] || 'PADRAO';
};

const PedidosColoridos: React.FC<{
    lista?: string;
    tipos?: Record<string, string>;
    situacao?: Record<string, string>;
    highlight?: string;
    onlyTipos?: string[];
    entregas?: Record<string, string>;
    emissoesOrig?: Record<string, string>;
}> = ({ lista, tipos, situacao, highlight, onlyTipos, entregas, emissoesOrig }) => {
    if (!lista) return <>—</>;
    let partes = lista.split(',').map((s) => s.trim()).filter(Boolean);
    if (onlyTipos && onlyTipos.length) {
        partes = partes.filter((p) => onlyTipos.includes(tipoEfetivo(p, tipos, situacao)));
    }
    if (partes.length === 0) return <>—</>;
    const hl = (highlight || '').trim().toLowerCase();
    return (
        <>
            {partes.map((p, idx) => {
                const t = tipoEfetivo(p, tipos, situacao);
                const isHit = hl && p.toLowerCase().includes(hl);
                const tip = `Pedido ${p}\nEmissão original: ${emissoesOrig?.[p] || '—'}\nEntrega: ${entregas?.[p] || '—'}`;
                return (
                    <React.Fragment key={p + idx}>
                        <span
                            title={tip}
                            className={`cursor-help ${classPorTipo(t === 'PADRAO' ? undefined : t)} ${
                                isHit ? 'ring-2 ring-yellow-400 bg-yellow-200 dark:bg-yellow-500/40 px-1 rounded' : ''
                            }`}
                        >
                            {p}
                        </span>
                        {idx < partes.length - 1 && <span className="text-slate-400 dark:text-slate-500">, </span>}
                    </React.Fragment>
                );
            })}
        </>
    );
};

// Dropdown de filtro com multi-seleção (checkbox), usado p/ Tipo e Grupo
const MultiSelectDropdown: React.FC<{
    label: string;
    options: { k: string; label: string; cor?: string; count?: number }[];
    selected: string[];
    onChange: (next: string[]) => void;
}> = ({ label, options, selected, onChange }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open) return;
        const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        document.addEventListener('mousedown', h);
        return () => document.removeEventListener('mousedown', h);
    }, [open]);
    const toggle = (k: string) => onChange(selected.includes(k) ? selected.filter((x) => x !== k) : [...selected, k]);
    return (
        <div className="relative" ref={ref}>
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className={`flex items-center gap-1 px-2 py-1 rounded border text-[11px] transition ${
                    selected.length
                        ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 font-semibold'
                        : 'border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
            >
                {label}
                {selected.length > 0 && <span className="px-1 rounded-full bg-blue-600 text-white text-[9px]">{selected.length}</span>}
                <ChevronDown className="w-3 h-3" />
            </button>
            {open && (
                <div className="absolute z-50 mt-1 min-w-[210px] bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 rounded-lg shadow-xl p-1">
                    {options.map((o) => (
                        <label key={o.k} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer text-xs">
                            <input type="checkbox" checked={selected.includes(o.k)} onChange={() => toggle(o.k)} className="accent-blue-600" />
                            {o.cor && <span style={{ background: o.cor }} className="inline-block w-2.5 h-2.5 rounded-sm" />}
                            <span className="flex-1 text-slate-700 dark:text-slate-200">{o.label}</span>
                            <span className="text-slate-400">({o.count ?? 0})</span>
                        </label>
                    ))}
                    {selected.length > 0 && (
                        <button type="button" onClick={() => onChange([])} className="w-full mt-1 flex items-center gap-1 text-[10px] text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 rounded px-2 py-1">
                            <X className="w-3 h-3" /> Limpar seleção
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

interface VersaoResumo {
    id: string;
    created_at: string;
    created_by_name: string | null;
    hoje: string;
    elapsed_seconds: number;
    totais: any;
    oficial?: boolean;
}

interface VersaoCompleta extends VersaoResumo {
    plano: any[];
    pedidos_completos: any[];
    detalhe_alocacao: any[];
}

const AtrasoRegionalGroup: React.FC<{
    reg: string; peds: string[]; valores: Record<string, number>; clientes: Record<string, string>;
    entregas: Record<string, string>; diasAtraso: Record<string, number>;
    tipos: Record<string, string>; situ: Record<string, string>; totalVal: number; forceOpen?: boolean;
}> = ({ reg, peds, valores, clientes, entregas, diasAtraso, tipos, situ, totalVal, forceOpen }) => {
    const [open, setOpen] = useState(false);
    useEffect(() => { setOpen(!!forceOpen); }, [forceOpen]);
    return (
        <div className="rounded-lg overflow-hidden border border-slate-200 dark:border-slate-600">
            <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-slate-100 to-slate-50 dark:from-slate-700 dark:to-slate-800 hover:from-slate-200 hover:to-slate-100 dark:hover:from-slate-600 dark:hover:to-slate-700 transition-all text-left">
                <div className="flex items-center gap-3">
                    <ArrowDown className={`w-3.5 h-3.5 text-slate-500 transition-transform ${open ? '' : '-rotate-90'}`} />
                    <span className="text-sm font-bold text-slate-800 dark:text-slate-100">{reg}</span>
                    <span className="text-[10px] bg-red-500 text-white px-2 py-0.5 rounded-full font-bold">{peds.length} pedidos</span>
                </div>
                <span className="text-sm font-bold font-mono text-red-600 dark:text-red-400">{fmtMoney(totalVal)}</span>
            </button>
            {open && (
                <div className="bg-white dark:bg-slate-800">
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-700/50">
                            <tr className="text-left text-[10px] uppercase text-slate-500 font-bold tracking-wider">
                                <th className="px-3 py-2 w-8">#</th>
                                <th className="px-3 py-2">Pedido</th>
                                <th className="px-3 py-2">Cliente</th>
                                <th className="px-3 py-2 text-center">Entrega</th>
                                <th className="px-3 py-2 text-center">Atraso</th>
                                <th className="px-3 py-2 text-right">Valor R$</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                            {peds.map((p, i) => {
                                const t = tipoEfetivo(p, tipos, situ);
                                const dias = diasAtraso[p] || 0;
                                return (
                                    <tr key={p} className="hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors">
                                        <td className="px-3 py-1.5 text-slate-400 text-[10px]">{i + 1}</td>
                                        <td className={`px-3 py-1.5 font-bold ${classPorTipo(t === 'PADRAO' ? undefined : t)}`}>{p}</td>
                                        <td className="px-3 py-1.5 text-slate-600 dark:text-slate-300 truncate max-w-[180px]" title={clientes[p] || ''}>{clientes[p] || '—'}</td>
                                        <td className="px-3 py-1.5 text-center text-slate-500">{entregas[p] || '—'}</td>
                                        <td className="px-3 py-1.5 text-center font-bold text-red-600">{dias > 0 ? `${dias}d` : '—'}</td>
                                        <td className="px-3 py-1.5 text-right font-mono font-semibold">{fmtMoney(valores[p] || 0)}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

const PlanoProducao: React.FC = () => {
    // Só usuários da Fábrica (ou super_user/ceo) podem definir a versão oficial.
    const podeOficial = useMemo(() => {
        try {
            const u = JSON.parse(sessionStorage.getItem('empresa_user') || '{}');
            if (['super_user', 'ceo'].includes(u.role)) return true;
            const norm = (s: string) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
            return [u.sector, ...String(u.managed_sectors || '').split(/[;,]/)].some((s: string) => norm(s) === norm('Fábrica'));
        } catch { return false; }
    }, []);
    const [versao, setVersao] = useState<VersaoCompleta | null>(__PP_LAST_VERSAO);
    const [historico, setHistorico] = useState<VersaoResumo[]>(__PP_HISTORICO || []);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const confirmar = useConfirm();
    const [aba, setAba] = useState<'plano' | 'estoque' | 'detalhe' | 'historico'>('plano');
    const [modalConfirm, setModalConfirm] = useState(false);
    const [wppModalOpen, setWppModalOpen] = useState(false);
    const today = new Date().toISOString().slice(0, 10);
    const [dataRef, setDataRef] = useState<string>(today);
    const [viewingOldVersion, setViewingOldVersion] = useState(false);
    const [versaoAtualId, setVersaoAtualId] = useState<string | null>(__PP_LAST_VERSAO?.id || null);

    // Sort + filter por aba
    const [sortPlano, setSortPlano] = useState<{ k: string; d: 'asc' | 'desc' }>({ k: 'SEQUENCIA', d: 'asc' });
    const [sortEstoque, setSortEstoque] = useState<{ k: string; d: 'asc' | 'desc' }>({ k: 'valor', d: 'desc' });
    const [sortDetalhe, setSortDetalhe] = useState<{ k: string; d: 'asc' | 'desc' }>({ k: 'pedido', d: 'asc' });
    const [filtroPlano, setFiltroPlano] = useState('');
    const [filtroTipos, setFiltroTipos] = useState<string[]>([]);
    const [filtroGrupos, setFiltroGrupos] = useState<string[]>([]);
    const [modalAtraso, setModalAtraso] = useState(false);
    const [filtroAtraso, setFiltroAtraso] = useState('');
    const [filtroTipoAtraso, setFiltroTipoAtraso] = useState<string | null>(null);
    const [expandAll, setExpandAll] = useState(false); // SAC | BONIFICACAO | TROCA | PADRAO | PENDENTE_FINANCEIRO

    // Contagem de pedidos por tipo (para exibir ao lado das legendas)
    const tipoCounts = useMemo<Record<string, number>>(() => {
        const counts: Record<string, number> = { SAC: 0, BONIFICACAO: 0, TROCA: 0, PADRAO: 0, PENDENTE_FINANCEIRO: 0, INTERNO: 0 };
        const v: any = versao;
        if (!v?.plano) return counts;
        const all = new Set<string>();
        v.plano.forEach((row: any) => {
            const lista = row.PEDIDOS_QUE_USAM_SKU || '';
            lista.split(',').map((s: string) => s.trim()).filter(Boolean).forEach((p: string) => all.add(p));
        });
        const tipos = v.totais?.pedidos_tipos;
        const situ = v.totais?.pedidos_situacao;
        all.forEach((p) => {
            const t = tipoEfetivo(p, tipos, situ);
            counts[t] = (counts[t] || 0) + 1;
        });
        return counts;
    }, [versao]);

    // Larguras de coluna ajustáveis (estilo Excel) — chave: `${aba}:${col}`
    const [colWidths, setColWidths] = useState<Record<string, number>>({});
    // Tendência mensal de demanda por produto (run-rate do mês atual), vinda dos dados realizados do S&OP.
    // Usada só para EXIBIÇÃO de 2 colunas — não afeta a otimização. Chave = código normalizado.
    const [tendMensalMap, setTendMensalMap] = useState<Record<string, number>>({});
    const startResize = useCallback((key: string, e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const th = (e.currentTarget.parentElement as HTMLElement);
        const startX = e.clientX;
        const startW = colWidths[key] ?? th?.offsetWidth ?? 100;
        const onMove = (ev: MouseEvent) => {
            const w = Math.max(40, startW + (ev.clientX - startX));
            setColWidths((prev) => ({ ...prev, [key]: w }));
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }, [colWidths]);
    const [filtroEstoque, setFiltroEstoque] = useState('');
    const [filtroDetalhe, setFiltroDetalhe] = useState('');

    // Refs para expandir cada tabela (fullscreen + landscape no mobile)
    const refTabelaPlano = useRef<HTMLDivElement>(null);
    const refTabelaEstoque = useRef<HTMLDivElement>(null);
    const refTabelaDetalhe = useRef<HTMLDivElement>(null);

    const sorter = (rows: any[], key: string, dir: 'asc' | 'desc') => {
        if (!key) return rows;
        const sign = dir === 'asc' ? 1 : -1;
        return [...rows].sort((a, b) => {
            const va = a[key]; const vb = b[key];
            if (va == null && vb == null) return 0;
            if (va == null) return 1;
            if (vb == null) return -1;
            if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * sign;
            return String(va).localeCompare(String(vb), 'pt-BR', { numeric: true }) * sign;
        });
    };
    const filterer = (rows: any[], q: string) => {
        if (!q.trim()) return rows;
        const t = q.toLowerCase();
        return rows.filter(r => Object.values(r).some(v => v != null && String(v).toLowerCase().includes(t)));
    };
    // Busca os dados realizados do S&OP e monta a tendência mensal (run-rate) por produto, só p/ exibição.
    useEffect(() => {
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
                if (parseInt(it.Ano) !== y || parseInt(it.Mes) !== mo) return;   // só mês atual
                const k = normCod(it.Codigo);
                if (!k) return;
                vendaMTD[k] = (vendaMTD[k] || 0) + cleanFloatPP(it.Qtd_Real);
            });
            const tend: Record<string, number> = {};
            Object.keys(vendaMTD).forEach(k => { tend[k] = diaHoje > 0 ? (vendaMTD[k] / diaHoje) * diasNoMes : vendaMTD[k]; });
            setTendMensalMap(tend);
        }).catch(() => { /* sem tendência: as 2 colunas mostram 0 */ });
        return () => { cancel = true; };
    }, []);

    // Linhas após filtro de grupo (atrasado/imediato/programado) + busca de texto
    const planoFiltrado = useMemo(() => {
        let rows: any[] = versao?.plano || [];
        if (filtroGrupos.length) rows = rows.filter((r: any) => filtroGrupos.includes(r.GRUPO));
        if (filtroPlano.trim()) rows = filterer(rows, filtroPlano);
        return rows;
    }, [versao, filtroGrupos, filtroPlano]);
    const toggleSort = (setter: any, current: any, k: string) => {
        if (current.k === k) setter({ k, d: current.d === 'asc' ? 'desc' : 'asc' });
        else setter({ k, d: 'asc' });
    };
    const SortIcon = ({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) =>
        !active ? <ArrowUp className="w-2.5 h-2.5 inline-block opacity-30 ml-1" />
            : dir === 'asc' ? <ArrowUp className="w-2.5 h-2.5 inline-block ml-1 text-blue-600" />
                : <ArrowDown className="w-2.5 h-2.5 inline-block ml-1 text-blue-600" />;

    // Carregar historico inicial (sem rodar otimizador)
    useEffect(() => {
        // Só pula o fetch se o cache tem versões DE VERDADE — um cache vazio (fetch que falhou/voltou
        // vazio em cold-start) não pode "travar" a tela em "Nenhuma versão" ao navegar.
        if (__PP_HISTORICO !== null && __PP_HISTORICO.length > 0) return;
        const carregarVersoes = (attempt = 0) => {
            api.listarVersoesPlanoProducao()
                .then((vs) => {
                    setHistorico(vs);
                    __PP_HISTORICO = vs;
                    // Se nao ha versao em cache mas ha versao no historico, carrega a mais recente
                    if (!__PP_LAST_VERSAO && vs.length > 0) {
                        api.obterVersaoPlanoProducao(vs[0].id).then((full) => {
                            setVersao(full);
                            setVersaoAtualId(full.id);
                            __PP_LAST_VERSAO = full;
                        }).catch(() => {});
                    }
                })
                // Backend lento/cold-start (ou redeploy) pode falhar nas primeiras chamadas logo
                // apos um F5: tenta de novo com backoff (ate 5x) antes de cair em "Nenhuma versão
                // disponível". Sem essas novas tentativas, a tela travava vazia ate o usuario
                // navegar para outra pagina e voltar (que forcava um novo fetch).
                .catch((e) => { if (attempt < 4) { setTimeout(() => carregarVersoes(attempt + 1), 800 * (attempt + 1)); } else { console.error('Erro ao listar versoes', e); } });
        };
        carregarVersoes();
    }, []);

    const gerarNovo = useCallback(async () => {
        setModalConfirm(false);
        setLoading(true);
        setError(null);
        try {
            const result = await api.gerarPlanoProducao(dataRef, 300);
            setVersao(result);
            setVersaoAtualId(result.id);
            setViewingOldVersion(false);
            __PP_LAST_VERSAO = result;
            // Atualiza historico
            const vs = await api.listarVersoesPlanoProducao();
            setHistorico(vs);
            __PP_HISTORICO = vs;
            setAba('plano');
        } catch (e: any) {
            setError(e?.message || 'Erro ao gerar plano.');
        } finally {
            setLoading(false);
        }
    }, [dataRef]);

    const carregarVersao = useCallback(async (id: string) => {
        setLoading(true);
        setError(null);
        try {
            const full = await api.obterVersaoPlanoProducao(id);
            setVersao(full);
            setViewingOldVersion(id !== versaoAtualId);
            setAba('plano');
        } catch (e: any) {
            setError(e?.message || 'Erro ao carregar versao.');
        } finally {
            setLoading(false);
        }
    }, [versaoAtualId]);

    const voltarParaAtual = useCallback(async () => {
        if (!versaoAtualId) return;
        await carregarVersao(versaoAtualId);
        setViewingOldVersion(false);
    }, [versaoAtualId, carregarVersao]);

    const baixarXlsx = useCallback((id: string) => {
        const url = api.getPlanoProducaoXlsxUrl(id);
        // Abre em nova aba para o browser tratar o download (com cookies de auth)
        window.open(url, '_blank');
    }, []);

    const toggleOficial = useCallback(async (id: string, oficial: boolean) => {
        try {
            if (oficial) {
                // A produção já está usando alguma versão oficial (com montagem)? Confirmar antes de trocar.
                let emUso: any = null;
                try {
                    const { oficiais } = await api.getOficiaisEmUso();
                    emUso = (oficiais || []).find((v: any) => v.id !== id && (v.board_itens || 0) > 0);
                } catch { /* segue sem bloquear */ }
                if (emUso) {
                    const dt = new Date(emUso.oficial_em || emUso.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
                    const ok = await confirmar({
                        title: 'Mudar versão oficial',
                        message: `A produção já está utilizando a versão oficial de ${dt} (${emUso.board_itens} itens montados na Programação). Tem certeza que deseja tornar esta versão oficial? A Programação será avisada de que há uma nova versão.`,
                        variant: 'warning',
                        confirmText: 'Sim, tornar oficial',
                        cancelText: 'Cancelar',
                    });
                    if (!ok) return;
                }
            }
            await api.marcarVersaoOficial(id, oficial);
            // Só uma oficial: ao marcar, desmarca as demais — no estado local E no cache de módulo
            // (senão, ao navegar e voltar, o cache stale "tira" o flag de oficial).
            const aplicar = (h: any) => h.id === id ? { ...h, oficial } : (oficial ? { ...h, oficial: false } : h);
            setHistorico((hs) => hs.map(aplicar));
            if (__PP_HISTORICO) __PP_HISTORICO = __PP_HISTORICO.map(aplicar);
            if (__PP_LAST_VERSAO) {
                if (__PP_LAST_VERSAO.id === id) __PP_LAST_VERSAO = { ...__PP_LAST_VERSAO, oficial };
                else if (oficial) __PP_LAST_VERSAO = { ...__PP_LAST_VERSAO, oficial: false };
            }
        } catch (e: any) {
            setError(e?.message || 'Erro ao marcar versão como oficial.');
        }
    }, [confirmar]);


    const totaisRaw = versao?.totais || {};

    const totais = useMemo(() => {
        // Sem nenhum filtro ativo → usa os totais do backend
        if ((!filtroTipos.length && !filtroGrupos.length && !filtroPlano.trim()) || !versao) return totaisRaw;
        const tipos = totaisRaw.pedidos_tipos || {};
        const situ = totaisRaw.pedidos_situacao || {};
        const valores = totaisRaw.pedidos_valores || {};
        const rows = planoFiltrado; // já filtrado por grupo + texto
        const tipoOk = (p: string) => !filtroTipos.length || filtroTipos.includes(tipoEfetivo(p, tipos, situ));
        const pedidosFiltrados = new Set<string>();
        rows.forEach((row: any) => {
            const lista: string = row.PEDIDOS_QUE_USAM_SKU || '';
            lista.split(',').map(s => s.trim()).filter(Boolean).forEach(p => {
                if (tipoOk(p)) pedidosFiltrados.add(p);
            });
        });
        const fulfilled = new Set<string>();
        rows.forEach((row: any) => {
            const lista: string = row.PEDIDOS_COMPLETOS_APOS_ESTE_ITEM || '';
            lista.split(',').map(s => s.trim()).filter(Boolean).forEach(p => {
                if (pedidosFiltrados.has(p)) fulfilled.add(p);
            });
        });
        const allPeds = Array.from(pedidosFiltrados);
        const fulfilledArr = Array.from(fulfilled);
        const valTot = allPeds.reduce((s, p) => s + (valores[p] || 0), 0);
        const valAtend = fulfilledArr.reduce((s, p) => s + (valores[p] || 0), 0);
        const atrasados = totaisRaw.pedidos_atrasados || {};
        const nAtrTot = allPeds.filter(p => atrasados[p]).length;
        const nAtrAtend = fulfilledArr.filter(p => atrasados[p]).length;
        // Completos só estoque: pedidos filtrados que estão na lista alloc_order
        const compEstoque = new Set<string>(totaisRaw.pedidos_completos_estoque || []);
        const nIni = allPeds.filter(p => compEstoque.has(p)).length;
        // Completos após plano: completos estoque + completos via produção (fulfilled)
        const nFim = nIni + fulfilled.size;
        // SKUs, unidades e valor otimizado: só rows que contêm pedidos filtrados
        let nSkus = 0;
        let nUnid = 0;
        let valOtim = 0;
        rows.forEach((row: any) => {
            const lista: string = row.PEDIDOS_QUE_USAM_SKU || '';
            const peds = lista.split(',').map(s => s.trim()).filter(Boolean);
            if (peds.some(p => pedidosFiltrados.has(p))) {
                nSkus++;
                nUnid += (row.QTD_PRODUZIR || 0);
            }
            if (filtroTipos.length && row.VALOR_POR_PEDIDO_COMPLETO) {
                valOtim += Object.entries(row.VALOR_POR_PEDIDO_COMPLETO as Record<string, number>)
                    .filter(([p]) => filtroTipos.includes(tipoEfetivo(p, tipos, situ)))
                    .reduce((a, [, v]) => a + v, 0);
            } else {
                valOtim += (row.VALOR_PEDIDOS_COMPLETOS_APOS || 0);
            }
        });
        return {
            ...totaisRaw,
            n_pedidos: allPeds.length,
            n_atendidos: fulfilled.size,
            n_atr_tot: nAtrTot,
            n_atr_atend: nAtrAtend,
            n_ini: nIni,
            n_fim: nFim,
            val_tot: valTot,
            val_atend: valAtend,
            n_skus: nSkus,
            n_unid: nUnid,
            val_otimizado: valOtim,
        };
    }, [totaisRaw, filtroTipos, filtroGrupos, filtroPlano, planoFiltrado, versao]);

    return (
        <div className="p-4 space-y-4 bg-slate-50 dark:bg-slate-900 min-h-screen">
            {/* Header */}
            <div className="bg-gradient-to-r from-slate-900 to-slate-800 text-white p-4 rounded-xl shadow flex flex-wrap justify-between items-center gap-3">
                <div>
                    <h1 className="text-xl font-bold">Otimizador de Produção</h1>
                    <p className="text-xs text-slate-300">
                        {versao
                            ? `Versão atual gerada em ${new Date(versao.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}${versao.created_by_name ? ` por ${versao.created_by_name}` : ''} (data ref: ${versao.hoje})`
                            : 'Nenhuma versão gerada ainda'}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    <input
                        type="date"
                        value={dataRef}
                        onChange={(e) => setDataRef(e.target.value)}
                        className="px-3 py-2 rounded-lg bg-white/10 border border-white/20 text-white text-xs"
                        title="Data de referência (atrasados = emissão antes desta data)"
                    />
                    {versao && (
                        <button
                            onClick={() => baixarXlsx(versao.id)}
                            className="flex items-center gap-2 px-3 py-2 bg-white/10 hover:bg-white/20 border border-white/20 rounded-lg font-bold"
                            title="Baixar Excel desta versão"
                        >
                            <FileDown className="w-4 h-4" /> Excel
                        </button>
                    )}
                    {versao && (
                        <button
                            onClick={() => setWppModalOpen(true)}
                            className="flex items-center gap-2 px-3 py-2 bg-green-600 hover:bg-green-700 border border-green-500 rounded-lg font-bold"
                            title="Enviar plano (Excel) via WhatsApp"
                        >
                            <MessageSquare className="w-4 h-4" /> WhatsApp
                        </button>
                    )}
                    <button
                        onClick={() => setModalConfirm(true)}
                        disabled={loading}
                        className="flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 border border-red-500 rounded-lg font-bold disabled:opacity-50"
                    >
                        <RotateCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                        {loading ? 'Gerando...' : 'Atualizar Dados'}
                    </button>
                </div>
            </div>

            {/* Banner versao antiga */}
            {viewingOldVersion && versao && (
                <div className="bg-amber-100 border border-amber-300 dark:bg-amber-900/30 dark:border-amber-600 rounded-lg p-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 text-amber-900 dark:text-amber-200 text-sm">
                        <AlertTriangle className="w-4 h-4" />
                        Visualizando versão antiga de <b>{new Date(versao.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}</b>
                        {versao.created_by_name && ` (gerada por ${versao.created_by_name})`}
                    </div>
                    <button
                        onClick={voltarParaAtual}
                        className="inline-flex items-center gap-1 text-xs font-bold text-amber-900 dark:text-amber-200 hover:underline"
                    >
                        <ArrowLeft className="w-3 h-3" /> Voltar para versão atual
                    </button>
                </div>
            )}

            {/* Erro */}
            {error && (
                <div className="bg-red-100 border border-red-300 text-red-800 dark:bg-red-900/30 dark:border-red-600 dark:text-red-200 rounded-lg p-3 text-sm">
                    {error}
                </div>
            )}

            {/* KPI Cards (espelha o resumo do XLSX, aba Plano_Producao) */}
            {versao && (
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
                    {[
                        { k: 'Pedidos Atendidos', v: `${totais.n_atendidos}/${totais.n_pedidos}`, sub: 'Atendidos / Carteira', color: 'border-blue-500', help: 'Quantidade de pedidos que o otimizador consegue atender completamente com estoque + produção, dividido pelo total de pedidos na carteira.' },
                        { k: 'Pedidos em Atraso', v: `${totais.n_atr_tot}/${totais.n_pedidos}`, sub: 'Atrasados / Total', color: 'border-red-500', help: 'Pedidos com data de entrega vencida. Quando entrega = emissão original, considera atraso após 5 dias. Quando são diferentes (prazo renegociado), qualquer entrega anterior a hoje é atraso.', action: () => setModalAtraso(true) },
                        { k: 'Valor Otimizado', v: fmtMoney(totais.val_otimizado ?? (versao.plano || []).reduce((s: number, r: any) => s + (r.VALOR_PEDIDOS_COMPLETOS_APOS || 0), 0)), sub: 'Soma da coluna Valor do Item', color: 'border-emerald-600', help: 'Soma dos valores (R$) da coluna "Valor do Item" da tabela — representa o valor do item (linha do SKU) nos pedidos que ficam completos após produzir cada item na sequência.' },
                        { k: 'Valor Carteira', v: fmtMoney(totais.val_tot || 0), sub: 'Total dos pedidos', color: 'border-cyan-600', help: 'Valor total (R$) de todos os pedidos na carteira de vendas (status 1 - Em aberto e 4 - Liberado).' },
                        { k: 'SKUs a Produzir', v: fmt(totais.n_skus || 0), sub: 'Itens distintos', color: 'border-purple-500', help: 'Quantidade de produtos (códigos) distintos que o otimizador determinou que precisam ser produzidos para atender os pedidos.' },
                        { k: 'Unidades a Produzir', v: fmt(totais.n_unid || 0), sub: 'Total de unidades', color: 'border-orange-500', help: 'Soma total de unidades a serem produzidas de todos os SKUs do plano.' },
                    ].map((c: any, i) => (
                        <div key={i} className={`bg-white dark:bg-slate-800 p-3 rounded-xl shadow border-t-4 ${c.color} relative ${c.action ? 'cursor-pointer' : ''}`} onDoubleClick={c.action || undefined}>
                            <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider flex items-center justify-between">
                                {c.k}
                                <span className="relative group">
                                    <span className="w-4 h-4 rounded-full bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-300 text-[9px] font-bold flex items-center justify-center cursor-help">?</span>
                                    <span className="absolute bottom-full right-0 mb-1 w-56 p-2 rounded bg-slate-900 text-white text-[10px] leading-tight shadow-lg opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity z-50 normal-case font-normal">{c.help}</span>
                                </span>
                            </div>
                            <div className="text-xl font-extrabold mt-1 dark:text-white whitespace-nowrap overflow-hidden text-ellipsis" title={c.v}>{c.v}</div>
                            <div className="text-[10px] text-slate-400 mt-1">{c.sub}</div>
                        </div>
                    ))}
                </div>
            )}

            {/* Estado vazio */}
            {!versao && !loading && (
                <div className="bg-white dark:bg-slate-800 p-12 rounded-xl shadow border border-slate-200 dark:border-slate-700 text-center">
                    <p className="text-slate-500 dark:text-slate-400 mb-4">
                        Nenhuma versão disponível. Clique em <b>Atualizar Dados</b> para gerar o primeiro plano.
                    </p>
                </div>
            )}

            {/* Tabs */}
            {versao && (
                <div className="bg-white dark:bg-slate-800 rounded-xl shadow border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="flex border-b border-slate-200 dark:border-slate-700 text-xs font-bold uppercase tracking-wider overflow-x-auto whitespace-nowrap">
                        {[
                            { k: 'plano', label: `Otimizador de Produção (${versao.plano.length})` },
                            { k: 'historico', label: `Histórico (${historico.length})` },
                        ].map((t) => (
                            <button
                                key={t.k}
                                onClick={() => setAba(t.k as any)}
                                className={`px-4 py-3 transition-colors flex-shrink-0 ${aba === t.k
                                    ? 'border-b-2 border-red-600 text-red-600 bg-red-50/50 dark:bg-red-900/20'
                                    : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>

                    {/* Aba: Plano de Producao (mesma estrutura da Aba 1 do XLSX) */}
                    {aba === 'plano' && (
                        <div ref={refTabelaPlano} className="bg-white dark:bg-slate-800">
                        <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 flex items-center gap-2">
                            <Search className="w-3 h-3 text-slate-400" />
                            <input
                                type="text" value={filtroPlano} onChange={(e) => setFiltroPlano(e.target.value)}
                                placeholder="Filtrar por código, descrição, pedido..."
                                className="flex-1 text-xs px-2 py-1 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 rounded"
                            />
                            <span className="text-[10px] text-slate-400 whitespace-nowrap">{planoFiltrado.length}/{versao.plano.length}</span>
                            <ExpandButton targetRef={refTabelaPlano} />
                        </div>
                        <div className="px-3 py-2 border-b border-slate-100 dark:border-slate-700 flex flex-wrap items-center gap-2 text-[10px] text-slate-500 dark:text-slate-300">
                            <span className="font-bold uppercase tracking-wide text-slate-400">Filtros:</span>
                            <MultiSelectDropdown
                                label="Tipo"
                                selected={filtroTipos}
                                onChange={setFiltroTipos}
                                options={[
                                    { k: 'SAC', label: 'SAC', cor: TIPO_COR.SAC, count: tipoCounts.SAC ?? 0 },
                                    { k: 'BONIFICACAO', label: 'Bonificação', cor: TIPO_COR.BONIFICACAO, count: tipoCounts.BONIFICACAO ?? 0 },
                                    { k: 'TROCA', label: 'Troca', cor: TIPO_COR.TROCA, count: tipoCounts.TROCA ?? 0 },
                                    { k: 'PADRAO', label: 'Cliente padrão', cor: COR_PADRAO, count: tipoCounts.PADRAO ?? 0 },
                                    { k: 'PENDENTE_FINANCEIRO', label: 'Pendente Liberação Financeiro', cor: TIPO_COR.PENDENTE_FINANCEIRO, count: tipoCounts.PENDENTE_FINANCEIRO ?? 0 },
                                    { k: 'INTERNO', label: 'EMPRESA Interno', cor: TIPO_COR.INTERNO, count: tipoCounts.INTERNO ?? 0 },
                                ]}
                            />
                            <MultiSelectDropdown
                                label="Grupo"
                                selected={filtroGrupos}
                                onChange={setFiltroGrupos}
                                options={(['atraso_deposito', 'atrasado', 'imediato', 'programado'] as const).map((g) => ({
                                    k: g, label: GRUPO_INFO[g].label, cor: GRUPO_INFO[g].cor,
                                    count: (versao.plano || []).filter((r: any) => r.GRUPO === g).length,
                                }))}
                            />
                            {(filtroTipos.length > 0 || filtroGrupos.length > 0) && (
                                <button
                                    type="button"
                                    onClick={() => { setFiltroTipos([]); setFiltroGrupos([]); }}
                                    className="ml-1 inline-flex items-center gap-1 px-2 py-1 rounded border border-red-300 text-red-600 dark:text-red-300 hover:bg-red-50 dark:hover:bg-red-900/20 text-[11px]"
                                >
                                    <X className="w-3 h-3" /> Limpar filtros
                                </button>
                            )}
                        </div>
                        <TableScroll maxHeight={600}>
                            <table className="w-full text-xs">
                                <thead className="bg-slate-50 dark:bg-slate-700 sticky top-0 z-10">
                                    <tr className="text-left text-[10px] uppercase text-slate-500 cursor-pointer select-none">
                                        {[
                                            { k: 'SEQUENCIA', l: 'Seq', cls: 'text-center' },
                                            { k: 'CODIGO_PRODUTO', l: 'Código' },
                                            { k: 'DESCRICAO', l: 'Descrição' },
                                            { k: 'GRUPO', l: 'Grupo', cls: 'text-center' },
                                            { k: 'QTD_PRODUZIR', l: 'Qtd Produzir', cls: 'text-right' },
                                            { k: 'TEND_5D', l: 'Tend. 5d', cls: 'text-right' },
                                            { k: 'TEND_5D_PROD', l: 'Tend. + Produzir', cls: 'text-right' },
                                            { k: 'ESTOQUE_DISPONIVEL', l: 'Est. Disponível', cls: 'text-right' },
                                            { k: 'RESERVA_ATUAL', l: 'Reserva', cls: 'text-right' },
                                            { k: 'ESTOQUE_FISICO', l: 'Est. Físico', cls: 'text-right' },
                                            { k: 'DEMANDA_TOTAL_PLANO', l: 'Demanda Total', cls: 'text-right' },
                                            { k: 'N_PEDIDOS_QUE_USAM_SKU', l: '# Peds', cls: 'text-center' },
                                            { k: 'PEDIDOS_QUE_USAM_SKU', l: 'Pedidos que usam SKU', style: { minWidth: 240 } },
                                            { k: 'N_PEDIDOS_COMPLETOS_APOS_ESTE_ITEM', l: '# Completos APÓS', cls: 'text-center' },
                                            { k: 'PEDIDOS_COMPLETOS_APOS_ESTE_ITEM', l: 'Pedidos Completos APÓS', style: { minWidth: 240 } },
                                            { k: 'VALOR_PEDIDOS_COMPLETOS_APOS', l: 'Valor do Item', cls: 'text-right' },
                                            { k: 'N_ATRASADOS_COMPLETOS_APOS', l: '# Atras. APÓS', cls: 'text-center' },
                                            { k: 'CUM_PEDIDOS_COMPLETOS', l: 'Cum. Peds', cls: 'text-right' },
                                            { k: 'CUM_PCT', l: 'Cum. %', cls: 'text-right' },
                                        ].map((h: any) => {
                                            const ckey = `plano:${h.k}`;
                                            const w = colWidths[ckey];
                                            return (
                                            <th key={h.k} onClick={() => toggleSort(setSortPlano, sortPlano, h.k)}
                                                className={`relative px-2 py-2 whitespace-nowrap hover:text-slate-700 dark:hover:text-slate-200 ${h.cls || ''}`}
                                                style={{ ...(h.style || {}), ...(w ? { width: w, minWidth: w, maxWidth: w } : {}) }}>
                                                {h.l} <SortIcon active={sortPlano.k === h.k} dir={sortPlano.d} />
                                                <div
                                                    onMouseDown={(e) => startResize(ckey, e)}
                                                    onClick={(e) => e.stopPropagation()}
                                                    title="Arraste para redimensionar"
                                                    className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-blue-400/60 active:bg-blue-500"
                                                />
                                            </th>
                                            );
                                        })}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                    {(() => {
                                        // Tendência só p/ exibição: tend. de ~5 dias = projeção do mês ÷ 30 × 5.
                                        const _comTend = planoFiltrado.map((r: any) => {
                                            const t5 = Math.round((tendMensalMap[normCod(r.CODIGO_PRODUTO)] || 0) / 30 * 5);
                                            return { ...r, TEND_5D: t5, TEND_5D_PROD: t5 + (r.QTD_PRODUZIR || 0) };
                                        });
                                        const _linhas = sorter(_comTend, sortPlano.k, sortPlano.d).filter((row: any) => {
                                            if (!filtroTipos.length) return true;
                                            const lista: string = row.PEDIDOS_QUE_USAM_SKU || '';
                                            const peds = lista.split(',').map((s) => s.trim()).filter(Boolean);
                                            return peds.some((p) => filtroTipos.includes(tipoEfetivo(p, versao.totais?.pedidos_tipos, versao.totais?.pedidos_situacao)));
                                        });
                                        // Estado vazio: mantém a altura da tabela (não colapsa) para o filtro continuar acessível.
                                        if (_linhas.length === 0) return (<tr><td colSpan={22} className="px-3 py-16 text-center text-slate-400 italic">Nenhum item para os filtros selecionados.</td></tr>);
                                        return _linhas.map((row: any, i: number) => (
                                        <tr key={i} className={row.N_PEDIDOS_COMPLETOS_APOS_ESTE_ITEM > 0 ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : ''}>
                                            <td className="px-2 py-1 text-center font-bold text-slate-400">{row.SEQUENCIA}</td>
                                            <td className="px-2 py-1 font-mono"><b>{row.CODIGO_PRODUTO}</b></td>
                                            <td className="px-2 py-1" style={{ maxWidth: 240 }}>{row.DESCRICAO}</td>
                                            <td className="px-2 py-1 text-center">
                                                {row.GRUPO ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => setFiltroGrupos(filtroGrupos.includes(row.GRUPO) ? filtroGrupos.filter((x: string) => x !== row.GRUPO) : [...filtroGrupos, row.GRUPO])}
                                                        title={`Filtrar por ${GRUPO_INFO[row.GRUPO]?.label || row.GRUPO}`}
                                                        className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border transition ${filtroGrupos.includes(row.GRUPO) ? 'ring-2 ring-offset-1' : 'border-transparent hover:opacity-80'}`}
                                                        style={{ background: (GRUPO_INFO[row.GRUPO]?.cor || '#64748b') + '22', color: GRUPO_INFO[row.GRUPO]?.cor || '#64748b' }}
                                                    >
                                                        {GRUPO_INFO[row.GRUPO]?.label || row.GRUPO}
                                                    </button>
                                                ) : '—'}
                                            </td>
                                            <td className="px-2 py-1 text-right font-bold text-blue-600">{fmt(row.QTD_PRODUZIR)}</td>
                                            <td className="px-2 py-1 text-right text-purple-600 dark:text-purple-300" title="Tendência de demanda de ~5 dias (projeção do mês ÷ 30 × 5)">{fmt(row.TEND_5D)}</td>
                                            <td className="px-2 py-1 text-right font-semibold text-indigo-600 dark:text-indigo-300" title="Tendência 5d + Qtd a Produzir">{fmt(row.TEND_5D_PROD)}</td>
                                            <td className="px-2 py-1 text-right">{fmt(row.ESTOQUE_DISPONIVEL ?? row.ESTOQUE_ATUAL)}</td>
                                            <td className="px-2 py-1 text-right">{fmt(row.RESERVA_ATUAL)}</td>
                                            <td className="px-2 py-1 text-right font-semibold">{fmt(row.ESTOQUE_FISICO ?? ((row.ESTOQUE_ATUAL || 0) + (row.RESERVA_ATUAL || 0)))}</td>
                                            <td className="px-2 py-1 text-right">{fmt(filtroTipos.length && row.DEMANDA_POR_PEDIDO
                                                ? Object.entries(row.DEMANDA_POR_PEDIDO as Record<string, number>).filter(([p]) => filtroTipos.includes(tipoEfetivo(p, versao.totais?.pedidos_tipos, versao.totais?.pedidos_situacao))).reduce((s, [, v]) => s + v, 0)
                                                : row.DEMANDA_TOTAL_PLANO)}</td>
                                            <td className="px-2 py-1 text-center">{row.N_PEDIDOS_QUE_USAM_SKU}</td>
                                            <td className="px-2 py-1 text-[10px] align-top whitespace-normal break-words" style={{ maxWidth: 320 }}>
                                                <PedidosColoridos lista={row.PEDIDOS_QUE_USAM_SKU} tipos={versao.totais?.pedidos_tipos} situacao={versao.totais?.pedidos_situacao} highlight={filtroPlano} onlyTipos={filtroTipos} entregas={versao.totais?.pedidos_entregas} emissoesOrig={versao.totais?.pedidos_emissao_orig} />
                                            </td>
                                            <td className="px-2 py-1 text-center font-bold text-emerald-600">{row.N_PEDIDOS_COMPLETOS_APOS_ESTE_ITEM}</td>
                                            <td className="px-2 py-1 text-[10px] align-top whitespace-normal break-words" style={{ maxWidth: 320 }}>
                                                {row.PEDIDOS_COMPLETOS_APOS_ESTE_ITEM
                                                    ? <PedidosColoridos lista={row.PEDIDOS_COMPLETOS_APOS_ESTE_ITEM} tipos={versao.totais?.pedidos_tipos} situacao={versao.totais?.pedidos_situacao} highlight={filtroPlano} onlyTipos={filtroTipos} entregas={versao.totais?.pedidos_entregas} emissoesOrig={versao.totais?.pedidos_emissao_orig} />
                                                    : '—'}
                                            </td>
                                            <td className="px-2 py-1 text-right font-bold whitespace-nowrap">{fmtMoney(filtroTipos.length && row.VALOR_POR_PEDIDO_COMPLETO
                                                ? Object.entries(row.VALOR_POR_PEDIDO_COMPLETO as Record<string, number>).filter(([p]) => filtroTipos.includes(tipoEfetivo(p, versao.totais?.pedidos_tipos, versao.totais?.pedidos_situacao))).reduce((s, [, v]) => s + v, 0)
                                                : row.VALOR_PEDIDOS_COMPLETOS_APOS)}</td>
                                            <td className="px-2 py-1 text-center font-bold text-red-600 whitespace-nowrap">{row.N_ATRASADOS_COMPLETOS_APOS}</td>
                                            <td className="px-2 py-1 text-right whitespace-nowrap">{row.CUM_PEDIDOS_COMPLETOS}</td>
                                            <td className="px-2 py-1 text-right font-mono whitespace-nowrap">{row.CUM_PCT}%</td>
                                        </tr>
                                    ));
                                    })()}
                                </tbody>
                            </table>
                        </TableScroll>
                        </div>
                    )}


                    {/* Aba: Historico */}
                    {aba === 'historico' && (
                        <div className="overflow-x-auto">
                            <table className="w-full text-xs">
                                <thead className="bg-slate-50 dark:bg-slate-700">
                                    <tr className="text-left text-[10px] uppercase text-slate-500">
                                        <th className="px-3 py-2 whitespace-nowrap">Data/Hora</th>
                                        <th className="px-3 py-2 whitespace-nowrap">Usuário</th>
                                        <th className="px-3 py-2 whitespace-nowrap">Data Ref</th>
                                        <th className="px-3 py-2 text-right whitespace-nowrap">Pedidos Atend.</th>
                                        <th className="px-3 py-2 text-right whitespace-nowrap">Atrasados</th>
                                        <th className="px-3 py-2 text-right whitespace-nowrap">Valor R$</th>
                                        <th className="px-3 py-2 text-right whitespace-nowrap">SKUs</th>
                                        <th className="px-3 py-2 text-center whitespace-nowrap">Tempo (s)</th>
                                        <th className="px-3 py-2 text-center whitespace-nowrap">Ações</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                    {historico.length === 0 && (
                                        <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400 italic">Nenhuma versão registrada</td></tr>
                                    )}
                                    {historico.map((v) => {
                                        const t = v.totais || {};
                                        const isAtual = v.id === versaoAtualId;
                                        return (
                                            <tr key={v.id} className={isAtual ? 'bg-blue-50/40 dark:bg-blue-900/10' : ''}>
                                                <td className="px-3 py-2 flex items-center gap-1">
                                                    <Clock className="w-3 h-3 text-slate-400" />
                                                    {new Date(v.created_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}
                                                    {isAtual && <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-100 text-blue-700">ATUAL</span>}
                                                    {v.oficial && <span className="ml-2 px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 text-emerald-700">OFICIAL</span>}
                                                </td>
                                                <td className="px-3 py-2 whitespace-nowrap">
                                                    <span className="inline-flex items-center gap-1">
                                                        <UserIcon className="w-3 h-3 text-slate-400" />
                                                        {v.created_by_name || '-'}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2 font-mono">{v.hoje}</td>
                                                <td className="px-3 py-2 text-right whitespace-nowrap">{t.n_atendidos}/{t.n_pedidos}</td>
                                                <td className="px-3 py-2 text-right whitespace-nowrap">{t.n_atr_atend}/{t.n_atr_tot}</td>
                                                <td className="px-3 py-2 text-right whitespace-nowrap">{fmtMoney(t.val_atend || 0)}</td>
                                                <td className="px-3 py-2 text-right whitespace-nowrap">{fmt(t.n_skus || 0)}</td>
                                                <td className="px-3 py-2 text-center whitespace-nowrap">{Math.round(v.elapsed_seconds || 0)}</td>
                                                <td className="px-3 py-2 text-center whitespace-nowrap">
                                                    <button
                                                        onClick={() => carregarVersao(v.id)}
                                                        className="px-2 py-0.5 mr-1 text-[10px] font-bold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200"
                                                    >
                                                        Visualizar
                                                    </button>
                                                    <button
                                                        onClick={() => baixarXlsx(v.id)}
                                                        className="px-2 py-0.5 mr-1 text-[10px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300"
                                                    >
                                                        Excel
                                                    </button>
                                                    {(podeOficial || v.oficial) && (
                                                    <button
                                                        onClick={() => podeOficial && toggleOficial(v.id, !v.oficial)}
                                                        disabled={!podeOficial}
                                                        className={`px-2 py-0.5 text-[10px] font-bold rounded border ${v.oficial ? 'text-emerald-700 bg-emerald-50 hover:bg-emerald-100 border-emerald-200' : 'text-slate-600 bg-white hover:bg-slate-100 border-slate-300'} ${!podeOficial ? 'cursor-default opacity-80' : ''}`}
                                                        title={!podeOficial ? 'Apenas a Fábrica pode definir a versão oficial' : (v.oficial ? 'Desmarcar como oficial' : 'Marcar como oficial')}
                                                    >
                                                        {v.oficial ? 'Oficial' : 'Tornar oficial'}
                                                    </button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                            <p className="text-[10px] text-slate-400 italic px-3 py-2">Versões com mais de 30 dias são removidas automaticamente.</p>
                        </div>
                    )}
                </div>
            )}

            {/* Loading overlay */}
            {loading && (
                <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl p-6 text-center max-w-sm">
                        <RotateCcw className="w-12 h-12 text-red-600 mx-auto animate-spin mb-3" />
                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-1">Gerando plano de produção</h3>
                        <p className="text-xs text-slate-500 dark:text-slate-400">
                            Consultando BigQuery e rodando otimizador (PuLP).<br />
                            Pode levar de alguns segundos a 5 minutos.
                        </p>
                    </div>
                </div>
            )}

            {/* Modal de confirmacao */}
            {modalConfirm && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setModalConfirm(false)}>
                    <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700">
                            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                <AlertTriangle className="w-4 h-4 text-amber-500" /> Confirmar atualização
                            </h3>
                            <button onClick={() => setModalConfirm(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200">
                                <X className="w-4 h-4" />
                            </button>
                        </div>
                        <div className="p-4 text-sm text-slate-700 dark:text-slate-300 space-y-2">
                            <p>Deseja realmente recalcular o plano?</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400">
                                Esta operação consulta o BigQuery e roda o otimizador (PuLP), pode levar até 5 minutos.
                                A versão atual será preservada no histórico.
                            </p>
                            <div className="bg-slate-50 dark:bg-slate-700/50 rounded p-2 text-xs">
                                <b>Data de referência:</b> {new Date(dataRef + 'T00:00').toLocaleDateString('pt-BR')}
                            </div>
                        </div>
                        <div className="flex gap-2 px-4 py-3 border-t border-slate-200 dark:border-slate-700">
                            <button
                                onClick={() => setModalConfirm(false)}
                                className="flex-1 px-4 py-2 bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-600"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={gerarNovo}
                                className="flex-1 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold"
                            >
                                Confirmar e Atualizar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {modalAtraso && versao && (() => {
                const atrasados = versao.totais?.pedidos_atrasados || {};
                const valores = versao.totais?.pedidos_valores || {};
                const tipos = versao.totais?.pedidos_tipos || {};
                const situ = versao.totais?.pedidos_situacao || {};
                const regionais = versao.totais?.pedidos_regionais || {};
                const clientes = versao.totais?.pedidos_clientes || {};
                const entregas = versao.totais?.pedidos_entregas || {};
                const diasAtraso = versao.totais?.pedidos_dias_atraso || {};
                const pedsAtr = Object.entries(atrasados).filter(([, v]) => v).map(([p]) => p);
                const porTipoGlobal = filtroTipos.length ? pedsAtr.filter(p => filtroTipos.includes(tipoEfetivo(p, tipos, situ))) : pedsAtr;
                const porTipoLocal = filtroTipoAtraso ? porTipoGlobal.filter(p => tipoEfetivo(p, tipos, situ) === filtroTipoAtraso) : porTipoGlobal;
                const q = (filtroAtraso || '').toLowerCase();
                const filtered = q ? porTipoLocal.filter(p => p.toLowerCase().includes(q) || (clientes[p] || '').toLowerCase().includes(q)) : porTipoLocal;
                const groups: Record<string, string[]> = {};
                filtered.forEach(p => {
                    const reg = regionais[p] || 'Sem Regional';
                    if (!groups[reg]) groups[reg] = [];
                    groups[reg].push(p);
                });
                const sortedGroups = Object.entries(groups)
                    .map(([reg, peds]) => ({ reg, peds: peds.sort((a, b) => (diasAtraso[b] || 0) - (diasAtraso[a] || 0)), val: peds.reduce((s, p) => s + (valores[p] || 0), 0) }))
                    .sort((a, b) => b.val - a.val);
                const totalVal = sortedGroups.reduce((s, g) => s + g.val, 0);
                const totalPeds = filtered.length;
                return (
                    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-4 pt-16" onClick={() => setModalAtraso(false)}>
                        <div className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl max-w-5xl w-full max-h-[85vh] flex flex-col border border-slate-200 dark:border-slate-700" onClick={e => e.stopPropagation()}>
                            <div className="px-6 py-5 border-b border-slate-200 dark:border-slate-700 bg-gradient-to-r from-red-50 to-white dark:from-red-900/20 dark:to-slate-800 rounded-t-2xl space-y-3">
                                <div className="flex items-center justify-between">
                                    <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Pedidos em Atraso</h3>
                                    <button onClick={() => setModalAtraso(false)} className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"><X className="w-5 h-5" /></button>
                                </div>
                                <div className="flex items-center gap-6 text-xs text-slate-500">
                                    <span className="font-semibold text-red-600">{totalPeds} pedidos</span>
                                    <span className="font-semibold">{sortedGroups.length} regionais</span>
                                    <span className="font-mono font-bold text-slate-700 dark:text-slate-300">{fmtMoney(totalVal)}</span>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-1 flex-1">
                                        <Search className="w-3.5 h-3.5 text-slate-400" />
                                        <input
                                            type="text" value={filtroAtraso} onChange={e => setFiltroAtraso(e.target.value)}
                                            placeholder="Filtrar por pedido ou cliente..."
                                            className="flex-1 text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 rounded-lg"
                                        />
                                    </div>
                                    <button
                                        onClick={() => setExpandAll(!expandAll)}
                                        className="text-[10px] font-bold px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 whitespace-nowrap"
                                    >
                                        {expandAll ? 'Recolher tudo' : 'Expandir tudo'}
                                    </button>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-[10px]">
                                    <span className="text-slate-400 font-bold uppercase">Filtrar por tipo:</span>
                                    {[
                                        { k: 'SAC', cor: TIPO_COR.SAC, label: 'SAC' },
                                        { k: 'BONIFICACAO', cor: TIPO_COR.BONIFICACAO, label: 'Bonificação' },
                                        { k: 'TROCA', cor: TIPO_COR.TROCA, label: 'Troca' },
                                        { k: 'PENDENTE_FINANCEIRO', cor: TIPO_COR.PENDENTE_FINANCEIRO, label: 'Pend. Financeiro' },
                                        { k: 'PADRAO', cor: COR_PADRAO, label: 'Cliente padrão' },
                                        { k: 'INTERNO', cor: TIPO_COR.INTERNO, label: 'EMPRESA Interno' },
                                    ].map(l => (
                                        <button
                                            key={l.k}
                                            onClick={() => setFiltroTipoAtraso(filtroTipoAtraso === l.k ? null : l.k)}
                                            className={`flex items-center gap-1 px-2 py-0.5 rounded border transition ${
                                                filtroTipoAtraso === l.k
                                                    ? 'border-slate-700 dark:border-slate-200 bg-slate-200 dark:bg-slate-600 font-bold'
                                                    : 'border-transparent hover:bg-slate-100 dark:hover:bg-slate-700'
                                            }`}
                                        >
                                            <span style={{ background: l.cor }} className="inline-block w-2.5 h-2.5 rounded-sm" />
                                            {l.label}
                                        </button>
                                    ))}
                                    {filtroTipoAtraso && (
                                        <button onClick={() => setFiltroTipoAtraso(null)} className="ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded border border-red-300 text-red-600 hover:bg-red-50">
                                            <X className="w-3 h-3" /> Limpar
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="overflow-y-auto flex-1 p-4 space-y-3">
                                {sortedGroups.map(g => (
                                    <AtrasoRegionalGroup key={g.reg} reg={g.reg} peds={g.peds} valores={valores} clientes={clientes} entregas={entregas} diasAtraso={diasAtraso} tipos={tipos} situ={situ} totalVal={g.val} forceOpen={expandAll} />
                                ))}
                                {sortedGroups.length === 0 && (
                                    <div className="text-center py-8 text-slate-400 text-sm italic">Nenhum pedido encontrado.</div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {versao && (
                <WhatsAppEnvioModal
                    open={wppModalOpen}
                    onClose={() => setWppModalOpen(false)}
                    titulo="Enviar Otimizador de Produção (Excel)"
                    onEnviar={(numero) => api.enviarPlanoProducaoWhatsApp(versao.id, numero)}
                />
            )}
        </div>
    );
};

export default PlanoProducao;
