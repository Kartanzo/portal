/**
 * Padroniza uma imagem no navegador (canvas) antes do upload, para que o catálogo
 * não fique com imagens distorcidas/mal cortadas.
 * - 'contain': encaixa a imagem inteira no quadro com fundo branco (sem cortar) → ideal p/ fotos de produto
 * - 'cover':   preenche o quadro recortando as bordas → ideal p/ capas (full-bleed)
 */
export type NormalizeMode = 'contain' | 'cover';

export interface NormalizeOpts {
  w: number;
  h: number;
  mode?: NormalizeMode;
  bg?: string;
  quality?: number;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = (e) => { URL.revokeObjectURL(url); reject(e); };
    img.src = url;
  });
}

export async function normalizeImage(file: File, opts: NormalizeOpts): Promise<File> {
  const { w, h, mode = 'contain', bg = '#ffffff', quality = 0.9 } = opts;
  const img = await loadImage(file);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return file; // fallback: envia original

  // fundo branco
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const scale = mode === 'cover'
    ? Math.max(w / img.width, h / img.height)
    : Math.min(w / img.width, h / img.height);
  const dw = img.width * scale;
  const dh = img.height * scale;
  const dx = (w - dw) / 2;
  const dy = (h - dh) / 2;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, dx, dy, dw, dh);

  const blob: Blob = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b as Blob), 'image/jpeg', quality)
  );
  const nome = file.name.replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], nome, { type: 'image/jpeg' });
}

// Presets do catálogo
export const FOTO_PRODUTO: NormalizeOpts = { w: 1000, h: 1000, mode: 'contain' };
export const FOTO_CAPA: NormalizeOpts = { w: 1200, h: 1560, mode: 'cover' };
