/**
 * EventosManager — Aba "Eventos" dentro de Marketing.
 * Permite: upload (multi), listar com thumbnail, reordenar (drag), excluir,
 * e editar os metadados da figurinha (estilo Panini): nome/apelido, posição,
 * número, craque (moldura dourada) e foco vertical da foto (object-position).
 */
import React, { useEffect, useRef, useState } from 'react';
import { api } from '../../app_api';

type Foto = {
  id: string;
  mime: string;
  ordem: number;
  criado_em: string;
  nome?: string | null;
  posicao?: string | null;
  numero?: string | null;
  craque?: boolean;
  obj_position?: string | null;
};

// Extrai o valor vertical (%) de um object-position no formato "center N%"
function focoFromObjPosition(obj?: string | null): number {
  if (!obj) return 30;
  const m = obj.match(/(\d+(?:\.\d+)?)\s*%/);
  if (m) return Math.max(0, Math.min(100, Math.round(parseFloat(m[1]))));
  return 30;
}

const EventosManager: React.FC = () => {
  const [fotos, setFotos] = useState<Foto[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [carregando, setCarregando] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [salvandoId, setSalvandoId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function authHeaders(): Record<string, string> {
    try {
      const saved = sessionStorage.getItem('empresa_user');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed?.id) return { 'user-id': String(parsed.id) };
      }
    } catch { /* ignore */ }
    return {};
  }

  async function carregar() {
    setCarregando(true);
    try {
      const r = await api.get('/eventos/fotos');
      const lista: Foto[] = r.data.fotos || [];
      setFotos(lista);
      // Pré-carrega thumbnails (mesma rota — backend retorna binário)
      const novosThumbs: Record<string, string> = {};
      await Promise.all(
        lista.map(async (f) => {
          try {
            const resp = await fetch(`/api/eventos/fotos/${f.id}`, {
              credentials: 'include',
              headers: authHeaders(),
            });
            if (resp.ok) {
              const blob = await resp.blob();
              novosThumbs[f.id] = URL.createObjectURL(blob);
            }
          } catch { /* skip */ }
        })
      );
      // limpa URLs antigas
      Object.values(thumbs).forEach(u => URL.revokeObjectURL(u));
      setThumbs(novosThumbs);
    } catch (e) {
      console.error(e);
      setFotos([]);
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
    return () => {
      Object.values(thumbs).forEach(u => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleUpload(filesList: FileList | null) {
    if (!filesList || filesList.length === 0) return;
    setEnviando(true);
    try {
      const fd = new FormData();
      Array.from(filesList).forEach(f => fd.append('files', f));
      const resp = await fetch('/api/eventos/fotos', {
        method: 'POST',
        credentials: 'include',
        headers: authHeaders(),
        body: fd,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        alert(`Erro no upload: ${err.detail || resp.statusText}`);
      } else {
        await carregar();
      }
    } catch (e: any) {
      alert(`Erro: ${e.message}`);
    } finally {
      setEnviando(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function excluir(id: string) {
    if (!confirm('Excluir esta foto do álbum?')) return;
    try {
      await api.del(`/eventos/fotos/${id}`);
      await carregar();
    } catch (e: any) {
      alert(`Erro: ${e.message}`);
    }
  }

  async function salvarOrdem(novaOrdem: Foto[]) {
    try {
      await api.post('/eventos/fotos/ordem', { ordem: novaOrdem.map(f => f.id) });
      setFotos(novaOrdem);
    } catch (e: any) {
      alert(`Erro ao reordenar: ${e.message}`);
    }
  }

  // Atualiza um campo localmente (sem persistir ainda)
  function setCampo(id: string, patch: Partial<Foto>) {
    setFotos(prev => prev.map(f => (f.id === id ? { ...f, ...patch } : f)));
  }

  // Persiste os metadados de uma figurinha via PATCH
  async function salvarMetadados(f: Foto) {
    setSalvandoId(f.id);
    try {
      const resp = await fetch(`/api/eventos/fotos/${f.id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          nome: f.nome ?? '',
          posicao: f.posicao ?? '',
          numero: f.numero ?? '',
          craque: !!f.craque,
          obj_position: f.obj_position || 'center 30%',
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        alert(`Erro ao salvar: ${err.detail || resp.statusText}`);
      }
    } catch (e: any) {
      alert(`Erro: ${e.message}`);
    } finally {
      setSalvandoId(null);
    }
  }

  // Drag para reordenar
  const onDragStart = (idx: number) => () => setDragIdx(idx);
  const onDragOver = (e: React.DragEvent) => e.preventDefault();
  const onDrop = (idx: number) => () => {
    if (dragIdx === null || dragIdx === idx) return;
    const nova = [...fotos];
    const [moved] = nova.splice(dragIdx, 1);
    nova.splice(idx, 0, moved);
    setDragIdx(null);
    salvarOrdem(nova);
  };

  const inputCls =
    'w-full text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-blue-500';

  return (
    <div>
      {/* Upload */}
      <div
        className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg p-6 text-center mb-6 bg-white dark:bg-slate-800"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); handleUpload(e.dataTransfer.files); }}
      >
        <div className="text-3xl mb-2">📤</div>
        <div className="text-sm text-slate-600 dark:text-slate-300 mb-3">
          Arraste fotos aqui ou clique para selecionar
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => handleUpload(e.target.files)}
          className="hidden"
          id="upload-eventos-input"
        />
        <label
          htmlFor="upload-eventos-input"
          className={`inline-block px-5 py-2 text-sm font-semibold rounded-md cursor-pointer ${
            enviando
              ? 'bg-slate-400 text-white cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-700 text-white'
          }`}
        >
          {enviando ? 'Enviando…' : 'Selecionar fotos'}
        </label>
        <div className="mt-3 text-xs text-slate-500">
          As fotos vão pro álbum "Seleção EMPRESA" na aba Eventos
        </div>
      </div>

      {/* Lista */}
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-200">
          Álbum: Seleção EMPRESA ({fotos.length} foto{fotos.length === 1 ? '' : 's'})
        </h2>
        <div className="text-xs text-slate-500">Arraste o cartão para reordenar</div>
      </div>

      {carregando ? (
        <div className="py-12 text-center text-slate-500">Carregando…</div>
      ) : fotos.length === 0 ? (
        <div className="py-12 text-center text-slate-500 border border-dashed border-slate-300 rounded-lg">
          Nenhuma foto ainda. Faça upload acima.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {fotos.map((f, idx) => {
            const foco = focoFromObjPosition(f.obj_position);
            return (
              <div
                key={f.id}
                draggable
                onDragStart={onDragStart(idx)}
                onDragOver={onDragOver}
                onDrop={onDrop(idx)}
                className={`relative bg-white dark:bg-slate-800 rounded-lg overflow-hidden border-2 transition ${
                  dragIdx === idx ? 'border-blue-500 scale-95' : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                {/* Preview no mesmo aspecto da figurinha: foto = 72% (retrato) */}
                <div className="relative bg-slate-100 dark:bg-slate-700" style={{ aspectRatio: '7 / 8' }}>
                  <div className="absolute top-0 left-0 right-0 overflow-hidden" style={{ height: '72%' }}>
                    {thumbs[f.id] ? (
                      <img
                        src={thumbs[f.id]}
                        alt=""
                        className="w-full h-full"
                        style={{ objectFit: 'cover', objectPosition: f.obj_position || 'center 30%' }}
                        draggable={false}
                      />
                    ) : (
                      <div className="flex items-center justify-center h-full text-slate-400 text-3xl">📷</div>
                    )}
                  </div>
                  {/* Barra inferior simulando a figurinha */}
                  <div
                    className="absolute left-0 right-0 bottom-0 flex flex-col items-center justify-center text-center px-1"
                    style={{ height: '28%', background: 'linear-gradient(180deg,#0a8a3c,#06632a)' }}
                  >
                    <div className="text-white font-bold text-sm leading-tight truncate max-w-full">
                      {f.nome || '—'}
                    </div>
                    <div className="text-[10px] font-semibold tracking-wider uppercase" style={{ color: '#ffd200' }}>
                      {f.posicao || ''}
                    </div>
                  </div>
                  {/* Número */}
                  {f.numero ? (
                    <div className="absolute top-1.5 left-1.5 min-w-[24px] text-center text-white text-xs font-bold px-1.5 py-0.5 rounded"
                         style={{ background: f.craque ? 'linear-gradient(180deg,#10a94c,#06632a)' : 'linear-gradient(180deg,#2a64d8,#012b86)' }}>
                      {f.numero}
                    </div>
                  ) : null}
                  {/* Indicador craque */}
                  {f.craque && (
                    <div className="absolute top-1.5 right-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded"
                         style={{ background: 'linear-gradient(180deg,#ffe27a,#e6b422)', color: '#5a3d00' }}>
                      ★ CRAQUE
                    </div>
                  )}
                  <div className="absolute bottom-1 right-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
                    #{f.ordem}
                  </div>
                </div>

                {/* Editor */}
                <div className="p-3 space-y-2">
                  <div className="flex gap-2">
                    <input
                      className={inputCls}
                      placeholder="Apelido (ex: Maestro)"
                      value={f.nome ?? ''}
                      onChange={(e) => setCampo(f.id, { nome: e.target.value })}
                    />
                    <input
                      className={`${inputCls} w-16 flex-none text-center`}
                      placeholder="Nº"
                      value={f.numero ?? ''}
                      onChange={(e) => setCampo(f.id, { numero: e.target.value })}
                    />
                  </div>
                  <input
                    className={inputCls}
                    placeholder="Posição (ex: Meia)"
                    value={f.posicao ?? ''}
                    onChange={(e) => setCampo(f.id, { posicao: e.target.value })}
                  />

                  {/* Foco vertical */}
                  <div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 mb-0.5">
                      <span>Foco vertical do rosto</span>
                      <span>{foco}%</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={foco}
                      onChange={(e) => setCampo(f.id, { obj_position: `center ${e.target.value}%` })}
                      className="w-full accent-blue-600"
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-200 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={!!f.craque}
                        onChange={(e) => setCampo(f.id, { craque: e.target.checked })}
                        className="accent-yellow-500"
                      />
                      Craque (moldura dourada)
                    </label>
                    <button
                      onClick={() => excluir(f.id)}
                      className="text-red-600 hover:text-red-700 text-xs font-semibold"
                      title="Excluir"
                    >
                      Excluir
                    </button>
                  </div>

                  <button
                    onClick={() => salvarMetadados(f)}
                    disabled={salvandoId === f.id}
                    className={`w-full text-xs font-semibold rounded-md py-1.5 ${
                      salvandoId === f.id
                        ? 'bg-slate-400 text-white cursor-not-allowed'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    }`}
                  >
                    {salvandoId === f.id ? 'Salvando…' : 'Salvar'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default EventosManager;
