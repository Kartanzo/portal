import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../app_api';
import { useToast } from '../../contexts/ToastContext';
import { Card } from '../ui/Card';
import { Button } from '../ui/Button';
import { Upload, Plus, Trash2, Save, Search, Calendar, User as UserIcon, Package, FileSpreadsheet, Sparkles, X, Pencil, Download } from 'lucide-react';
import * as XLSX from 'xlsx';

interface MoqRow {
    codigo: string;
    descricao: string | null;
    moq: number;
    unit_ctn: number;
    cbm: number;
    gw: number;
    nw: number;
    comprimento: number;
    largura: number;
    altura: number;
    price: number;
    ncm: string;
    unit: string;
    barcode: string;
    name_cn: string;
    remark: string;
    obs: string;
    observacoes: string;
    english_description: string;
    ctns: number;
    qty: number;
    amount: number;
    cbm_total: number;
    tgw: number;
    tnw: number;
    origem: string;
    updated_at: string | null;
    updated_by: string;
}

const ImportacaoMoq: React.FC<{ user: any }> = ({ user }) => {
    const toast = useToast();
    const [items, setItems] = useState<MoqRow[]>([]);
    const [loading, setLoading] = useState(false);
    const [busca, setBusca] = useState('');
    const fileRef = useRef<HTMLInputElement>(null);

    // edição/criação
    const [editOpen, setEditOpen] = useState(false);
    const [edit, setEdit] = useState<{
        codigo: string; descricao: string; moq: string; novo: boolean;
        unit_ctn: string; cbm: string; gw: string; nw: string;
        comprimento: string; largura: string; altura: string;
        price: string; ncm: string; unit: string;
        barcode: string; name_cn: string; remark: string; obs: string;
        observacoes: string; english_description: string;
        ctns: string; qty: string; amount: string;
        cbm_total: string; tgw: string; tnw: string;
    }>({
        codigo: '', descricao: '', moq: '', novo: true,
        unit_ctn: '', cbm: '', gw: '', nw: '',
        comprimento: '', largura: '', altura: '',
        price: '', ncm: '', unit: '',
        barcode: '', name_cn: '', remark: '', obs: '',
        observacoes: '', english_description: '',
        ctns: '', qty: '', amount: '',
        cbm_total: '', tgw: '', tnw: '',
    });

    const carregar = async () => {
        setLoading(true);
        try {
            const r = await api.importacaoV2ListarMoq();
            setItems(r.items || []);
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao carregar MOQs', 'error');
        } finally { setLoading(false); }
    };

    useEffect(() => { carregar(); }, []);

    const abrirNovo = () => {
        setEdit({
            codigo: '', descricao: '', moq: '', novo: true,
            unit_ctn: '', cbm: '', gw: '', nw: '',
            comprimento: '', largura: '', altura: '',
            price: '', ncm: '', unit: '',
            barcode: '', name_cn: '', remark: '', obs: '',
            observacoes: '', english_description: '',
            ctns: '', qty: '', amount: '',
            cbm_total: '', tgw: '', tnw: '',
        });
        setEditOpen(true);
    };

    const abrirEdicao = (row: MoqRow) => {
        const s = (v: number | null | undefined) => (v && v > 0 ? String(v) : '');
        setEdit({
            codigo: row.codigo, descricao: row.descricao || '', moq: String(row.moq), novo: false,
            unit_ctn: s(row.unit_ctn), cbm: s(row.cbm), gw: s(row.gw), nw: s(row.nw),
            comprimento: s(row.comprimento), largura: s(row.largura), altura: s(row.altura),
            price: s(row.price), ncm: row.ncm || '', unit: row.unit || '',
            barcode: row.barcode || '', name_cn: row.name_cn || '',
            remark: row.remark || '', obs: row.obs || '',
            observacoes: row.observacoes || '',
            english_description: row.english_description || '',
            ctns: s(row.ctns), qty: s(row.qty), amount: s(row.amount),
            cbm_total: s(row.cbm_total), tgw: s(row.tgw), tnw: s(row.tnw),
        });
        setEditOpen(true);
    };

    const salvar = async () => {
        const cod = edit.codigo.trim();
        const moqVal = parseFloat(edit.moq);
        if (!cod) { toast.showToast('Código obrigatório', 'error'); return; }
        if (isNaN(moqVal) || moqVal < 0) { toast.showToast('MOQ deve ser número ≥ 0', 'error'); return; }
        const optNum = (v: string) => { const n = parseFloat(v); return isNaN(n) ? undefined : n; };
        try {
            await api.importacaoV2SalvarMoq(cod, {
                codigo: cod,
                descricao: edit.descricao.trim() || undefined,
                moq: moqVal,
                unit_ctn: optNum(edit.unit_ctn),
                cbm: optNum(edit.cbm),
                gw: optNum(edit.gw),
                nw: optNum(edit.nw),
                comprimento: optNum(edit.comprimento),
                largura: optNum(edit.largura),
                altura: optNum(edit.altura),
                price: optNum(edit.price),
                ncm: edit.ncm.trim() || undefined,
                unit: edit.unit.trim() || undefined,
                barcode: edit.barcode.trim() || undefined,
                name_cn: edit.name_cn.trim() || undefined,
                remark: edit.remark.trim() || undefined,
                obs: edit.obs.trim() || undefined,
                observacoes: edit.observacoes.trim() || undefined,
                english_description: edit.english_description.trim() || undefined,
                ctns: optNum(edit.ctns),
                qty: optNum(edit.qty),
                amount: optNum(edit.amount),
                cbm_total: optNum(edit.cbm_total),
                tgw: optNum(edit.tgw),
                tnw: optNum(edit.tnw),
            } as any);
            toast.showToast('Parâmetros salvos', 'success');
            setEditOpen(false);
            await carregar();
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao salvar', 'error');
        }
    };

    const excluir = async (cod: string) => {
        if (!confirm(`Excluir MOQ do SKU ${cod}?`)) return;
        try {
            await api.importacaoV2ExcluirMoq(cod);
            toast.showToast('MOQ excluído', 'success');
            await carregar();
        } catch (e: any) {
            toast.showToast(e.message || 'Erro ao excluir', 'error');
        }
    };

    const baixarModelo = () => {
        const headers = ['ITEM NO', 'DESCRIPTION', 'MOQ'];
        const exemplos = [
            ['10400001', 'Produto Demo Alfa', 3000],
            ['10400002', 'Produto Demo Beta', 3000],
            ['10400003', 'Produto Demo Gama', 500],
        ];
        const ws = XLSX.utils.aoa_to_sheet([headers, ...exemplos]);
        ws['!cols'] = [{ wch: 14 }, { wch: 38 }, { wch: 10 }];
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'MOQ');
        XLSX.writeFile(wb, 'modelo_parametros_produto.xlsx');
    };

    const uploadArquivo = async (file: File) => {
        try {
            const r = await api.importacaoV2UploadMoq(file);
            toast.showToast(`Upload OK · aba "${r.aba}" · ${r.inseridos} novos, ${r.atualizados} atualizados, ${r.ignorados} ignorados`, 'success');
            await carregar();
        } catch (e: any) {
            toast.showToast(e.message || 'Erro no upload', 'error');
        } finally {
            if (fileRef.current) fileRef.current.value = '';
        }
    };

    const filtrados = useMemo(() => {
        const q = busca.toLowerCase().trim();
        if (!q) return items;
        return items.filter(it => it.codigo.toLowerCase().includes(q) || (it.descricao || '').toLowerCase().includes(q));
    }, [items, busca]);

    return (
        <div className="min-h-screen bg-gradient-to-br from-slate-50 via-indigo-50/30 to-slate-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-950">
            <div className="p-4 sm:p-6 space-y-4 max-w-[1400px] mx-auto">
                <header className="flex items-center justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shadow-lg shadow-amber-500/30">
                            <Package className="w-6 h-6 text-white" />
                        </div>
                        <div>
                            <h1 className="text-2xl font-black bg-gradient-to-r from-amber-600 to-orange-600 dark:from-amber-400 dark:to-orange-400 bg-clip-text text-transparent">
                                Importação · Parâmetros do Produto
                            </h1>
                            <p className="text-xs text-slate-500 mt-0.5">
                                MOQ, medidas, peso e preço — base para os cálculos de container. Suba uma planilha ou edite manualmente.
                            </p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <input
                            ref={fileRef}
                            type="file"
                            accept=".xlsx,.xls,.xlsm"
                            className="hidden"
                            onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadArquivo(f); }}
                        />
                        <Button variant="secondary" size="sm" onClick={baixarModelo} title="Baixar modelo de planilha">
                            <Download className="w-3.5 h-3.5" /><span className="hidden sm:inline ml-1">Baixar modelo</span>
                        </Button>
                        <Button variant="secondary" size="sm" onClick={() => fileRef.current?.click()} title="Subir planilha">
                            <Upload className="w-3.5 h-3.5" /><span className="hidden sm:inline ml-1">Subir planilha</span>
                        </Button>
                        <Button variant="primary" size="sm" onClick={abrirNovo} title="Novo SKU">
                            <Plus className="w-3.5 h-3.5" /><span className="hidden sm:inline ml-1">Novo SKU</span>
                        </Button>
                    </div>
                </header>

                <Card className="border-amber-200 dark:border-amber-900/40 bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-900/10 dark:to-orange-900/10">
                    <div className="flex items-center gap-2 mb-3">
                        <FileSpreadsheet className="w-5 h-5 text-amber-600" />
                        <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">Como deve ser a planilha</h3>
                    </div>

                    <div className="grid md:grid-cols-2 gap-4 text-xs text-slate-700 dark:text-slate-300">
                        {/* Regras */}
                        <div className="space-y-2">
                            <div className="flex items-start gap-2"><span className="inline-block w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">1</span>
                                <span>Arquivo <strong>.xlsx / .xls / .xlsm</strong> com <strong>apenas 1 aba</strong>. O nome da aba não importa.</span></div>
                            <div className="flex items-start gap-2"><span className="inline-block w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">2</span>
                                <span>Os cabeçalhos das colunas devem estar na <strong>linha 1</strong>.</span></div>
                            <div className="flex items-start gap-2"><span className="inline-block w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">3</span>
                                <span>Colunas obrigatórias: <strong>código</strong> do SKU e <strong>MOQ</strong>. Descrição é opcional.</span></div>
                            <div className="flex items-start gap-2"><span className="inline-block w-5 h-5 rounded-full bg-amber-500 text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0">4</span>
                                <span>Linhas sem código ou com MOQ ≤ 0 são <strong>ignoradas</strong>. SKUs já cadastrados são <strong>atualizados</strong>.</span></div>
                        </div>

                        {/* Nomes aceitos para cada coluna */}
                        <div className="space-y-2">
                            <div>
                                <p className="font-bold text-amber-700 dark:text-amber-400 mb-1">📌 Coluna "Código" — aceita qualquer um destes nomes:</p>
                                <div className="flex flex-wrap gap-1">
                                    {['ITEM NO', 'Código', 'Codigo', 'Codigo EMPRESA', 'Cod Produto', 'Cod Prod'].map(n => (
                                        <code key={n} className="px-1.5 py-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-[10px] font-mono">{n}</code>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <p className="font-bold text-amber-700 dark:text-amber-400 mb-1">📌 Coluna "MOQ":</p>
                                <div className="flex flex-wrap gap-1">
                                    {['MOQ', 'Lote Min', 'Lote Minimo', 'Qtd Min', 'Min Order Quantity'].map(n => (
                                        <code key={n} className="px-1.5 py-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-[10px] font-mono">{n}</code>
                                    ))}
                                </div>
                            </div>
                            <div>
                                <p className="font-bold text-amber-700 dark:text-amber-400 mb-1">📌 Coluna "Descrição" (opcional):</p>
                                <div className="flex flex-wrap gap-1">
                                    {['DESCRIPTION', 'Descrição', 'Descricao'].map(n => (
                                        <code key={n} className="px-1.5 py-0.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-[10px] font-mono">{n}</code>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Exemplo visual */}
                    <div className="mt-4">
                        <p className="text-[11px] uppercase tracking-wider text-slate-500 font-bold mb-1.5">Exemplo de planilha correta</p>
                        <div className="bg-white dark:bg-slate-900 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                            <table className="w-full text-[11px]">
                                <thead className="bg-slate-100 dark:bg-slate-800">
                                    <tr>
                                        <th className="px-3 py-1.5 text-left font-bold text-amber-700 dark:text-amber-400">ITEM NO</th>
                                        <th className="px-3 py-1.5 text-left font-bold text-amber-700 dark:text-amber-400">DESCRIPTION</th>
                                        <th className="px-3 py-1.5 text-right font-bold text-amber-700 dark:text-amber-400">MOQ</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr className="border-t border-slate-100 dark:border-slate-800"><td className="px-3 py-1 font-mono">10400001</td><td className="px-3 py-1">Produto Demo Alfa</td><td className="px-3 py-1 text-right tabular-nums">3000</td></tr>
                                    <tr className="border-t border-slate-100 dark:border-slate-800"><td className="px-3 py-1 font-mono">10400002</td><td className="px-3 py-1">Produto Demo Beta</td><td className="px-3 py-1 text-right tabular-nums">3000</td></tr>
                                    <tr className="border-t border-slate-100 dark:border-slate-800"><td className="px-3 py-1 font-mono">10400003</td><td className="px-3 py-1">Produto Demo Gama</td><td className="px-3 py-1 text-right tabular-nums">500</td></tr>
                                </tbody>
                            </table>
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1.5">
                            ℹ️ Nomes de coluna não distinguem maiúsculas/minúsculas, espaços, sublinhados ou barras. <code>MOQ</code>, <code>moq</code>, <code>M O Q</code>, <code>M/O/Q</code> — todos funcionam.
                        </p>
                    </div>
                </Card>

                <div className="flex items-center gap-3 flex-wrap">
                    <div className="relative">
                        <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
                        <input
                            value={busca}
                            onChange={(e) => setBusca(e.target.value)}
                            placeholder="Buscar código ou descrição…"
                            className="pl-8 pr-3 py-1.5 text-xs border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 w-64"
                        />
                    </div>
                    <span className="text-[11px] text-slate-500">
                        <strong>{filtrados.length}</strong> de {items.length} SKUs
                    </span>
                </div>

                {/* MOBILE — cards */}
                <div className="md:hidden space-y-2">
                    {loading && <Card className="text-center py-6 text-slate-400"><Sparkles className="w-6 h-6 mx-auto mb-1 animate-pulse text-indigo-300" />Carregando…</Card>}
                    {!loading && filtrados.length === 0 && (
                        <Card className="text-center py-8 text-slate-400">
                            <Package className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                            <p>Nenhum MOQ cadastrado</p>
                            <p className="text-[11px] mt-1">Use <strong>Subir planilha</strong> ou <strong>Novo SKU</strong></p>
                        </Card>
                    )}
                    {filtrados.map(it => (
                        <Card key={it.codigo} className="border-l-4 border-l-amber-500">
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 min-w-0">
                                    <span className="font-mono font-bold text-amber-700 dark:text-amber-400 text-sm">{it.codigo}</span>
                                    <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 truncate">{it.descricao || '—'}</p>
                                    <div className="flex items-center gap-2 mt-1.5 text-[10px] text-slate-500">
                                        <span className={`px-1.5 py-0.5 rounded-full font-bold ${it.origem === 'upload' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>{it.origem}</span>
                                        <span>{it.updated_by}</span>
                                        <span>{it.updated_at ? new Date(it.updated_at).toLocaleDateString('pt-BR') : '—'}</span>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <div className="text-[10px] uppercase tracking-wider text-slate-400">MOQ</div>
                                    <div className="text-xl font-black text-slate-800 dark:text-slate-100 tabular-nums">{it.moq.toLocaleString('pt-BR')}</div>
                                </div>
                            </div>
                            <div className="flex gap-2 mt-2 pt-2 border-t border-slate-100 dark:border-slate-700">
                                <Button variant="secondary" size="sm" className="flex-1" onClick={() => abrirEdicao(it)}><Pencil className="w-3.5 h-3.5" /> Editar</Button>
                                <Button variant="secondary" size="sm" onClick={() => excluir(it.codigo)} className="text-rose-600"><Trash2 className="w-3.5 h-3.5" /></Button>
                            </div>
                        </Card>
                    ))}
                </div>

                {/* DESKTOP — tabela */}
                <Card noPadding className="hidden md:block overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs">
                            <thead className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30 sticky top-0">
                                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-600 dark:text-slate-300 font-bold whitespace-nowrap">
                                    <th className="px-3 py-3">Código</th>
                                    <th className="px-3 py-3">Descrição</th>
                                    <th className="px-3 py-3 text-right">MOQ</th>
                                    <th className="px-3 py-3 text-right" title="Unidades por caixa">UNIT/CTN</th>
                                    <th className="px-3 py-3 text-right" title="Volume da caixa em m³">CBM</th>
                                    <th className="px-3 py-3 text-right" title="Peso bruto (kg)">G.W</th>
                                    <th className="px-3 py-3 text-right" title="Medidas L×W×H (cm)">L×W×H</th>
                                    <th className="px-3 py-3 text-right" title="Preço unitário">Preço</th>
                                    <th className="px-3 py-3 text-center">Origem</th>
                                    <th className="px-3 py-3 text-right">Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                {loading && (
                                    <tr><td colSpan={10} className="text-center py-8 text-slate-400">
                                        <Sparkles className="w-6 h-6 mx-auto mb-2 animate-pulse text-indigo-300" />
                                        Carregando…
                                    </td></tr>
                                )}
                                {!loading && filtrados.length === 0 && (
                                    <tr><td colSpan={10} className="text-center py-12 text-slate-400">
                                        <Package className="w-8 h-8 mx-auto mb-2 text-slate-300" />
                                        <p>Nenhum parâmetro cadastrado ainda</p>
                                        <p className="text-[11px] mt-1">Clique em <strong>Subir planilha</strong> ou <strong>Novo SKU</strong></p>
                                    </td></tr>
                                )}
                                {filtrados.map((it, idx) => (
                                    <tr key={it.codigo} onClick={() => abrirEdicao(it)}
                                        className={`border-t border-slate-100 dark:border-slate-700 h-11 hover:bg-amber-50/50 dark:hover:bg-amber-900/10 cursor-pointer ${idx % 2 ? 'bg-slate-50/30' : ''}`}
                                        title={it.updated_at ? `Clique para editar — atualizado por ${it.updated_by} em ${new Date(it.updated_at).toLocaleString('pt-BR')}` : 'Clique para editar'}>
                                        <td className="px-3 py-2 font-mono font-bold text-amber-700 dark:text-amber-400">{it.codigo}</td>
                                        <td className="px-3 py-2 text-slate-600 dark:text-slate-300 max-w-[260px] truncate" title={it.descricao || ''}>{it.descricao || '—'}</td>
                                        <td className="px-3 py-2 text-right tabular-nums font-bold">{it.moq.toLocaleString('pt-BR')}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{it.unit_ctn > 0 ? it.unit_ctn.toLocaleString('pt-BR') : '—'}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{it.cbm > 0 ? it.cbm.toLocaleString('pt-BR', { minimumFractionDigits: 4 }) : '—'}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{it.gw > 0 ? it.gw.toLocaleString('pt-BR', { minimumFractionDigits: 1 }) : '—'}</td>
                                        <td className="px-3 py-2 text-right tabular-nums text-[10px]">
                                            {(it.comprimento > 0 || it.largura > 0 || it.altura > 0)
                                                ? `${it.comprimento}×${it.largura}×${it.altura}`
                                                : '—'}
                                        </td>
                                        <td className="px-3 py-2 text-right tabular-nums">{it.price > 0 ? it.price.toLocaleString('pt-BR', { minimumFractionDigits: 2 }) : '—'}</td>
                                        <td className="px-3 py-2 text-center">
                                            <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-bold ${it.origem === 'upload' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}`}>
                                                {it.origem}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <div className="flex gap-1 justify-end" onClick={(e) => e.stopPropagation()}>
                                                <button onClick={() => abrirEdicao(it)} className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded" title="Editar"><Pencil className="w-3.5 h-3.5" /></button>
                                                <button onClick={() => excluir(it.codigo)} className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded" title="Excluir"><Trash2 className="w-3.5 h-3.5" /></button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>
            </div>

            {/* Modal edição */}
            {editOpen && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={() => setEditOpen(false)}>
                    <div onClick={(e) => e.stopPropagation()} className="bg-white dark:bg-slate-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
                    <div className="p-6 overflow-y-auto flex-1">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-bold text-lg flex items-center gap-2">
                                <Package className="w-5 h-5 text-amber-600" />
                                {edit.novo ? 'Novo SKU' : `Editar — ${edit.codigo}`}
                            </h3>
                            <button onClick={() => setEditOpen(false)} className="p-1 hover:bg-slate-200 rounded"><X className="w-4 h-4" /></button>
                        </div>

                        {/* IDENTIFICAÇÃO */}
                        <div className="grid grid-cols-2 gap-3 mb-4">
                            <div className="col-span-2">
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">ITEM NO *</label>
                                <input value={edit.codigo} disabled={!edit.novo}
                                    onChange={(e) => setEdit({ ...edit, codigo: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900 disabled:bg-slate-100 disabled:text-slate-500"
                                    placeholder="ex: 10400167" />
                            </div>
                            <div className="col-span-2">
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">DESCRIPTION</label>
                                <input value={edit.descricao}
                                    onChange={(e) => setEdit({ ...edit, descricao: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                                    placeholder="ex: BENGALA DOBRAVEL" />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">NCM</label>
                                <input value={edit.ncm}
                                    onChange={(e) => setEdit({ ...edit, ncm: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                                    placeholder="ex: 7324.10.00" />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">UNIT</label>
                                <input value={edit.unit}
                                    onChange={(e) => setEdit({ ...edit, unit: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                                    placeholder="ex: KIT / PC / PAR" />
                            </div>
                        </div>

                        {/* COMPRA */}
                        <h4 className="text-[10px] uppercase tracking-wider text-amber-600 font-black mb-2 mt-3">📦 Compra</h4>
                        <div className="grid grid-cols-3 gap-3 mb-4">
                            <div>
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">MOQ *</label>
                                <input type="number" min={0} value={edit.moq}
                                    onChange={(e) => setEdit({ ...edit, moq: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                                    placeholder="3000" />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">UNIT/CTN</label>
                                <input type="number" min={0} value={edit.unit_ctn}
                                    onChange={(e) => setEdit({ ...edit, unit_ctn: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                                    placeholder="30" />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">U.PRICE</label>
                                <input type="number" min={0} step={0.01} value={edit.price}
                                    onChange={(e) => setEdit({ ...edit, price: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                                    placeholder="10.30" />
                            </div>
                        </div>

                        {/* DIMENSÕES */}
                        <h4 className="text-[10px] uppercase tracking-wider text-amber-600 font-black mb-2 mt-3">📐 Dimensões da caixa</h4>
                        <div className="grid grid-cols-4 gap-3 mb-4">
                            <div>
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">L</label>
                                <input type="number" min={0} step={0.1} value={edit.comprimento}
                                    onChange={(e) => setEdit({ ...edit, comprimento: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                                    placeholder="L" />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">W</label>
                                <input type="number" min={0} step={0.1} value={edit.largura}
                                    onChange={(e) => setEdit({ ...edit, largura: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                                    placeholder="W" />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">H</label>
                                <input type="number" min={0} step={0.1} value={edit.altura}
                                    onChange={(e) => setEdit({ ...edit, altura: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                                    placeholder="H" />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">CBM</label>
                                <input type="number" min={0} step={0.0001} value={edit.cbm}
                                    onChange={(e) => setEdit({ ...edit, cbm: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                                    placeholder="0.0446" />
                            </div>
                        </div>

                        {/* PESO */}
                        <h4 className="text-[10px] uppercase tracking-wider text-amber-600 font-black mb-2 mt-3">⚖️ Peso</h4>
                        <div className="grid grid-cols-2 gap-3 mb-2">
                            <div>
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">G.W</label>
                                <input type="number" min={0} step={0.01} value={edit.gw}
                                    onChange={(e) => setEdit({ ...edit, gw: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                                    placeholder="10.4" />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">N.W</label>
                                <input type="number" min={0} step={0.01} value={edit.nw}
                                    onChange={(e) => setEdit({ ...edit, nw: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                                    placeholder="9.4" />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">T.G.W</label>
                                <input type="number" min={0} step={0.01} value={edit.tgw}
                                    onChange={(e) => setEdit({ ...edit, tgw: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">T.N.W</label>
                                <input type="number" min={0} step={0.01} value={edit.tnw}
                                    onChange={(e) => setEdit({ ...edit, tnw: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                            </div>
                        </div>

                        {/* QUANTIDADES / VALORES */}
                        <h4 className="text-[10px] uppercase tracking-wider text-amber-600 font-black mb-2 mt-3">🧮 Quantidades & valores</h4>
                        <div className="grid grid-cols-4 gap-3 mb-4">
                            <div>
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">CTNS</label>
                                <input type="number" min={0} step={1} value={edit.ctns}
                                    onChange={(e) => setEdit({ ...edit, ctns: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">QTY</label>
                                <input type="number" min={0} step={1} value={edit.qty}
                                    onChange={(e) => setEdit({ ...edit, qty: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">AMOUNT</label>
                                <input type="number" min={0} step={0.01} value={edit.amount}
                                    onChange={(e) => setEdit({ ...edit, amount: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">CBM TOTAL</label>
                                <input type="number" min={0} step={0.0001} value={edit.cbm_total}
                                    onChange={(e) => setEdit({ ...edit, cbm_total: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                            </div>
                        </div>

                        {/* INFORMAÇÕES ADICIONAIS */}
                        <h4 className="text-[10px] uppercase tracking-wider text-amber-600 font-black mb-2 mt-3">📝 Informações adicionais</h4>
                        <div className="grid grid-cols-2 gap-3 mb-4">
                            <div>
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Barcode Number</label>
                                <input value={edit.barcode}
                                    onChange={(e) => setEdit({ ...edit, barcode: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900"
                                    placeholder="ex: 7896796310484" />
                            </div>
                            <div>
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">NAME</label>
                                <input value={edit.name_cn}
                                    onChange={(e) => setEdit({ ...edit, name_cn: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                            </div>
                            <div className="col-span-2">
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">English Description</label>
                                <input value={edit.english_description}
                                    onChange={(e) => setEdit({ ...edit, english_description: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                            </div>
                            <div className="col-span-2">
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">REMARK</label>
                                <textarea value={edit.remark} rows={2}
                                    onChange={(e) => setEdit({ ...edit, remark: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                            </div>
                            <div className="col-span-2">
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">OBS</label>
                                <textarea value={edit.obs} rows={2}
                                    onChange={(e) => setEdit({ ...edit, obs: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                            </div>
                            <div className="col-span-2">
                                <label className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">OBSERVAÇÕES 13.03</label>
                                <textarea value={edit.observacoes} rows={2}
                                    onChange={(e) => setEdit({ ...edit, observacoes: e.target.value })}
                                    className="w-full px-3 py-2 mt-1 border border-slate-300 dark:border-slate-600 rounded-lg bg-white dark:bg-slate-900" />
                            </div>
                        </div>
                    </div>

                    {/* Footer fixo */}
                    <div className="border-t border-slate-200 dark:border-slate-700 p-4 flex justify-end gap-2 flex-shrink-0 bg-slate-50 dark:bg-slate-900/50">
                        <Button variant="secondary" size="sm" onClick={() => setEditOpen(false)}>Cancelar</Button>
                        <Button variant="primary" size="sm" onClick={salvar} disabled={!edit.codigo.trim() || !edit.moq}>
                            <Save className="w-3.5 h-3.5" /> Salvar
                        </Button>
                    </div>
                </div>
            </div>
            )}
        </div>
    );
};

export default ImportacaoMoq;
