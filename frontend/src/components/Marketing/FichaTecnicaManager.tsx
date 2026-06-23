/**
 * Marketing — Ficha Técnica (gestão de PDFs)
 * Permite ao Marketing carregar PDFs, registrar nome/data/quem subiu e
 * ativar (publicar) ou desativar. PDFs ativos aparecem no Catálogo (galeria).
 * module_id: marketing_ficha_tecnica
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Upload, Trash2, Download, Link2, CheckCircle2, XCircle } from 'lucide-react';
import { api } from '../../app_api';
import PageBackground from '../common/PageBackground';
import KpiCard, { KpiGrid } from '../common/KpiCard';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';

interface FichaPdf {
  id: string;
  nome_arquivo: string;
  tamanho_bytes: number | null;
  ativo: boolean;
  token_publico: string;
  criado_por_nome: string;
  criado_em: string | null;
}

const fmtData = (iso: string | null) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
};
const fmtTamanho = (b: number | null) => {
  if (!b && b !== 0) return '—';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
};
const linkPublico = (token: string) => `${window.location.origin}${api.API_PREFIX}/marketing/ficha-tecnica/p/${token}`;

const FichaTecnicaManager: React.FC = () => {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const [itens, setItens] = useState<FichaPdf[]>([]);
  const [loading, setLoading] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/marketing/ficha-tecnica/listar');
      setItens(data.itens || []);
    } catch (e: any) {
      showToast(e?.message || 'Erro ao carregar PDFs', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { carregar(); }, [carregar]);

  const onSelecionar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showToast('Selecione um arquivo PDF.', 'error');
      return;
    }
    setEnviando(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch(`${api.API_PREFIX}/marketing/ficha-tecnica/upload`, {
        method: 'POST',
        body: fd,
        credentials: 'include',
      });
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail || 'Falha no upload');
      }
      showToast('PDF carregado. Ative para publicar no catálogo.', 'success');
      await carregar();
    } catch (e: any) {
      showToast(e?.message || 'Erro no upload', 'error');
    } finally {
      setEnviando(false);
    }
  };

  const toggleAtivo = async (item: FichaPdf) => {
    try {
      await api.put(`/marketing/ficha-tecnica/${item.id}`, { ativo: !item.ativo });
      setItens(prev => prev.map(i => i.id === item.id ? { ...i, ativo: !i.ativo } : i));
      showToast(!item.ativo ? 'PDF publicado no catálogo.' : 'PDF removido do catálogo.', 'success');
    } catch (e: any) {
      showToast(e?.message || 'Erro ao alterar status', 'error');
    }
  };

  const excluir = async (item: FichaPdf) => {
    const ok = await confirm({
      title: 'Excluir PDF',
      message: `Excluir definitivamente "${item.nome_arquivo}"? Esta ação é irreversível.`,
      confirmText: 'Excluir',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.del(`/marketing/ficha-tecnica/${item.id}`);
      setItens(prev => prev.filter(i => i.id !== item.id));
      showToast('PDF excluído.', 'success');
    } catch (e: any) {
      showToast(e?.message || 'Erro ao excluir', 'error');
    }
  };

  const copiarLink = async (item: FichaPdf) => {
    try {
      await navigator.clipboard.writeText(linkPublico(item.token_publico));
      showToast('Link de acesso externo copiado.', 'success');
    } catch {
      showToast('Não foi possível copiar o link.', 'error');
    }
  };

  const total = itens.length;
  const ativos = itens.filter(i => i.ativo).length;

  return (
    <PageBackground>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Ficha Técnica — Catálogo de PDFs</h1>
        <p className="text-sm text-slate-500 mt-1">Carregue os PDFs e ative para publicá-los no catálogo do portal.</p>
      </header>

      <KpiGrid className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <KpiCard label="Total de PDFs" value={total} Icon={FileText} color="blue" />
        <KpiCard label="Publicados (ativos)" value={ativos} Icon={CheckCircle2} color="emerald" />
        <KpiCard label="Desativados" value={total - ativos} Icon={XCircle} color="slate" />
      </KpiGrid>

      <div className="mb-6">
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={onSelecionar} />
        <button
          onClick={() => inputRef.current?.click()}
          disabled={enviando}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 shadow-sm whitespace-nowrap"
        >
          <Upload className="w-4 h-4" />
          {enviando ? 'Enviando…' : 'Carregar PDF'}
        </button>
      </div>

      <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/70 backdrop-blur overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="px-4 py-3 font-medium whitespace-nowrap">Arquivo</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Enviado por</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Data / Hora</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Tamanho</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">Status</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Carregando…</td></tr>
              ) : itens.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">Nenhum PDF carregado ainda.</td></tr>
              ) : itens.map(item => (
                <tr key={item.id} className="border-b border-slate-100 dark:border-slate-800 hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 text-slate-800 dark:text-slate-100">
                      <FileText className="w-4 h-4 text-red-500 shrink-0" />
                      <span className="font-medium whitespace-nowrap">{item.nome_arquivo}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">{item.criado_por_nome || '—'}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">{fmtData(item.criado_em)}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap">{fmtTamanho(item.tamanho_bytes)}</td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-2.5">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={item.ativo}
                        onClick={() => toggleAtivo(item)}
                        title={item.ativo ? 'Clique para despublicar' : 'Clique para publicar'}
                        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-emerald-500 ${
                          item.ativo ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600'
                        }`}
                      >
                        <span
                          className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                            item.ativo ? 'translate-x-[22px]' : 'translate-x-0.5'
                          }`}
                        />
                      </button>
                      <span className={`text-xs font-semibold ${item.ativo ? 'text-emerald-700 dark:text-emerald-300' : 'text-slate-500'}`}>
                        {item.ativo ? 'Publicado' : 'Despublicado'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      <a
                        href={`${api.API_PREFIX}/marketing/ficha-tecnica/download/${item.id}`}
                        className="p-2 rounded-lg text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40"
                        title="Baixar PDF"
                      >
                        <Download className="w-4 h-4" />
                      </a>
                      <button
                        onClick={() => copiarLink(item)}
                        className="p-2 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40"
                        title="Copiar link de acesso externo"
                      >
                        <Link2 className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => excluir(item)}
                        className="p-2 rounded-lg text-slate-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40"
                        title="Excluir"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </PageBackground>
  );
};

export default FichaTecnicaManager;
