import React, { useEffect, useMemo, useState } from 'react';
import { Laptop, Smartphone, Monitor, Headphones, Key, HardDrive, Package, Search, X, Plus, Pencil, Trash2, Save, ArrowLeft, ChevronRight, UserPlus, UserMinus, Printer, Phone, History, MapPin, Users as UsersIcon, Boxes, Edit3, Eye, Download } from 'lucide-react';
import { api } from '../../../app_api';
import { useToast } from '../../../contexts/ToastContext';
import * as XLSX from 'xlsx';
import KpiCard, { KpiGrid } from '../../common/KpiCard';

const TIPOS = [
    { v: 'notebook', l: 'Notebook', icon: Laptop, cor: 'text-blue-600 bg-blue-100 dark:bg-blue-900/40' },
    { v: 'computador', l: 'Desktop', icon: HardDrive, cor: 'text-indigo-600 bg-indigo-100 dark:bg-indigo-900/40' },
    { v: 'celular', l: 'Celular', icon: Smartphone, cor: 'text-emerald-600 bg-emerald-100 dark:bg-emerald-900/40' },
    { v: 'linha_movel', l: 'Linha Móvel (Vivo)', icon: Smartphone, cor: 'text-green-700 bg-green-100 dark:bg-green-900/40' },
    { v: 'telefone_ip', l: 'Telefone IP', icon: Phone, cor: 'text-sky-600 bg-sky-100 dark:bg-sky-900/40' },
    { v: 'telefone', l: 'Telefone (fixo)', icon: Phone, cor: 'text-teal-600 bg-teal-100 dark:bg-teal-900/40' },
    { v: 'monitor', l: 'Monitor', icon: Monitor, cor: 'text-violet-600 bg-violet-100 dark:bg-violet-900/40' },
    { v: 'impressora', l: 'Impressora', icon: Printer, cor: 'text-cyan-600 bg-cyan-100 dark:bg-cyan-900/40' },
    { v: 'headset', l: 'Headset', icon: Headphones, cor: 'text-amber-600 bg-amber-100 dark:bg-amber-900/40' },
    { v: 'token', l: 'Token/SmartCard', icon: Key, cor: 'text-slate-600 bg-slate-200 dark:bg-slate-700' },
    { v: 'outro', l: 'Outro', icon: Package, cor: 'text-slate-600 bg-slate-200 dark:bg-slate-700' },
];
const tipoVisual = (t: string) => TIPOS.find(x => x.v === t) || TIPOS[TIPOS.length - 1];

const STATUS_LABELS: Record<string, string> = { estoque: 'Em estoque', ativo: 'Em uso', manutencao: 'Manutenção', descartado: 'Descartado', perdido: 'Perdido' };
const STATUS_COR: Record<string, string> = {
    estoque: 'bg-slate-200 text-slate-700 dark:bg-slate-700',
    ativo: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40',
    manutencao: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40',
    descartado: 'bg-slate-300 text-slate-600 dark:bg-slate-800',
    perdido: 'bg-red-100 text-red-700 dark:bg-red-900/40',
};
const ACAO_LABEL: Record<string, string> = {
    atribuicao: '📥 Atribuído',
    devolucao: '📤 Devolvido',
    devolucao_automatica: '🔁 Substituído',
    manutencao: '🔧 Manutenção',
    descarte: '🗑️ Descartado',
};

const fmtDate = (s?: string) => {
    if (!s) return '—';
    try { return new Date(s + 'T00:00:00').toLocaleDateString('pt-BR'); } catch { return s; }
};
const fmtDateTime = (s?: string) => {
    if (!s) return '—';
    try { return new Date(s).toLocaleString('pt-BR'); } catch { return s; }
};
const fmtMoney = (v?: number | null) => v == null ? '—' : 'R$ ' + Number(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Aba = 'estoque' | 'por-colab';

const EquipamentosPage: React.FC = () => {
    const [aba, setAba] = useState<Aba>('estoque');
    const [modalEqId, setModalEqId] = useState<number | null>(null);
    const [modalNovo, setModalNovo] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);

    return (
        <div className="-m-4 md:-m-6 lg:-m-8 min-h-[calc(100vh-2rem)] relative overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50/60 to-indigo-50 dark:from-slate-900 dark:via-blue-950/40 dark:to-indigo-950/40">
            <div className="pointer-events-none absolute -top-32 -left-32 w-[480px] h-[480px] rounded-full bg-blue-300/40 blur-3xl dark:bg-blue-700/20" />
            <div className="pointer-events-none absolute top-1/3 -right-40 w-[520px] h-[520px] rounded-full bg-indigo-300/40 blur-3xl dark:bg-indigo-700/20" />
            <div className="pointer-events-none absolute bottom-0 left-1/3 w-[480px] h-[480px] rounded-full bg-sky-300/30 blur-3xl dark:bg-sky-800/20" />
            <div className="pointer-events-none absolute -bottom-24 -right-24 w-[400px] h-[400px] rounded-full bg-cyan-200/30 blur-3xl dark:bg-cyan-800/15" />
            <div className="pointer-events-none absolute inset-0 opacity-[0.04] dark:opacity-[0.08]" style={{ backgroundImage: 'linear-gradient(rgb(30,58,138) 1px, transparent 1px), linear-gradient(90deg, rgb(30,58,138) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
            <div className="relative p-4 sm:p-6 space-y-4 max-w-[1400px] mx-auto">
                <header className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg shadow-rose-500/30">
                            <Package className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black bg-gradient-to-r from-rose-600 to-pink-600 dark:from-rose-400 dark:to-pink-400 bg-clip-text text-transparent">
                                Equipamentos T.I
                            </h1>
                            <p className="text-xs text-slate-500 mt-0.5">Estoque e controle por colaborador</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={() => setModalNovo(true)} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700">
                            <Plus className="w-3.5 h-3.5" /> Novo equipamento
                        </button>
                    </div>
                </header>

                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <div className="border-b border-slate-200 dark:border-slate-700 flex text-xs">
                        {([
                            { k: 'estoque', l: 'Estoque (todos)', icon: Boxes },
                            { k: 'por-colab', l: 'Por colaborador', icon: UsersIcon },
                        ] as { k: Aba; l: string; icon: any }[]).map((t) => {
                            const Ic = t.icon;
                            const active = aba === t.k;
                            return (
                                <button key={t.k} onClick={() => setAba(t.k)}
                                    className={`px-4 py-2 inline-flex items-center gap-1.5 border-b-2 transition ${active ? 'border-rose-600 text-rose-600 font-bold' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
                                    <Ic className="w-3.5 h-3.5" /> {t.l}
                                </button>
                            );
                        })}
                    </div>
                    <div className="p-4">
                        {aba === 'estoque' ?
                            <AbaEstoque refreshKey={refreshKey} onClickEq={(id) => setModalEqId(id)} /> :
                            <AbaPorColab onClickEq={(id) => setModalEqId(id)} refreshKey={refreshKey} />
                        }
                    </div>
                </div>
            </div>

            {modalEqId && <EquipamentoDetalhe eqId={modalEqId} onClose={() => setModalEqId(null)} onChanged={() => setRefreshKey(k => k + 1)} />}
            {modalNovo && <NovoEquipamentoModal onClose={() => setModalNovo(false)} onSaved={() => { setModalNovo(false); setRefreshKey(k => k + 1); }} />}
        </div>
    );
};

// ============ ABA ESTOQUE (TODOS) ============

const AbaEstoque: React.FC<{ refreshKey: number; onClickEq: (id: number) => void }> = ({ refreshKey, onClickEq }) => {
    const toast = useToast();
    const [itens, setItens] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [busca, setBusca] = useState('');
    const [filtroTipo, setFiltroTipo] = useState('');
    const [filtroStatus, setFiltroStatus] = useState('');
    const [expandedId, setExpandedId] = useState<number | null>(null);

    const carregar = async () => {
        setLoading(true);
        try {
            // Busca todos (filtro por tipo é feito no cliente p/ alimentar as abas)
            const r = await api.rhEquipamentosListar({ search: busca, status: filtroStatus });
            setItens(r.equipamentos || []);
        } catch (e: any) { toast.showToast(e.message, 'error'); }
        finally { setLoading(false); }
    };
    useEffect(() => { carregar(); }, [refreshKey]);
    useEffect(() => { const t = setTimeout(carregar, 250); return () => clearTimeout(t); }, [busca, filtroStatus]);

    // Contagem por tipo (para as abas) — ignora o tipo selecionado
    const porTipo = useMemo(() => {
        const m: Record<string, number> = {};
        itens.forEach((i) => { m[i.tipo] = (m[i.tipo] || 0) + 1; });
        return m;
    }, [itens]);

    // Linhas exibidas conforme a aba (tipo) ativa
    const itensFiltrados = useMemo(
        () => filtroTipo ? itens.filter((i) => i.tipo === filtroTipo) : itens,
        [itens, filtroTipo]);

    const totais = useMemo(() => {
        const t = { total: itensFiltrados.length, ativo: 0, estoque: 0, manutencao: 0 };
        itensFiltrados.forEach((i) => {
            if (i.status === 'ativo') t.ativo++;
            else if (i.status === 'estoque') t.estoque++;
            else if (i.status === 'manutencao') t.manutencao++;
        });
        return t;
    }, [itensFiltrados]);

    // Colunas dinâmicas: só exibe a coluna se houver dado nela na seleção atual
    const col = useMemo(() => ({
        modelo: itensFiltrados.some((e) => e.modelo || e.marca),
        patrimonio: itensFiltrados.some((e) => e.patrimonio || e.serial_number),
        numero: itensFiltrados.some((e) => e.numero_linha || e.ramal || e.ip || e.nome_estacao),
        setor: itensFiltrados.some((e) => e.setor || e.localizacao),
        comquem: itensFiltrados.some((e) => e.colaborador_nome || e.usuario_nome),
    }), [itensFiltrados]);
    const colCount = 3 + [col.modelo, col.patrimonio, col.numero, col.setor, col.comquem].filter(Boolean).length;

    const exportarExcel = () => {
        const rows = itensFiltrados.map((e) => {
            const base: Record<string, any> = {
                'Tipo': tipoVisual(e.tipo).l,
                'Modelo': e.modelo || '',
                'Marca': e.marca || '',
                'Patrimônio': e.patrimonio || '',
                'Serial': e.serial_number || '',
                'Número/Linha': e.numero_linha || '',
                'Ramal': e.ramal || '',
                'IP': e.ip || '',
                'Nome Estação': e.nome_estacao || '',
                'Setor': e.setor || '',
                'Localização': e.localizacao || '',
                'Com quem': e.colaborador_nome || e.usuario_nome || '',
                'Status': STATUS_LABELS[e.status] || e.status || '',
                'Nota Fiscal': e.nota_fiscal || '',
                'Descrição': e.descricao || '',
                'Observações': e.observacoes || '',
            };
            Object.entries(e.atributos || {}).forEach(([k, v]) => {
                base[k] = (typeof v === 'object' && v !== null) ? JSON.stringify(v) : (v ?? '');
            });
            return base;
        });
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Equipamentos');
        XLSX.writeFile(wb, `equipamentos_ti${filtroTipo ? '_' + filtroTipo : ''}.xlsx`);
    };

    return (
        <>
            <KpiGrid className="grid grid-cols-4 gap-2 mb-3">
                <KpiCard label="Total" value={totais.total} color="slate" />
                <KpiCard label="Em uso" value={totais.ativo} color="emerald" />
                <KpiCard label="Em estoque" value={totais.estoque} color="blue" />
                <KpiCard label="Manutenção" value={totais.manutencao} color="amber" />
            </KpiGrid>
            <div className="flex flex-wrap gap-2 items-center mb-3">
                <div className="relative flex-1 min-w-[250px]">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                    <input value={busca} onChange={(e) => setBusca(e.target.value)}
                        placeholder="Buscar modelo, patrimônio, serial, usuário, nº/ramal, IP, setor…"
                        className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                </div>
                <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900">
                    <option value="">Status (todos)</option>
                    {Object.entries(STATUS_LABELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
                <button onClick={exportarExcel} disabled={!itensFiltrados.length}
                    title="Exportar para Excel" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50">
                    <Download className="w-3.5 h-3.5" /> Exportar Excel
                </button>
            </div>

            {/* Abas por tipo */}
            <div className="flex flex-wrap gap-1.5 mb-3 border-b border-slate-200 dark:border-slate-700 pb-2">
                <button onClick={() => setFiltroTipo('')}
                    className={`px-2.5 py-1 rounded-lg text-xs font-bold ${filtroTipo === '' ? 'bg-rose-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'}`}>
                    Todos <span className="opacity-70">({itens.length})</span>
                </button>
                {TIPOS.filter(t => porTipo[t.v]).map(t => {
                    const Ic = t.icon;
                    return (
                        <button key={t.v} onClick={() => setFiltroTipo(t.v)}
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold ${filtroTipo === t.v ? 'bg-rose-600 text-white' : 'bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200'}`}>
                            <Ic className="w-3 h-3" /> {t.l} <span className="opacity-70">({porTipo[t.v]})</span>
                        </button>
                    );
                })}
            </div>

            {loading ? <p className="p-6 text-center text-slate-500 text-sm">Carregando…</p> : itensFiltrados.length === 0 ? (
                <div className="p-10 text-center text-slate-400"><Package className="w-10 h-10 mx-auto mb-2 opacity-40" /><p className="text-sm">Nenhum equipamento</p></div>
            ) : (
                <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-900/40 text-slate-500 uppercase text-[10px]">
                            <tr>
                                <th className="px-3 py-2 text-left">Tipo</th>
                                {col.modelo && <th className="px-3 py-2 text-left">Modelo / Marca</th>}
                                {col.patrimonio && <th className="px-3 py-2 text-left">Patrimônio / Serial</th>}
                                {col.numero && <th className="px-3 py-2 text-left">Nº / Ramal / IP</th>}
                                {col.setor && <th className="px-3 py-2 text-left">Setor / Local</th>}
                                {col.comquem && <th className="px-3 py-2 text-left">Com quem</th>}
                                <th className="px-3 py-2 text-center">Status</th>
                                <th className="px-3 py-2 text-right"></th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                            {itensFiltrados.map((e) => {
                                const tv = tipoVisual(e.tipo);
                                const Ic = tv.icon;
                                const aberto = expandedId === e.id;
                                return (
                                  <React.Fragment key={e.id}>
                                    <tr onClick={() => onClickEq(e.id)} className={`cursor-pointer hover:bg-rose-50/40 dark:hover:bg-rose-900/10 ${aberto ? 'bg-rose-50/60 dark:bg-rose-900/10' : ''}`}>
                                        <td className="px-3 py-2">
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${tv.cor}`}>
                                                <Ic className="w-3 h-3" /> {tv.l}
                                            </span>
                                        </td>
                                        {col.modelo && (
                                            <td className="px-3 py-2">
                                                <div className="font-bold">{e.modelo || '—'}</div>
                                                {e.marca && <div className="text-[10px] text-slate-400">{e.marca}</div>}
                                            </td>
                                        )}
                                        {col.patrimonio && (
                                            <td className="px-3 py-2 font-mono">
                                                <div>{e.patrimonio || '—'}</div>
                                                {e.serial_number && <div className="text-[10px] text-slate-400">{e.serial_number}</div>}
                                            </td>
                                        )}
                                        {col.numero && (
                                            <td className="px-3 py-2 font-mono">
                                                <div>{e.numero_linha || e.ramal || e.ip || '—'}</div>
                                                {e.nome_estacao && <div className="text-[10px] text-slate-400">{e.nome_estacao}</div>}
                                            </td>
                                        )}
                                        {col.setor && (
                                            <td className="px-3 py-2">
                                                {(e.setor || e.localizacao) ? <span className="inline-flex items-center gap-1 text-slate-700 dark:text-slate-200"><MapPin className="w-3 h-3 text-slate-400" />{e.setor || e.localizacao}</span> : <span className="text-slate-300">—</span>}
                                            </td>
                                        )}
                                        {col.comquem && <td className="px-3 py-2 font-semibold">{e.colaborador_nome || e.usuario_nome || <span className="text-slate-300 font-normal italic">livre</span>}</td>}
                                        <td className="px-3 py-2 text-center">
                                            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COR[e.status]}`}>{STATUS_LABELS[e.status]}</span>
                                        </td>
                                        <td className="px-3 py-2 text-right whitespace-nowrap">
                                            <button onClick={(ev) => { ev.stopPropagation(); setExpandedId(aberto ? null : e.id); }}
                                                title="Pré-visualizar dados"
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-900/20">
                                                <Eye className="w-3.5 h-3.5" /> {aberto ? 'Ocultar' : 'Visualizar'}
                                            </button>
                                        </td>
                                    </tr>
                                    {aberto && (
                                        <tr className="bg-slate-50/70 dark:bg-slate-900/30">
                                            <td colSpan={colCount} className="px-4 py-3">
                                                <PreviewEquip e={e} />
                                            </td>
                                        </tr>
                                    )}
                                  </React.Fragment>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </>
    );
};

// ============ ABA POR COLABORADOR ============

const AbaPorColab: React.FC<{ refreshKey: number; onClickEq: (id: number) => void }> = ({ refreshKey, onClickEq }) => {
    const toast = useToast();
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [busca, setBusca] = useState('');
    const [filtroTipo, setFiltroTipo] = useState('');
    const [detalheColab, setDetalheColab] = useState<number | null>(null);

    const carregar = async () => {
        setLoading(true);
        try {
            const r = await api.rhEquipamentosPorColaborador({ search: busca, tipo: filtroTipo });
            setData(r.colaboradores || []);
        } catch (e: any) { toast.showToast(e.message, 'error'); }
        finally { setLoading(false); }
    };
    useEffect(() => { carregar(); }, [refreshKey]);
    useEffect(() => { const t = setTimeout(carregar, 250); return () => clearTimeout(t); }, [busca, filtroTipo]);

    return (
        <>
            <div className="flex flex-wrap gap-2 items-center mb-3">
                <div className="relative flex-1 min-w-[250px]">
                    <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
                    <input value={busca} onChange={(e) => setBusca(e.target.value)}
                        placeholder="Buscar nome, matrícula, modelo, patrimônio, serial…"
                        className="w-full pl-8 pr-3 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                </div>
                <select value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="text-xs px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900">
                    <option value="">Tipo (todos)</option>
                    {TIPOS.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
            </div>

            {loading ? <p className="p-6 text-center text-slate-500 text-sm">Carregando…</p> : data.length === 0 ? (
                <div className="p-10 text-center text-slate-400"><UsersIcon className="w-10 h-10 mx-auto mb-2 opacity-40" /><p className="text-sm">Nenhum colaborador encontrado</p></div>
            ) : (
                <div className="space-y-2">
                    {data.map((c) => (
                        <button key={c.id} onClick={() => setDetalheColab(c.id)}
                            className="w-full bg-white dark:bg-slate-900/40 rounded-lg border border-slate-200 dark:border-slate-700 p-3 flex items-center gap-3 hover:border-rose-300 hover:shadow transition text-left">
                            <div className="w-10 h-10 rounded-full overflow-hidden bg-gradient-to-br from-rose-400 to-pink-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                                {c.foto_url ? <img src={c.foto_url} alt={c.nome} className="w-full h-full object-cover" /> : (c.nome || '?').split(' ').slice(0, 2).map((s: string) => s[0]).join('').toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-bold text-sm">{c.nome}</p>
                                <p className="text-[11px] text-slate-500">{c.cargo || '—'} {c.setor && <>· {c.setor}</>}</p>
                                {c.equipamentos.length > 0 ? (
                                    <div className="flex flex-wrap gap-1 mt-1.5">
                                        {c.equipamentos.map((e: any) => {
                                            const tv = tipoVisual(e.tipo);
                                            const Ic = tv.icon;
                                            return (
                                                <span key={e.id}
                                                    onClick={(ev) => { ev.stopPropagation(); onClickEq(e.id); }}
                                                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold ${tv.cor} cursor-pointer hover:ring-2 hover:ring-rose-300`}>
                                                    <Ic className="w-3 h-3" /> {e.modelo || tv.l}
                                                    {e.patrimonio && <span className="opacity-70">· {e.patrimonio}</span>}
                                                </span>
                                            );
                                        })}
                                    </div>
                                ) : <p className="text-[10px] text-slate-400 italic mt-1">Sem equipamento</p>}
                            </div>
                            <div className="flex flex-col items-end gap-1 flex-shrink-0">
                                <span className="text-xs font-bold">{c.n_equipamentos} item{c.n_equipamentos === 1 ? '' : 's'}</span>
                                {c.status === 'demitido' && <span className="text-[10px] text-red-600 font-bold">DESLIGADO</span>}
                                <ChevronRight className="w-4 h-4 text-slate-400" />
                            </div>
                        </button>
                    ))}
                </div>
            )}

            {detalheColab && <DetalheColabModal cid={detalheColab} onClose={() => { setDetalheColab(null); carregar(); }} onClickEq={(id) => onClickEq(id)} />}
        </>
    );
};

// Pré-visualização inline (accordion abaixo da linha) — somente leitura, só campos preenchidos
const PreviewEquip: React.FC<{ e: any }> = ({ e }) => {
    const toast = useToast();
    const [cred, setCred] = useState<Record<string, any> | null>(null);
    const [credLoading, setCredLoading] = useState(false);
    const revelar = async () => {
        setCredLoading(true);
        try { const r = await api.rhEquipamentoCredenciais(e.id); setCred(r.credenciais || {}); }
        catch (err: any) { toast.showToast(err.message, 'error'); }
        finally { setCredLoading(false); }
    };
    const ats = Object.entries(e.atributos || {}).filter(([, v]) =>
        v !== null && v !== '' && !(typeof v === 'object' && v !== null && Object.keys(v as any).length === 0));
    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 text-xs">
            {e.modelo && <Field label="Modelo" value={e.modelo} />}
            {e.marca && <Field label="Marca" value={e.marca} />}
            {e.patrimonio && <Field label="Patrimônio" value={e.patrimonio} mono />}
            {e.serial_number && <Field label="Serial" value={e.serial_number} mono />}
            {e.numero_linha && <Field label="Número / Linha" value={e.numero_linha} mono />}
            {e.ramal && <Field label="Ramal" value={e.ramal} mono />}
            {e.ip && <Field label="IP" value={e.ip} mono />}
            {e.nome_estacao && <Field label="Nome da estação" value={e.nome_estacao} />}
            {e.setor && <Field label="Setor" value={e.setor} />}
            {e.localizacao && <Field label="Localização" value={e.localizacao} />}
            {(e.colaborador_nome || e.usuario_nome) && <Field label="Com quem" value={e.colaborador_nome || e.usuario_nome} />}
            <Field label="Status" value={STATUS_LABELS[e.status]} />
            {e.data_aquisicao && <Field label="Aquisição" value={fmtDate(e.data_aquisicao)} />}
            {e.valor != null && <Field label="Valor" value={fmtMoney(e.valor)} />}
            {e.nota_fiscal && <Field label="Nota fiscal" value={e.nota_fiscal} />}
            {e.descricao && <div className="col-span-full"><Field label="Descrição" value={e.descricao} /></div>}
            {e.observacoes && <div className="col-span-full"><Field label="Observações" value={e.observacoes} /></div>}
            {ats.length > 0 && (
                <div className="col-span-full mt-1">
                    <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Detalhes técnicos</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                        {ats.map(([k, v]) => <Field key={k} label={k.replace(/_/g, ' ')} value={typeof v === 'object' && v !== null ? JSON.stringify(v) : (v as any)} />)}
                    </div>
                </div>
            )}
            {e.tem_credenciais && (
                <div className="col-span-full mt-1 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                    <div className="flex items-center justify-between">
                        <p className="text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-300 font-bold inline-flex items-center gap-1"><Key className="w-3 h-3" /> Credenciais</p>
                        {!cred && <button onClick={revelar} disabled={credLoading} className="text-[11px] font-bold text-amber-700 dark:text-amber-300 hover:underline">{credLoading ? 'Revelando…' : '🔓 Revelar'}</button>}
                    </div>
                    {cred ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5 mt-1">
                            {Object.entries(cred).map(([k, v]) => <Field key={k} label={k.replace(/_/g, ' ')} value={v as any} mono />)}
                        </div>
                    ) : <p className="text-[11px] text-amber-700/70 dark:text-amber-300/70 mt-0.5">••••••••</p>}
                </div>
            )}
        </div>
    );
};

// Editor de campos específicos (atributos JSONB) — pares chave/valor
const AtributosEditor: React.FC<{ value: Record<string, any>; onChange: (v: Record<string, any>) => void }> = ({ value, onChange }) => {
    const entries = Object.entries(value || {});
    const rebuild = (oldK: string, newK: string, v: any) => {
        const o: Record<string, any> = {};
        Object.entries(value || {}).forEach(([k, val]) => {
            if (k === oldK) { if (newK !== '') o[newK] = v; }
            else o[k] = val;
        });
        onChange(o);
    };
    const add = () => { if (!('' in (value || {}))) onChange({ ...(value || {}), '': '' }); };
    const remove = (k: string) => { const o = { ...(value || {}) }; delete o[k]; onChange(o); };
    return (
        <div>
            <span className="text-[10px] text-slate-500 font-semibold">Detalhes técnicos (campos específicos do tipo)</span>
            <div className="space-y-1 mt-0.5">
                {entries.map(([k, v], i) => (
                    <div key={i} className="flex gap-1 items-center">
                        <input value={k} onChange={(e) => rebuild(k, e.target.value, v)} placeholder="campo"
                            className="w-1/3 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
                        <input value={typeof v === 'object' && v !== null ? JSON.stringify(v) : (v ?? '')} onChange={(e) => rebuild(k, k, e.target.value)} placeholder="valor"
                            className="flex-1 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
                        <button type="button" onClick={() => remove(k)} className="px-1.5 py-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                ))}
                <button type="button" onClick={add} className="text-[11px] font-bold text-rose-600 hover:underline inline-flex items-center gap-1"><Plus className="w-3 h-3" /> Adicionar campo</button>
            </div>
        </div>
    );
};

// ============ DETALHE DE UM EQUIPAMENTO ============

const EquipamentoDetalhe: React.FC<{ eqId: number; onClose: () => void; onChanged?: () => void }> = ({ eqId, onClose, onChanged }) => {
    const toast = useToast();
    const [eq, setEq] = useState<any>(null);
    const [colabs, setColabs] = useState<any[]>([]);
    const [setores, setSetores] = useState<string[]>([]);
    const [historico, setHistorico] = useState<any[]>([]);
    const [edit, setEdit] = useState(false);
    const [form, setForm] = useState<any>({});
    const [salvando, setSalvando] = useState(false);
    const [cred, setCred] = useState<Record<string, any> | null>(null);
    const [credLoading, setCredLoading] = useState(false);

    const revelarCred = async () => {
        setCredLoading(true);
        try {
            const r = await api.rhEquipamentoCredenciais(eqId);
            setCred(r.credenciais || {});
        } catch (err: any) { toast.showToast(err.message, 'error'); }
        finally { setCredLoading(false); }
    };

    const carregar = async () => {
        try {
            const r = await api.rhEquipamentosListar({}); // pegamos do lote — mas ineficiente.
            // melhor: filtrar manualmente
            const e = (r.equipamentos || []).find((x: any) => x.id === eqId);
            if (e) { setEq(e); setForm(e); }
            const h = await api.rhEquipamentoHistorico(eqId);
            setHistorico(h.historico || []);
            const cs = await api.rhColaboradoresListar();
            setColabs(cs.colaboradores || []);
            const sects = await api.getSectors();
            setSetores((sects || []).filter((s: any) => s.is_active).map((s: any) => s.name));
        } catch (err: any) { toast.showToast(err.message, 'error'); }
    };
    useEffect(() => { carregar(); }, [eqId]);

    const salvar = async () => {
        if (!form.tipo) { toast.showToast('Tipo obrigatório', 'error'); return; }
        setSalvando(true);
        try {
            const payload: any = {};
            ['tipo', 'modelo', 'marca', 'patrimonio', 'serial_number', 'status', 'colaborador_id',
                'localizacao', 'descricao', 'setor', 'usuario_nome', 'numero_linha', 'ramal', 'ip', 'nome_estacao',
                'data_aquisicao', 'valor', 'nota_fiscal', 'data_atribuicao', 'observacoes'].forEach((k) => {
                    payload[k] = form[k] === '' ? null : form[k];
                });
            payload.atributos = form.atributos || {};
            await api.rhEquipamentoAtualizar(eqId, payload);
            toast.showToast('Salvo', 'success');
            setEdit(false);
            carregar();
            onChanged?.();
        } catch (err: any) { toast.showToast(err.message, 'error'); }
        finally { setSalvando(false); }
    };

    const devolver = async () => {
        if (!confirm('Devolver equipamento ao estoque? Será registrado no histórico.')) return;
        try {
            await api.rhEquipamentoDevolver(eqId);
            toast.showToast('Devolvido', 'success');
            carregar();
            onChanged?.();
        } catch (err: any) { toast.showToast(err.message, 'error'); }
    };

    const remover = async () => {
        if (!confirm('Excluir o equipamento (perde o histórico)?')) return;
        try {
            await api.rhEquipamentoRemover(eqId);
            toast.showToast('Removido', 'success');
            onChanged?.();
            onClose();
        } catch (err: any) { toast.showToast(err.message, 'error'); }
    };

    if (!eq) return null;
    const tv = tipoVisual(eq.tipo);
    const Ic = tv.icon;

    return (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-20 pb-4 px-4 overflow-y-auto" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-gradient-to-r from-rose-50 to-pink-50 dark:from-rose-900/20 dark:to-pink-900/20">
                    <div className="flex items-center gap-2">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${tv.cor}`}><Ic className="w-3 h-3" /> {tv.l}</span>
                        <h3 className="font-bold">{eq.modelo || tv.l} {eq.patrimonio && <span className="text-slate-500 font-normal">· {eq.patrimonio}</span>}</h3>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-4 text-xs">
                    {!edit ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <Field label="Tipo" value={tv.l} />
                            <Field label="Status" value={STATUS_LABELS[eq.status]} />
                            {eq.modelo && <Field label="Modelo" value={eq.modelo} />}
                            {eq.marca && <Field label="Marca" value={eq.marca} />}
                            {eq.patrimonio && <Field label="Patrimônio" value={eq.patrimonio} mono />}
                            {eq.serial_number && <Field label="Serial" value={eq.serial_number} mono />}
                            {eq.numero_linha && <Field label="Número / Linha" value={eq.numero_linha} mono />}
                            {eq.ramal && <Field label="Ramal" value={eq.ramal} mono />}
                            {eq.ip && <Field label="IP" value={eq.ip} mono />}
                            {eq.nome_estacao && <Field label="Nome da estação" value={eq.nome_estacao} />}
                            {eq.setor && <Field label="Setor" value={eq.setor} />}
                            {eq.localizacao && <Field label="Localização" value={eq.localizacao} />}
                            {(eq.colaborador_nome || eq.usuario_nome) && <Field label="Com quem" value={eq.colaborador_nome || eq.usuario_nome} />}
                            {eq.data_atribuicao && <Field label="Atribuído em" value={fmtDate(eq.data_atribuicao)} />}
                            {eq.data_devolucao && <Field label="Devolvido em" value={fmtDate(eq.data_devolucao)} />}
                            {eq.data_aquisicao && <Field label="Aquisição" value={fmtDate(eq.data_aquisicao)} />}
                            {eq.valor != null && <Field label="Valor" value={fmtMoney(eq.valor)} />}
                            {eq.nota_fiscal && <Field label="Nota fiscal" value={eq.nota_fiscal} />}
                            {eq.descricao && <div className="col-span-2"><Field label="Descrição" value={eq.descricao} /></div>}
                            {eq.observacoes && <div className="col-span-2"><Field label="Observações" value={eq.observacoes} /></div>}
                            {/* Atributos específicos do tipo (apenas preenchidos) */}
                            {(() => {
                                const ats = Object.entries(eq.atributos || {}).filter(([, v]) =>
                                    v !== null && v !== '' && !(typeof v === 'object' && v !== null && Object.keys(v as any).length === 0));
                                return ats.length > 0 ? (
                                    <div className="col-span-2 mt-1">
                                        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Detalhes técnicos</p>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                                            {ats.map(([k, v]) => (
                                                <Field key={k} label={k.replace(/_/g, ' ')} value={typeof v === 'object' && v !== null ? JSON.stringify(v) : (v as any)} />
                                            ))}
                                        </div>
                                    </div>
                                ) : null;
                            })()}
                            {/* Credenciais sensíveis */}
                            {eq.tem_credenciais && (
                                <div className="col-span-2 mt-1 p-2 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800">
                                    <div className="flex items-center justify-between">
                                        <p className="text-[10px] uppercase tracking-wider text-amber-700 dark:text-amber-300 font-bold inline-flex items-center gap-1"><Key className="w-3 h-3" /> Credenciais</p>
                                        {!cred && <button onClick={revelarCred} disabled={credLoading} className="text-[11px] font-bold text-amber-700 dark:text-amber-300 hover:underline">{credLoading ? 'Revelando…' : '🔓 Revelar'}</button>}
                                    </div>
                                    {cred ? (
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 mt-1">
                                            {Object.entries(cred).map(([k, v]) => <Field key={k} label={k.replace(/_/g, ' ')} value={v as any} mono />)}
                                        </div>
                                    ) : <p className="text-[11px] text-amber-700/70 dark:text-amber-300/70 mt-0.5">••••••••  (clique em Revelar — ação auditada)</p>}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="space-y-2">
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                <S label="Tipo *" value={form.tipo || ''} onChange={(v) => setForm({ ...form, tipo: v })} options={TIPOS.map(t => ({ v: t.v, l: t.l }))} />
                                <S label="Status" value={form.status || 'estoque'} onChange={(v) => setForm({ ...form, status: v })} options={Object.entries(STATUS_LABELS).map(([v, l]) => ({ v, l }))} />
                                <I label="Modelo" value={form.modelo || ''} onChange={(v) => setForm({ ...form, modelo: v })} />
                                <I label="Marca" value={form.marca || ''} onChange={(v) => setForm({ ...form, marca: v })} />
                                <I label="Patrimônio" value={form.patrimonio || ''} onChange={(v) => setForm({ ...form, patrimonio: v })} />
                                <I label="Serial Number" value={form.serial_number || ''} onChange={(v) => setForm({ ...form, serial_number: v })} />
                                <I label="Localização" value={form.localizacao || ''} onChange={(v) => setForm({ ...form, localizacao: v })} placeholder="Sala 3, Mesa 2 ou Depósito A" />
                                <label className="block">
                                    <span className="text-[10px] text-slate-500 font-semibold">Atribuído a</span>
                                    <select value={form.colaborador_id || ''} onChange={(e) => setForm({ ...form, colaborador_id: e.target.value ? parseInt(e.target.value, 10) : null })}
                                        className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs">
                                        <option value="">— Em estoque —</option>
                                        {colabs.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                                    </select>
                                </label>
                                <I label="Aquisição" type="date" value={form.data_aquisicao || ''} onChange={(v) => setForm({ ...form, data_aquisicao: v })} />
                                <I label="Valor" type="number" step="0.01" value={form.valor ?? ''} onChange={(v) => setForm({ ...form, valor: v === '' ? null : parseFloat(v) })} />
                                <I label="Nota fiscal" value={form.nota_fiscal || ''} onChange={(v) => setForm({ ...form, nota_fiscal: v })} />
                                <I label="Data atribuição" type="date" value={form.data_atribuicao || ''} onChange={(v) => setForm({ ...form, data_atribuicao: v })} />
                                <S label="Setor" value={form.setor || ''} onChange={(v) => setForm({ ...form, setor: v })}
                                    options={[{ v: '', l: '— Selecione —' }, ...setores.map((s) => ({ v: s, l: s })), ...(form.setor && !setores.includes(form.setor) ? [{ v: form.setor, l: `${form.setor} (atual)` }] : [])]} />
                                <I label="Usuário (com quem)" value={form.usuario_nome || ''} onChange={(v) => setForm({ ...form, usuario_nome: v })} placeholder="Nome do responsável" />
                                <I label="Número / Linha" value={form.numero_linha || ''} onChange={(v) => setForm({ ...form, numero_linha: v })} />
                                <I label="Ramal" value={form.ramal || ''} onChange={(v) => setForm({ ...form, ramal: v })} />
                                <I label="IP" value={form.ip || ''} onChange={(v) => setForm({ ...form, ip: v })} />
                                <I label="Nome da estação" value={form.nome_estacao || ''} onChange={(v) => setForm({ ...form, nome_estacao: v })} />
                            </div>
                            <label className="block">
                                <span className="text-[10px] text-slate-500 font-semibold">Descrição</span>
                                <textarea value={form.descricao || ''} onChange={(e) => setForm({ ...form, descricao: e.target.value })} rows={2}
                                    className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
                            </label>
                            <label className="block">
                                <span className="text-[10px] text-slate-500 font-semibold">Observações</span>
                                <textarea value={form.observacoes || ''} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} rows={2}
                                    className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
                            </label>
                            <AtributosEditor value={form.atributos || {}} onChange={(v) => setForm({ ...form, atributos: v })} />
                        </div>
                    )}

                    {/* Histórico */}
                    <div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-2 inline-flex items-center gap-1"><History className="w-3 h-3" /> Histórico de uso</p>
                        {historico.length === 0 ? <p className="text-slate-400 italic">Sem eventos registrados.</p> : (
                            <ul className="space-y-1.5">
                                {historico.map((h: any) => (
                                    <li key={h.id} className="flex items-start gap-2 text-[11px]">
                                        <span className="font-mono text-slate-400">{fmtDateTime(h.data)}</span>
                                        <span className="font-bold">{ACAO_LABEL[h.acao] || h.acao}</span>
                                        {h.colaborador_nome && <span className="text-slate-600 dark:text-slate-300">{h.colaborador_nome}</span>}
                                        {h.observacoes && <span className="text-slate-400 italic">— {h.observacoes}</span>}
                                    </li>
                                ))}
                            </ul>
                        )}
                    </div>
                </div>
                <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-between gap-2">
                    <button onClick={remover} className="text-red-600 text-xs font-bold inline-flex items-center gap-1 hover:bg-red-50 px-2 py-1 rounded"><Trash2 className="w-3.5 h-3.5" /> Excluir</button>
                    <div className="flex gap-2">
                        {!edit && eq.status === 'ativo' && (
                            <button onClick={devolver} className="px-3 py-1.5 text-xs font-bold bg-amber-500 hover:bg-amber-600 text-white rounded-lg inline-flex items-center gap-1">
                                <ArrowLeft className="w-3.5 h-3.5" /> Devolver ao estoque
                            </button>
                        )}
                        {!edit ? (
                            <button onClick={() => setEdit(true)} className="px-3 py-1.5 text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white rounded-lg inline-flex items-center gap-1">
                                <Pencil className="w-3.5 h-3.5" /> Editar
                            </button>
                        ) : (
                            <>
                                <button onClick={() => { setEdit(false); setForm(eq); }} disabled={salvando} className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
                                <button onClick={salvar} disabled={salvando} className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg disabled:opacity-50">
                                    <Save className="w-3.5 h-3.5" /> {salvando ? '…' : 'Salvar'}
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

// ============ DETALHE DO COLABORADOR (usado em "Por Colaborador") ============

const DetalheColabModal: React.FC<{ cid: number; onClose: () => void; onClickEq: (id: number) => void }> = ({ cid, onClose, onClickEq }) => {
    const toast = useToast();
    const [info, setInfo] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [tab, setTab] = useState<'equip' | 'acessos' | 'admissao' | 'desligamento'>('equip');

    useEffect(() => {
        setLoading(true);
        api.rhEquipamentosColabDetalhe(cid)
            .then(setInfo)
            .catch((e) => toast.showToast(e.message, 'error'))
            .finally(() => setLoading(false));
    }, [cid]);

    return (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-20 pb-4 px-4 overflow-y-auto" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between bg-gradient-to-r from-rose-50 to-pink-50 dark:from-rose-900/20 dark:to-pink-900/20">
                    <button onClick={onClose} className="inline-flex items-center gap-1 text-xs text-slate-600 hover:text-rose-600"><ArrowLeft className="w-3.5 h-3.5" /> Voltar</button>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
                </div>
                {loading || !info ? (<div className="p-10 text-center text-slate-500 text-sm">Carregando…</div>) : (
                    <>
                        <div className="px-4 py-3 flex items-center gap-3 border-b border-slate-200 dark:border-slate-700">
                            <div className="w-14 h-14 rounded-full overflow-hidden bg-gradient-to-br from-rose-400 to-pink-500 text-white text-lg font-bold flex items-center justify-center flex-shrink-0">
                                {info.colaborador.foto_url ? <img src={info.colaborador.foto_url} alt={info.colaborador.nome} className="w-full h-full object-cover" /> :
                                    (info.colaborador.nome || '?').split(' ').slice(0, 2).map((s: string) => s[0]).join('').toUpperCase()}
                            </div>
                            <div className="flex-1">
                                <p className="font-black text-lg">{info.colaborador.nome}</p>
                                <p className="text-xs text-slate-500">{info.colaborador.cargo || '—'} {info.colaborador.setor && <>· {info.colaborador.setor}</>}</p>
                            </div>
                            {info.colaborador.status === 'demitido' && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[10px] font-bold">DESLIGADO</span>}
                        </div>
                        <div className="border-b border-slate-200 dark:border-slate-700 flex text-xs">
                            {([
                                { k: 'equip', l: `Equipamentos (${info.equipamentos.length})`, icon: Package },
                                { k: 'acessos', l: 'Acessos / Sistemas', icon: Key },
                                { k: 'admissao', l: 'Admissão', icon: UserPlus },
                                { k: 'desligamento', l: 'Desligamento', icon: UserMinus },
                            ] as any[]).map((t) => {
                                const Ic = t.icon;
                                const active = tab === t.k;
                                return (
                                    <button key={t.k} onClick={() => setTab(t.k)}
                                        className={`px-3 py-2 inline-flex items-center gap-1.5 border-b-2 transition ${active ? 'border-rose-600 text-rose-600 font-bold' : 'border-transparent text-slate-500'}`}>
                                        <Ic className="w-3.5 h-3.5" /> {t.l}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 text-xs">
                            {tab === 'equip' && (
                                info.equipamentos.length === 0 ? <p className="text-slate-400 italic">Nenhum equipamento.</p> :
                                <div className="space-y-2">
                                    {info.equipamentos.map((e: any) => {
                                        const tv = tipoVisual(e.tipo);
                                        const Ic = tv.icon;
                                        return (
                                            <button key={e.id} onClick={() => onClickEq(e.id)}
                                                className="w-full bg-slate-50 dark:bg-slate-900/40 rounded-lg p-3 border hover:border-rose-300 text-left">
                                                <div className="flex items-center gap-2">
                                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${tv.cor}`}><Ic className="w-3 h-3" /> {tv.l}</span>
                                                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${STATUS_COR[e.status]}`}>{STATUS_LABELS[e.status]}</span>
                                                </div>
                                                <p className="font-bold text-sm mt-1">{e.modelo}</p>
                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 text-[11px] mt-1">
                                                    <div><strong>Patrimônio:</strong> {e.patrimonio || '—'}</div>
                                                    <div><strong>Localização:</strong> {e.localizacao || '—'}</div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                            {tab === 'acessos' && <AcessosTab info={info} cid={cid} onChange={() => { /* refresh */ }} />}
                            {tab === 'admissao' && (info.admissao ? (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    <Field label="Cargo" value={info.admissao.cargo} />
                                    <Field label="Setor" value={info.admissao.setor} />
                                    <Field label="Motivo" value={info.admissao.motivo} />
                                    <Field label="Urgência" value={info.admissao.urgencia} />
                                    <Field label="Data prevista" value={fmtDate(info.admissao.data_prevista)} />
                                    <Field label="Status" value={info.admissao.status} />
                                </div>
                            ) : <p className="text-slate-400 italic">Sem movimentação de admissão.</p>)}
                            {tab === 'desligamento' && (info.desligamento ? (
                                <div className="space-y-2">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <Field label="Motivo" value={info.desligamento.motivo} />
                                        <Field label="Data prevista" value={fmtDate(info.desligamento.data_prevista)} />
                                        <Field label="Status" value={info.desligamento.status} />
                                    </div>
                                    <Bloco titulo="Bloqueios" items={info.desligamento.dados?.bloqueios} />
                                    <Bloco titulo="Devoluções" items={info.desligamento.dados?.devolucao_equipamentos} />
                                </div>
                            ) : <p className="text-slate-400 italic">Sem desligamento registrado.</p>)}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

// ============ NOVO EQUIPAMENTO ============

const NovoEquipamentoModal: React.FC<{ onClose: () => void; onSaved: () => void }> = ({ onClose, onSaved }) => {
    const toast = useToast();
    const [colabs, setColabs] = useState<any[]>([]);
    const [setores, setSetores] = useState<string[]>([]);
    const [tiposExistentes, setTiposExistentes] = useState<string[]>([]);
    const [form, setForm] = useState<any>({ tipo: 'notebook', status: 'estoque' });
    const [salvando, setSalvando] = useState(false);
    useEffect(() => {
        api.rhColaboradoresListar().then((r) => setColabs(r.colaboradores || [])).catch(() => {});
        api.rhEquipamentosTipos().then((r) => setTiposExistentes(r.tipos || [])).catch(() => {});
        api.getSectors().then((d) => setSetores((d || []).filter((s: any) => s.is_active).map((s: any) => s.name))).catch(() => {});
    }, []);
    const sugestoesTipo = Array.from(new Set([...TIPOS.map(t => t.v), ...tiposExistentes])).sort();
    const salvar = async () => {
        if (!form.tipo) { toast.showToast('Tipo obrigatório', 'error'); return; }
        setSalvando(true);
        try {
            const payload: any = {};
            ['tipo', 'modelo', 'marca', 'patrimonio', 'serial_number', 'status', 'colaborador_id',
                'localizacao', 'descricao', 'setor', 'usuario_nome', 'numero_linha', 'ramal', 'ip', 'nome_estacao',
                'data_aquisicao', 'valor', 'nota_fiscal', 'data_atribuicao', 'observacoes'].forEach((k) => {
                    payload[k] = form[k] === '' ? null : form[k];
                });
            payload.atributos = form.atributos || {};
            await api.rhEquipamentoCriar(payload);
            toast.showToast('Equipamento criado', 'success');
            onSaved();
        } catch (e: any) { toast.showToast(e.message, 'error'); }
        finally { setSalvando(false); }
    };
    return (
        <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 pt-20 pb-4 px-4 overflow-y-auto" onClick={() => !salvando && onClose()}>
            <div className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                    <h3 className="font-bold">Novo equipamento</h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700"><X className="w-4 h-4" /></button>
                </div>
                <div className="p-4 space-y-2 text-xs">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label className="block">
                            <span className="text-[10px] text-slate-500 font-semibold">Tipo * <span className="text-slate-400">(escolha ou digite um novo)</span></span>
                            <input list="tipos-equip" value={form.tipo || ''} onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                                className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
                            <datalist id="tipos-equip">
                                {sugestoesTipo.map(t => <option key={t} value={t} />)}
                            </datalist>
                        </label>
                        <S label="Status" value={form.status || 'estoque'} onChange={(v) => setForm({ ...form, status: v })} options={Object.entries(STATUS_LABELS).map(([v, l]) => ({ v, l }))} />
                        <I label="Modelo" value={form.modelo || ''} onChange={(v) => setForm({ ...form, modelo: v })} />
                        <I label="Marca" value={form.marca || ''} onChange={(v) => setForm({ ...form, marca: v })} />
                        <I label="Patrimônio" value={form.patrimonio || ''} onChange={(v) => setForm({ ...form, patrimonio: v })} />
                        <I label="Serial Number" value={form.serial_number || ''} onChange={(v) => setForm({ ...form, serial_number: v })} />
                        <I label="Localização" value={form.localizacao || ''} onChange={(v) => setForm({ ...form, localizacao: v })} placeholder="Sala 3 / Depósito A" />
                        <label className="block">
                            <span className="text-[10px] text-slate-500 font-semibold">Atribuir a</span>
                            <select value={form.colaborador_id || ''} onChange={(e) => setForm({ ...form, colaborador_id: e.target.value ? parseInt(e.target.value, 10) : null })}
                                className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs">
                                <option value="">— Em estoque —</option>
                                {colabs.map(c => <option key={c.id} value={c.id}>{c.nome}</option>)}
                            </select>
                        </label>
                        <I label="Data de aquisição" type="date" value={form.data_aquisicao || ''} onChange={(v) => setForm({ ...form, data_aquisicao: v })} />
                        <I label="Valor (R$)" type="number" step="0.01" value={form.valor ?? ''} onChange={(v) => setForm({ ...form, valor: v === '' ? null : parseFloat(v) })} />
                        <I label="Nota fiscal" value={form.nota_fiscal || ''} onChange={(v) => setForm({ ...form, nota_fiscal: v })} />
                        <S label="Setor" value={form.setor || ''} onChange={(v) => setForm({ ...form, setor: v })}
                            options={[{ v: '', l: '— Selecione —' }, ...setores.map((s) => ({ v: s, l: s })), ...(form.setor && !setores.includes(form.setor) ? [{ v: form.setor, l: `${form.setor} (atual)` }] : [])]} />
                        <I label="Usuário (com quem)" value={form.usuario_nome || ''} onChange={(v) => setForm({ ...form, usuario_nome: v })} placeholder="Nome do responsável" />
                        <I label="Número / Linha" value={form.numero_linha || ''} onChange={(v) => setForm({ ...form, numero_linha: v })} />
                        <I label="Ramal" value={form.ramal || ''} onChange={(v) => setForm({ ...form, ramal: v })} />
                        <I label="IP" value={form.ip || ''} onChange={(v) => setForm({ ...form, ip: v })} />
                        <I label="Nome da estação" value={form.nome_estacao || ''} onChange={(v) => setForm({ ...form, nome_estacao: v })} />
                    </div>
                    <AtributosEditor value={form.atributos || {}} onChange={(v) => setForm({ ...form, atributos: v })} />
                    <label className="block">
                        <span className="text-[10px] text-slate-500 font-semibold">Descrição (configuração detalhada)</span>
                        <textarea value={form.descricao || ''} onChange={(e) => setForm({ ...form, descricao: e.target.value })} rows={2}
                            placeholder="Ex: Intel i5 12ª, 16GB RAM, 512GB SSD"
                            className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
                    </label>
                    <label className="block">
                        <span className="text-[10px] text-slate-500 font-semibold">Observações</span>
                        <textarea value={form.observacoes || ''} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} rows={2}
                            className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
                    </label>
                </div>
                <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-700 flex justify-end gap-2">
                    <button onClick={onClose} disabled={salvando} className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
                    <button onClick={salvar} disabled={salvando} className="inline-flex items-center gap-1 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold rounded-lg disabled:opacity-50">
                        <Save className="w-3.5 h-3.5" /> {salvando ? '…' : 'Salvar'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const SISTEMAS_SUGESTOES = ['4Bis', 'Chatwoot', 'StarSoft', 'Krayin (CRM)', 'WAHA (WhatsApp)', 'BigQuery', 'Looker Studio', 'Conta Azul', 'WMS', 'PCP', 'AutoCAD', 'SolidWorks'];
const MODULOS_SUGESTOES = ['Dashboard', 'Chamados (T.I)', 'Plano de Ação', 'Importação V2', 'Financeiro · DRE', 'SAC', 'Metas de Faturamento', 'S&OP Dashboard', 'Otimizador de Produção', 'RH / DP'];
const ACESSOS_SUGESTOES = ['Email @blackd.com.br', 'Office 365', 'Google Workspace', 'VPN', 'Acesso remoto/RDP', 'CFTV', 'Controle de ponto'];

const AcessosTab: React.FC<{ info: any; cid: number; onChange: () => void }> = ({ info, cid }) => {
    const toast = useToast();
    const [edit, setEdit] = useState(false);
    const [extras, setExtras] = useState<any>(info.colaborador.acessos_extras || {});
    const [salvando, setSalvando] = useState(false);

    useEffect(() => { setExtras(info.colaborador.acessos_extras || {}); }, [info]);

    const adm = info.admissao?.dados || {};

    // Merge: prioriza extras como fonte de verdade, mas mostra os da admissão pra referência
    const merge = (a: string[] = [], b: string[] = []) => Array.from(new Set([...(a || []), ...(b || [])]));
    const modulos = merge(adm.modulos_portal, extras.modulos_portal);
    const sistemas = merge(adm.sistemas_externos, extras.sistemas_externos);
    const pastas = merge(adm.pastas_rede, extras.pastas_rede);
    const acessosG = merge(adm.acessos, extras.acessos);
    const permissoes = merge(adm.permissoes, extras.permissoes);
    const fisicos = merge(adm.fisicos, extras.fisicos);

    const toggleArr = (key: string, val: string) => {
        const arr: string[] = extras[key] || [];
        const novo = arr.includes(val) ? arr.filter((x: string) => x !== val) : [...arr, val];
        setExtras({ ...extras, [key]: novo });
    };

    const salvar = async () => {
        setSalvando(true);
        try {
            await api.rhColaboradorAtualizarAcessos(cid, extras);
            toast.showToast('Acessos atualizados', 'success');
            setEdit(false);
        } catch (e: any) { toast.showToast(e.message, 'error'); }
        finally { setSalvando(false); }
    };

    if (!edit) {
        return (
            <div className="space-y-2">
                <div className="flex justify-end">
                    <button onClick={() => setEdit(true)} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-600 text-white text-xs font-bold hover:bg-rose-700">
                        <Edit3 className="w-3.5 h-3.5" /> Editar acessos
                    </button>
                </div>
                {modulos.length === 0 && sistemas.length === 0 && pastas.length === 0 && acessosG.length === 0 && permissoes.length === 0 && fisicos.length === 0 && (
                    <p className="text-slate-400 italic">Nenhum acesso cadastrado ainda. Clique em "Editar acessos" para começar.</p>
                )}
                <Bloco titulo="Módulos do portal" items={modulos} />
                <Bloco titulo="Sistemas externos" items={sistemas} />
                <Bloco titulo="Pastas de rede" items={pastas} mono />
                <Bloco titulo="Acessos genéricos" items={acessosG} />
                <Bloco titulo="Permissões especiais" items={permissoes} />
                <Bloco titulo="Acessos físicos" items={fisicos} />
                {extras.observacoes && (
                    <div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Observações</p>
                        <p className="text-[11px] bg-slate-50 dark:bg-slate-900/40 rounded p-2 whitespace-pre-wrap">{extras.observacoes}</p>
                    </div>
                )}
                {adm.ti_equipamentos && Object.keys(adm.ti_equipamentos).length > 0 && (
                    <div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Detalhes TI da admissão (somente leitura)</p>
                        <div className="bg-slate-50 dark:bg-slate-900/40 rounded p-2 grid grid-cols-2 gap-1 text-[11px]">
                            {Object.entries(adm.ti_equipamentos).map(([k, v]) => v ? (
                                <div key={k}><strong className="text-slate-500">{k.replace(/_/g, ' ')}:</strong> {String(v)}</div>
                            ) : null)}
                        </div>
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-3">
            <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 p-2 text-[11px] text-blue-700 dark:text-blue-200">
                ℹ️ Edição independente da admissão. Os itens da admissão continuam aparecendo, mas você pode adicionar/remover livremente.
            </div>
            <Editavel titulo="Módulos do portal" sugestoes={MODULOS_SUGESTOES} selecionadas={extras.modulos_portal || []} onToggle={(v) => toggleArr('modulos_portal', v)} />
            <Editavel titulo="Sistemas externos" sugestoes={SISTEMAS_SUGESTOES} selecionadas={extras.sistemas_externos || []} onToggle={(v) => toggleArr('sistemas_externos', v)} />
            <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Pastas de rede (uma por linha)</p>
                <textarea
                    value={(extras.pastas_rede || []).join('\n')}
                    onChange={(e) => setExtras({ ...extras, pastas_rede: e.target.value.split('\n').map((s: string) => s.trim()).filter(Boolean) })}
                    rows={3} placeholder={"\\\\servidor\\Financeiro\n\\\\servidor\\Comercial"}
                    className="w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs font-mono"
                />
            </div>
            <Editavel titulo="Acessos genéricos" sugestoes={ACESSOS_SUGESTOES} selecionadas={extras.acessos || []} onToggle={(v) => toggleArr('acessos', v)} />
            <Editavel titulo="Permissões especiais" sugestoes={['Acesso administrativo a plataforma', 'Acesso a dados sensíveis', 'Aprovação de despesas', 'Assinatura em documentos legais']} selecionadas={extras.permissoes || []} onToggle={(v) => toggleArr('permissoes', v)} />
            <Editavel titulo="Acessos físicos" sugestoes={['Crachá / Cartão de proximidade', 'Sala/área restrita', 'Vaga de estacionamento', 'Chave de armário']} selecionadas={extras.fisicos || []} onToggle={(v) => toggleArr('fisicos', v)} />
            <div>
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">Observações</p>
                <textarea value={extras.observacoes || ''} onChange={(e) => setExtras({ ...extras, observacoes: e.target.value })}
                    rows={2} className="w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => { setEdit(false); setExtras(info.colaborador.acessos_extras || {}); }} className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg">Cancelar</button>
                <button onClick={salvar} disabled={salvando} className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-lg disabled:opacity-50">
                    <Save className="w-3.5 h-3.5" /> {salvando ? '…' : 'Salvar acessos'}
                </button>
            </div>
        </div>
    );
};

const Editavel: React.FC<{ titulo: string; sugestoes: string[]; selecionadas: string[]; onToggle: (v: string) => void }> = ({ titulo, sugestoes, selecionadas, onToggle }) => {
    const [novo, setNovo] = useState('');
    const todos = Array.from(new Set([...sugestoes, ...selecionadas])).sort();
    return (
        <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">{titulo}</p>
            <div className="flex flex-wrap gap-1 mb-1.5">
                {todos.map((o) => {
                    const sel = selecionadas.includes(o);
                    return (
                        <button key={o} type="button" onClick={() => onToggle(o)}
                            className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border ${sel ? 'bg-rose-600 text-white border-rose-600' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-300 hover:border-rose-400'}`}>
                            {sel ? '✓ ' : ''}{o}
                        </button>
                    );
                })}
            </div>
            <div className="flex gap-1">
                <input value={novo} onChange={(e) => setNovo(e.target.value)} placeholder="Adicionar item personalizado…"
                    onKeyDown={(e) => { if (e.key === 'Enter' && novo.trim()) { onToggle(novo.trim()); setNovo(''); e.preventDefault(); } }}
                    className="flex-1 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded text-[11px] bg-white dark:bg-slate-900" />
                <button type="button" onClick={() => { if (novo.trim()) { onToggle(novo.trim()); setNovo(''); } }}
                    className="px-2 py-1 bg-slate-200 dark:bg-slate-700 text-xs rounded hover:bg-slate-300">+</button>
            </div>
        </div>
    );
};

const Bloco: React.FC<{ titulo: string; items?: string[]; mono?: boolean }> = ({ titulo, items, mono }) => {
    if (!items || items.length === 0) return null;
    return (
        <div>
            <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold mb-1">{titulo}</p>
            <div className={`bg-slate-50 dark:bg-slate-900/40 rounded p-2 ${mono ? 'font-mono text-[10px]' : 'text-[11px]'}`}>{items.join(', ')}</div>
        </div>
    );
};
const Field: React.FC<{ label: string; value: any; mono?: boolean }> = ({ label, value, mono }) => (
    <div className="flex flex-col">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">{label}</span>
        <span className={`text-slate-800 dark:text-slate-100 font-semibold ${mono ? 'font-mono' : ''}`}>{value || '—'}</span>
    </div>
);
const I: React.FC<{ label: string; value: any; onChange: (v: string) => void; type?: string; step?: string; placeholder?: string }> = ({ label, value, onChange, type = 'text', step, placeholder }) => (
    <label className="block">
        <span className="text-[10px] text-slate-500 font-semibold">{label}</span>
        <input type={type} step={step} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)}
            className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs" />
    </label>
);
const S: React.FC<{ label: string; value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }> = ({ label, value, onChange, options }) => (
    <label className="block">
        <span className="text-[10px] text-slate-500 font-semibold">{label}</span>
        <select value={value} onChange={(e) => onChange(e.target.value)}
            className="mt-0.5 w-full px-2 py-1.5 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 text-xs">
            {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
        </select>
    </label>
);

export default EquipamentosPage;
