import React, { useEffect, useState } from 'react';
import { Trash2, Plus, MessageSquare, ToggleLeft, ToggleRight, Loader2 } from 'lucide-react';
import { api } from '../../app_api';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';

interface NumeroAutorizado {
  id: number;
  numero: string;
  descricao: string | null;
  ativo: boolean;
  criado_em: string | null;
  atualizado_em: string | null;
}

const formatarNumero = (n: string) => {
  const d = (n || '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return d;
};

const WhatsAppNumerosAutorizados: React.FC = () => {
  const { showToast } = useToast();
  const confirmar = useConfirm();
  const [itens, setItens] = useState<NumeroAutorizado[]>([]);
  const [loading, setLoading] = useState(false);
  const [novoNumero, setNovoNumero] = useState('');
  const [novaDescricao, setNovaDescricao] = useState('');
  const [salvando, setSalvando] = useState(false);

  const carregar = async () => {
    setLoading(true);
    try {
      const data = await api.listarNumerosWhatsApp();
      setItens(data);
    } catch (e: any) {
      showToast(e.message || 'Erro ao carregar', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { carregar(); }, []);

  const onAdicionar = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = novoNumero.replace(/\D/g, '');
    if (digits.length < 10 || digits.length > 11) {
      showToast('Numero invalido. Use DDD + numero (10 ou 11 digitos).', 'error');
      return;
    }
    setSalvando(true);
    try {
      await api.criarNumeroWhatsApp(digits, novaDescricao.trim() || undefined, true);
      showToast('Numero cadastrado.', 'success');
      setNovoNumero('');
      setNovaDescricao('');
      carregar();
    } catch (err: any) {
      showToast(err.message || 'Erro ao cadastrar', 'error');
    } finally {
      setSalvando(false);
    }
  };

  const toggleAtivo = async (item: NumeroAutorizado) => {
    try {
      await api.atualizarNumeroWhatsApp(item.id, { ativo: !item.ativo });
      carregar();
    } catch (err: any) {
      showToast(err.message || 'Erro', 'error');
    }
  };

  const onRemover = async (item: NumeroAutorizado) => {
    const ok = await confirmar({
      title: 'Remover número',
      message: `Remover ${formatarNumero(item.numero)} dos números autorizados?`,
      confirmText: 'Remover',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await api.removerNumeroWhatsApp(item.id);
      showToast('Numero removido.', 'success');
      carregar();
    } catch (err: any) {
      showToast(err.message || 'Erro ao remover', 'error');
    }
  };

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-4">
        <MessageSquare className="w-6 h-6 text-green-600" />
        <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
          Números WhatsApp Autorizados
        </h1>
      </div>
      <p className="text-sm text-slate-600 dark:text-slate-400 mb-6">
        Somente os números cadastrados aqui poderão receber mensagens automáticas
        (ex.: Otimizador de Produção). Use DDD + número (10 ou 11 dígitos).
      </p>

      <form onSubmit={onAdicionar} className="bg-white dark:bg-slate-800 rounded-lg shadow p-4 mb-6 border border-slate-200 dark:border-slate-700">
        <h2 className="text-lg font-semibold mb-3 text-slate-800 dark:text-slate-100">Adicionar número</h2>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
          <div className="md:col-span-4">
            <label className="block text-xs text-slate-500 mb-1">Número (DDD + número)</label>
            <input
              value={novoNumero}
              onChange={(e) => setNovoNumero(e.target.value)}
              placeholder="11981239133"
              inputMode="numeric"
              maxLength={15}
              className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
            />
          </div>
          <div className="md:col-span-6">
            <label className="block text-xs text-slate-500 mb-1">Descrição (opcional)</label>
            <input
              value={novaDescricao}
              onChange={(e) => setNovaDescricao(e.target.value)}
              placeholder="Ex.: João — Gerência PCP"
              maxLength={120}
              className="w-full px-3 py-2 rounded border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100"
            />
          </div>
          <div className="md:col-span-2 flex items-end">
            <button
              type="submit"
              disabled={salvando}
              className="w-full inline-flex items-center justify-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white rounded font-medium"
            >
              {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Adicionar
            </button>
          </div>
        </div>
      </form>

      <div className="bg-white dark:bg-slate-800 rounded-lg shadow border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
              <tr>
                <th className="text-left px-3 py-2">Número</th>
                <th className="text-left px-3 py-2">Descrição</th>
                <th className="text-left px-3 py-2">Status</th>
                <th className="text-left px-3 py-2">Atualizado em</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  <Loader2 className="inline w-4 h-4 animate-spin mr-2" />Carregando...
                </td></tr>
              )}
              {!loading && itens.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-500">
                  Nenhum número cadastrado ainda.
                </td></tr>
              )}
              {!loading && itens.map((it) => (
                <tr key={it.id} className="border-t border-slate-200 dark:border-slate-700">
                  <td className="px-3 py-2 font-mono text-slate-800 dark:text-slate-100">{formatarNumero(it.numero)}</td>
                  <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{it.descricao || '-'}</td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => toggleAtivo(it)}
                      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium ${
                        it.ativo
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'
                          : 'bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300'
                      }`}
                      title={it.ativo ? 'Desativar' : 'Ativar'}
                    >
                      {it.ativo ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                      {it.ativo ? 'Ativo' : 'Inativo'}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400">
                    {it.atualizado_em ? new Date(it.atualizado_em).toLocaleString('pt-BR') : '-'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => onRemover(it)}
                      className="inline-flex items-center gap-1 px-2 py-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"
                      title="Remover"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default WhatsAppNumerosAutorizados;
