import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../app_api';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useTablePrefs, sortRows, SortHeader } from '../../hooks/useTablePrefs';
import { useFiltroPersistente } from '../../hooks/useFiltroPersistente';
import { ExcelFilterHeader, applyFilters, distinctValues } from './ExcelFilterHeader';
import { Factory, Plus, Trash2, RefreshCw, Search, X, Check, Cog, PackageSearch, History, User, Clock, Network, Upload, FilterX } from 'lucide-react';
import EstruturaArvore, { EstruturaItem } from './EstruturaArvore';

// ---- Tipos ----
interface Maquina { id: number; nome: string; ativo: boolean; n_regras: number; n_excecoes: number; cor?: string | null; }
// Paleta de cores para o card da máquina na Programação.
const CORES_MAQUINA = ['#2563eb', '#dc2626', '#16a34a', '#ea580c', '#9333ea', '#0891b2', '#db2777', '#ca8a04', '#475569', '#0d9488'];
interface Regra { id: number; tipo: 'prefixo' | 'codigo'; valor: string; }
interface Excecao { id: number; cod_item: string; acao: 'incluir' | 'excluir'; desc_item?: string; created_by_name?: string | null; created_at?: string | null; }
interface ProdutoMaq { cod_item: string; desc_item: string; pecas_hora?: number | null; }
interface ProdutoRow { cod_item: string; desc_item: string; un_medida?: string; cod_agrupamento?: string; desc_agrupamento?: string; maquinas: string[]; }
interface ProdBusca { cod_item: string; desc_item: string; }

const Portal: React.FC<{ children: React.ReactNode }> = ({ children }) => createPortal(children, document.body);

// ---- estilos base ----
const card = "bg-white dark:bg-slate-800 rounded-2xl shadow-sm ring-1 ring-slate-200/70 dark:ring-slate-700";
const btn = "inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
const btnPri = `${btn} bg-blue-600 text-white hover:bg-blue-700 shadow-sm shadow-blue-600/20`;
const btnGhost = `${btn} text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700`;
const btnDanger = `${btn} text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40`;
const input = "w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/60 focus:border-blue-500";
const th = "text-left px-3 py-2.5 font-semibold text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 whitespace-nowrap";
const td = "px-3 py-2 text-slate-700 dark:text-slate-200 whitespace-nowrap";
const numInput = "w-24 px-2 py-1.5 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-sm text-right focus:outline-none focus:ring-2 focus:ring-blue-500/60";

// Cache em memória (persiste entre navegações; só recarrega ao pedir explicitamente)
let cacheMaquinas: Maquina[] | null = null;
let cacheProdutos: { produtos: ProdutoRow[]; total: number } | null = null;

const CadastroMaquinas: React.FC = () => {
  const { showToast } = useToast();
  const confirmar = useConfirm();
  const mqTbl = useTablePrefs('maquina_produtos', { cod_item: 130, pecas_hora: 110 });
  const pbTbl = useTablePrefs('produtos_base', { cod_item: 120, un_medida: 70, cod_agrupamento: 110, desc_agrupamento: 200, maquinas: 170 });

  const [tab, setTab] = useState<'maquinas' | 'produtos' | 'estrutura'>('maquinas');

  // Estrutura
  const [estVersoes, setEstVersoes] = useState<{ id: number; arquivo_nome: string; total_linhas: number; enviado_em: string; enviado_por_nome: string }[]>([]);
  const [estArquivo, setEstArquivo] = useState<File | null>(null);
  const [estEnviando, setEstEnviando] = useState(false);
  const [estCod, setEstCod] = useState('');
  const [estItens, setEstItens] = useState<EstruturaItem[]>([]);
  const [estBuscou, setEstBuscou] = useState(false);
  const [estEncontrado, setEstEncontrado] = useState(false);
  const [estBuscando, setEstBuscando] = useState(false);

  const [maquinas, setMaquinas] = useState<Maquina[]>([]);
  const [novaMaquina, setNovaMaquina] = useState('');
  const [novaCor, setNovaCor] = useState(CORES_MAQUINA[0]);
  const [selecionada, setSelecionada] = useState<Maquina | null>(null);
  const [loadingMaq, setLoadingMaq] = useState(false);

  const [regras, setRegras] = useState<Regra[]>([]);
  const [excecoes, setExcecoes] = useState<Excecao[]>([]);
  const [regraTipo, setRegraTipo] = useState<'prefixo' | 'codigo'>('prefixo');
  const [regraValor, setRegraValor] = useState('');

  const [prodMaq, setProdMaq] = useState<ProdutoMaq[]>([]);
  const [filtroMaq, setFiltroMaq] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [bulkPecas, setBulkPecas] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [buscaProd, setBuscaProd] = useState('');
  const [resultados, setResultados] = useState<ProdBusca[]>([]);
  const [totalBusca, setTotalBusca] = useState(0);
  const [loadingBusca, setLoadingBusca] = useState(false);
  const [selModal, setSelModal] = useState<Set<string>>(new Set());

  // Modal de auditoria de exceções manuais
  const [excModalOpen, setExcModalOpen] = useState(false);
  const [excFiltro, setExcFiltro] = useState('');

  // Histórico de máquinas (auditoria)
  const [histOpen, setHistOpen] = useState(false);
  const [hist, setHist] = useState<{ id: number; maquina_nome: string; acao: string; detalhe: string | null; user_nome: string | null; created_at: string | null }[]>([]);
  const [histFiltro, setHistFiltro] = useState('');
  const abrirHistorico = async () => {
    setHistOpen(true); setHistFiltro('');
    try { const { data } = await api.get('/maquinas/historico'); setHist(data.historico || []); }
    catch (e: any) { showToast(e?.message || 'Erro ao carregar histórico', 'error'); }
  };

  const [produtos, setProdutos] = useState<ProdutoRow[]>([]);
  const [busca, setBusca] = useState('');
  const [totalBase, setTotalBase] = useState(0);
  const [loadingProd, setLoadingProd] = useState(false);

  // Filtros estilo Excel persistidos por coluna (arrays serializáveis)
  const [filtrosMaqProd, setFiltrosMaqProd, limparFiltrosMaqProd] = useFiltroPersistente<Record<string, string[]>>('filtros:fabrica:cadastro_maquinas:maquinas:colunas', {});
  const [filtrosProd, setFiltrosProd, limparFiltrosProd] = useFiltroPersistente<Record<string, string[]>>('filtros:fabrica:cadastro_maquinas:produtos:colunas', {});

  // Busca global "encontrar máquinas que fazem o produto" (na aba Máquinas) — filtra a lista lateral
  const [buscaMaqGlobal, setBuscaMaqGlobal, limparBuscaMaqGlobal] = useFiltroPersistente<string>('filtros:fabrica:cadastro_maquinas:maquinas:busca_global', '');

  // Helpers pra integrar com ExcelFilterHeader (Set<string> | null)
  const getColFilter = (rec: Record<string, string[]>, col: string): Set<string> | null => {
    const arr = rec[col];
    return arr && arr.length > 0 ? new Set(arr) : null;
  };
  const setColFilter = (
    setter: (v: Record<string, string[]> | ((p: Record<string, string[]>) => Record<string, string[]>)) => void,
    col: string,
    s: Set<string> | null,
  ) => {
    setter(prev => {
      const next = { ...prev };
      if (s === null || s.size === 0) delete next[col];
      else next[col] = Array.from(s);
      return next;
    });
  };

  // Accessors usados em filtro Excel e em sort
  const accessorMaqProd = (p: ProdutoMaq, k: string): string | string[] => {
    if (k === 'pecas_hora') return p.pecas_hora == null ? '' : String(p.pecas_hora);
    return String((p as any)[k] ?? '');
  };
  const accessorProdBase = (p: ProdutoRow, k: string): string | string[] => {
    if (k === 'maquinas') return p.maquinas;
    return String((p as any)[k] ?? '');
  };

  const erro = (e: any, fallback: string) => showToast(e?.message || fallback, 'error');

  const carregarMaquinas = useCallback(async (force = false) => {
    if (!force && cacheMaquinas) { setMaquinas(cacheMaquinas); return; }
    setLoadingMaq(true);
    try { const { data } = await api.get('/maquinas'); cacheMaquinas = data.maquinas || []; setMaquinas(cacheMaquinas); }
    catch (e) { erro(e, 'Erro ao carregar máquinas'); }
    finally { setLoadingMaq(false); }
  }, []); // eslint-disable-line

  const carregarDetalhe = useCallback(async (maq: Maquina) => {
    try {
      const { data } = await api.get(`/maquinas/${maq.id}/regras`);
      setRegras(data.regras || []); setExcecoes(data.excecoes || []);
      const { data: pd } = await api.get(`/maquinas/${maq.id}/produtos`);
      setProdMaq(pd.produtos || []); setSel(new Set());
    } catch (e) { erro(e, 'Erro ao carregar detalhes'); }
  }, []); // eslint-disable-line

  useEffect(() => { carregarMaquinas(); }, [carregarMaquinas]);
  useEffect(() => { if (selecionada) carregarDetalhe(selecionada); }, [selecionada, carregarDetalhe]);

  const carregarProdutos = useCallback(async (refresh = false) => {
    setLoadingProd(true);
    try {
      const { data } = await api.get('/maquinas/produtos', { params: { busca: busca || undefined, refresh } });
      cacheProdutos = { produtos: data.produtos || [], total: data.total_base || 0 };
      setProdutos(cacheProdutos.produtos); setTotalBase(cacheProdutos.total);
    } catch (e) { erro(e, 'Erro ao carregar produtos'); }
    finally { setLoadingProd(false); }
  }, [busca]); // eslint-disable-line

  // Ao abrir a aba: usa o cache se já carregou antes; só busca da 1ª vez.
  useEffect(() => {
    if (tab !== 'produtos') return;
    if (cacheProdutos) { setProdutos(cacheProdutos.produtos); setTotalBase(cacheProdutos.total); }
    else carregarProdutos();
  }, [tab]); // eslint-disable-line

  // ---- Máquinas ----
  const addMaquina = async () => {
    if (!novaMaquina.trim()) return;
    try { await api.post('/maquinas', { nome: novaMaquina.trim(), cor: novaCor }); setNovaMaquina(''); carregarMaquinas(true); showToast('Máquina criada', 'success'); }
    catch (e) { erro(e, 'Erro ao criar máquina'); }
  };
  const setCorMaquina = async (m: Maquina, cor: string) => {
    try {
      await api.put(`/maquinas/${m.id}`, { nome: m.nome, ativo: m.ativo, cor });
      setMaquinas(prev => prev.map(x => x.id === m.id ? { ...x, cor } : x));
      if (selecionada?.id === m.id) setSelecionada({ ...selecionada, cor });
    } catch (e) { erro(e, 'Erro ao salvar a cor'); }
  };
  const removerMaquina = async (m: Maquina) => {
    const ok = await confirmar({ title: 'Remover máquina', message: `Remover a máquina "${m.nome}"? Regras, exceções e tempos serão apagados.`, variant: 'danger', confirmText: 'Remover', cancelText: 'Cancelar' });
    if (!ok) return;
    try { await api.del(`/maquinas/${m.id}`); if (selecionada?.id === m.id) setSelecionada(null); carregarMaquinas(true); showToast('Máquina removida', 'success'); }
    catch (e) { erro(e, 'Erro ao remover máquina'); }
  };

  // ---- Regras / exclusões ----
  const addRegra = async () => {
    if (!selecionada || !regraValor.trim()) return;
    try { await api.post(`/maquinas/${selecionada.id}/regras`, { tipo: regraTipo, valor: regraValor.trim() }); setRegraValor(''); carregarDetalhe(selecionada); carregarMaquinas(true); }
    catch (e) { erro(e, 'Erro ao adicionar regra'); }
  };
  const removerRegra = async (id: number) => {
    if (!selecionada) return;
    try { await api.del(`/maquinas/regras/${id}`); carregarDetalhe(selecionada); carregarMaquinas(true); }
    catch (e) { erro(e, 'Erro ao remover regra'); }
  };
  const removerExcecao = async (id: number) => {
    if (!selecionada) return;
    try { await api.del(`/maquinas/excecoes/${id}`); carregarDetalhe(selecionada); carregarMaquinas(true); }
    catch (e) { erro(e, 'Erro ao desfazer exclusão'); }
  };

  // ---- Tabela mestre ----
  const salvarTempo = async (cod: string, valor: string) => {
    if (!selecionada) return;
    const v = valor.trim() === '' ? null : Number(valor.replace(',', '.'));
    if (v !== null && (isNaN(v) || v < 0)) { showToast('Peças/hora inválido', 'error'); return; }
    try { await api.put(`/maquinas/${selecionada.id}/tempo`, { cod_item: cod, pecas_hora: v }); carregarDetalhe(selecionada); }
    catch (e) { erro(e, 'Erro ao salvar tempo'); }
  };
  const aplicarPecasLote = async () => {
    if (!selecionada || sel.size === 0) return;
    const v = bulkPecas.trim() === '' ? null : Number(bulkPecas.replace(',', '.'));
    if (v !== null && (isNaN(v) || v < 0)) { showToast('Peças/hora inválido', 'error'); return; }
    try { await api.put(`/maquinas/${selecionada.id}/tempo-lote`, { cod_items: [...sel], pecas_hora: v }); setBulkPecas(''); carregarDetalhe(selecionada); showToast(`Peças/h aplicado a ${sel.size} produto(s)`, 'success'); }
    catch (e) { erro(e, 'Erro ao aplicar tempo'); }
  };
  const removerMarcados = async () => {
    if (!selecionada || sel.size === 0) return;
    const ok = await confirmar({ title: 'Remover produtos', message: `Remover ${sel.size} produto(s) desta máquina?`, variant: 'danger', confirmText: 'Remover', cancelText: 'Cancelar' });
    if (!ok) return;
    try { await api.post(`/maquinas/${selecionada.id}/remover-produtos`, { cod_items: [...sel] }); carregarDetalhe(selecionada); carregarMaquinas(true); showToast('Produtos removidos', 'success'); }
    catch (e) { erro(e, 'Erro ao remover produtos'); }
  };

  const prodFiltrados = useMemo(() => {
    const t = filtroMaq.trim().toUpperCase();
    const base = !t ? prodMaq : prodMaq.filter(p => p.cod_item.toUpperCase().includes(t) || p.desc_item.toUpperCase().includes(t));
    const fSet: Record<string, Set<string>> = {};
    Object.entries(filtrosMaqProd).forEach(([k, arr]) => { if (arr.length > 0) fSet[k] = new Set(arr); });
    const filtrado = applyFilters(base, fSet, accessorMaqProd);
    return sortRows(filtrado, mqTbl.prefs.sort, (p, k) => k === 'pecas_hora' ? (p.pecas_hora == null ? -1 : Number(p.pecas_hora)) : (p as any)[k]);
  }, [prodMaq, filtroMaq, mqTbl.prefs.sort, filtrosMaqProd]);

  // Valores distintos para os dropdowns (calculados antes do filtro Excel pra mostrar opções completas)
  const distMaqProd = useMemo(() => {
    const t = filtroMaq.trim().toUpperCase();
    const base = !t ? prodMaq : prodMaq.filter(p => p.cod_item.toUpperCase().includes(t) || p.desc_item.toUpperCase().includes(t));
    return {
      cod_item: distinctValues(base, 'cod_item', accessorMaqProd),
      desc_item: distinctValues(base, 'desc_item', accessorMaqProd),
      pecas_hora: distinctValues(base, 'pecas_hora', accessorMaqProd),
    };
  }, [prodMaq, filtroMaq]);

  const produtosView = useMemo(() => {
    const fSet: Record<string, Set<string>> = {};
    Object.entries(filtrosProd).forEach(([k, arr]) => { if (arr.length > 0) fSet[k] = new Set(arr); });
    const filtrado = applyFilters(produtos, fSet, accessorProdBase);
    return sortRows(filtrado, pbTbl.prefs.sort, (p, k) => k === 'maquinas' ? p.maquinas.join(', ') : (p as any)[k]);
  }, [produtos, pbTbl.prefs.sort, filtrosProd]);

  const distProd = useMemo(() => ({
    cod_item: distinctValues(produtos, 'cod_item', accessorProdBase),
    desc_item: distinctValues(produtos, 'desc_item', accessorProdBase),
    un_medida: distinctValues(produtos, 'un_medida', accessorProdBase),
    cod_agrupamento: distinctValues(produtos, 'cod_agrupamento', accessorProdBase),
    desc_agrupamento: distinctValues(produtos, 'desc_agrupamento', accessorProdBase),
    maquinas: distinctValues(produtos, 'maquinas', accessorProdBase),
  }), [produtos]);

  const totalFiltrosMaqProd = Object.values(filtrosMaqProd).filter(a => a.length > 0).length;
  const totalFiltrosProd = Object.values(filtrosProd).filter(a => a.length > 0).length;

  // Resultado da busca global (endpoint /maquinas/produtos com busca=...)
  // Estado próprio pra não conflitar com a aba Produtos
  const [produtosBuscaMaq, setProdutosBuscaMaq] = useState<ProdutoRow[]>([]);
  const [loadingBuscaMaq, setLoadingBuscaMaq] = useState(false);

  // Debounce + fetch direto no endpoint usando o termo da busca global
  useEffect(() => {
    if (tab !== 'maquinas') return;
    const termo = buscaMaqGlobal.trim();
    if (!termo) { setProdutosBuscaMaq([]); return; }
    setLoadingBuscaMaq(true);
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get('/maquinas/produtos', { params: { busca: termo, limite: 2000 } });
        setProdutosBuscaMaq(data.produtos || []);
      } catch (e) { erro(e, 'Erro ao buscar produto'); }
      finally { setLoadingBuscaMaq(false); }
    }, 300);
    return () => clearTimeout(t);
  }, [tab, buscaMaqGlobal]); // eslint-disable-line

  // Mapa nomeMaquina → quantidade de produtos casando com a busca global
  const matchPorMaquina = useMemo(() => {
    const t = buscaMaqGlobal.trim().toUpperCase();
    if (!t) return null as Map<string, number> | null;
    const m = new Map<string, number>();
    produtosBuscaMaq.forEach(p => {
      // Backend ja filtrou; aqui so monto o agregado por máquina
      p.maquinas.forEach(nome => m.set(nome, (m.get(nome) || 0) + 1));
    });
    return m;
  }, [buscaMaqGlobal, produtosBuscaMaq]);

  const maquinasFiltradas = useMemo(() => {
    if (!matchPorMaquina) return maquinas;
    return maquinas.filter(m => (matchPorMaquina.get(m.nome) || 0) > 0);
  }, [maquinas, matchPorMaquina]);

  const toggleSel = (cod: string) => setSel(prev => { const n = new Set(prev); n.has(cod) ? n.delete(cod) : n.add(cod); return n; });
  const toggleSelAll = () => setSel(prev => prev.size === prodFiltrados.length ? new Set() : new Set(prodFiltrados.map(p => p.cod_item)));

  // ---- Modal ----
  const [filtrosModal, setFiltrosModal] = useState<Record<string, string[]>>({});
  const abrirModal = () => { setModalOpen(true); setBuscaProd(''); setResultados([]); setTotalBusca(0); setSelModal(new Set()); setFiltrosModal({}); };
  const buscarProdutos = async () => {
    if (!buscaProd.trim()) { setResultados([]); setTotalBusca(0); return; }
    setLoadingBusca(true);
    setFiltrosModal({});
    try { const { data } = await api.get('/maquinas/buscar-produtos', { params: { busca: buscaProd.trim(), limite: 500 } }); setResultados(data.produtos || []); setTotalBusca(data.total || 0); }
    catch (e) { erro(e, 'Erro na busca'); }
    finally { setLoadingBusca(false); }
  };
  const accessorModal = (p: ProdBusca, k: string): string => String((p as any)[k] ?? '');
  const resultadosFiltrados = useMemo(() => {
    const fSet: Record<string, Set<string>> = {};
    Object.entries(filtrosModal).forEach(([k, arr]) => { if (arr.length > 0) fSet[k] = new Set(arr); });
    return applyFilters(resultados, fSet, accessorModal);
  }, [resultados, filtrosModal]);
  const distModal = useMemo(() => ({
    cod_item: distinctValues(resultados, 'cod_item', accessorModal),
    desc_item: distinctValues(resultados, 'desc_item', accessorModal),
  }), [resultados]);
  const totalFiltrosModal = Object.values(filtrosModal).filter(a => a.length > 0).length;
  const toggleSelModal = (cod: string) => setSelModal(prev => { const n = new Set(prev); n.has(cod) ? n.delete(cod) : n.add(cod); return n; });
  const selecionaveis = useMemo(() => resultadosFiltrados.filter(p => !prodMaq.some(x => x.cod_item === p.cod_item)), [resultadosFiltrados, prodMaq]);
  const toggleSelModalAll = () => setSelModal(prev => prev.size === selecionaveis.length ? new Set() : new Set(selecionaveis.map(p => p.cod_item)));
  const adicionarSelecionados = async () => {
    if (!selecionada || selModal.size === 0) return;
    try { await api.post(`/maquinas/${selecionada.id}/excecoes-lote`, { cod_items: [...selModal], acao: 'incluir' }); setModalOpen(false); carregarDetalhe(selecionada); carregarMaquinas(true); showToast(`${selModal.size} produto(s) adicionado(s)`, 'success'); }
    catch (e) { erro(e, 'Erro ao adicionar produtos'); }
  };

  const jaNaMaquina = (cod: string) => prodMaq.some(p => p.cod_item === cod);

  // ---- Estrutura ----
  const carregarEstVersoes = useCallback(async () => {
    try { const data = await api.estruturaVersoes(); setEstVersoes(data.versoes || []); }
    catch (e: any) { showToast(e?.message || 'Erro ao carregar histórico', 'error'); }
  }, []); // eslint-disable-line
  useEffect(() => { if (tab === 'estrutura') carregarEstVersoes(); }, [tab]); // eslint-disable-line
  const enviarEstBase = async () => {
    if (!estArquivo) return;
    setEstEnviando(true);
    try {
      const r = await api.estruturaUpload(estArquivo);
      setEstArquivo(null);
      showToast(`Base enviada (${r.total_linhas} linha(s)).`, 'success');
      carregarEstVersoes();
    } catch (e: any) { erro(e, 'Erro ao enviar base'); }
    finally { setEstEnviando(false); }
  };
  const buscarEstrutura = async () => {
    if (!estCod.trim()) return;
    setEstBuscando(true);
    try {
      const data = await api.estruturaProduto(estCod.trim());
      setEstBuscou(true);
      setEstEncontrado(!!data.encontrado);
      setEstItens(data.itens || []);
    } catch (e: any) { erro(e, 'Erro ao buscar estrutura'); }
    finally { setEstBuscando(false); }
  };

  return (
    <div className="-m-4 md:-m-6 lg:-m-8 min-h-[calc(100vh-2rem)] relative overflow-hidden bg-gradient-to-br from-slate-50 via-blue-50/60 to-indigo-50 dark:from-slate-900 dark:via-blue-950/40 dark:to-indigo-950/40">
      <div className="pointer-events-none absolute -top-32 -left-32 w-[480px] h-[480px] rounded-full bg-blue-300/40 blur-3xl dark:bg-blue-700/20" />
      <div className="pointer-events-none absolute top-1/3 -right-40 w-[520px] h-[520px] rounded-full bg-indigo-300/40 blur-3xl dark:bg-indigo-700/20" />
      <div className="pointer-events-none absolute bottom-0 left-1/3 w-[480px] h-[480px] rounded-full bg-sky-300/30 blur-3xl dark:bg-sky-800/20" />
      <div className="pointer-events-none absolute -bottom-24 -right-24 w-[400px] h-[400px] rounded-full bg-cyan-200/30 blur-3xl dark:bg-cyan-800/15" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.04] dark:opacity-[0.08]" style={{ backgroundImage: 'linear-gradient(rgb(30,58,138) 1px, transparent 1px), linear-gradient(90deg, rgb(30,58,138) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
      <div className="relative p-4 sm:p-6 max-w-[1400px] mx-auto">
        {/* Cabeçalho */}
        <div className="flex items-center gap-4 mb-6">
          <div className="grid place-items-center w-12 h-12 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-600 text-white shadow-lg shadow-blue-600/25">
            <Factory className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Cadastro de Máquinas</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">Defina as máquinas e quais produtos podem ser feitos em cada uma.</p>
          </div>
        </div>

        {/* Abas */}
        <div className="flex gap-1 mb-5 p-1 bg-slate-200/60 dark:bg-slate-800 rounded-xl w-fit">
          {([['maquinas', 'Máquinas', Cog], ['produtos', 'Produtos', PackageSearch], ['estrutura', 'Estrutura', Network]] as const).map(([t, label, Icon]) => (
            <button key={t} onClick={() => setTab(t as any)}
              className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition-colors ${tab === t ? 'bg-white dark:bg-slate-700 text-blue-600 shadow-sm' : 'text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}>
              <Icon className="w-4 h-4" />{label}
            </button>
          ))}
        </div>

        {tab === 'maquinas' && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
            {/* Lista de máquinas */}
            <div className={`${card} p-4 self-start`}>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Máquinas</span>
                <button onClick={abrirHistorico} title="Histórico (quem criou/excluiu)"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer">
                  <History className="w-4 h-4" />Histórico
                </button>
              </div>

              {/* Busca global: encontra máquinas que produzem o item */}
              <div className="mb-3 rounded-xl bg-blue-50/60 dark:bg-blue-950/20 p-2.5 ring-1 ring-blue-100 dark:ring-blue-900/40">
                <label className="text-[10px] uppercase tracking-wide font-semibold text-blue-700 dark:text-blue-300 mb-1.5 block">Onde está o produto?</label>
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input className={`${input} pl-9 pr-9`} placeholder="Código ou descrição do produto" value={buscaMaqGlobal}
                    onChange={e => setBuscaMaqGlobal(e.target.value)} />
                  {buscaMaqGlobal && (
                    <button onClick={limparBuscaMaqGlobal} className="absolute right-2 top-2 text-slate-400 hover:text-slate-700" title="Limpar busca">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
                {buscaMaqGlobal && loadingBuscaMaq && (
                  <p className="text-[11px] text-slate-500 mt-1.5">Buscando…</p>
                )}
                {buscaMaqGlobal && !loadingBuscaMaq && matchPorMaquina && (
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    {produtosBuscaMaq.length === 0
                      ? <span className="text-amber-700 dark:text-amber-300">Nenhum produto encontrado para "{buscaMaqGlobal}"</span>
                      : maquinasFiltradas.length === 0
                        ? <span className="text-amber-700 dark:text-amber-300">{produtosBuscaMaq.length} produto(s) encontrado(s), mas nenhum tem máquina cadastrada</span>
                        : <>Mostrando {maquinasFiltradas.length} máquina(s) — {produtosBuscaMaq.length} produto(s) casam</>}
                  </p>
                )}
              </div>

              <div className="mb-3 space-y-2">
                <div className="flex gap-2">
                  <input className={input} placeholder="Nome da máquina" value={novaMaquina}
                    onChange={e => setNovaMaquina(e.target.value)} onKeyDown={e => e.key === 'Enter' && addMaquina()} />
                  <button className={btnPri} onClick={addMaquina} title="Adicionar máquina"><Plus className="w-4 h-4" /></button>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">Cor:</span>
                  {CORES_MAQUINA.map(c => (
                    <button key={c} type="button" onClick={() => setNovaCor(c)} title="Cor do card"
                      style={{ background: c }}
                      className={`w-5 h-5 rounded-full border-2 transition ${novaCor === c ? 'border-slate-700 dark:border-white scale-110' : 'border-transparent'}`} />
                  ))}
                </div>
              </div>
              {loadingMaq ? <p className="text-sm text-slate-400 px-1">Carregando…</p> : (
                <ul className="space-y-1">
                  {maquinasFiltradas.map(m => {
                    const nMatch = matchPorMaquina?.get(m.nome) || 0;
                    return (
                    <li key={m.id}>
                      <div className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${selecionada?.id === m.id ? 'bg-blue-50 dark:bg-slate-700 ring-1 ring-blue-200 dark:ring-slate-600' : 'hover:bg-slate-50 dark:hover:bg-slate-700/50'}`}
                        onClick={() => setSelecionada(m)}>
                        <div className="flex items-center gap-2 min-w-0">
                        <span style={{ background: m.cor || '#94a3b8' }} className="inline-block w-3 h-3 rounded-full shrink-0" title="Cor do card" />
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate" title={m.nome}>{m.nome}</div>
                          <div className="text-xs text-slate-400 whitespace-nowrap">{m.n_regras} regra(s) · {m.n_excecoes} exceção(ões)</div>
                        </div>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          {nMatch > 0 && (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold" title={`${nMatch} produto(s) casam com a busca`}>
                              {nMatch}
                            </span>
                          )}
                          <button className="text-slate-300 hover:text-red-600" onClick={(e) => { e.stopPropagation(); removerMaquina(m); }} title="Remover máquina">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </li>
                    );
                  })}
                  {maquinas.length === 0 && <p className="text-sm text-slate-400 px-1 py-2">Nenhuma máquina cadastrada.</p>}
                  {maquinas.length > 0 && maquinasFiltradas.length === 0 && buscaMaqGlobal && (
                    <p className="text-sm text-slate-400 px-1 py-2">Nenhuma máquina produz "{buscaMaqGlobal}".</p>
                  )}
                </ul>
              )}
            </div>

            {/* Painel da máquina */}
            <div className={`${card} p-5 lg:col-span-3`}>
              {!selecionada ? (
                <div className="flex flex-col items-center justify-center h-48 text-slate-400">
                  <Cog className="w-8 h-8 mb-2 opacity-50" />
                  <span className="text-sm">Selecione uma máquina para configurar.</span>
                </div>
              ) : (
                <>
                  <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
                    <h2 className="text-lg font-bold text-slate-800 dark:text-slate-100 truncate" title={selecionada.nome}>{selecionada.nome}</h2>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] uppercase tracking-wide text-slate-400">Cor do card:</span>
                      {CORES_MAQUINA.map(c => (
                        <button key={c} type="button" onClick={() => setCorMaquina(selecionada, c)} title="Definir cor do card na Programação"
                          style={{ background: c }}
                          className={`w-5 h-5 rounded-full border-2 transition ${(selecionada.cor || CORES_MAQUINA[0]) === c ? 'border-slate-700 dark:border-white scale-110' : 'border-transparent'}`} />
                      ))}
                    </div>
                  </div>

                  {/* Seção: ADICIONAR */}
                  <div className="rounded-xl border border-blue-200 dark:border-blue-900/50 bg-blue-50/40 dark:bg-blue-950/10 p-4 mb-5">
                    <div className="flex items-center justify-between gap-3 mb-3">
                      <div>
                        <h3 className="inline-flex items-center gap-2 text-sm font-bold text-blue-700 dark:text-blue-300"><Plus className="w-4 h-4" />Adicionar códigos à máquina</h3>
                        <p className="text-[11px] text-slate-500 mt-0.5">Por regra (ex.: começa com 103) ou manualmente em "Adicionar produtos".</p>
                      </div>
                      <button className={btnPri} onClick={abrirModal}><Plus className="w-4 h-4" />Adicionar produtos</button>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <select className={`${input} max-w-[150px]`} value={regraTipo} onChange={e => setRegraTipo(e.target.value as any)}>
                        <option value="prefixo">Começa com</option>
                        <option value="codigo">Código exato</option>
                      </select>
                      <input className={`${input} max-w-[160px]`} placeholder={regraTipo === 'prefixo' ? 'ex.: 103' : 'ex.: 103045'}
                        value={regraValor} onChange={e => setRegraValor(e.target.value)} onKeyDown={e => e.key === 'Enter' && addRegra()} />
                      <button className={btnPri} onClick={addRegra}><Plus className="w-4 h-4" />Regra</button>
                      <div className="flex flex-wrap gap-1.5">
                        {regras.map(r => (
                          <span key={r.id} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-xs text-slate-700 dark:text-slate-200 whitespace-nowrap">
                            {r.tipo === 'prefixo' ? `começa com ${r.valor}` : `= ${r.valor}`}
                            <button onClick={() => removerRegra(r.id)} className="text-slate-400 hover:text-red-600"><X className="w-3 h-3" /></button>
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Seção: CONSULTAR cadastrados */}
                  <h3 className="inline-flex items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300 mb-2"><PackageSearch className="w-4 h-4" />Produtos cadastrados nesta máquina (consulta)</h3>
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-400 mr-1">
                      {(filtroMaq || totalFiltrosMaqProd > 0) ? `${prodFiltrados.length} de ${prodMaq.length}` : `${prodMaq.length} produto(s)`}
                    </span>
                    <div className="relative flex-1 min-w-[200px]">
                      <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                      <input className={`${input} pl-9`} placeholder="Filtrar nesta lista (código ou descrição)" value={filtroMaq} onChange={e => setFiltroMaq(e.target.value)} />
                    </div>
                    {totalFiltrosMaqProd > 0 && (
                      <button
                        onClick={limparFiltrosMaqProd}
                        title="Limpar filtros das colunas"
                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors cursor-pointer"
                      >
                        <FilterX className="w-3.5 h-3.5" />
                        Limpar {totalFiltrosMaqProd} filtro{totalFiltrosMaqProd > 1 ? 's' : ''}
                      </button>
                    )}
                  </div>

                  {sel.size > 0 && (
                    <div className="flex flex-wrap items-center gap-2 mb-2 px-3 py-2 rounded-xl bg-blue-50 dark:bg-slate-700/50 ring-1 ring-blue-100 dark:ring-slate-700">
                      <span className="text-sm font-medium text-blue-700 dark:text-slate-200 whitespace-nowrap">{sel.size} selecionado(s)</span>
                      <span className="text-sm text-slate-500 whitespace-nowrap">· Peças/h:</span>
                      <input type="number" min={0} step="any" className={numInput} value={bulkPecas} onChange={e => setBulkPecas(e.target.value)} placeholder="ex.: 250" />
                      <button className={btnPri} onClick={aplicarPecasLote}><Check className="w-4 h-4" />Aplicar</button>
                      <button className={btnDanger} onClick={removerMarcados}><Trash2 className="w-4 h-4" />Remover</button>
                    </div>
                  )}

                  <div className="overflow-auto max-h-[55vh] rounded-xl ring-1 ring-slate-200 dark:ring-slate-700">
                    <table className="w-full text-sm table-fixed">
                      <colgroup>
                        <col className="w-10" />
                        <col style={{ width: mqTbl.prefs.widths.cod_item }} />
                        <col style={{ width: mqTbl.prefs.widths.desc_item }} />
                        <col style={{ width: mqTbl.prefs.widths.pecas_hora }} />
                      </colgroup>
                      <thead className="bg-slate-50 dark:bg-slate-700/50 sticky top-0 z-10">
                        <tr>
                          <th className="px-3 py-2.5"><input type="checkbox" checked={prodFiltrados.length > 0 && sel.size === prodFiltrados.length} onChange={toggleSelAll} /></th>
                          <ExcelFilterHeader label="Código" col="cod_item" sort={mqTbl.prefs.sort} onSort={mqTbl.toggleSort} onResize={mqTbl.setWidth}
                            values={distMaqProd.cod_item} selected={getColFilter(filtrosMaqProd, 'cod_item')} onFilterChange={s => setColFilter(setFiltrosMaqProd, 'cod_item', s)} />
                          <ExcelFilterHeader label="Descrição" col="desc_item" sort={mqTbl.prefs.sort} onSort={mqTbl.toggleSort} onResize={mqTbl.setWidth}
                            values={distMaqProd.desc_item} selected={getColFilter(filtrosMaqProd, 'desc_item')} onFilterChange={s => setColFilter(setFiltrosMaqProd, 'desc_item', s)} />
                          <ExcelFilterHeader label="Peças/h" col="pecas_hora" sort={mqTbl.prefs.sort} onSort={mqTbl.toggleSort} onResize={mqTbl.setWidth}
                            values={distMaqProd.pecas_hora} selected={getColFilter(filtrosMaqProd, 'pecas_hora')} onFilterChange={s => setColFilter(setFiltrosMaqProd, 'pecas_hora', s)} />
                        </tr>
                      </thead>
                      <tbody>
                        {prodFiltrados.map(p => (
                          <tr key={p.cod_item} className={`border-t border-slate-100 dark:border-slate-700 ${sel.has(p.cod_item) ? 'bg-blue-50/60 dark:bg-slate-700/30' : 'hover:bg-slate-50/60 dark:hover:bg-slate-700/20'}`}>
                            <td className="px-3 py-2 text-center"><input type="checkbox" checked={sel.has(p.cod_item)} onChange={() => toggleSel(p.cod_item)} /></td>
                            <td className={`${td} font-mono text-xs`}>{p.cod_item}</td>
                            <td className={`${td} truncate`} title={p.desc_item}>{p.desc_item}</td>
                            <td className="px-3 py-2">
                              <input type="number" min={0} step="any" defaultValue={p.pecas_hora ?? ''} placeholder="—"
                                className={numInput}
                                onBlur={e => { if (e.target.value !== String(p.pecas_hora ?? '')) salvarTempo(p.cod_item, e.target.value); }}
                                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
                            </td>
                          </tr>
                        ))}
                        {prodFiltrados.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">Nenhum produto. Use "Adicionar produtos" ou crie uma regra.</td></tr>}
                      </tbody>
                    </table>
                  </div>

                  {excecoes.length > 0 && (
                    <div className="mt-4">
                      <button onClick={() => { setExcFiltro(''); setExcModalOpen(true); }}
                        className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg text-sm font-medium border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer">
                        <History className="w-4 h-4" />
                        Exceções manuais
                        <span className="px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold">{excecoes.length}</span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}

        {tab === 'produtos' && (
          <div className={`${card} p-5`}>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <div className="relative flex-1 min-w-[240px]">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                <input className={`${input} pl-9`} placeholder="Buscar por código ou descrição" value={busca}
                  onChange={e => setBusca(e.target.value)} onKeyDown={e => e.key === 'Enter' && carregarProdutos()} />
              </div>
              <button className={btnPri} onClick={() => carregarProdutos()}><Search className="w-4 h-4" />Buscar</button>
              <button className={btnGhost} onClick={() => carregarProdutos(true)} title="Recarregar do BigQuery"><RefreshCw className="w-4 h-4" />Atualizar base</button>
              {totalFiltrosProd > 0 && (
                <button
                  onClick={limparFiltrosProd}
                  title="Limpar filtros das colunas"
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-colors cursor-pointer"
                >
                  <FilterX className="w-3.5 h-3.5" />
                  Limpar {totalFiltrosProd} filtro{totalFiltrosProd > 1 ? 's' : ''}
                </button>
              )}
            </div>
            <p className="text-xs text-slate-400 mb-2">
              Exibindo {produtosView.length} {totalFiltrosProd > 0 ? `(filtrados de ${produtos.length}) ` : ''}de {totalBase} produtos.
            </p>
            <div className="overflow-auto max-h-[66vh] rounded-xl ring-1 ring-slate-200 dark:ring-slate-700">
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col style={{ width: pbTbl.prefs.widths.cod_item }} />
                  <col style={{ width: pbTbl.prefs.widths.desc_item }} />
                  <col style={{ width: pbTbl.prefs.widths.un_medida }} />
                  <col style={{ width: pbTbl.prefs.widths.cod_agrupamento }} />
                  <col style={{ width: pbTbl.prefs.widths.desc_agrupamento }} />
                  <col style={{ width: pbTbl.prefs.widths.maquinas }} />
                </colgroup>
                <thead className="bg-slate-50 dark:bg-slate-700/50 sticky top-0 z-10">
                  <tr>
                    <ExcelFilterHeader label="Código" col="cod_item" sort={pbTbl.prefs.sort} onSort={pbTbl.toggleSort} onResize={pbTbl.setWidth}
                      values={distProd.cod_item} selected={getColFilter(filtrosProd, 'cod_item')} onFilterChange={s => setColFilter(setFiltrosProd, 'cod_item', s)} />
                    <ExcelFilterHeader label="Descrição" col="desc_item" sort={pbTbl.prefs.sort} onSort={pbTbl.toggleSort} onResize={pbTbl.setWidth}
                      values={distProd.desc_item} selected={getColFilter(filtrosProd, 'desc_item')} onFilterChange={s => setColFilter(setFiltrosProd, 'desc_item', s)} />
                    <ExcelFilterHeader label="UN" col="un_medida" sort={pbTbl.prefs.sort} onSort={pbTbl.toggleSort} onResize={pbTbl.setWidth}
                      values={distProd.un_medida} selected={getColFilter(filtrosProd, 'un_medida')} onFilterChange={s => setColFilter(setFiltrosProd, 'un_medida', s)} />
                    <ExcelFilterHeader label="Cód. Agrup." col="cod_agrupamento" sort={pbTbl.prefs.sort} onSort={pbTbl.toggleSort} onResize={pbTbl.setWidth}
                      values={distProd.cod_agrupamento} selected={getColFilter(filtrosProd, 'cod_agrupamento')} onFilterChange={s => setColFilter(setFiltrosProd, 'cod_agrupamento', s)} />
                    <ExcelFilterHeader label="Desc. Agrup." col="desc_agrupamento" sort={pbTbl.prefs.sort} onSort={pbTbl.toggleSort} onResize={pbTbl.setWidth}
                      values={distProd.desc_agrupamento} selected={getColFilter(filtrosProd, 'desc_agrupamento')} onFilterChange={s => setColFilter(setFiltrosProd, 'desc_agrupamento', s)} />
                    <ExcelFilterHeader label="Máquina(s)" col="maquinas" sort={pbTbl.prefs.sort} onSort={pbTbl.toggleSort} onResize={pbTbl.setWidth}
                      values={distProd.maquinas} selected={getColFilter(filtrosProd, 'maquinas')} onFilterChange={s => setColFilter(setFiltrosProd, 'maquinas', s)} />
                  </tr>
                </thead>
                <tbody>
                  {loadingProd ? <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Carregando…</td></tr> : produtosView.map(p => (
                    <tr key={p.cod_item} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50/60 dark:hover:bg-slate-700/20">
                      <td className={`${td} font-mono text-xs`}>{p.cod_item}</td>
                      <td className={`${td} truncate`} title={p.desc_item}>{p.desc_item}</td>
                      <td className={td}>{p.un_medida}</td>
                      <td className={td}>{p.cod_agrupamento}</td>
                      <td className={`${td} truncate`} title={p.desc_agrupamento}>{p.desc_agrupamento}</td>
                      <td className="px-3 py-2">
                        {p.maquinas.length === 0 ? <span className="text-slate-300">—</span> :
                          <div className="flex gap-1 overflow-hidden" title={p.maquinas.join(', ')}>
                            {p.maquinas.map(m => <span key={m} className="px-2 py-0.5 rounded-full bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300 text-xs whitespace-nowrap">{m}</span>)}
                          </div>}
                      </td>
                    </tr>
                  ))}
                  {!loadingProd && produtos.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Nenhum produto.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {tab === 'estrutura' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* Coluna esquerda: upload + histórico */}
            <div className="space-y-5">
              {/* Upload */}
              <div className={`${card} p-5`}>
                <h3 className="inline-flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200 mb-3"><Upload className="w-4 h-4" />Enviar base de estrutura</h3>
                <input type="file" accept=".xls,.xlsx" onChange={e => setEstArquivo(e.target.files?.[0] || null)}
                  className="block w-full text-sm text-slate-600 dark:text-slate-300 file:mr-3 file:px-3.5 file:py-2 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-blue-600 file:text-white hover:file:bg-blue-700 file:cursor-pointer mb-3" />
                <button className={btnPri} disabled={!estArquivo || estEnviando} onClick={enviarEstBase}>
                  {estEnviando ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {estEnviando ? 'Enviando…' : 'Enviar base'}
                </button>
                <p className="text-[11px] text-slate-500 mt-3">São mantidas as últimas 20 versões; ao enviar uma nova, a mais antiga é removida.</p>
              </div>
              {/* Histórico */}
              <div className={`${card} p-5`}>
                <h3 className="inline-flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200 mb-3"><History className="w-4 h-4" />Histórico de versões</h3>
                <div className="overflow-auto max-h-[50vh] rounded-xl ring-1 ring-slate-200 dark:ring-slate-700">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-700/50 sticky top-0"><tr>
                      <th className={th}>Data/Hora</th><th className={th}>Enviado por</th><th className={th}>Arquivo</th><th className={`${th} text-right`}>Linhas</th>
                    </tr></thead>
                    <tbody>
                      {estVersoes.map(v => (
                        <tr key={v.id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/20">
                          <td className={`${td} text-slate-500`}><span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-slate-400" />{v.enviado_em ? new Date(v.enviado_em).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</span></td>
                          <td className={td}><span className="inline-flex items-center gap-1"><User className="w-3.5 h-3.5 text-slate-400" />{v.enviado_por_nome || '—'}</span></td>
                          <td className={`${td} truncate max-w-[180px]`} title={v.arquivo_nome}>{v.arquivo_nome}</td>
                          <td className={`${td} text-right tabular-nums`}>{v.total_linhas}</td>
                        </tr>
                      ))}
                      {estVersoes.length === 0 && <tr><td colSpan={4} className="px-3 py-6 text-center text-slate-400">Nenhuma versão enviada.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
            {/* Coluna direita: consulta */}
            <div className={`${card} p-5 lg:col-span-2`}>
              <h3 className="inline-flex items-center gap-2 text-sm font-bold text-slate-700 dark:text-slate-200 mb-3"><Network className="w-4 h-4" />Consultar estrutura de um produto</h3>
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <div className="relative flex-1 min-w-[220px]">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input className={`${input} pl-9`} placeholder="Código do produto" value={estCod}
                    onChange={e => setEstCod(e.target.value)} onKeyDown={e => e.key === 'Enter' && buscarEstrutura()} />
                </div>
                <button className={btnPri} disabled={estBuscando || !estCod.trim()} onClick={buscarEstrutura}>
                  {estBuscando ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}Buscar estrutura
                </button>
              </div>
              {estBuscou && !estEncontrado && (
                <div className="px-4 py-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 text-sm ring-1 ring-amber-200 dark:ring-amber-900/50">
                  Estrutura não encontrada para este código.
                </div>
              )}
              {estBuscou && estEncontrado && <EstruturaArvore itens={estItens} />}
              {!estBuscou && <p className="text-sm text-slate-400">Digite um código e clique em "Buscar estrutura".</p>}
            </div>
          </div>
        )}

        <Portal>
        {/* MODAL ADICIONAR */}
        {modalOpen && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={() => setModalOpen(false)}>
            <div className={`${card} w-full max-w-2xl p-5`} onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 truncate" title={selecionada?.nome}>Adicionar produtos · {selecionada?.nome}</h3>
                <button onClick={() => setModalOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
              </div>
              <div className="flex gap-2 mb-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input autoFocus className={`${input} pl-9`} placeholder="Parte da descrição ou código (ex.: slim, 103)"
                    value={buscaProd} onChange={e => setBuscaProd(e.target.value)} onKeyDown={e => e.key === 'Enter' && buscarProdutos()} />
                </div>
                <button className={btnPri} onClick={buscarProdutos}><Search className="w-4 h-4" />Buscar</button>
              </div>
              {totalFiltrosModal > 0 && (
                <div className="flex items-center justify-between gap-2 mb-2 px-3 py-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/30 ring-1 ring-blue-100 dark:ring-blue-900/40">
                  <span className="text-xs text-blue-700 dark:text-blue-300">
                    Mostrando {resultadosFiltrados.length} de {resultados.length} resultados (filtro de coluna ativo)
                  </span>
                  <button onClick={() => setFiltrosModal({})} className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 dark:text-blue-300 hover:underline">
                    <FilterX className="w-3.5 h-3.5" />Limpar filtros
                  </button>
                </div>
              )}
              <div className="overflow-auto max-h-[50vh] rounded-xl ring-1 ring-slate-200 dark:ring-slate-700">
                <table className="w-full text-sm table-fixed">
                  <colgroup><col className="w-10" /><col className="w-32" /><col /></colgroup>
                  <thead className="bg-slate-50 dark:bg-slate-700/50 sticky top-0 z-10">
                    <tr>
                      <th className="px-3 py-2.5"><input type="checkbox" checked={selecionaveis.length > 0 && selModal.size === selecionaveis.length} onChange={toggleSelModalAll} /></th>
                      <ExcelFilterHeader label="Código" col="cod_item" sort={{ key: null, dir: 'asc' }} onSort={() => {}} onResize={() => {}}
                        values={distModal.cod_item} selected={filtrosModal['cod_item'] && filtrosModal['cod_item'].length > 0 ? new Set(filtrosModal['cod_item']) : null}
                        onFilterChange={s => setFiltrosModal(p => { const n = { ...p }; if (!s || s.size === 0) delete n['cod_item']; else n['cod_item'] = Array.from(s); return n; })} />
                      <ExcelFilterHeader label="Descrição" col="desc_item" sort={{ key: null, dir: 'asc' }} onSort={() => {}} onResize={() => {}}
                        values={distModal.desc_item} selected={filtrosModal['desc_item'] && filtrosModal['desc_item'].length > 0 ? new Set(filtrosModal['desc_item']) : null}
                        onFilterChange={s => setFiltrosModal(p => { const n = { ...p }; if (!s || s.size === 0) delete n['desc_item']; else n['desc_item'] = Array.from(s); return n; })} />
                    </tr>
                  </thead>
                  <tbody>
                    {loadingBusca ? <tr><td colSpan={3} className="px-3 py-6 text-center text-slate-400">Buscando…</td></tr> : resultadosFiltrados.map(p => {
                      const naMaq = jaNaMaquina(p.cod_item);
                      return (
                        <tr key={p.cod_item} className={`border-t border-slate-100 dark:border-slate-700 ${naMaq ? 'opacity-50' : 'hover:bg-slate-50/60'}`}>
                          <td className="px-3 py-2 text-center"><input type="checkbox" disabled={naMaq} checked={selModal.has(p.cod_item)} onChange={() => toggleSelModal(p.cod_item)} /></td>
                          <td className={`${td} font-mono text-xs`}>{p.cod_item}</td>
                          <td className={`${td} truncate`} title={p.desc_item}>
                            {p.desc_item}
                            {naMaq && <span className="ml-2 inline-flex items-center gap-0.5 text-xs text-green-600"><Check className="w-3 h-3" />na máquina</span>}
                          </td>
                        </tr>
                      );
                    })}
                    {!loadingBusca && resultados.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-slate-400">Busque um produto pela descrição ou código.</td></tr>}
                    {!loadingBusca && resultados.length > 0 && resultadosFiltrados.length === 0 && <tr><td colSpan={3} className="px-3 py-6 text-center text-slate-400">Nenhum resultado após o filtro de coluna.</td></tr>}
                  </tbody>
                </table>
              </div>
              {totalBusca > resultados.length && <p className="text-xs text-slate-400 mt-1">Exibindo {resultados.length} de {totalBusca}. Refine a busca para ver mais.</p>}
              <div className="flex justify-end gap-2 mt-4">
                <button className={btnGhost} onClick={() => setModalOpen(false)}>Fechar</button>
                <button className={btnPri} disabled={selModal.size === 0} onClick={adicionarSelecionados}>
                  <Plus className="w-4 h-4" />Adicionar selecionados ({selModal.size})
                </button>
              </div>
            </div>
          </div>
        )}

        {/* MODAL — auditoria de exceções manuais */}
        {excModalOpen && (() => {
          const termo = excFiltro.trim().toUpperCase();
          const lista = excecoes.filter(x => !termo || x.cod_item.toUpperCase().includes(termo) || (x.desc_item || '').toUpperCase().includes(termo) || (x.created_by_name || '').toUpperCase().includes(termo));
          return (
            <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={() => setExcModalOpen(false)}>
              <div className={`${card} w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col`} onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-700">
                  <h3 className="inline-flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-100">
                    <History className="w-5 h-5 text-blue-600" />Exceções manuais
                    <span className="px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 text-xs font-bold">{excecoes.length}</span>
                  </h3>
                  <button onClick={() => setExcModalOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
                </div>
                <div className="px-5 pt-3">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input className={`${input} pl-9`} placeholder="Buscar por código, descrição ou usuário" value={excFiltro} onChange={e => setExcFiltro(e.target.value)} />
                  </div>
                </div>
                <div className="p-5 overflow-auto">
                  <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200 dark:ring-slate-700">
                    <table className="w-full text-sm min-w-[700px]">
                      <thead className="bg-slate-50 dark:bg-slate-700/50 sticky top-0">
                        <tr>
                          <th className={th}>Ação</th>
                          <th className={th}>Código</th>
                          <th className={th}>Descrição</th>
                          <th className={th}>Usuário</th>
                          <th className={th}>Data</th>
                          <th className="px-3 py-2.5"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {lista.map(x => (
                          <tr key={x.id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/20">
                            <td className="px-3 py-2">
                              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${x.acao === 'excluir' ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300' : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'}`}>{x.acao === 'excluir' ? 'Excluiu' : 'Incluiu'}</span>
                            </td>
                            <td className={`${td} font-mono text-xs`}>{x.cod_item}</td>
                            <td className={`${td} truncate max-w-[260px]`} title={x.desc_item}>{x.desc_item || '—'}</td>
                            <td className={td}><span className="inline-flex items-center gap-1"><User className="w-3.5 h-3.5 text-slate-400" />{x.created_by_name || '—'}</span></td>
                            <td className={`${td} text-slate-500`}><span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-slate-400" />{x.created_at ? new Date(x.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</span></td>
                            <td className="px-3 py-2 text-right">
                              <button onClick={() => removerExcecao(x.id)} className="text-slate-400 hover:text-red-600" title="Desfazer"><Trash2 className="w-4 h-4" /></button>
                            </td>
                          </tr>
                        ))}
                        {lista.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">Nenhuma exceção para o filtro.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}

        {/* MODAL — histórico de máquinas */}
        {histOpen && (() => {
          const t = histFiltro.trim().toUpperCase();
          const lista = hist.filter(h => !t || (h.maquina_nome || '').toUpperCase().includes(t) || (h.user_nome || '').toUpperCase().includes(t) || (h.acao || '').toUpperCase().includes(t));
          const acaoTone: Record<string, string> = {
            criou: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300',
            excluiu: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
            renomeou: 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300',
          };
          const acaoLabel: Record<string, string> = { criou: 'Criou', excluiu: 'Excluiu', renomeou: 'Renomeou' };
          return (
            <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/50 backdrop-blur-sm p-4" onClick={() => setHistOpen(false)}>
              <div className={`${card} w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col`} onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-700">
                  <h3 className="inline-flex items-center gap-2 text-lg font-bold text-slate-800 dark:text-slate-100"><History className="w-5 h-5 text-blue-600" />Histórico de máquinas</h3>
                  <button onClick={() => setHistOpen(false)} className="text-slate-400 hover:text-slate-700"><X className="w-5 h-5" /></button>
                </div>
                <div className="px-5 pt-3">
                  <div className="relative">
                    <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                    <input className={`${input} pl-9`} placeholder="Buscar por máquina, usuário ou ação" value={histFiltro} onChange={e => setHistFiltro(e.target.value)} />
                  </div>
                </div>
                <div className="p-5 overflow-auto">
                  <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200 dark:ring-slate-700">
                    <table className="w-full text-sm min-w-[640px]">
                      <thead className="bg-slate-50 dark:bg-slate-700/50 sticky top-0">
                        <tr>
                          <th className={th}>Ação</th>
                          <th className={th}>Máquina</th>
                          <th className={th}>Detalhe</th>
                          <th className={th}>Usuário</th>
                          <th className={th}>Data</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lista.map(h => (
                          <tr key={h.id} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700/20">
                            <td className="px-3 py-2"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${acaoTone[h.acao] || 'bg-slate-100 text-slate-600'}`}>{acaoLabel[h.acao] || h.acao}</span></td>
                            <td className={`${td} font-medium`}>{h.maquina_nome || '—'}</td>
                            <td className={`${td} truncate max-w-[220px] text-slate-500`} title={h.detalhe || ''}>{h.detalhe || '—'}</td>
                            <td className={td}><span className="inline-flex items-center gap-1"><User className="w-3.5 h-3.5 text-slate-400" />{h.user_nome || '—'}</span></td>
                            <td className={`${td} text-slate-500`}><span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-slate-400" />{h.created_at ? new Date(h.created_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</span></td>
                          </tr>
                        ))}
                        {lista.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">Nenhum registro.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          );
        })()}
        </Portal>
      </div>
    </div>
  );
};

export default CadastroMaquinas;
