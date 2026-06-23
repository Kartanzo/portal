/**
 * EventosAlbum — Álbum de figurinhas "Seleção 3LACKD" (estilo Panini).
 * Porte fiel do modelo copa/album.js, dirigido pelas fotos do banco
 * (nome/posicao/numero/craque/obj_position definidos pelo Marketing).
 */
import React, { useEffect, useRef, useState } from 'react';
import './eventos-album.css';

type Foto = {
  id: string; mime: string; ordem: number; criado_em: string;
  nome?: string | null; posicao?: string | null; numero?: string | null;
  craque?: boolean; obj_position?: string | null;
};

function authHeaders(): Record<string, string> {
  try {
    const saved = sessionStorage.getItem('blackd_user');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed?.id) return { 'user-id': String(parsed.id) };
    }
  } catch { /* ignore */ }
  return {};
}

function photoSrc(id: string): string {
  try {
    const saved = sessionStorage.getItem('blackd_user');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed?.id) return `/api/eventos/fotos/${id}?_uid=${encodeURIComponent(String(parsed.id))}`;
    }
  } catch { /* ignore */ }
  return `/api/eventos/fotos/${id}`;
}

const esc = (s: any) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

const EventosAlbum: React.FC = () => {
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [loading, setLoading] = useState(true);
  const [isFull, setIsFull] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const bookRef = useRef<HTMLDivElement>(null);
  const prevRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const dotsRef = useRef<HTMLSpanElement>(null);
  const lbRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/api/eventos/fotos', { credentials: 'include', headers: authHeaders() })
      .then(r => r.ok ? r.json() : { fotos: [] })
      .then(d => setFotos(d.fotos || []))
      .catch(() => setFotos([]))
      .finally(() => setLoading(false));
  }, []);

  // Toggle de tela cheia (overlay fixo — funciona em mobile; tenta também a Fullscreen API nativa)
  const toggleFull = () => {
    const next = !isFull;
    setIsFull(next);
    try {
      const el = rootRef.current as any;
      if (next) {
        const req = el?.requestFullscreen || el?.webkitRequestFullscreen;
        if (req) req.call(el).catch?.(() => {});
      } else {
        const doc = document as any;
        const exit = doc.exitFullscreen || doc.webkitExitFullscreen;
        if ((doc.fullscreenElement || doc.webkitFullscreenElement) && exit) exit.call(doc).catch?.(() => {});
      }
    } catch { /* ignore */ }
  };

  // Reescala o álbum ao entrar/sair de tela cheia e sincroniza se o usuário sair via Esc
  useEffect(() => {
    window.dispatchEvent(new Event('resize'));
    const onFsChange = () => {
      const doc = document as any;
      if (!doc.fullscreenElement && !doc.webkitFullscreenElement) setIsFull(false);
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
    };
  }, [isFull]);

  useEffect(() => {
    if (loading) return;
    const bookEl = bookRef.current, stage = stageRef.current;
    const prevB = prevRef.current, nextB = nextRef.current;
    const dotsEl = dotsRef.current, lb = lbRef.current;
    if (!bookEl || !stage || !prevB || !nextB || !dotsEl || !lb) return;

    /* ---- emblema (crest) — porte fiel ---- */
    let _idc = 0;
    function crest(size: number, cls?: string) {
      const u = 'c' + (_idc++);
      return `<svg class="${cls || 'crest'}" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true">
        <defs>
          <linearGradient id="${u}y" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe661"/><stop offset="1" stop-color="#f3b500"/></linearGradient>
          <radialGradient id="${u}b" cx="40%" cy="36%" r="72%"><stop offset="0" stop-color="#1e54c8"/><stop offset=".7" stop-color="#002776"/><stop offset="1" stop-color="#001a52"/></radialGradient>
          <clipPath id="${u}g"><circle cx="50" cy="50" r="16.5"/></clipPath>
        </defs>
        <circle cx="50" cy="50" r="48" fill="#0a8a3c" stroke="#fff" stroke-width="4"/>
        <path d="M50 16 L86 50 L50 84 L14 50 Z" fill="url(#${u}y)" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>
        <circle cx="50" cy="50" r="16.5" fill="url(#${u}b)" stroke="#fff" stroke-width="2"/>
        <g clip-path="url(#${u}g)"><rect x="31" y="47.3" width="38" height="5" fill="#fff" transform="rotate(-23 50 50)"/></g>
        <g fill="#fff"><circle cx="43" cy="45" r="1.1"/><circle cx="55" cy="44" r="1.1"/><circle cx="58" cy="55" r="1"/><circle cx="45" cy="56" r="1"/><circle cx="51" cy="43" r=".9"/></g>
      </svg>`;
    }

    /* ---- figurinha ---- */
    function sticker(f: Foto | null, i: number, special?: boolean) {
      const dx = (i % 3 - 1) * 6;
      const r = (i % 2 ? 5 : -5);
      if (special) {
        return `<div class="cell" style="--i:${i};--dx:${dx}px;--r:${r}deg">
          <div class="stk gold special" data-special="1">
            <div class="stk-in">
              <div class="stk-photo"><img class="specialflag" src="/eventos/bandeira-brasil.png" alt="Brasil"></div>
              <div class="stk-bar"><div class="nk">Brasil</div><div class="ps">Seleção 3LACKD</div></div>
              <div class="holo"></div><div class="shine"></div>
            </div>
          </div></div>`;
      }
      if (!f) {
        return `<div class="cell" style="--i:${i};--dx:${dx}px;--r:${r}deg">
          <div class="slot">
            <div class="dash"></div>
            <div class="num">??</div>
            <div class="g"><div class="sil"></div><div class="nn">?</div><div class="tx">Falta</div></div>
          </div></div>`;
      }
      const cls = 'stk' + (f.craque ? ' gold' : '');
      const obj = f.obj_position || 'center 30%';
      return `<div class="cell" style="--i:${i};--dx:${dx}px;--r:${r}deg">
        <div class="${cls}" data-fig="${esc(f.id)}">
          <div class="stk-in">
            <div class="stk-photo"><img src="${photoSrc(f.id)}" alt="${esc(f.nome)}" style="object-position:${esc(obj)}" loading="lazy"></div>
            <div class="stk-bar"><div class="nk">${esc(f.nome) || '&nbsp;'}</div><div class="ps">${esc(f.posicao)}</div></div>
            ${f.numero ? `<div class="num">${esc(f.numero)}</div>` : ''}
            <div class="holo"></div><div class="shine"></div>
          </div>
        </div></div>`;
    }

    function paniniPage(cells: (Foto | null)[], pageNo: number, comSpecial: boolean) {
      const titulo = comSpecial ? 'Seleção 3LACKD' : 'Convocados';
      const sub = comSpecial ? 'Elenco Oficial · 2026' : 'Seleção 3LACKD · Brasil';
      let i = 0;
      const html = cells.map((c) => {
        const isSpecial = comSpecial && i === 0;
        return sticker(isSpecial ? null : c, i++, isSpecial);
      }).join('');
      return `<div class="pp">
        <div class="pp-head">
          ${crest(46)}
          <div class="ht"><div class="t">${titulo}</div><div class="s">${sub}</div></div>
          <div class="cup">${crest(50)}</div>
        </div>
        <div class="pp-flag"><i class="g"></i><i class="r"></i><i class="w"></i></div>
        <div class="grid">${html}</div>
        <div class="pg-num">Seleção 3LACKD · ${String(pageNo).padStart(2, '0')}</div>
      </div>`;
    }

    /* ---- monta as páginas a partir das fotos do banco ---- */
    function buildPages() {
      const pages: string[] = [];
      // capa
      pages.push(`<div class="cover">
        <div class="tex"></div><div class="rays"></div>
        <span class="kick">Álbum Oficial de Figurinhas</span>
        <div class="flaghero"><img class="bigflag" src="/eventos/bandeira-brasil.png" alt="Bandeira do Brasil"></div>
        <div class="wm"><h1>3LACKD</h1><div class="tagbr">Seleção Brasileira</div></div>
        <div class="foot">
          <span class="ribbon">Seleção 3LACKD · 2026</span>
          <div class="stamp">Verde e amarelo no coração — Edição de Colecionador</div>
        </div>
      </div>`);

      // páginas internas: primeira começa com o escudo especial + 8 figs; demais 9 figs
      const lista = [...fotos];
      let pageNo = 1;
      let primeira = true;
      while (lista.length > 0 || primeira) {
        const capacidade = primeira ? 8 : 9;
        const slice = lista.splice(0, capacidade);
        const cells: (Foto | null)[] = primeira ? [null, ...slice] : [...slice];
        while (cells.length < 9) cells.push(null);     // completa com slots vazios
        pages.push(paniniPage(cells, pageNo++, primeira));
        primeira = false;
        if (lista.length === 0) break;
      }

      // contracapa
      pages.push(`<div class="backcover"><div class="rays"></div>
        <div class="clg">${crest(118)}</div>
        <h3>SELEÇÃO 3LACKD</h3><div class="jp">2 0 2 6</div>
        <div class="ln">O álbum oficial da torcida que veste o verde e amarelo com orgulho. Obrigado por colecionar com a gente!</div>
        <div class="barcode"></div>
      </div>`);
      return pages;
    }

    /* ===== render leaves ===== */
    const PAGES = buildPages();
    if (PAGES.length % 2) PAGES.push(`<div class="pp"></div>`);
    const NUM_LEAVES = PAGES.length / 2;
    bookEl.innerHTML = '';
    const leaves: HTMLDivElement[] = [];
    for (let i = 0; i < NUM_LEAVES; i++) {
      const leaf = document.createElement('div'); leaf.className = 'leaf';
      leaf.innerHTML =
        `<div class="face front"><div class="sheet">${PAGES[i * 2]}</div></div>` +
        `<div class="face back"><div class="sheet">${PAGES[i * 2 + 1]}</div></div>`;
      bookEl.appendChild(leaf); leaves.push(leaf);
    }

    /* ===== flip logic (porte fiel) ===== */
    let flipped = 0, busy = false, lbOpen = false;
    let mPage = 0;                                   // página atual no modo celular (1 por vez)
    const isMobile = () => window.innerWidth < 700;
    const FLIP = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--flip')) || 820;

    function visibleFaces(): HTMLElement[] {
      const r = (flipped < NUM_LEAVES) ? leaves[flipped].querySelector('.face.front') as HTMLElement : null;
      const l = (flipped > 0) ? leaves[flipped - 1].querySelector('.face.back') as HTMLElement : null;
      return [l, r].filter(Boolean) as HTMLElement[];
    }
    function preHide() {
      visibleFaces().forEach(face => face.querySelectorAll('.cell .stk, .cell .slot').forEach(el => { (el as HTMLElement).style.opacity = '0'; }));
    }
    let glueGen = 0;
    const easeOutBack = (t: number) => { const c = 1.9; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
    function tweenGlue(el: HTMLElement, delay: number, dur: number, from: { dx: number; r: number }) {
      const gen = glueGen; (el as any).__gen = gen;
      el.style.opacity = '0';
      el.style.transform = `translate(${from.dx}px,-40px) scale(1.24) rotate(${from.r}deg)`;
      const t0 = performance.now() + delay;
      function step(now: number) {
        if ((el as any).__gen !== gen) return;
        let p = (now - t0) / dur;
        if (p < 0) { requestAnimationFrame(step); return; }
        if (p > 1) p = 1;
        const e = easeOutBack(p);
        el.style.opacity = Math.min(1, p / 0.45).toFixed(3);
        const tx = from.dx * (1 - e), ty = -40 * (1 - e);
        const sc = 1.24 + (1 - 1.24) * e, ro = from.r * (1 - e);
        el.style.transform = p >= 1 ? 'none' : `translate(${tx.toFixed(2)}px,${ty.toFixed(2)}px) scale(${sc.toFixed(3)}) rotate(${ro.toFixed(2)}deg)`;
        if (p >= 1) { el.style.opacity = '1'; el.style.transform = ''; return; }
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    function tweenFade(el: HTMLElement, delay: number, dur: number) {
      const gen = glueGen; (el as any).__gen = gen; el.style.opacity = '0';
      const t0 = performance.now() + delay;
      function step(now: number) {
        if ((el as any).__gen !== gen) return;
        let p = (now - t0) / dur; if (p < 0) { requestAnimationFrame(step); return; } if (p > 1) p = 1;
        el.style.opacity = p.toFixed(3);
        if (p >= 1) { el.style.opacity = '1'; return; }
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    function flashShine(el: HTMLElement | null, delay: number) {
      if (!el) return;
      const t0 = performance.now() + delay, dur = 420;
      function step(now: number) {
        let p = (now - t0) / dur; if (p < 0) { requestAnimationFrame(step); return; } if (p > 1) p = 1;
        el!.style.opacity = (Math.sin(p * Math.PI) * 0.9).toFixed(3);
        if (p >= 1) { el!.style.opacity = '0'; return; }
        requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }
    function fireGlue() {
      glueGen++;
      visibleFaces().forEach(face => {
        const cells = [...face.querySelectorAll('.cell')];
        cells.forEach((cell, i) => {
          // Cascata: cada figurinha entra após a anterior (stagger maior) e com duração um pouco maior.
          const col = i % 3, dx = (col - 1) * 8, r = (i % 2 ? 5 : -5), delay = i * 150 + 160;
          cell.classList.remove('pre');
          const stk = cell.querySelector('.stk') as HTMLElement | null;
          const slot = cell.querySelector('.slot') as HTMLElement | null;
          if (stk) { tweenGlue(stk, delay, 700, { dx, r }); flashShine(stk.querySelector('.shine') as HTMLElement, delay + 320); }
          else if (slot) { tweenFade(slot, delay, 420); }
        });
      });
    }
    function applyShift() {
      const pageW = leaves[0].offsetWidth;
      let shift = 0;
      if (isMobile()) {
        // Celular: mostra UMA página por vez. Página par = lado direito; ímpar = lado esquerdo.
        shift = (mPage % 2 === 0) ? -pageW / 2 : pageW / 2;
      } else {
        if (flipped === 0) shift = -pageW / 2;
        else if (flipped === NUM_LEAVES) shift = pageW / 2;
      }
      bookEl!.style.transform = `translateX(${shift}px)`;
    }
    function updateZ() { leaves.forEach((leaf, i) => { leaf.style.zIndex = String((i < flipped) ? (i + 1) : (NUM_LEAVES - i)); }); }

    // Navegação por PÁGINA no celular: dentro da dupla só desliza; ao trocar de dupla, vira a folha.
    function goMobile(dir: number) {
      if (busy || lbOpen) return;
      const newK = mPage + dir;
      if (newK < 0 || newK > PAGES.length - 1) return;
      const newFlipped = Math.ceil(newK / 2);
      mPage = newK;
      if (newFlipped !== flipped) {
        busy = true;
        if (newFlipped > flipped) {
          const leaf = leaves[flipped]; leaf.style.zIndex = String(NUM_LEAVES + 2);
          leaf.classList.add('flipped');
          setTimeout(() => leaf.classList.add('show-back'), FLIP / 2);
        } else {
          const leaf = leaves[flipped - 1]; leaf.style.zIndex = String(NUM_LEAVES + 2);
          leaf.classList.remove('flipped');
          setTimeout(() => leaf.classList.remove('show-back'), FLIP / 2);
        }
        flipped = newFlipped;
        applyShift(); updateDots(); preHide();
        setTimeout(() => { updateZ(); busy = false; updateNav(); fireGlue(); }, FLIP);
      } else {
        // mesma dupla: só desliza para a outra página
        applyShift(); updateNav();
      }
    }
    function nav(dir: number) { if (isMobile()) goMobile(dir); else go(dir); }

    function go(dir: number) {
      if (busy || lbOpen) return;
      const target = flipped + dir;
      if (target < 0 || target > NUM_LEAVES) return;
      busy = true;
      if (dir > 0) {
        const leaf = leaves[flipped]; leaf.style.zIndex = String(NUM_LEAVES + 2);
        leaf.classList.add('flipped');
        setTimeout(() => leaf.classList.add('show-back'), FLIP / 2);
        flipped = target;
      } else {
        const leaf = leaves[flipped - 1]; leaf.style.zIndex = String(NUM_LEAVES + 2);
        leaf.classList.remove('flipped');
        setTimeout(() => leaf.classList.remove('show-back'), FLIP / 2);
        flipped = target;
      }
      applyShift(); updateDots(); preHide();
      setTimeout(() => { updateZ(); busy = false; updateNav(); fireGlue(); }, FLIP);
    }

    /* ===== nav + dots ===== */
    dotsEl.innerHTML = '';
    for (let i = 0; i <= NUM_LEAVES; i++) { dotsEl.appendChild(document.createElement('i')); }
    function updateDots() { [...dotsEl!.children].forEach((d, i) => d.classList.toggle('on', i === flipped)); }
    function updateNav() {
      if (isMobile()) { prevB!.disabled = mPage === 0; nextB!.disabled = mPage >= PAGES.length - 1; }
      else { prevB!.disabled = flipped === 0; nextB!.disabled = flipped === NUM_LEAVES; }
    }
    const onPrev = (e: Event) => { e.stopPropagation(); nav(-1); };
    const onNext = (e: Event) => { e.stopPropagation(); nav(1); };
    prevB.addEventListener('click', onPrev);
    nextB.addEventListener('click', onNext);
    const onKey = (e: KeyboardEvent) => {
      if (lbOpen) { if (e.key === 'Escape') closeLB(); return; }
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); nav(1); }
      if (e.key === 'ArrowLeft') nav(-1);
    };
    document.addEventListener('keydown', onKey);
    const onBookClick = (e: MouseEvent) => {
      const stk = (e.target as HTMLElement).closest('.stk:not(.special)') as HTMLElement | null;
      if (stk) { e.stopPropagation(); openLB(stk.dataset.fig || ''); return; }
      if ((e.target as HTMLElement).closest('.stk.special')) return;
      const r = bookEl!.getBoundingClientRect();
      if (e.clientX > r.left + r.width / 2) nav(1); else nav(-1);
    };
    bookEl.addEventListener('click', onBookClick);

    /* ===== lightbox ===== */
    function openLB(id: string) {
      const f = fotos.find(x => x.id === id); if (!f) return;
      const obj = f.obj_position || 'center 30%';
      lb!.innerHTML = `<div class="lb-card ${f.craque ? 'gold' : ''}">
        <button class="lb-close" aria-label="Fechar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg></button>
        <div class="lb-in">
          <div class="lb-photo"><img src="${photoSrc(f.id)}" alt="${esc(f.nome)}" style="object-position:${esc(obj)}"><div class="holo"></div></div>
          ${f.craque ? '<div class="craquetag">★ Craque</div>' : ''}
          <div class="lb-bar">${f.numero ? `<div class="num">${esc(f.numero)}</div>` : ''}<span class="ps">${esc(f.posicao)}</span><div class="nk">${esc(f.nome)}</div><div class="tm">Seleção 3LACKD · 2026</div></div>
        </div>
      </div>
      <div class="lb-hint">Toque fora para fechar</div>`;
      lb!.classList.add('open'); lbOpen = true;
      (lb!.querySelector('.lb-close') as HTMLElement).onclick = closeLB;
    }
    function closeLB() { lb!.classList.remove('open'); lbOpen = false; }
    const onLbClick = (e: MouseEvent) => { if (e.target === lb || (e.target as HTMLElement).classList.contains('lb-hint')) closeLB(); };
    lb.addEventListener('click', onLbClick);

    /* ===== scale ===== */
    function fit() {
      const mobile = window.innerWidth < 700;
      const pageW = leaves[0].offsetWidth, pageH = leaves[0].offsetHeight;
      // No celular ajusta por UMA página (cabe bem maior); no desktop, pela dupla.
      const pad = mobile ? 20 : 120;
      const w = mobile ? pageW + 16 : pageW * 2 + 80;
      const h = pageH + (mobile ? 32 : 90);
      const s = Math.min((window.innerWidth - pad) / w, (window.innerHeight - pad) / h, mobile ? 2.4 : 1.15);
      stage!.style.transform = `scale(${s})`;
    }
    const onResize = () => {
      // Mantém o cursor de página alinhado à folha atual ao alternar mobile/desktop.
      mPage = flipped === 0 ? 0 : Math.min(PAGES.length - 1, flipped * 2 - 1);
      fit(); applyShift(); updateNav();
    };
    window.addEventListener('resize', onResize);

    /* init */
    updateZ(); applyShift(); updateDots(); updateNav(); fit();
    setTimeout(fireGlue, 60); // cola as figurinhas da primeira dupla visível

    // preload das fotos para virar páginas sem flash
    fotos.forEach(f => { const img = new Image(); img.src = photoSrc(f.id); });

    return () => {
      prevB.removeEventListener('click', onPrev);
      nextB.removeEventListener('click', onNext);
      document.removeEventListener('keydown', onKey);
      bookEl.removeEventListener('click', onBookClick);
      lb.removeEventListener('click', onLbClick);
      window.removeEventListener('resize', onResize);
    };
  }, [loading, fotos]);

  if (loading) {
    return <div className="p-12 text-center text-slate-500">Carregando álbum…</div>;
  }
  if (fotos.length === 0) {
    return (
      <div className="p-12 text-center text-slate-500">
        Nenhuma figurinha ainda. O Marketing adiciona fotos em Marketing › Eventos.
      </div>
    );
  }

  return (
    <div className={`album-root${isFull ? ' is-full' : ''}`} ref={rootRef}>
      <button
        className="fsbtn"
        type="button"
        onClick={toggleFull}
        aria-label={isFull ? 'Sair da tela cheia' : 'Tela cheia'}
        title={isFull ? 'Sair da tela cheia' : 'Tela cheia'}
      >
        {isFull ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 4v3a2 2 0 0 1-2 2H4M20 9h-3a2 2 0 0 1-2-2V4M15 20v-3a2 2 0 0 1 2-2h3M4 15h3a2 2 0 0 1 2 2v3" /></svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9V6a2 2 0 0 1 2-2h3M20 9V6a2 2 0 0 0-2-2h-3M4 15v3a2 2 0 0 0 2 2h3M20 15v3a2 2 0 0 1-2 2h-3" /></svg>
        )}
      </button>
      <div id="stage" ref={stageRef}>
        <div className="book" id="book" ref={bookRef}></div>
      </div>
      <button className="nav" id="prev" ref={prevRef} aria-label="Página anterior">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
      </button>
      <button className="nav" id="next" ref={nextRef} aria-label="Próxima página">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
      </button>
      <div className="hint">
        <span>Toque, vire (← →) ou clique na figurinha</span>
        <span className="dots" id="dots" ref={dotsRef}></span>
      </div>
      <div className="lb" id="lightbox" ref={lbRef}></div>
    </div>
  );
};

export default EventosAlbum;
