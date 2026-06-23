import React, { useState, useEffect } from 'react';
import { User } from '../../types';
import { api } from '../../app_api';
import { useToast } from '../../contexts/ToastContext';
import { Plus, Pencil, Trash2, Check, X, Loader2, ToggleLeft, ToggleRight } from 'lucide-react';
import { useConfirm } from '../../contexts/ConfirmContext';

interface Props { user: User; }
interface Tipo { id: number; nome: string; ativo: boolean; categoria: string; setor?: string | null; }

type Tab = 'tipo_problema' | 'canal_compra' | 'status_interno';

const TAB_LABELS: Record<Tab, string> = {
  tipo_problema: 'Tipos de Problema',
  canal_compra: 'Canais de Compra',
  status_interno: 'Status Interno',
};

const SETORES = ['SAC', 'Logística', 'Financeiro', 'Comercial', 'Qualidade'];

const SacTipoProblema: React.FC<Props> = ({ user }) => {
  const { showToast } = useToast();
  const [tab, setTab] = useState<Tab>('tipo_problema');
  const [todos, setTodos] = useState<Tipo[]>([]);
  const [loading, setLoading] = useState(true);
  const [novoNome, setNovoNome] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [editNome, setEditNome] = useState('');

  const podeTodosSetores = ['super_user', 'ceo', 'admin'].includes(user.role) || user.sector === 'SAC' || user.sector === 'Qualidade';
  const setoresDisponiveis = podeTodosSetores ? SETORES : (user.sector ? [user.sector] : []);
  const [setorSel, setSetorSel] = useState<string>(setoresDisponiveis[0] || 'SAC');

  const lista = tab === 'status_interno'
    ? todos.filter(t => t.categoria === 'status_interno' && t.setor === setorSel)
    : todos.filter(t => t.categoria === tab);

  const load = async () => {
    setLoading(true);
    try {
      const resp: any = await api.get('/sac/tipos-problema');
      const data = resp?.data ?? resp;
      setTodos(Array.isArray(data) ? data : []);
    } catch { showToast('Erro ao carregar', 'error'); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!novoNome.trim()) return;
    setSalvando(true);
    try {
      const fd = new FormData();
      fd.append('nome', novoNome.trim());
      fd.append('categoria', tab);
      if (tab === 'status_interno') fd.append('setor', setorSel);
      await fetch('/api/sac/tipos-problema', { credentials: 'include',  method: 'POST', headers: { 'user-id': user.id }, body: fd });
      setNovoNome('');
      showToast('Criado com sucesso', 'success');
      load();
    } catch { showToast('Erro ao criar', 'error'); }
    finally { setSalvando(false); }
  };

  const handleEdit = async (id: number) => {
    if (!editNome.trim()) return;
    const fd = new FormData();
    fd.append('nome', editNome.trim());
    await fetch(`/api/sac/tipos-problema/${id}`, { credentials: 'include',  method: 'PATCH', headers: { 'user-id': user.id }, body: fd });
    showToast('Atualizado', 'success');
    setEditId(null);
    load();
  };

  const handleToggle = async (t: Tipo) => {
    const fd = new FormData();
    fd.append('ativo', String(!t.ativo));
    await fetch(`/api/sac/tipos-problema/${t.id}`, { credentials: 'include',  method: 'PATCH', headers: { 'user-id': user.id }, body: fd });
    showToast(t.ativo ? 'Desativado' : 'Ativado', 'success');
    load();
  };

  const confirmar = useConfirm();
  const handleDelete = async (id: number) => {
    const ok = await confirmar({
      title: 'Excluir item',
      message: 'Tem certeza que deseja excluir este item?',
      confirmText: 'Excluir',
      variant: 'danger',
    });
    if (!ok) return;
    await fetch(`/api/sac/tipos-problema/${id}`, { credentials: 'include',  method: 'DELETE', headers: { 'user-id': user.id } });
    showToast('Excluído', 'success');
    load();
  };

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">SAC — Categorias</h1>
          <p className="text-slate-500 text-sm mt-0.5">Gerencie os tipos de problema e canais de compra do formulário SAC</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-white border border-slate-200 rounded-xl overflow-hidden mb-5 shadow-sm">
        {(Object.keys(TAB_LABELS) as Tab[]).map(t => (
          <button key={t} onClick={() => { setTab(t); setNovoNome(''); setEditId(null); }}
            className={`flex-1 py-2.5 text-sm font-semibold transition-colors border-r border-slate-200 last:border-0 ${tab === t ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Seletor de setor (apenas Status Interno) */}
      {tab === 'status_interno' && (
        <div className="mb-4">
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1.5">Setor</label>
          <select value={setorSel} onChange={e => { setSetorSel(e.target.value); setEditId(null); }}
            disabled={!podeTodosSetores}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:bg-slate-100">
            {setoresDisponiveis.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <p className="text-[11px] text-slate-400 mt-1">Cada setor define os próprios status internos. {podeTodosSetores ? 'Você pode gerenciar qualquer setor.' : 'Você só pode gerenciar o seu setor.'}</p>
        </div>
      )}

      {/* Adicionar */}
      <form onSubmit={handleAdd} className="flex gap-2 mb-5">
        <input value={novoNome} onChange={e => setNovoNome(e.target.value)}
          placeholder={tab === 'status_interno' ? `Novo status interno de ${setorSel}...` : `Novo ${TAB_LABELS[tab].slice(0, -1).toLowerCase()}...`}
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <button type="submit" disabled={salvando || !novoNome.trim()}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white text-sm font-semibold rounded-lg hover:bg-indigo-700 disabled:opacity-50 transition-colors">
          {salvando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Adicionar
        </button>
      </form>

      {/* Lista */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-indigo-500" /></div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          {lista.length === 0 && (
            <div className="text-center py-12 text-slate-400 text-sm">Nenhum item cadastrado</div>
          )}
          {lista.map(t => (
            <div key={t.id} className={`flex items-center gap-3 px-4 py-3 border-b border-slate-100 last:border-0 ${!t.ativo ? 'opacity-50' : ''}`}>
              {editId === t.id ? (
                <>
                  <input value={editNome} onChange={e => setEditNome(e.target.value)} autoFocus
                    className="flex-1 border border-slate-300 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  <button onClick={() => handleEdit(t.id)} className="p-1.5 bg-green-500 text-white rounded-lg hover:bg-green-600"><Check className="w-3.5 h-3.5" /></button>
                  <button onClick={() => setEditId(null)} className="p-1.5 bg-slate-200 text-slate-600 rounded-lg hover:bg-slate-300"><X className="w-3.5 h-3.5" /></button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm font-medium text-slate-800">{t.nome}</span>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${t.ativo ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                    {t.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                  <button onClick={() => { setEditId(t.id); setEditNome(t.nome); }} className="p-1.5 text-indigo-500 hover:bg-indigo-50 rounded-lg"><Pencil className="w-3.5 h-3.5" /></button>
                  <button onClick={() => handleToggle(t)} className={`p-1.5 rounded-lg ${t.ativo ? 'text-amber-500 hover:bg-amber-50' : 'text-green-500 hover:bg-green-50'}`}>
                    {t.ativo ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
                  </button>
                  <button onClick={() => handleDelete(t.id)} className="p-1.5 text-red-400 hover:bg-red-50 rounded-lg"><Trash2 className="w-3.5 h-3.5" /></button>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default SacTipoProblema;
