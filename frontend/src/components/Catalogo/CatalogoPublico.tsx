/**
 * CatalogoPublico — Página pública das Fichas Técnicas (galeria estilo fichário).
 * Mostra TODAS as fichas marcadas como oficiais pelo Marketing (GET /catalogo/oficiais):
 * o usuário passa para o lado entre as capas, abre a que quiser (flipbook estilo revista),
 * gera PDF de cada uma e busca por nome da ficha ou por um produto específico
 * (código ou nome) — que destaca em quais fichas ele aparece.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, BookOpen, Maximize2, Minimize2, Download, X, Search, ArrowLeft } from 'lucide-react';
// @ts-ignore — react-pageflip não traz tipos
import HTMLFlipBook from 'react-pageflip';
import { api } from '../../app_api';

const LOGO = '/Logo-3LACKD.png';
// Tamanho-base do design da página (a ficha foi desenhada nesta escala). O conteúdo é
// renderizado neste tamanho fixo e escalado via transform p/ caber em `dims`, assim
// fontes/paddings encolhem junto com a página (igual ao zoom de um PDF) — evita que em
// telas de menor resolução as fontes fiquem grandes e a ficha estoure.
const BASE_W = 600, BASE_H = 780;

type ProdutoPub = {
  codigo_produto: string;
  descricao: string | null;
  imagem_id: string | null;
  ficha: Record<string, string>;
};
type Oficial = {
  id: string;
  nome: string;
  titulo_pagina: string;
  ano: number;
  subtitulo: string | null;
  usar_capa_padrao: boolean;
  capa_inicial_id: string | null;
  capa_indice_id: string | null;
  capa_final_id: string | null;
  colunas_ficha: string[];
  produtos: ProdutoPub[];
};

type Pagina =
  | { type: 'capa_padrao'; titulo: string; subtitulo: string }
  | { type: 'imagem'; imagemId: string; titulo?: string }
  | { type: 'produto'; produto: ProdutoPub; colunas: string[] };

function userId(): string {
  try { const s = sessionStorage.getItem('blackd_user'); if (s) { const p = JSON.parse(s); if (p?.id) return String(p.id); } } catch { /* */ }
  return '';
}
function imgUrl(id: string): string {
  return `/api/catalogo/imagens/${id}?_uid=${encodeURIComponent(userId())}`;
}
function norm(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Monta a lista de páginas do flipbook de uma ficha (capa(s) + produtos + contracapa).
function montarPaginas(o: Oficial): Pagina[] {
  const paginas: Pagina[] = [];
  if (o.capa_inicial_id) paginas.push({ type: 'imagem', imagemId: o.capa_inicial_id, titulo: 'Capa' });
  else if (o.usar_capa_padrao) paginas.push({
    type: 'capa_padrao',
    titulo: o.titulo_pagina,
    subtitulo: o.subtitulo || 'Linha Completa de Produtos\nConstrução • Acessibilidade • Hidráulica • Utilidades',
  });
  if (o.capa_indice_id) paginas.push({ type: 'imagem', imagemId: o.capa_indice_id, titulo: 'Índice' });
  o.produtos.forEach(p => paginas.push({ type: 'produto', produto: p, colunas: o.colunas_ficha }));
  if (o.capa_final_id) paginas.push({ type: 'imagem', imagemId: o.capa_final_id, titulo: 'Contracapa' });
  return paginas;
}

const Pagina: React.FC<{ page: Pagina; number: number }> = ({ page, number }) => {
  if (page.type === 'capa_padrao') {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center p-12 text-white"
           style={{ background: 'linear-gradient(135deg,#7f1d1d,#dc2626)' }}>
        <img src={LOGO} alt="3LACKD" className="h-20 mb-10" style={{ filter: 'brightness(0) invert(1)' }} />
        <h2 className="text-3xl font-bold text-center font-serif">{page.titulo}</h2>
        <p className="text-white/80 text-center mt-5 whitespace-pre-line text-base leading-relaxed">{page.subtitulo}</p>
      </div>
    );
  }
  if (page.type === 'imagem') {
    return (
      <div className="w-full h-full bg-white flex items-center justify-center overflow-hidden">
        <img src={imgUrl(page.imagemId)} alt={page.titulo || ''} className="w-full h-full object-cover" />
      </div>
    );
  }
  // produto — imagem à esquerda, ficha à direita
  const p = page.produto;
  return (
    <div className="w-full h-full bg-white flex flex-row overflow-hidden">
      <div className="w-[45%] h-full bg-white relative flex-shrink-0">
        {p.imagem_id ? (
          <img src={imgUrl(p.imagem_id)} alt={p.descricao || ''} className="w-full h-full object-contain p-2" />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-gray-300 text-5xl">📷</div>
        )}
        <div className="absolute bottom-0 left-0 right-0 p-4" style={{ background: 'linear-gradient(to top,rgba(0,0,0,.5),transparent)' }}>
          <h3 className="text-white text-lg font-bold leading-tight font-serif">{p.descricao || p.codigo_produto}</h3>
        </div>
      </div>
      <div className="w-[55%] h-full p-5 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[#b91c1c] text-[10px] font-bold uppercase tracking-wider">{p.codigo_produto}</span>
          <img src={LOGO} alt="" className="h-5 opacity-40" />
        </div>
        <h4 className="text-base font-bold text-gray-900 mb-3 font-serif leading-tight">{p.descricao || p.codigo_produto}</h4>
        <div className="flex-1 overflow-hidden">
          <div className="bg-gray-50 rounded-lg p-3">
            <h5 className="text-[10px] font-bold text-gray-800 uppercase tracking-wider mb-2 border-b border-gray-200 pb-1">Ficha Técnica</h5>
            <div className="space-y-1.5">
              {page.colunas.length === 0 ? (
                <div className="text-[11px] text-gray-400">Nenhuma coluna configurada.</div>
              ) : page.colunas.map(col => (
                <div key={col} className="flex text-[11px] leading-tight">
                  <span className="text-gray-400 font-medium w-24 flex-shrink-0">{col}</span>
                  <span className="text-gray-700">{p.ficha[col] || '—'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-auto pt-2 flex justify-between items-center text-[9px] text-gray-400 border-t border-gray-100">
          <span>3LACKD — Ficha Técnica</span>
          <span>Página {number}</span>
        </div>
      </div>
    </div>
  );
};

// Gera um PDF (via impressão do navegador → "Salvar como PDF"), começando pela CAPA.
function gerarPDFde(o: Oficial) {
  const esc = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const blocos: string[] = [];

  // 1) CAPA (sempre primeiro)
  if (o.capa_inicial_id) {
    blocos.push(`<section class="page capa"><img src="${imgUrl(o.capa_inicial_id)}" /></section>`);
  } else if (o.usar_capa_padrao) {
    const sub = esc(o.subtitulo || 'Linha Completa de Produtos\nConstrução • Acessibilidade • Hidráulica • Utilidades').replace(/\n/g, '<br/>');
    blocos.push(`<section class="page capa-padrao"><img class="logo" src="${LOGO}"/><h1>${esc(o.titulo_pagina)}</h1><p>${sub}</p></section>`);
  }
  // 2) Índice (opcional)
  if (o.capa_indice_id) blocos.push(`<section class="page capa"><img src="${imgUrl(o.capa_indice_id)}" /></section>`);
  // 3) Produtos
  o.produtos.forEach((p, i) => {
    const linhas = o.colunas_ficha.map(c => `<tr><td class="k">${esc(c)}</td><td class="v">${esc(p.ficha[c] || '—')}</td></tr>`).join('');
    const img = p.imagem_id ? `<img src="${imgUrl(p.imagem_id)}" />` : '';
    blocos.push(`<section class="page produto">
      <div class="foto">${img}</div>
      <div class="info">
        <div class="cod">${esc(p.codigo_produto)}</div>
        <h2>${esc(p.descricao || p.codigo_produto)}</h2>
        <h3>Ficha Técnica</h3>
        <table>${linhas}</table>
        <div class="rodape"><span>3LACKD — ${esc(o.titulo_pagina)}</span><span>Página ${i + 1}</span></div>
      </div>
    </section>`);
  });
  // 4) Capa final (opcional)
  if (o.capa_final_id) blocos.push(`<section class="page capa"><img src="${imgUrl(o.capa_final_id)}" /></section>`);

  const html = `<!doctype html><html lang="pt-br"><head><meta charset="utf-8"/>
    <title>${esc(o.titulo_pagina)}</title>
    <style>
      @page { size: A4; margin: 0; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      body { margin: 0; font-family: Georgia, 'Times New Roman', serif; color: #111; }
      .page { width: 210mm; height: 297mm; page-break-after: always; overflow: hidden; display: flex; }
      .page:last-child { page-break-after: auto; }
      .capa img, .capa { width: 210mm; height: 297mm; object-fit: cover; }
      .capa-padrao { flex-direction: column; align-items: center; justify-content: center; background: linear-gradient(135deg,#7f1d1d,#dc2626); color: #fff; text-align: center; }
      .capa-padrao .logo { height: 70px; filter: brightness(0) invert(1); margin-bottom: 40px; }
      .capa-padrao h1 { font-size: 34px; margin: 0 0 16px; }
      .capa-padrao p { font-size: 16px; opacity: .85; }
      .produto { flex-direction: row; }
      .produto .foto { width: 45%; height: 297mm; display: flex; align-items: center; justify-content: center; background: #fff; }
      .produto .foto img { max-width: 100%; max-height: 100%; object-fit: contain; }
      .produto .info { width: 55%; padding: 24px; }
      .produto .cod { color: #b91c1c; font-size: 11px; font-weight: bold; letter-spacing: 1px; }
      .produto h2 { font-size: 22px; margin: 4px 0 18px; }
      .produto h3 { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #333; border-bottom: 1px solid #ddd; padding-bottom: 4px; }
      .produto table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .produto td.k { color: #888; width: 38%; padding: 4px 0; vertical-align: top; }
      .produto td.v { color: #222; padding: 4px 0; }
      .produto .rodape { display: flex; justify-content: space-between; font-size: 9px; color: #999; margin-top: 24px; border-top: 1px solid #eee; padding-top: 6px; }
    </style></head><body>${blocos.join('')}
    <script>window.addEventListener('load',function(){setTimeout(function(){window.print();},400);});</script>
    </body></html>`;

  const w = window.open('', '_blank');
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// ─────────────────────────────────────────────
//  Visualizador de UMA ficha (flipbook estilo revista)
// ─────────────────────────────────────────────
const FichaViewer: React.FC<{ oficial: Oficial; onVoltar: () => void; irParaCodigo?: string }> = ({ oficial, onVoltar, irParaCodigo }) => {
  const flipBook = useRef<any>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [dims, setDims] = useState({ w: 600, h: 780, mobile: false });

  useEffect(() => {
    const calc = () => {
      const mobile = window.innerWidth < 700;
      const padW = mobile ? 24 : 120;
      const padH = mobile ? 170 : 230;
      let w = Math.min(window.innerWidth - padW, 600);
      let h = w * 1.3;
      const maxH = window.innerHeight - padH;
      if (h > maxH) { h = maxH; w = h / 1.3; }
      setDims({ w: Math.round(w), h: Math.round(h), mobile });
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, [fullscreen]);

  const paginas = useMemo(() => montarPaginas(oficial), [oficial]);
  const total = paginas.length;

  // Abre direto na página do produto buscado (quando veio da busca por produto).
  useEffect(() => {
    if (!irParaCodigo) return;
    const idx = paginas.findIndex(pg => pg.type === 'produto' && pg.produto.codigo_produto === irParaCodigo);
    if (idx < 0) return;
    const t = setTimeout(() => { try { flipBook.current?.pageFlip()?.flip(idx); } catch { /* */ } }, 350);
    return () => clearTimeout(t);
  }, [irParaCodigo, paginas, dims.w]);

  const goNext = () => flipBook.current?.pageFlip()?.flipNext();
  const goPrev = () => flipBook.current?.pageFlip()?.flipPrev();

  return (
    <section className={`bg-gray-100 dark:bg-slate-900 rounded-lg ${fullscreen ? 'fixed inset-0 z-50 py-4 flex flex-col rounded-none' : 'py-8'}`}>
      <div className={`mx-auto px-4 ${fullscreen ? 'flex-1 flex flex-col max-w-7xl' : 'max-w-7xl'}`}>
        {fullscreen && (
          <button onClick={() => setFullscreen(false)}
            className="fixed top-3 right-3 z-[60] flex items-center gap-1.5 text-sm text-white bg-[#b91c1c] hover:bg-[#991b1b] px-4 py-2 rounded-full shadow-lg">
            <X size={16} /> Voltar
          </button>
        )}
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <div className="flex items-center gap-3">
            <button onClick={onVoltar} className="flex items-center gap-1.5 text-sm text-slate-600 hover:text-[#b91c1c] bg-white dark:bg-slate-800 px-3 py-2 rounded-full shadow-sm">
              <ArrowLeft size={16} /> Galeria
            </button>
            <p className="text-sm text-slate-500"><span className="font-semibold text-slate-700 dark:text-slate-200">{oficial.titulo_pagina}</span> · Página {currentPage + 1} de {total}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => gerarPDFde(oficial)}
              className="flex items-center gap-2 text-sm text-white bg-[#b91c1c] hover:bg-[#991b1b] px-4 py-2 rounded-full shadow-sm">
              <Download size={16} />Gerar PDF
            </button>
            <button onClick={() => setFullscreen(f => !f)}
              className="flex items-center gap-2 text-sm text-slate-600 hover:text-[#b91c1c] bg-white dark:bg-slate-800 px-4 py-2 rounded-full shadow-sm">
              {fullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}{fullscreen ? 'Sair' : 'Tela Cheia'}
            </button>
          </div>
        </div>

        <div className={`relative flex items-center justify-center ${fullscreen ? 'flex-1' : ''}`}>
          <button onClick={goPrev} className="absolute left-0 z-10 w-12 h-12 bg-white/90 rounded-full flex items-center justify-center shadow-lg hover:bg-white -translate-x-4 md:-translate-x-6">
            <ChevronLeft size={22} className="text-gray-700" />
          </button>
          <div className="shadow-2xl rounded-lg overflow-hidden">
            <HTMLFlipBook
              ref={flipBook}
              key={`${oficial.id}-${dims.w}x${dims.h}x${dims.mobile}`}
              width={dims.w} height={dims.h} size="fixed"
              minWidth={dims.w} maxWidth={dims.w} minHeight={dims.h} maxHeight={dims.h}
              showCover={true} mobileScrollSupport={true}
              onFlip={(e: any) => setCurrentPage(e.data)}
              flippingTime={800} usePortrait={dims.mobile} startZIndex={0}
              autoSize={false} maxShadowOpacity={0.5} drawShadow={true}
              showPageCorners={!dims.mobile} disableFlipByClick={false}
              startPage={0} clickEventForward={true} useMouseEvents={true} swipeDistance={30}
              className="flipbook" style={{}}
            >
              {paginas.map((pg, i) => (
                <div key={i} className="bg-white" style={{ width: dims.w, height: dims.h, overflow: 'hidden' }}>
                  {/* Página renderizada no tamanho-base e escalada p/ caber: conteúdo e fontes escalam juntos */}
                  <div style={{ width: BASE_W, height: BASE_H, transform: `scale(${dims.w / BASE_W})`, transformOrigin: 'top left' }}>
                    <Pagina page={pg} number={i + 1} />
                  </div>
                </div>
              ))}
            </HTMLFlipBook>
          </div>
          <button onClick={goNext} className="absolute right-0 z-10 w-12 h-12 bg-white/90 rounded-full flex items-center justify-center shadow-lg hover:bg-white translate-x-4 md:translate-x-6">
            <ChevronRight size={22} className="text-gray-700" />
          </button>
        </div>

        <div className="flex justify-center gap-1.5 mt-6">
          {paginas.map((_, i) => (
            <button key={i} onClick={() => flipBook.current?.pageFlip()?.flip(i)}
              className={`h-2 rounded-full transition-all ${i === currentPage ? 'bg-[#b91c1c] w-6' : 'bg-gray-300 w-2'}`} />
          ))}
        </div>
      </div>
    </section>
  );
};

// Capa (miniatura) usada nos cards da galeria.
const CapaThumb: React.FC<{ o: Oficial }> = ({ o }) => {
  if (o.capa_inicial_id) {
    return <img src={imgUrl(o.capa_inicial_id)} alt={o.titulo_pagina} className="w-full h-full object-cover" />;
  }
  return (
    <div className="w-full h-full flex flex-col items-center justify-center text-white p-4 text-center" style={{ background: 'linear-gradient(135deg,#7f1d1d,#dc2626)' }}>
      <img src={LOGO} alt="" className="h-8 mb-4" style={{ filter: 'brightness(0) invert(1)' }} />
      <div className="text-sm font-bold font-serif leading-tight">{o.titulo_pagina}</div>
      <div className="text-white/80 text-xs mt-1">{o.ano}</div>
    </div>
  );
};

// ─────────────────────────────────────────────
//  Galeria — todas as fichas oficiais (fichário)
// ─────────────────────────────────────────────
const CARD_W = 200, CARD_H = 264, BOOK_D = 42;

// CSS do livro 3D (cuboide): capa + lombada + miolo de paginas, dando profundidade real.
const BOOK_CSS = `
.ft-stage { width:100%; height:330px; perspective:2800px; perspective-origin:50% 50%; }
.ft-ring  { width:${CARD_W}px; height:${CARD_H}px; margin:0 auto; position:relative; transform-style:preserve-3d; will-change:transform; }
.ft-book  { position:absolute; inset:0; transform-style:preserve-3d; cursor:pointer; }
.ft-face  { position:absolute; left:50%; top:50%; overflow:hidden; backface-visibility:hidden; }
.ft-cover { width:${CARD_W}px; height:${CARD_H}px; transform:translate(-50%,-50%) translateZ(${BOOK_D/2}px); border-radius:3px 8px 8px 3px;
  box-shadow: inset -10px 0 20px rgba(0,0,0,.30), inset 12px 0 14px rgba(255,255,255,.10), 0 18px 40px rgba(0,0,0,.35); }
.ft-cover::after { content:''; position:absolute; left:0; top:0; bottom:0; width:16px; background:linear-gradient(90deg, rgba(0,0,0,.40), rgba(0,0,0,0)); pointer-events:none; }
.ft-cover::before { content:''; position:absolute; right:0; top:0; bottom:0; width:8px; background:linear-gradient(270deg, rgba(255,255,255,.18), rgba(255,255,255,0)); pointer-events:none; z-index:2; }
.ft-back  { width:${CARD_W}px; height:${CARD_H}px; transform:translate(-50%,-50%) rotateY(180deg) translateZ(${BOOK_D/2}px); border-radius:8px 3px 3px 8px; background:linear-gradient(135deg,#6d0d0d,#8f1212); box-shadow:inset 0 0 30px rgba(0,0,0,.4); }
.ft-pages { width:${BOOK_D}px; height:${CARD_H}px; transform:translate(-50%,-50%) rotateY(90deg) translateZ(${CARD_W/2}px);
  background:repeating-linear-gradient(90deg,#fdfcf7 0px,#fdfcf7 1px,#e6e1d1 2px,#fbfaf4 3px); box-shadow:inset 0 0 8px rgba(0,0,0,.18); }
.ft-spine { width:${BOOK_D}px; height:${CARD_H}px; transform:translate(-50%,-50%) rotateY(-90deg) translateZ(${CARD_W/2}px);
  background:linear-gradient(90deg,#5e0b0b,#7a1010 45%,#5e0b0b); box-shadow:inset 0 0 12px rgba(0,0,0,.45); border-radius:2px; }
.ft-top   { width:${CARD_W}px; height:${BOOK_D}px; transform:translate(-50%,-50%) rotateX(90deg) translateZ(${CARD_H/2}px);
  background:repeating-linear-gradient(0deg,#fdfcf7 0px,#fdfcf7 1px,#e6e1d1 2px,#fbfaf4 3px); }
.ft-bottom{ width:${CARD_W}px; height:${BOOK_D}px; transform:translate(-50%,-50%) rotateX(-90deg) translateZ(${CARD_H/2}px);
  background:repeating-linear-gradient(0deg,#fdfcf7 0px,#fdfcf7 1px,#e6e1d1 2px,#fbfaf4 3px); }
.ft-cover > * { position:absolute; inset:0; width:100%!important; height:100%!important; }
.ft-shadow { position:absolute; left:50%; bottom:18px; width:220px; height:24px; transform:translateX(-50%); border-radius:50%;
  background:radial-gradient(ellipse, rgba(0,0,0,.30), rgba(0,0,0,0) 70%); filter:blur(3px); pointer-events:none; }
`;

const CatalogoPublico: React.FC = () => {
  const [fichas, setFichas] = useState<Oficial[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [busca, setBusca] = useState('');
  const [aberta, setAberta] = useState<{ ficha: Oficial; codigo?: string } | null>(null);
  const [front, setFront] = useState(0);

  const ringRef = useRef<HTMLDivElement>(null);
  const angleRef = useRef(0);
  const frontRef = useRef(0);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/catalogo/oficiais');
        setFichas(r.data.fichas || []);
      } catch (e) { console.error(e); }
      finally { setCarregando(false); }
    })();
  }, []);

  // Busca por nome da ficha OU por produto (codigo/nome). Guardamos o 1o produto que casa
  // para abrir direto na pagina dele e mostrar no rodape da ficha ativa.
  const resultado = useMemo(() => {
    const q = busca.trim();
    if (!q) return fichas.map(f => ({ ficha: f, produto: null as ProdutoPub | null }));
    const nq = norm(q);
    const out: { ficha: Oficial; produto: ProdutoPub | null }[] = [];
    for (const f of fichas) {
      const nomeMatch = norm(`${f.nome} ${f.titulo_pagina}`).includes(nq);
      const prod = f.produtos.find(p => norm(`${p.codigo_produto} ${p.descricao || ''}`).includes(nq)) || null;
      if (nomeMatch || prod) out.push({ ficha: f, produto: prod });
    }
    return out;
  }, [busca, fichas]);

  const buscandoProduto = busca.trim().length > 0 && resultado.some(r => r.produto);
  const n = resultado.length;
  const step = 360 / Math.max(n, 1);
  const radius = n <= 1 ? 0 : Math.round(Math.max(CARD_W * 1.15, (CARD_W / 2) / Math.tan(Math.PI / n)));

  // Reseta o giro quando a busca muda.
  useEffect(() => { angleRef.current = 0; frontRef.current = 0; setFront(0); }, [busca]);

  // Giro lento continuo (estante giratoria): ~4,5s por ficha, independente da quantidade.
  // Pausa no hover ou com uma ficha aberta. So atualiza o React quando a ficha da frente muda.
  useEffect(() => {
    if (n <= 1 || aberta) {
      if (ringRef.current) ringRef.current.style.transform = `translateY(44px) rotateY(0deg)`;
      return;
    }
    let raf = 0; let last = 0;
    const VEL = step / 4500; // graus por ms
    const loop = (ts: number) => {
      if (last) angleRef.current += (ts - last) * VEL;
      last = ts;
      if (ringRef.current) ringRef.current.style.transform = `translateY(44px) rotateY(${-angleRef.current}deg)`;
      const fi = (((Math.round(angleRef.current / step)) % n) + n) % n;
      if (fi !== frontRef.current) { frontRef.current = fi; setFront(fi); }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [n, aberta, step]);

  // Leva uma ficha para a frente pelo caminho mais curto (sem dar voltas).
  const snapTo = (i: number) => {
    const alvoBase = i * step;
    const voltas = Math.round((angleRef.current - alvoBase) / 360);
    angleRef.current = alvoBase + voltas * 360;
    frontRef.current = i; setFront(i);
    if (ringRef.current) ringRef.current.style.transform = `translateY(44px) rotateY(${-angleRef.current}deg)`;
  };
  const irProx = () => snapTo((front + 1) % Math.max(n, 1));
  const irAnt = () => snapTo((front - 1 + Math.max(n, 1)) % Math.max(n, 1));

  if (carregando) return <div className="py-20 text-center text-slate-500">Carregando fichas tecnicas...</div>;

  if (aberta) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-6">
        <FichaViewer oficial={aberta.ficha} irParaCodigo={aberta.codigo} onVoltar={() => setAberta(null)} />
      </div>
    );
  }

  const frontR = resultado[Math.min(front, Math.max(n - 1, 0))];

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      <style>{BOOK_CSS}</style>
      <header className="mb-6 text-center">
        <div className="flex items-center justify-center gap-2 text-[#b91c1c] mb-1">
          <BookOpen size={18} />
          <span className="text-xs font-semibold uppercase tracking-wider">Ficha Tecnica</span>
        </div>
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 font-serif">Galeria de Fichas Tecnicas</h1>
      </header>

      {/* Busca por nome da ficha ou por produto */}
      <div className="max-w-xl mx-auto mb-6">
        <div className="relative">
          <Search size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar ficha por nome ou um produto (codigo ou nome)..."
            className="w-full pl-10 pr-9 py-2.5 rounded-full border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-[#b91c1c]/40"
          />
          {busca && (
            <button onClick={() => setBusca('')} title="Limpar" className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
              <X size={16} />
            </button>
          )}
        </div>
        {busca.trim() && (
          <p className="text-center text-xs text-slate-500 mt-2">
            {n === 0
              ? 'Nenhuma ficha encontrada.'
              : buscandoProduto
                ? `Produto encontrado em ${resultado.filter(r => r.produto).length} ficha(s).`
                : `${n} ficha(s) encontrada(s).`}
          </p>
        )}
      </div>

      {fichas.length === 0 ? (
        <div className="py-20 text-center text-slate-500">
          <BookOpen className="mx-auto mb-3 text-slate-300" size={40} />
          Nenhuma ficha publicada ainda. Configure em Marketing -&gt; Ficha Tecnica.
        </div>
      ) : n === 0 ? (
        <div className="py-16 text-center text-slate-400 text-sm">Nenhuma ficha corresponde a busca.</div>
      ) : (
        <div className="relative">
          {/* Setas */}
          {n > 1 && (
            <>
              <button onClick={irAnt} aria-label="Anterior"
                className="absolute left-1 md:left-10 z-20 w-12 h-12 bg-white/90 dark:bg-slate-800/90 rounded-full flex items-center justify-center shadow-lg hover:bg-white"
                style={{ top: 170 }}>
                <ChevronLeft size={24} className="text-gray-700 dark:text-slate-200" />
              </button>
              <button onClick={irProx} aria-label="Proximo"
                className="absolute right-1 md:right-10 z-20 w-12 h-12 bg-white/90 dark:bg-slate-800/90 rounded-full flex items-center justify-center shadow-lg hover:bg-white"
                style={{ top: 170 }}>
                <ChevronRight size={24} className="text-gray-700 dark:text-slate-200" />
              </button>
            </>
          )}

          {/* Palco 3D giratorio (estante de livros) */}
          <div className="ft-stage">
            <div ref={ringRef} className="ft-ring" style={{ transform: 'translateY(44px) rotateY(0deg)' }}>
              {resultado.map((r, idx) => (
                <div
                  key={r.ficha.id}
                  className="ft-book"
                  style={{ transform: `rotateY(${idx * step}deg) translateZ(${radius}px)` }}
                  onClick={() => (idx === front ? setAberta({ ficha: r.ficha, codigo: r.produto?.codigo_produto }) : snapTo(idx))}
                >
                  <div className="ft-face ft-cover"><CapaThumb o={r.ficha} /></div>
                  <div className="ft-face ft-back" />
                  <div className="ft-face ft-pages" />
                  <div className="ft-face ft-spine" />
                  <div className="ft-face ft-top" />
                  <div className="ft-face ft-bottom" />
                </div>
              ))}
            </div>
            <div className="ft-shadow" />
          </div>

          {/* Ficha da frente + acoes */}
          {frontR && (
            <div className="text-center mt-2">
              <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100 font-serif leading-tight">{frontR.ficha.titulo_pagina}</h3>
              <div className="text-xs text-slate-400 mt-0.5">{frontR.ficha.ano} · {frontR.ficha.produtos.length} produto(s)</div>
              {frontR.produto && (
                <div className="inline-block mt-2 text-[11px] bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200 rounded px-2 py-1 leading-tight">
                  <span className="font-bold">{frontR.produto.codigo_produto}</span> — {frontR.produto.descricao || ''}
                </div>
              )}
              <div className="flex items-center justify-center gap-2 mt-3">
                <button onClick={() => setAberta({ ficha: frontR.ficha, codigo: frontR.produto?.codigo_produto })}
                  className="inline-flex items-center justify-center gap-1.5 text-sm font-semibold text-white bg-[#b91c1c] hover:bg-[#991b1b] px-5 py-2 rounded-full shadow-sm">
                  <BookOpen size={16} /> Abrir
                </button>
                <button onClick={() => gerarPDFde(frontR.ficha)} title="Gerar PDF"
                  className="inline-flex items-center justify-center gap-1.5 text-sm font-semibold text-slate-600 dark:text-slate-200 bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 px-5 py-2 rounded-full">
                  <Download size={16} /> Gerar PDF
                </button>
              </div>
            </div>
          )}

          {/* Indicadores */}
          {n > 1 && (
            <div className="flex justify-center gap-1.5 mt-4 flex-wrap">
              {resultado.map((_, idx) => (
                <button key={idx} onClick={() => snapTo(idx)}
                  className={`h-2 rounded-full transition-all ${idx === front ? 'bg-[#b91c1c] w-6' : 'bg-gray-300 w-2'}`} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default CatalogoPublico;
