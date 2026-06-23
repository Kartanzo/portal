import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../../app_api';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { RefreshCw, Plus, Trash2, Calculator, Search, Info, Save, FolderOpen, X, GitCompare } from 'lucide-react';

interface Cambio {
    rate: number;
    fetched_at: string;
    source: string;
    auto_refreshed?: boolean;
    auto_refresh_error?: string;
    yuan_usd?: number | null;
}

interface ItemCatalogo {
    codigo: string;
    descricao: string;
    preco_rmb: number;
    moq: number;
    unit: string;
}

interface ItemSimulado {
    codigo: string;
    descricao: string;
    preco_rmb: number;
    quantidade: number;
}

const MULT_FINAL = 1.45;

const fmtBRL = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtNum = (v: number, d = 2) => v.toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });

const SimuladorImportacao: React.FC = () => {
    const toast = useToast();
    const [cambio, setCambio] = useState<Cambio | null>(null);
    const [cotacaoEdit, setCotacaoEdit] = useState<number>(0);
    const [divisorRmbUsd, setDivisorRmbUsd] = useState<number>(7);
    const [catalogo, setCatalogo] = useState<ItemCatalogo[]>([]);
    const [simulados, setSimulados] = useState<ItemSimulado[]>([]);
    const [busca, setBusca] = useState('');
    const [detalheCodigo, setDetalheCodigo] = useState<string | null>(null);
    const [modalSalvarOpen, setModalSalvarOpen] = useState(false);
    const [nomeSalvar, setNomeSalvar] = useState('');
    const [descSalvar, setDescSalvar] = useState('');
    const [drawerSalvasOpen, setDrawerSalvasOpen] = useState(false);
    const [salvas, setSalvas] = useState<any[]>([]);
    const [carregandoSalvas, setCarregandoSalvas] = useState(false);
    const [compararIds, setCompararIds] = useState<number[]>([]);
    const [comparacao, setComparacao] = useState<any[] | null>(null);

    const carregarSimulacoesSalvas = async () => {
        setCarregandoSalvas(true);
        try {
            const data = await api.simuladorImportacaoListarSimulacoes();
            setSalvas(data || []);
        } catch (e: any) {
            toast.showToast(`Erro: ${e?.message || e}`, 'error');
        } finally {
            setCarregandoSalvas(false);
        }
    };

    const salvarSimulacao = async () => {
        if (!nomeSalvar.trim()) { toast.showToast('Informe um nome', 'error'); return; }
        try {
            await api.simuladorImportacaoSalvarSimulacao({
                nome: nomeSalvar.trim(),
                descricao: descSalvar.trim() || null,
                cotacao_usd_brl: cotacaoEdit,
                divisor_rmb_usd: divisorRmbUsd,
                multiplicador: MULT_FINAL,
                itens: simulados.map(s => ({ codigo: s.codigo, descricao: s.descricao, preco_rmb: s.preco_rmb, quantidade: s.quantidade })),
            });
            toast.showToast('Simulação salva', 'success');
            setModalSalvarOpen(false);
            setNomeSalvar(''); setDescSalvar('');
        } catch (e: any) {
            toast.showToast(`Erro: ${e?.message || e}`, 'error');
        }
    };

    const carregarSimulacao = async (id: number) => {
        try {
            const s = await api.simuladorImportacaoCarregarSimulacao(id);
            setCotacaoEdit(Number(s.cotacao_usd_brl) || 0);
            setDivisorRmbUsd(Number(s.divisor_rmb_usd) || 7);
            setSimulados((s.itens || []).map((it: any) => ({
                codigo: it.codigo, descricao: it.descricao, preco_rmb: Number(it.preco_rmb), quantidade: Number(it.quantidade),
            })));
            setDrawerSalvasOpen(false);
            toast.showToast(`"${s.nome}" carregada`, 'success');
        } catch (e: any) {
            toast.showToast(`Erro: ${e?.message || e}`, 'error');
        }
    };

    const excluirSimulacao = async (id: number, nome: string) => {
        if (!confirm(`Excluir "${nome}"?`)) return;
        try {
            await api.simuladorImportacaoExcluirSimulacao(id);
            setSalvas(s => s.filter(x => x.id !== id));
            setCompararIds(c => c.filter(x => x !== id));
            toast.showToast('Excluída', 'success');
        } catch (e: any) {
            toast.showToast(`Erro: ${e?.message || e}`, 'error');
        }
    };

    const compararSimulacoes = async () => {
        if (compararIds.length < 2) { toast.showToast('Selecione 2 simulações', 'info'); return; }
        try {
            const detalhes = await Promise.all(compararIds.map(id => api.simuladorImportacaoCarregarSimulacao(id)));
            setComparacao(detalhes);
        } catch (e: any) {
            toast.showToast(`Erro: ${e?.message || e}`, 'error');
        }
    };

    const calcSimulacao = (s: any) => {
        const div = Number(s.divisor_rmb_usd) || 7;
        const cot = Number(s.cotacao_usd_brl) || 1;
        const mult = Number(s.multiplicador) || 1.45;
        const linhas = (s.itens || []).map((it: any) => {
            const rmb = Number(it.preco_rmb) * Number(it.quantidade);
            const usd = rmb / div;
            const brl = usd * cot;
            const final = brl * mult;
            return { ...it, totRmb: rmb, totUsd: usd, totBrl: brl, custoFinal: final };
        });
        const totais = linhas.reduce((a: any, l: any) => ({
            rmb: a.rmb + l.totRmb, usd: a.usd + l.totUsd, brl: a.brl + l.totBrl, final: a.final + l.custoFinal,
        }), { rmb: 0, usd: 0, brl: 0, final: 0 });
        return { linhas, totais };
    };
    const [loadingCambio, setLoadingCambio] = useState(false);
    const [loadingItens, setLoadingItens] = useState(false);

    const carregarCambio = async (force = false) => {
        setLoadingCambio(true);
        try {
            const data: Cambio = force
                ? await api.simuladorImportacaoAtualizarCambio()
                : await api.simuladorImportacaoCambio();
            setCambio(data);
            setCotacaoEdit(Number(data.rate) || 0);
            if (force) toast.showToast(`Cotação atualizada: R$ ${fmtNum(data.rate, 4)}`, 'success');
            if (data.auto_refresh_error) toast.showToast(`Falha auto-refresh: ${data.auto_refresh_error}`, 'error');
        } catch (e: any) {
            toast.showToast(`Erro ao buscar cotação: ${e?.message || e}`, 'error');
        } finally {
            setLoadingCambio(false);
        }
    };

    const carregarItens = async () => {
        setLoadingItens(true);
        try {
            const data: ItemCatalogo[] = await api.simuladorImportacaoItens();
            setCatalogo(data || []);
        } catch (e: any) {
            toast.showToast(`Erro ao carregar itens: ${e?.message || e}`, 'error');
        } finally {
            setLoadingItens(false);
        }
    };

    useEffect(() => { carregarCambio(); carregarItens(); }, []);

    const catalogoFiltrado = useMemo(() => {
        if (!busca.trim()) return catalogo.slice(0, 50);
        const q = busca.toLowerCase();
        return catalogo.filter(i =>
            i.codigo.toLowerCase().includes(q) || (i.descricao || '').toLowerCase().includes(q)
        ).slice(0, 80);
    }, [catalogo, busca]);

    const adicionarItem = (it: ItemCatalogo) => {
        if (simulados.find(s => s.codigo === it.codigo)) {
            toast.showToast(`Item ${it.codigo} já adicionado`, 'info');
            return;
        }
        setSimulados(s => [...s, {
            codigo: it.codigo,
            descricao: it.descricao,
            preco_rmb: it.preco_rmb,
            quantidade: Math.max(1, it.moq || 1),
        }]);
    };

    const removerItem = (codigo: string) => setSimulados(s => s.filter(x => x.codigo !== codigo));
    const atualizarQtd = (codigo: string, qtd: number) =>
        setSimulados(s => s.map(x => x.codigo === codigo ? { ...x, quantidade: qtd } : x));
    const atualizarPreco = (codigo: string, preco: number) =>
        setSimulados(s => s.map(x => x.codigo === codigo ? { ...x, preco_rmb: preco } : x));

    const calc = useMemo(() => {
        const divisor = divisorRmbUsd > 0 ? divisorRmbUsd : 7;
        const cot = cotacaoEdit > 0 ? cotacaoEdit : 1;
        const linhas = simulados.map(it => {
            const totRmb = it.preco_rmb * it.quantidade;
            const totUsd = totRmb / divisor;
            const totBrl = totUsd * cot;
            const custoFinal = totBrl * MULT_FINAL;
            return { ...it, totRmb, totUsd, totBrl, custoFinal };
        });
        const totais = linhas.reduce((acc, l) => ({
            qtd: acc.qtd + l.quantidade,
            rmb: acc.rmb + l.totRmb,
            usd: acc.usd + l.totUsd,
            brl: acc.brl + l.totBrl,
            final: acc.final + l.custoFinal,
        }), { qtd: 0, rmb: 0, usd: 0, brl: 0, final: 0 });
        return { linhas, totais };
    }, [simulados, divisorRmbUsd, cotacaoEdit]);

    return (
        <div className="space-y-4">
            {/* Card Cotação */}
            <Card className="p-4">
                <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center">
                            <Calculator className="w-5 h-5 text-white" />
                        </div>
                        <div>
                            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Cotação do dia · USD → BRL</h3>
                            <p className="text-[11px] text-slate-500">
                                {cambio
                                    ? `Última atualização: ${new Date(cambio.fetched_at).toLocaleString('pt-BR')} · fonte: ${cambio.source}`
                                    : 'Carregando...'}
                                {cambio?.auto_refreshed && <span className="ml-2 text-emerald-600">(auto-refresh)</span>}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-end gap-3 flex-wrap">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase" title="Quantos reais vale 1 dólar (R$ por US$ 1). Editável para simular alta/baixa.">Cotação USD→BRL (R$ por US$ 1)</label>
                            <input type="number" step="0.0001" value={cotacaoEdit}
                                onChange={e => setCotacaoEdit(Number(e.target.value) || 0)}
                                className="w-32 mt-1 px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 dark:bg-slate-800 rounded-md tabular-nums font-bold text-emerald-700" />
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase" title="Quantos Yuan (¥) equivalem a 1 dólar. Aproximadamente 7. Editável.">Yuan→USD (¥ por US$ 1)</label>
                            <input type="number" step="0.01" value={divisorRmbUsd}
                                onChange={e => setDivisorRmbUsd(Number(e.target.value) || 0)}
                                className="w-24 mt-1 px-2 py-1.5 text-sm border border-slate-300 dark:border-slate-600 dark:bg-slate-800 rounded-md tabular-nums font-bold text-indigo-700" />
                            {cambio?.yuan_usd != null && (
                                <div className="text-[9px] text-slate-400 mt-0.5 text-center" title="Cotação real USD/CNY agora">
                                    real: ¥{cambio.yuan_usd.toFixed(4)}
                                    {Math.abs(cambio.yuan_usd - divisorRmbUsd) > 0.05 && (
                                        <button onClick={() => setDivisorRmbUsd(Number(cambio.yuan_usd!.toFixed(4)))}
                                            className="ml-1 text-indigo-500 hover:underline">aplicar</button>
                                    )}
                                </div>
                            )}
                        </div>
                        <div>
                            <label className="block text-[10px] font-bold text-slate-500 uppercase" title="Cobre impostos, frete e margem (+45%). Fixo.">Multiplicador final (×1,45)</label>
                            <input type="number" value={MULT_FINAL} disabled
                                className="w-24 mt-1 px-2 py-1.5 text-sm border border-slate-200 bg-slate-100 dark:bg-slate-900 rounded-md tabular-nums text-slate-500" />
                        </div>
                        <Button onClick={() => carregarCambio(true)} disabled={loadingCambio} size="sm">
                            <RefreshCw className={`w-3.5 h-3.5 ${loadingCambio ? 'animate-spin' : ''}`} />
                            <span className="ml-1">Atualizar cotação</span>
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => {
                            if (simulados.length > 0 && !confirm('Restaurar padrão limpa todos os itens da simulação. Continuar?')) return;
                            setCotacaoEdit(Number(cambio?.rate) || 0);
                            setDivisorRmbUsd(7);
                            setSimulados([]);
                            setDetalheCodigo(null);
                        }} title="Limpa itens, volta cotação para a API e divisor para 7">
                            Restaurar padrão
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => setModalSalvarOpen(true)} disabled={simulados.length === 0} title="Salvar esta simulação">
                            <Save className="w-3.5 h-3.5" /><span className="ml-1">Salvar</span>
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => { setDrawerSalvasOpen(true); carregarSimulacoesSalvas(); }} title="Ver histórico de simulações">
                            <FolderOpen className="w-3.5 h-3.5" /><span className="ml-1">Histórico</span>
                        </Button>
                    </div>
                </div>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Catálogo */}
                <Card className="p-4 lg:col-span-1">
                    <h3 className="text-sm font-bold mb-2 text-slate-800 dark:text-slate-100">Catálogo MOQ</h3>
                    <div className="relative mb-2">
                        <Search className="w-3.5 h-3.5 absolute left-2 top-2.5 text-slate-400" />
                        <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar código ou descrição"
                            className="w-full pl-7 pr-2 py-1.5 text-xs border border-slate-300 dark:border-slate-600 dark:bg-slate-800 rounded-md" />
                    </div>
                    <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-700">
                        {loadingItens && <div className="text-xs text-slate-500 p-2">Carregando...</div>}
                        {!loadingItens && catalogoFiltrado.length === 0 && (
                            <div className="text-xs text-slate-500 p-2">Nenhum item com preço RMB cadastrado.</div>
                        )}
                        {catalogoFiltrado.map(it => (
                            <button key={it.codigo} onClick={() => adicionarItem(it)}
                                className="w-full text-left py-1.5 px-1 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 rounded">
                                <div className="flex items-center justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs font-bold text-slate-800 dark:text-slate-100 truncate">{it.codigo}</div>
                                        <div className="text-[10px] text-slate-500 truncate">{it.descricao}</div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-[11px] tabular-nums font-bold text-amber-600">¥ {fmtNum(it.preco_rmb)}</div>
                                        <Plus className="w-3 h-3 text-indigo-500 inline" />
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                </Card>

                {/* Simulação */}
                <Card className="p-4 lg:col-span-2">
                    <h3 className="text-sm font-bold mb-2 text-slate-800 dark:text-slate-100">
                        Simulação ({simulados.length} {simulados.length === 1 ? 'item' : 'itens'})
                    </h3>
                    {simulados.length === 0 ? (
                        <div className="text-xs text-slate-500 py-8 text-center">
                            Selecione itens no catálogo ao lado para começar a simular.
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-[11px]">
                                <thead className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                                    <tr>
                                        <th className="px-2 py-1.5 text-left">Código</th>
                                        <th className="px-2 py-1.5 text-left">Descrição</th>
                                        <th className="px-2 py-1.5 text-right" title="Preço unitário em Yuan/RMB">Preço RMB (¥/un)</th>
                                        <th className="px-2 py-1.5 text-right">Qtd</th>
                                        <th className="px-2 py-1.5 text-right">¥ Total</th>
                                        <th className="px-2 py-1.5 text-right">US$</th>
                                        <th className="px-2 py-1.5 text-right">R$ Bruto</th>
                                        <th className="px-2 py-1.5 text-right">Custo Final</th>
                                        <th className="px-2 py-1.5"></th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 dark:divide-slate-700">
                                    {calc.linhas.map(l => (
                                        <React.Fragment key={l.codigo}>
                                        <tr>
                                            <td className="px-2 py-1.5 font-bold">{l.codigo}</td>
                                            <td className="px-2 py-1.5 text-slate-600 truncate max-w-[180px]">{l.descricao}</td>
                                            <td className="px-2 py-1.5 text-right">
                                                <input type="number" step="0.01" value={l.preco_rmb}
                                                    onChange={e => atualizarPreco(l.codigo, Number(e.target.value) || 0)}
                                                    className="w-20 text-right px-1 py-0.5 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 rounded tabular-nums" />
                                            </td>
                                            <td className="px-2 py-1.5 text-right">
                                                <input type="number" min="1" value={l.quantidade}
                                                    onChange={e => atualizarQtd(l.codigo, Number(e.target.value) || 0)}
                                                    className="w-20 text-right px-1 py-0.5 border border-slate-300 dark:border-slate-600 dark:bg-slate-700 rounded tabular-nums" />
                                            </td>
                                            <td className="px-2 py-1.5 text-right tabular-nums text-amber-600">¥ {fmtNum(l.totRmb)}</td>
                                            <td className="px-2 py-1.5 text-right tabular-nums text-slate-600">US$ {fmtNum(l.totUsd)}</td>
                                            <td className="px-2 py-1.5 text-right tabular-nums">{fmtBRL(l.totBrl)}</td>
                                            <td className="px-2 py-1.5 text-right tabular-nums font-bold text-emerald-700">{fmtBRL(l.custoFinal)}</td>
                                            <td className="px-2 py-1.5 text-center">
                                                <div className="flex items-center justify-center gap-1">
                                                    <button onClick={() => setDetalheCodigo(detalheCodigo === l.codigo ? null : l.codigo)}
                                                        className={`p-1 rounded ${detalheCodigo === l.codigo ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40' : 'text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'}`}
                                                        title="Ver detalhamento do cálculo">
                                                        <Info className="w-3 h-3" />
                                                    </button>
                                                    <button onClick={() => removerItem(l.codigo)} className="text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-900/20 p-1 rounded">
                                                        <Trash2 className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                        {detalheCodigo === l.codigo && (
                                            <tr className="bg-indigo-50/40 dark:bg-indigo-900/10">
                                                <td colSpan={9} className="px-4 py-3">
                                                    <div className="text-[11px] text-slate-700 dark:text-slate-200 space-y-1.5">
                                                        <div className="font-bold text-indigo-700 dark:text-indigo-300 mb-2">Como o custo final de {l.codigo} foi calculado:</div>
                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 font-mono text-[11px]">
                                                            <div><span className="text-slate-500">1)</span> <b>¥ Total</b> = ¥{fmtNum(l.preco_rmb)} × {fmtNum(l.quantidade, 0)} = <span className="text-amber-600 font-bold">¥ {fmtNum(l.totRmb)}</span></div>
                                                            <div><span className="text-slate-500">2)</span> <b>US$ Total</b> = ¥{fmtNum(l.totRmb)} ÷ {divisorRmbUsd} = <span className="text-slate-700 font-bold">US$ {fmtNum(l.totUsd)}</span></div>
                                                            <div><span className="text-slate-500">3)</span> <b>R$ Bruto</b> = US$ {fmtNum(l.totUsd)} × R$ {fmtNum(cotacaoEdit, 4)} = <span className="font-bold">{fmtBRL(l.totBrl)}</span></div>
                                                            <div><span className="text-slate-500">4)</span> <b>Custo Final</b> = {fmtBRL(l.totBrl)} × {MULT_FINAL} = <span className="text-emerald-700 font-bold">{fmtBRL(l.custoFinal)}</span></div>
                                                        </div>
                                                        <div className="text-[10px] text-slate-500 mt-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                                                            <b>Fórmula:</b> (Preço RMB × Qtd) ÷ {divisorRmbUsd} × R$ {fmtNum(cotacaoEdit, 4)} × {MULT_FINAL} ·
                                                            <b className="ml-2">Multiplicador {MULT_FINAL}</b> cobre impostos, frete e margem (+45%)
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                        </React.Fragment>
                                    ))}
                                </tbody>
                                <tfoot className="bg-slate-50 dark:bg-slate-800 font-bold">
                                    <tr>
                                        <td className="px-2 py-2" colSpan={3}>TOTAIS</td>
                                        <td className="px-2 py-2 text-right tabular-nums">{fmtNum(calc.totais.qtd, 0)}</td>
                                        <td className="px-2 py-2 text-right tabular-nums text-amber-700">¥ {fmtNum(calc.totais.rmb)}</td>
                                        <td className="px-2 py-2 text-right tabular-nums text-slate-700">US$ {fmtNum(calc.totais.usd)}</td>
                                        <td className="px-2 py-2 text-right tabular-nums">{fmtBRL(calc.totais.brl)}</td>
                                        <td className="px-2 py-2 text-right tabular-nums text-emerald-700 text-[13px]">{fmtBRL(calc.totais.final)}</td>
                                        <td></td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}
                </Card>
            </div>

            {modalSalvarOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-start justify-center p-4 pt-20" onClick={() => setModalSalvarOpen(false)}>
                    <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl p-5 w-full max-w-md">
                        <h3 className="font-bold text-lg mb-3 flex items-center gap-2"><Save className="w-5 h-5 text-emerald-600"/>Salvar simulação</h3>
                        <label className="block text-xs font-bold text-slate-500 mb-1">Nome *</label>
                        <input autoFocus value={nomeSalvar} onChange={e => setNomeSalvar(e.target.value)}
                            placeholder="Ex: Pedido Maio/26 - cenário base"
                            className="w-full px-3 py-2 mb-3 text-sm border border-slate-300 dark:border-slate-600 dark:bg-slate-900 rounded-lg" />
                        <label className="block text-xs font-bold text-slate-500 mb-1">Descrição (opcional)</label>
                        <textarea value={descSalvar} onChange={e => setDescSalvar(e.target.value)}
                            rows={3} placeholder="Notas sobre este cenário..."
                            className="w-full px-3 py-2 mb-4 text-sm border border-slate-300 dark:border-slate-600 dark:bg-slate-900 rounded-lg resize-none" />
                        <div className="text-[11px] text-slate-500 mb-3 bg-slate-50 dark:bg-slate-900/60 rounded p-2">
                            <b>Snapshot:</b> {simulados.length} {simulados.length === 1 ? 'item' : 'itens'} ·
                            Cotação R$ {fmtNum(cotacaoEdit, 4)} · Yuan→USD {divisorRmbUsd} · Multiplicador {MULT_FINAL}
                        </div>
                        <div className="flex justify-end gap-2">
                            <Button variant="secondary" size="sm" onClick={() => setModalSalvarOpen(false)}>Cancelar</Button>
                            <Button variant="primary" size="sm" onClick={salvarSimulacao} disabled={!nomeSalvar.trim()}>Salvar</Button>
                        </div>
                    </div>
                </div>
            )}

            {drawerSalvasOpen && (
                <div className="fixed inset-0 z-[60]" onClick={() => setDrawerSalvasOpen(false)}>
                    <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
                    <div onClick={(e) => e.stopPropagation()} className="absolute top-20 right-0 bottom-4 w-full max-w-lg bg-white dark:bg-slate-800 shadow-2xl flex flex-col rounded-l-2xl">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                            <div>
                                <h3 className="font-bold text-base flex items-center gap-2"><FolderOpen className="w-4 h-4 text-indigo-600"/>Histórico de simulações</h3>
                                <p className="text-[11px] text-slate-500">Marque 2 para comparar</p>
                            </div>
                            <div className="flex items-center gap-2">
                                <Button variant="primary" size="sm" onClick={compararSimulacoes} disabled={compararIds.length !== 2}>
                                    <GitCompare className="w-3.5 h-3.5"/><span className="ml-1">Comparar ({compararIds.length}/2)</span>
                                </Button>
                                <button onClick={() => setDrawerSalvasOpen(false)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X className="w-4 h-4"/></button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto p-4 space-y-2">
                            {carregandoSalvas && <div className="text-xs text-slate-500">Carregando...</div>}
                            {!carregandoSalvas && salvas.length === 0 && <div className="text-xs text-slate-500 py-8 text-center">Nenhuma simulação salva ainda.</div>}
                            {salvas.map(s => {
                                const selected = compararIds.includes(s.id);
                                return (
                                    <div key={s.id} className={`p-3 border rounded-lg ${selected ? 'border-indigo-500 bg-indigo-50/40 dark:bg-indigo-900/20' : 'border-slate-200 dark:border-slate-700'}`}>
                                        <div className="flex items-start gap-2">
                                            <input type="checkbox" checked={selected} onChange={() => {
                                                setCompararIds(c => selected ? c.filter(x => x !== s.id) : (c.length >= 2 ? [c[1], s.id] : [...c, s.id]));
                                            }} className="mt-1" />
                                            <div className="flex-1 min-w-0">
                                                <div className="font-bold text-sm truncate">{s.nome}</div>
                                                {s.descricao && <div className="text-[11px] text-slate-500 truncate">{s.descricao}</div>}
                                                <div className="text-[10px] text-slate-500 mt-1">
                                                    {new Date(s.created_at).toLocaleString('pt-BR')} · {s.qtd_itens} itens · R$ {fmtNum(s.cotacao_usd_brl, 4)}/US$ · Yuan/USD {s.divisor_rmb_usd}
                                                </div>
                                                <div className="flex gap-2 mt-2">
                                                    <button onClick={() => carregarSimulacao(s.id)} className="text-[11px] text-indigo-600 hover:underline">Carregar</button>
                                                    <button onClick={() => excluirSimulacao(s.id, s.nome)} className="text-[11px] text-rose-600 hover:underline">Excluir</button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {comparacao && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[60] flex items-start justify-center p-4 pt-20" onClick={() => setComparacao(null)}>
                    <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-6xl max-h-[90vh] flex flex-col">
                        <div className="p-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
                            <h3 className="font-bold text-base flex items-center gap-2"><GitCompare className="w-4 h-4 text-indigo-600"/>Comparação de cenários</h3>
                            <button onClick={() => setComparacao(null)} className="p-1 hover:bg-slate-200 dark:hover:bg-slate-700 rounded"><X className="w-4 h-4"/></button>
                        </div>
                        <div className="flex-1 overflow-auto p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                            {comparacao.map((s, i) => {
                                const c = calcSimulacao(s);
                                const other = comparacao[1 - i] ? calcSimulacao(comparacao[1 - i]) : null;
                                const otherByCodigo: Record<string, any> = {};
                                if (other) other.linhas.forEach((l: any) => { otherByCodigo[l.codigo] = l; });
                                const thisByCodigo: Record<string, any> = {};
                                c.linhas.forEach((l: any) => { thisByCodigo[l.codigo] = l; });
                                const diff = other ? c.totais.final - other.totais.final : 0;
                                const pct = other && other.totais.final ? (diff / other.totais.final) * 100 : 0;
                                const exclusivos = other ? other.linhas.filter((l: any) => !thisByCodigo[l.codigo]) : [];
                                return (
                                    <div key={s.id} className="border border-slate-200 dark:border-slate-700 rounded-xl p-4">
                                        <div className="font-bold text-base mb-1">{s.nome}</div>
                                        {s.descricao && <div className="text-[11px] text-slate-500 mb-1">{s.descricao}</div>}
                                        <div className="text-[10px] text-slate-500 mb-3">{new Date(s.created_at).toLocaleString('pt-BR')}</div>
                                        <div className="grid grid-cols-3 gap-2 text-[11px] mb-3 bg-slate-50 dark:bg-slate-900/40 rounded p-2">
                                            <div><div className="text-slate-500">Cotação</div><b>R$ {fmtNum(s.cotacao_usd_brl, 4)}</b></div>
                                            <div><div className="text-slate-500">Yuan/USD</div><b>{s.divisor_rmb_usd}</b></div>
                                            <div><div className="text-slate-500">Multiplic.</div><b>{s.multiplicador}</b></div>
                                        </div>
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-[11px]">
                                                <thead className="bg-slate-100 dark:bg-slate-900/60">
                                                    <tr>
                                                        <th className="px-2 py-1 text-left">Item</th>
                                                        <th className="px-2 py-1 text-right">Qtd</th>
                                                        <th className="px-2 py-1 text-right">Custo Final</th>
                                                        <th className="px-2 py-1 text-right">vs outro</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {c.linhas.map((l: any) => {
                                                        const oLine = otherByCodigo[l.codigo];
                                                        if (!oLine) {
                                                            return (
                                                                <tr key={l.codigo} className="border-t border-slate-100 dark:border-slate-700 bg-amber-50/40 dark:bg-amber-900/10">
                                                                    <td className="px-2 py-1 truncate max-w-[120px]" title={l.codigo}>{l.codigo}</td>
                                                                    <td className="px-2 py-1 text-right tabular-nums">{fmtNum(l.quantidade, 0)}</td>
                                                                    <td className="px-2 py-1 text-right tabular-nums">{fmtBRL(l.custoFinal)}</td>
                                                                    <td className="px-2 py-1 text-right text-amber-700 text-[10px]" title="Item exclusivo deste cenário — não consta no outro">⚠ exclusivo</td>
                                                                </tr>
                                                            );
                                                        }
                                                        const d = l.custoFinal - oLine.custoFinal;
                                                        const p = oLine.custoFinal ? (d / oLine.custoFinal) * 100 : 0;
                                                        const isUp = d > 0;
                                                        const isEq = Math.abs(d) < 0.005;
                                                        return (
                                                            <tr key={l.codigo} className="border-t border-slate-100 dark:border-slate-700">
                                                                <td className="px-2 py-1 truncate max-w-[120px]" title={l.codigo}>{l.codigo}</td>
                                                                <td className="px-2 py-1 text-right tabular-nums">{fmtNum(l.quantidade, 0)}</td>
                                                                <td className="px-2 py-1 text-right tabular-nums">{fmtBRL(l.custoFinal)}</td>
                                                                <td className={`px-2 py-1 text-right tabular-nums text-[10px] font-bold ${isEq ? 'text-slate-400' : isUp ? 'text-rose-600' : 'text-emerald-600'}`}>
                                                                    {isEq ? '=' : `${isUp ? '▲' : '▼'} ${p >= 0 ? '+' : ''}${p.toFixed(1)}%`}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                    {exclusivos.map((l: any) => (
                                                        <tr key={`only-${l.codigo}`} className="border-t border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/30 text-slate-400 italic">
                                                            <td className="px-2 py-1 truncate max-w-[120px]" title={l.codigo}>{l.codigo}</td>
                                                            <td className="px-2 py-1 text-right tabular-nums">—</td>
                                                            <td className="px-2 py-1 text-right tabular-nums">—</td>
                                                            <td className="px-2 py-1 text-right text-[10px]" title={`Item ausente neste cenário — no outro custa ${fmtBRL(l.custoFinal)}`}>○ ausente</td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                                <tfoot>
                                                    <tr className="font-bold bg-slate-50 dark:bg-slate-900/40">
                                                        <td className="px-2 py-2" colSpan={2}>TOTAL</td>
                                                        <td className="px-2 py-2 text-right tabular-nums text-emerald-700">{fmtBRL(c.totais.final)}</td>
                                                        <td></td>
                                                    </tr>
                                                </tfoot>
                                            </table>
                                        </div>
                                        {other && (
                                            <div className={`mt-3 text-[12px] font-bold p-2 rounded ${diff >= 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                                {diff >= 0 ? '▲' : '▼'} {fmtBRL(Math.abs(diff))} ({pct >= 0 ? '+' : ''}{pct.toFixed(1)}%) vs outro cenário
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SimuladorImportacao;
