/**
 * CatalogoManager — Aba "Catálogo" dentro de Marketing.
 *
 * Dois modos:
 *  1) BIBLIOTECA de produtos (reutilizável): cadastra foto + produto UMA vez
 *     (busca na base por código/nome, foto padronizada no upload).
 *  2) MODELOS de catálogo: configura título/ano/colunas/capas e apenas FLAGA
 *     quais produtos da biblioteca entram no catálogo (com busca por código/nome).
 *     Marca a VERSÃO OFICIAL, refletida na página pública /catalogo.
 */
import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../app_api';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { normalizeImage, FOTO_PRODUTO, FOTO_CAPA } from '../../utils/normalizeImage';

type ColunaBase = { grupo: string; nome: string };
type BibItem = { id: string; codigo: string; descricao: string | null; imagem_id: string | null };
type FlagItem = { biblioteca_id: string; codigo: string; descricao: string | null; imagem_id: string | null; incluido: boolean; ordem: number };
type ProdutoModelo = { biblioteca_id: string; codigo_produto: string; descricao: string | null; imagem_id: string | null; ordem: number; ficha: Record<string, string> };
type Modelo = {
  id: string; nome: string; titulo_pagina: string; subtitulo: string | null; ano: number; oficial: boolean;
  colunas_ficha: string[];
  capa_inicial_id: string | null; capa_indice_id: string | null; capa_final_id: string | null;
  usar_capa_padrao: boolean; produtos: ProdutoModelo[];
};
type ModeloResumo = { id: string; nome: string; titulo_pagina: string; ano: number; oficial: boolean; produtos_incluidos: number };

function userId(): string {
  try { const s = sessionStorage.getItem('empresa_user'); if (s) { const p = JSON.parse(s); if (p?.id) return String(p.id); } } catch { /* */ }
  return '';
}
function authHeaders(): Record<string, string> { const id = userId(); return id ? { 'user-id': id } : {}; }
function imgUrl(id: string): string { return `/api/catalogo/imagens/${id}?_uid=${encodeURIComponent(userId())}`; }

async function uploadImagemNormalizada(file: File, preset: typeof FOTO_PRODUTO): Promise<string | null> {
  const norm = await normalizeImage(file, preset);
  const fd = new FormData();
  fd.append('file', norm);
  const resp = await fetch('/api/catalogo/imagens', { method: 'POST', credentials: 'include', headers: authHeaders(), body: fd });
  if (!resp.ok) return null;
  return (await resp.json()).id as string;
}

const inputCls =
  'w-full text-sm px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500';

const CatalogoManager: React.FC = () => {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [view, setView] = useState<'modelos' | 'biblioteca'>('modelos');

  // base / colunas
  const [colunas, setColunas] = useState<ColunaBase[]>([]);
  const [baseSync, setBaseSync] = useState<{ total: number; sincronizado_em: string | null }>({ total: 0, sincronizado_em: null });
  const [sincronizando, setSincronizando] = useState(false);

  async function carregarColunas() {
    try {
      const r = await api.get('/catalogo/base/colunas');
      setColunas(r.data.colunas || []);
      setBaseSync({ total: r.data.total || 0, sincronizado_em: r.data.sincronizado_em || null });
    } catch (e) { console.error(e); }
  }
  async function sincronizarBase() {
    setSincronizando(true);
    try {
      const r = await api.post('/catalogo/base/sync', {});
      showToast(`Base sincronizada: ${r.data.total} produtos, ${r.data.colunas} colunas.`, 'success');
      await carregarColunas();
    } catch (e: any) { showToast(`Erro ao sincronizar: ${e.message}`, 'error'); }
    finally { setSincronizando(false); }
  }
  useEffect(() => { carregarColunas(); }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
          <button onClick={() => setView('modelos')} className={`px-4 py-2 text-sm font-semibold ${view === 'modelos' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600'}`}>Modelos</button>
          <button onClick={() => setView('biblioteca')} className={`px-4 py-2 text-sm font-semibold ${view === 'biblioteca' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-slate-800 text-slate-600'}`}>Biblioteca de produtos</button>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            Base: {baseSync.total} produtos {baseSync.sincronizado_em ? `· ${new Date(baseSync.sincronizado_em).toLocaleString('pt-BR')}` : '· nunca sincronizada'}
          </span>
          <button onClick={sincronizarBase} disabled={sincronizando}
            className={`px-4 py-2 text-sm font-semibold rounded-md ${sincronizando ? 'bg-slate-400 text-white' : 'bg-slate-200 hover:bg-slate-300 text-slate-700 dark:bg-slate-700 dark:text-slate-100'}`}>
            {sincronizando ? 'Sincronizando…' : 'Sincronizar base'}
          </button>
        </div>
      </div>

      {view === 'biblioteca'
        ? <Biblioteca showToast={showToast} confirm={confirm} />
        : <Modelos colunas={colunas} showToast={showToast} confirm={confirm} />}
    </div>
  );
};

/* ════════════════ BIBLIOTECA ════════════════ */
const Biblioteca: React.FC<{ showToast: any; confirm: any }> = ({ showToast, confirm }) => {
  const [itens, setItens] = useState<BibItem[]>([]);
  const [filtro, setFiltro] = useState('');
  const [busca, setBusca] = useState('');
  const [sugestoes, setSugestoes] = useState<{ codigo: string; descricao: string; status: string }[]>([]);
  const buscaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function carregar(q = '') {
    try { const r = await api.get('/catalogo/biblioteca', { params: { q } }); setItens(r.data.itens || []); }
    catch (e) { console.error(e); }
  }
  useEffect(() => { carregar(); }, []);

  function onBusca(v: string) {
    setBusca(v);
    if (buscaTimer.current) clearTimeout(buscaTimer.current);
    if (!v.trim()) { setSugestoes([]); return; }
    buscaTimer.current = setTimeout(async () => {
      try { const r = await api.get('/catalogo/base/buscar', { params: { q: v, limit: 15 } }); setSugestoes(r.data.itens || []); }
      catch { setSugestoes([]); }
    }, 250);
  }
  async function adicionar(codigo: string, descricao: string) {
    try {
      await api.post('/catalogo/biblioteca', { codigo_produto: codigo, descricao });
      setBusca(''); setSugestoes([]);
      await carregar(filtro);
      showToast('Produto adicionado à biblioteca. Envie a foto.', 'success');
    } catch (e: any) { showToast(`Erro: ${e.message}`, 'error'); }
  }
  async function trocarFoto(item: BibItem, file: File | null) {
    if (!file) return;
    const id = await uploadImagemNormalizada(file, FOTO_PRODUTO);
    if (!id) { showToast('Erro no upload da imagem', 'error'); return; }
    await fetch(`/api/catalogo/biblioteca/${item.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ imagem_id: id }),
    });
    setItens(prev => prev.map(x => x.id === item.id ? { ...x, imagem_id: id } : x));
  }
  async function remover(item: BibItem) {
    const ok = await confirm({ title: 'Remover da biblioteca', message: `Remover "${item.descricao || item.codigo}" da biblioteca? Ele sairá de todos os catálogos.`, confirmText: 'Remover', variant: 'danger' });
    if (!ok) return;
    try { await api.del(`/catalogo/biblioteca/${item.id}`); setItens(prev => prev.filter(x => x.id !== item.id)); }
    catch (e: any) { showToast(`Erro: ${e.message}`, 'error'); }
  }

  return (
    <div>
      <div className="relative mb-3 max-w-xl">
        <input className={inputCls} placeholder="Adicionar produto: buscar na base por código ou nome…" value={busca} onChange={e => onBusca(e.target.value)} />
        {sugestoes.length > 0 && (
          <div className="absolute z-20 left-0 right-0 mt-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md shadow-lg max-h-64 overflow-y-auto">
            {sugestoes.map(s => (
              <button key={s.codigo} onClick={() => adicionar(s.codigo, s.descricao)} className="w-full text-left px-3 py-2 text-sm hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center justify-between">
                <span><b>{s.codigo}</b> — {s.descricao}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.status === 'ATIVO' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>{s.status}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Biblioteca ({itens.length})</h2>
        <input className={`${inputCls} max-w-xs`} placeholder="Filtrar biblioteca…" value={filtro}
          onChange={e => { setFiltro(e.target.value); carregar(e.target.value); }} />
      </div>

      {itens.length === 0 ? (
        <div className="py-10 text-center text-slate-500 border border-dashed border-slate-300 rounded-lg">Nenhum produto na biblioteca. Use a busca acima para adicionar.</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {itens.map(item => (
            <div key={item.id} className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
              <div className="aspect-square bg-slate-100 dark:bg-slate-700 flex items-center justify-center">
                {item.imagem_id ? <img src={imgUrl(item.imagem_id)} alt="" className="w-full h-full object-contain" /> : <span className="text-slate-400 text-3xl">📷</span>}
              </div>
              <div className="p-2">
                <div className="text-xs font-semibold text-slate-800 dark:text-slate-100 truncate">{item.codigo}</div>
                <div className="text-[11px] text-slate-500 line-clamp-2 h-8">{item.descricao}</div>
                <div className="flex items-center justify-between mt-2">
                  <label className="text-[11px] px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white cursor-pointer">
                    {item.imagem_id ? 'Trocar foto' : 'Enviar foto'}
                    <input type="file" accept="image/*" className="hidden" onChange={e => trocarFoto(item, e.target.files?.[0] || null)} />
                  </label>
                  <button onClick={() => remover(item)} className="text-[11px] text-red-600 hover:text-red-700 font-semibold">Remover</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

/* ════════════════ MODELOS ════════════════ */
const Modelos: React.FC<{ colunas: ColunaBase[]; showToast: any; confirm: any }> = ({ colunas, showToast, confirm }) => {
  const [modelos, setModelos] = useState<ModeloResumo[]>([]);
  const [modelo, setModelo] = useState<Modelo | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [seletorAberto, setSeletorAberto] = useState(false);

  // flag list (biblioteca com inclusão por modelo)
  const [flags, setFlags] = useState<FlagItem[]>([]);
  const [flagBusca, setFlagBusca] = useState('');

  async function carregarModelos() {
    setCarregando(true);
    try { const r = await api.get('/catalogo/modelos'); setModelos(r.data.modelos || []); }
    catch (e) { console.error(e); } finally { setCarregando(false); }
  }
  async function abrirModelo(id: string) {
    try {
      const r = await api.get(`/catalogo/modelos/${id}`);
      setModelo(r.data);
      await carregarFlags(id, '');
    } catch (e: any) { showToast(`Erro ao abrir modelo: ${e.message}`, 'error'); }
  }
  async function carregarFlags(mid: string, q: string) {
    try { const r = await api.get(`/catalogo/modelos/${mid}/biblioteca`, { params: { q } }); setFlags(r.data.itens || []); }
    catch (e) { console.error(e); }
  }
  useEffect(() => { carregarModelos(); }, []);

  function setCampoModelo(patch: Partial<Modelo>) { setModelo(m => (m ? { ...m, ...patch } : m)); }

  async function criarModelo() {
    try {
      const r = await api.post('/catalogo/modelos', { nome: 'Novo catálogo', titulo_pagina: 'Catálogo EMPRESA 2026', ano: 2026 });
      await carregarModelos();
      await abrirModelo(r.data.id);
      showToast('Modelo criado. Ajuste o nome e a configuração e clique em Salvar.', 'success');
    } catch (e: any) { showToast(`Erro ao criar modelo: ${e.message}`, 'error'); }
  }
  async function salvarModelo() {
    if (!modelo) return;
    setSalvando(true);
    try {
      const resp = await fetch(`/api/catalogo/modelos/${modelo.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          nome: modelo.nome, titulo_pagina: modelo.titulo_pagina, subtitulo: modelo.subtitulo ?? '',
          ano: modelo.ano, usar_capa_padrao: modelo.usar_capa_padrao, colunas_ficha: modelo.colunas_ficha,
        }),
      });
      if (!resp.ok) { const e = await resp.json().catch(() => ({})); throw new Error(e.detail || resp.statusText); }
      showToast('Modelo salvo.', 'success');
      await carregarModelos();
      await abrirModelo(modelo.id);
    } catch (e: any) { showToast(`Erro ao salvar: ${e.message}`, 'error'); }
    finally { setSalvando(false); }
  }
  async function definirOficial() {
    if (!modelo) return;
    const publicar = !modelo.oficial;
    const ok = await confirm({
      title: publicar ? 'Publicar ficha' : 'Despublicar ficha',
      message: publicar
        ? 'Publicar esta ficha? Ela passa a aparecer na galeria pública de Fichas Técnicas. Várias fichas podem ficar publicadas ao mesmo tempo.'
        : 'Despublicar esta ficha? Ela deixa de aparecer na galeria pública de Fichas Técnicas.',
      confirmText: publicar ? 'Publicar' : 'Despublicar', variant: 'info',
    });
    if (!ok) return;
    try { await api.post(`/catalogo/modelos/${modelo.id}/oficial`, {}); showToast(publicar ? 'Ficha publicada.' : 'Ficha despublicada.', 'success'); await carregarModelos(); await abrirModelo(modelo.id); }
    catch (e: any) { showToast(`Erro: ${e.message}`, 'error'); }
  }
  async function excluirModelo() {
    if (!modelo) return;
    const ok = await confirm({ title: 'Excluir modelo', message: `Excluir o modelo "${modelo.nome}"? Esta ação não pode ser desfeita.`, confirmText: 'Excluir', variant: 'danger' });
    if (!ok) return;
    try { await api.del(`/catalogo/modelos/${modelo.id}`); setModelo(null); await carregarModelos(); showToast('Modelo excluído.', 'success'); }
    catch (e: any) { showToast(`Erro: ${e.message}`, 'error'); }
  }

  async function toggleColuna(nome: string) {
    if (!modelo) return;
    const novas = modelo.colunas_ficha.includes(nome)
      ? modelo.colunas_ficha.filter(c => c !== nome)
      : [...modelo.colunas_ficha, nome];
    setCampoModelo({ colunas_ficha: novas });
    // Persiste imediatamente para não depender da ordem de cliques (evita perder a seleção)
    try {
      const resp = await fetch(`/api/catalogo/modelos/${modelo.id}`, {
        method: 'PATCH', credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ colunas_ficha: novas }),
      });
      if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).detail || resp.statusText);
    } catch (e: any) { showToast(`Erro ao salvar colunas: ${e.message}`, 'error'); }
  }

  async function trocarCapa(campo: 'capa_inicial_id' | 'capa_indice_id' | 'capa_final_id', file: File | null) {
    if (!modelo || !file) return;
    const id = await uploadImagemNormalizada(file, FOTO_CAPA);
    if (!id) { showToast('Erro no upload da imagem', 'error'); return; }
    await fetch(`/api/catalogo/modelos/${modelo.id}`, {
      method: 'PATCH', credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ [campo]: id }),
    });
    setCampoModelo({ [campo]: id } as any);
  }

  // FLAG: incluir/excluir produto da biblioteca neste modelo
  async function toggleFlag(f: FlagItem) {
    if (!modelo) return;
    try {
      if (f.incluido) {
        await api.del(`/catalogo/modelos/${modelo.id}/itens/${f.biblioteca_id}`);
      } else {
        await api.post(`/catalogo/modelos/${modelo.id}/itens`, { biblioteca_id: f.biblioteca_id });
      }
      setFlags(prev => prev.map(x => x.biblioteca_id === f.biblioteca_id ? { ...x, incluido: !x.incluido } : x));
      // recarrega só os produtos do modelo, preservando edições locais ainda não salvas
      const r = await api.get(`/catalogo/modelos/${modelo.id}`);
      setModelo(m => m ? {
        ...r.data,
        nome: m.nome, titulo_pagina: m.titulo_pagina, subtitulo: m.subtitulo,
        ano: m.ano, usar_capa_padrao: m.usar_capa_padrao, colunas_ficha: m.colunas_ficha,
      } : r.data);
    } catch (e: any) { showToast(`Erro: ${e.message}`, 'error'); }
  }

  const colunasPorGrupo = colunas.reduce<Record<string, ColunaBase[]>>((acc, c) => { (acc[c.grupo] = acc[c.grupo] || []).push(c); return acc; }, {});
  const totalIncluidos = flags.filter(f => f.incluido).length;

  // lista de modelos
  if (!modelo) {
    return (
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Modelos de catálogo</h2>
          <button onClick={criarModelo} className="px-4 py-2 text-sm font-semibold rounded-md bg-blue-600 hover:bg-blue-700 text-white">Novo modelo</button>
        </div>
        {carregando ? <div className="py-12 text-center text-slate-500">Carregando…</div>
          : modelos.length === 0 ? <div className="py-12 text-center text-slate-500 border border-dashed border-slate-300 rounded-lg">Nenhum modelo ainda. Clique em "Novo modelo".</div>
            : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {modelos.map(m => (
                  <button key={m.id} onClick={() => abrirModelo(m.id)} className="text-left bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 hover:border-blue-500 transition">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-800 dark:text-slate-100">{m.nome}</span>
                      {m.oficial && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-700">PUBLICADA</span>}
                    </div>
                    <div className="text-xs text-slate-500 mt-1">{m.titulo_pagina} · {m.ano}</div>
                    <div className="text-xs text-slate-400 mt-2">{m.produtos_incluidos} produtos no catálogo</div>
                  </button>
                ))}
              </div>
            )}
      </div>
    );
  }

  // editor
  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={() => setModelo(null)} className="text-sm text-blue-600 hover:underline">← Voltar aos modelos</button>
        <div className="flex gap-2">
          <button onClick={definirOficial} title={modelo.oficial ? 'Clique para despublicar' : 'Publicar na galeria de Fichas Técnicas'} className={`px-4 py-2 text-sm font-semibold rounded-md ${modelo.oficial ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-emerald-600 hover:bg-emerald-700 text-white'}`}>
            {modelo.oficial ? '★ Publicada' : 'Publicar ficha'}
          </button>
          <button onClick={salvarModelo} disabled={salvando} className={`px-4 py-2 text-sm font-semibold rounded-md ${salvando ? 'bg-slate-400 text-white' : 'bg-blue-600 hover:bg-blue-700 text-white'}`}>
            {salvando ? 'Salvando…' : 'Salvar modelo'}
          </button>
          <button onClick={excluirModelo} className="px-3 py-2 text-sm font-semibold rounded-md text-red-600 hover:bg-red-50">Excluir</button>
        </div>
      </div>

      {/* Configuração */}
      <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 mb-4">
        <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200 mb-3">Configuração da página</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div><label className="text-xs text-slate-500">Nome do modelo</label><input className={inputCls} value={modelo.nome} onChange={e => setCampoModelo({ nome: e.target.value })} /></div>
          <div><label className="text-xs text-slate-500">Título da página</label><input className={inputCls} value={modelo.titulo_pagina} onChange={e => setCampoModelo({ titulo_pagina: e.target.value })} /></div>
          <div><label className="text-xs text-slate-500">Ano</label><input type="number" className={inputCls} value={modelo.ano} onChange={e => setCampoModelo({ ano: parseInt(e.target.value) || modelo.ano })} /></div>
          <div className="md:col-span-3"><label className="text-xs text-slate-500">Subtítulo</label><input className={inputCls} value={modelo.subtitulo ?? ''} onChange={e => setCampoModelo({ subtitulo: e.target.value })} placeholder="Linha Completa de Produtos · Construção • Acessibilidade • Hidráulica • Utilidades" /></div>
        </div>
      </section>

      {/* Colunas */}
      <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Colunas da ficha técnica</h3>
            <p className="text-xs text-slate-500 mt-0.5">Aparecem na ficha de <b>todos</b> os produtos. ({modelo.colunas_ficha.length} selecionadas)</p>
          </div>
          <button onClick={() => setSeletorAberto(s => !s)} className="px-4 py-2 text-sm font-semibold rounded-md bg-slate-200 hover:bg-slate-300 text-slate-700 dark:bg-slate-700 dark:text-slate-100">{seletorAberto ? 'Fechar seletor' : 'Selecionar colunas'}</button>
        </div>
        {modelo.colunas_ficha.length > 0 && <div className="flex flex-wrap gap-1.5 mt-3">{modelo.colunas_ficha.map(c => <span key={c} className="text-[11px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{c}</span>)}</div>}
        {seletorAberto && (colunas.length === 0
          ? <div className="mt-4 text-xs text-amber-600">Base não sincronizada. Clique em "Sincronizar base".</div>
          : <div className="mt-4 max-h-72 overflow-y-auto border-t border-slate-100 dark:border-slate-700 pt-3 space-y-3">
            {Object.entries(colunasPorGrupo).map(([grupo, cols]) => (
              <div key={grupo}>
                <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1">{grupo || 'Geral'}</div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-1">
                  {cols.map(c => (
                    <label key={c.nome} className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-200 cursor-pointer">
                      <input type="checkbox" className="accent-blue-600" checked={modelo.colunas_ficha.includes(c.nome)} onChange={() => toggleColuna(c.nome)} />
                      <span className="truncate">{c.nome}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>)}
      </section>

      {/* Capas */}
      <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Capas</h3>
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
            <input type="checkbox" className="accent-blue-600" checked={modelo.usar_capa_padrao} onChange={e => setCampoModelo({ usar_capa_padrao: e.target.checked })} />
            Usar capa padrão (arte vermelha "Catálogo EMPRESA {modelo.ano}")
          </label>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {([['capa_inicial_id', 'Capa inicial'], ['capa_indice_id', 'Índice'], ['capa_final_id', 'Capa final']] as const).map(([campo, label]) => (
            <div key={campo} className="border border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-3 text-center">
              <div className="text-xs font-medium text-slate-600 dark:text-slate-300 mb-2">{label}</div>
              {modelo[campo]
                ? <img src={imgUrl(modelo[campo] as string)} alt={label} className="mx-auto h-28 object-contain mb-2" />
                : <div className="h-28 flex items-center justify-center text-slate-400 text-xs mb-2">{campo === 'capa_inicial_id' && modelo.usar_capa_padrao ? 'Capa padrão 2026' : 'Sem imagem'}</div>}
              <label className="inline-block text-xs px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white cursor-pointer">
                {modelo[campo] ? 'Trocar' : 'Enviar'}
                <input type="file" accept="image/*" className="hidden" onChange={e => trocarCapa(campo, e.target.files?.[0] || null)} />
              </label>
            </div>
          ))}
        </div>
      </section>

      {/* Produtos — flag a partir da biblioteca */}
      <section className="bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-200">Produtos do catálogo <span className="text-slate-400 font-normal">({totalIncluidos} marcados)</span></h3>
          <input className={`${inputCls} max-w-xs`} placeholder="Buscar por código ou nome…" value={flagBusca}
            onChange={e => { setFlagBusca(e.target.value); carregarFlags(modelo.id, e.target.value); }} />
        </div>
        <p className="text-xs text-slate-500 mb-3">Marque os produtos da biblioteca que entram neste catálogo. Para cadastrar novos produtos/fotos, use a aba <b>Biblioteca de produtos</b>.</p>
        {flags.length === 0 ? (
          <div className="py-8 text-center text-slate-500 border border-dashed border-slate-300 rounded-lg">Biblioteca vazia ou sem resultados. Cadastre produtos na aba Biblioteca.</div>
        ) : (
          <div className="space-y-2 max-h-[28rem] overflow-y-auto">
            {flags.map(f => {
              const ficha = modelo.produtos.find(p => p.biblioteca_id === f.biblioteca_id)?.ficha || {};
              return (
                <label key={f.biblioteca_id} className={`flex gap-3 items-center border rounded-lg p-2 cursor-pointer ${f.incluido ? 'border-emerald-300 bg-emerald-50/40 dark:bg-emerald-900/10' : 'border-slate-200 dark:border-slate-700'}`}>
                  <input type="checkbox" className="accent-emerald-600 w-4 h-4" checked={f.incluido} onChange={() => toggleFlag(f)} />
                  <div className="w-14 h-14 flex-shrink-0 bg-slate-100 dark:bg-slate-700 rounded overflow-hidden flex items-center justify-center">
                    {f.imagem_id ? <img src={imgUrl(f.imagem_id)} alt="" className="w-full h-full object-contain" /> : <span className="text-slate-400 text-lg">📷</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{f.codigo} — {f.descricao}</div>
                    {f.incluido && modelo.colunas_ficha.length > 0 && (
                      <div className="text-[11px] text-slate-500 truncate">{modelo.colunas_ficha.map(c => `${c}: ${ficha[c] || '—'}`).join(' · ')}</div>
                    )}
                    {!f.imagem_id && <div className="text-[11px] text-amber-600">Sem foto — envie na aba Biblioteca</div>}
                  </div>
                </label>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};

export default CatalogoManager;
