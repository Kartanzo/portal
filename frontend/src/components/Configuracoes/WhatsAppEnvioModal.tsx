import React, { useEffect, useMemo, useState } from 'react';
import { X, MessageSquare, Loader2, Check, AlertTriangle } from 'lucide-react';
import { AnimatePresence, motion } from 'framer-motion';
import { api } from '../../app_api';
import { useToast } from '../../contexts/ToastContext';

interface NumeroAtivo {
  id: number;
  numero: string;
  descricao: string | null;
}

type Status = 'pendente' | 'enviando' | 'ok' | 'erro';

interface Props {
  open: boolean;
  titulo?: string;
  onClose: () => void;
  /**
   * Função que envia para UM número. Cada número selecionado dispara
   * uma chamada (envios individuais, conforme exigência do backend WAHA).
   * Deve fazer rethrow em caso de erro.
   */
  onEnviar: (numero: string) => Promise<any>;
}

const formatarNumero = (n: string) => {
  const d = (n || '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
};

const WhatsAppEnvioModal: React.FC<Props> = ({ open, titulo, onClose, onEnviar }) => {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [itens, setItens] = useState<NumeroAtivo[]>([]);
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set());
  const [status, setStatus] = useState<Record<number, Status>>({});
  const [erros, setErros] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!open) return;
    setSelecionados(new Set());
    setStatus({});
    setErros({});
    setLoading(true);
    api.listarNumerosAtivosWhatsApp()
      .then(setItens)
      .catch((e: any) => showToast(e.message || 'Erro ao carregar números', 'error'))
      .finally(() => setLoading(false));
  }, [open, showToast]);

  const toggleAll = () => {
    if (selecionados.size === itens.length) setSelecionados(new Set());
    else setSelecionados(new Set(itens.map(i => i.id)));
  };

  const toggle = (id: number) => {
    setSelecionados(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const alvos = useMemo(() => itens.filter(i => selecionados.has(i.id)), [itens, selecionados]);

  const disparar = async () => {
    if (alvos.length === 0) {
      showToast('Selecione ao menos um destinatário.', 'error');
      return;
    }
    setEnviando(true);
    let okCount = 0;
    let errCount = 0;
    // Envios SEQUENCIAIS individuais (uma requisição por número)
    for (const it of alvos) {
      setStatus(s => ({ ...s, [it.id]: 'enviando' }));
      try {
        await onEnviar(it.numero);
        setStatus(s => ({ ...s, [it.id]: 'ok' }));
        okCount++;
      } catch (e: any) {
        setStatus(s => ({ ...s, [it.id]: 'erro' }));
        setErros(s => ({ ...s, [it.id]: e?.message || 'Falha' }));
        errCount++;
      }
    }
    setEnviando(false);
    if (errCount === 0) showToast(`Enviado para ${okCount} destinatário(s).`, 'success');
    else showToast(`Concluído com ${errCount} falha(s). Veja detalhes no modal.`, 'error');
  };

  return (
    <AnimatePresence>
      {open && (
    <motion.div
      key="wpp-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18, ease: 'easeOut' }}
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        key="wpp-dialog"
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 4 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col"
      >
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-green-600" />
            {titulo || 'Enviar via WhatsApp'}
          </h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto flex-1">
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Selecione um ou mais destinatários cadastrados em
            <strong> Configurações &gt; Números WhatsApp</strong>.
          </p>

          {loading && (
            <div className="text-center py-8 text-slate-500">
              <Loader2 className="inline w-4 h-4 animate-spin mr-2" />Carregando...
            </div>
          )}

          {!loading && itens.length === 0 && (
            <div className="text-center py-8 text-slate-500 text-sm">
              Nenhum número ativo cadastrado.
            </div>
          )}

          {!loading && itens.length > 0 && (
            <>
              <div className="flex items-center justify-between text-xs text-slate-500">
                <button
                  type="button"
                  onClick={toggleAll}
                  className="hover:underline"
                  disabled={enviando}
                >
                  {selecionados.size === itens.length ? 'Limpar seleção' : 'Selecionar todos'}
                </button>
                <span>{selecionados.size} de {itens.length} selecionado(s)</span>
              </div>
              <div className="border border-slate-200 dark:border-slate-700 rounded divide-y divide-slate-200 dark:divide-slate-700 max-h-64 overflow-y-auto">
                {itens.map((it) => {
                  const st = status[it.id];
                  return (
                    <label
                      key={it.id}
                      className={`flex items-center gap-3 px-3 py-2 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-700/50 ${
                        selecionados.has(it.id) ? 'bg-green-50 dark:bg-green-900/20' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selecionados.has(it.id)}
                        onChange={() => toggle(it.id)}
                        disabled={enviando}
                        className="w-4 h-4"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
                          {it.descricao || '(sem descrição)'}
                        </div>
                        <div className="text-xs font-mono text-slate-500">
                          {formatarNumero(it.numero)}
                        </div>
                        {st === 'erro' && erros[it.id] && (
                          <div className="text-xs text-red-600 mt-1">{erros[it.id]}</div>
                        )}
                      </div>
                      <div className="w-5 flex-shrink-0">
                        {st === 'enviando' && <Loader2 className="w-4 h-4 animate-spin text-slate-500" />}
                        {st === 'ok' && <Check className="w-4 h-4 text-green-600" />}
                        {st === 'erro' && <AlertTriangle className="w-4 h-4 text-red-600" />}
                      </div>
                    </label>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <div className="px-5 py-4 border-t border-slate-200 dark:border-slate-700 flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={enviando}
            className="px-4 py-2 rounded bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-100 text-sm"
          >
            Fechar
          </button>
          <button
            onClick={disparar}
            disabled={enviando || loading || selecionados.size === 0}
            className="px-4 py-2 rounded bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white text-sm font-semibold inline-flex items-center gap-2"
          >
            {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <MessageSquare className="w-4 h-4" />}
            Enviar para {selecionados.size}
          </button>
        </div>
      </motion.div>
    </motion.div>
      )}
    </AnimatePresence>
  );
};

export default WhatsAppEnvioModal;
