/**
 * Catálogo de Fichas Técnicas (galeria do portal)
 * Mostra os PDFs publicados (ativos) pelo Marketing. Cada item oferece:
 * prévia da capa (1ª página), busca por nome, baixar o PDF,
 * abrir o link de acesso externo (público) e copiá-lo.
 * module_id: ficha_tecnica_catalogo
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { FileText, Download, Link2, ExternalLink, Search, Copy } from 'lucide-react';
import { api } from '../../app_api';
import PageBackground from '../common/PageBackground';
import { useToast } from '../../contexts/ToastContext';

interface FichaPdf {
  id: string;
  nome_arquivo: string;
  token_publico: string;
  criado_em: string | null;
}

const fmtData = (iso: string | null) => {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
};
const linkPublico = (token: string) => `${window.location.origin}${api.API_PREFIX}/marketing/ficha-tecnica/p/${token}`;
const capaUrl = (id: string) => `${api.API_PREFIX}/marketing/ficha-tecnica/capa/${id}`;

const Capa: React.FC<{ id: string; nome: string }> = ({ id, nome }) => {
  const [erro, setErro] = useState(false);
  if (erro) {
    return (
      <div className="flex items-center justify-center h-44 bg-gradient-to-br from-red-50 to-rose-100 dark:from-red-950/30 dark:to-rose-900/20">
        <FileText className="w-12 h-12 text-red-500" />
      </div>
    );
  }
  return (
    <div className="h-44 bg-slate-100 dark:bg-slate-800 overflow-hidden flex items-start justify-center">
      <img
        src={capaUrl(id)}
        alt={`Capa de ${nome}`}
        loading="lazy"
        onError={() => setErro(true)}
        className="w-full h-full object-cover object-top"
      />
    </div>
  );
};

const CatalogoFichas: React.FC = () => {
  const { showToast } = useToast();
  const [itens, setItens] = useState<FichaPdf[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');

  const carregar = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get('/marketing/ficha-tecnica/galeria');
      setItens(data.itens || []);
    } catch (e: any) {
      showToast(e?.message || 'Erro ao carregar o catálogo', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { carregar(); }, [carregar]);

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return itens;
    return itens.filter(i => i.nome_arquivo.toLowerCase().includes(q));
  }, [itens, busca]);

  const copiarLink = async (item: FichaPdf) => {
    try {
      await navigator.clipboard.writeText(linkPublico(item.token_publico));
      showToast('Link de acesso externo copiado.', 'success');
    } catch {
      showToast('Não foi possível copiar o link.', 'error');
    }
  };

  return (
    <PageBackground>
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Catálogo de Fichas Técnicas</h1>
        <p className="text-sm text-slate-500 mt-1">Baixe o PDF ou compartilhe o link de acesso externo.</p>
      </header>

      <div className="mb-6 max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Pesquisar por nome do arquivo…"
            className="w-full pl-9 pr-3 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/70 text-sm text-slate-800 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {loading ? (
        <div className="text-center text-slate-400 py-16">Carregando…</div>
      ) : filtrados.length === 0 ? (
        <div className="text-center text-slate-400 py-16">
          {busca ? 'Nenhuma ficha encontrada para a busca.' : 'Nenhuma ficha técnica publicada no momento.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {filtrados.map(item => (
            <div
              key={item.id}
              className="flex flex-col rounded-xl border border-slate-200 dark:border-slate-700 bg-white/90 dark:bg-slate-900/70 backdrop-blur overflow-hidden shadow-sm hover:shadow-md transition-shadow"
            >
              <Capa id={item.id} nome={item.nome_arquivo} />
              <div className="flex flex-col flex-1 p-4">
                <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 line-clamp-2" title={item.nome_arquivo}>
                  {item.nome_arquivo}
                </h3>
                {item.criado_em && (
                  <p className="text-xs text-slate-400 mt-1">{fmtData(item.criado_em)}</p>
                )}
                <div className="mt-auto pt-4 space-y-2">
                  <a
                    href={`${api.API_PREFIX}/marketing/ficha-tecnica/download/${item.id}`}
                    className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 whitespace-nowrap"
                  >
                    <Download className="w-4 h-4" /> Baixar PDF
                  </a>
                  <div className="flex items-center gap-2">
                    <a
                      href={linkPublico(item.token_publico)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-indigo-700 bg-indigo-100 hover:bg-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 whitespace-nowrap"
                      title="Abrir o link de acesso externo em nova aba"
                    >
                      <ExternalLink className="w-4 h-4" /> Link externo
                    </a>
                    <button
                      onClick={() => copiarLink(item)}
                      className="inline-flex items-center justify-center p-2 rounded-lg text-slate-500 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 border border-slate-200 dark:border-slate-700"
                      title="Copiar link de acesso externo"
                    >
                      <Copy className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </PageBackground>
  );
};

export default CatalogoFichas;
