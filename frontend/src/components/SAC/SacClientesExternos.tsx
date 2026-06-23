import React, { useState, useEffect } from 'react';
import { User } from '../../types';
import { api } from '../../app_api';
import { useToast } from '../../contexts/ToastContext';
import { UserPlus, RefreshCw, Loader2, Pencil, Power, KeyRound, X, Check } from 'lucide-react';

interface Props { user: User; }

interface ClienteExterno {
  id: string;
  name: string;
  email: string;
  empresa: string;
  is_active: boolean;
  last_login: string | null;
  created_at?: string | null;
}

interface FormState {
  nome: string;
  email: string;
  empresa: string;
  senha: string;
  confirmar: string;
}

const EMPTY_FORM: FormState = { nome: '', email: '', empresa: '', senha: '', confirmar: '' };

const SacClientesExternos: React.FC<Props> = ({ user }) => {
  const { showToast } = useToast();
  const [clientes, setClientes] = useState<ClienteExterno[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // Edição inline
  const [editId, setEditId] = useState<string | null>(null);
  const [editNome, setEditNome] = useState('');
  const [editEmpresa, setEditEmpresa] = useState('');
  const [editSenha, setEditSenha] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const resp = await api.get('/sac/clientes-externos') as any;
      const data = resp?.data ?? resp;
      setClientes(Array.isArray(data) ? data as ClienteExterno[] : []);
    } catch {
      showToast('Erro ao carregar clientes externos', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.senha !== form.confirmar) {
      showToast('As senhas não coincidem', 'error'); return;
    }
    if (form.senha.length < 6) {
      showToast('Senha mínima: 6 caracteres', 'error'); return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('nome', form.nome);
      fd.append('email', form.email);
      fd.append('empresa', form.empresa);
      fd.append('senha', form.senha);
      await fetch('/api/sac/clientes-externos', { credentials: 'include', 
        method: 'POST',
        headers: { 'user-id': user.id },
        body: fd,
      }).then(async r => {
        if (!r.ok) {
          const err = await r.json();
          throw new Error(err.detail || 'Erro ao criar');
        }
      });
      showToast('Cliente criado com sucesso', 'success');
      setShowModal(false);
      setForm(EMPTY_FORM);
      load();
    } catch (err: any) {
      showToast(err.message || 'Erro ao criar cliente', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (c: ClienteExterno) => {
    const fd = new FormData();
    fd.append('is_active', String(!c.is_active));
    await fetch(`/api/sac/clientes-externos/${c.id}`, { credentials: 'include', 
      method: 'PATCH',
      headers: { 'user-id': user.id },
      body: fd,
    });
    showToast(c.is_active ? 'Cliente desativado' : 'Cliente ativado', 'success');
    load();
  };

  const startEdit = (c: ClienteExterno) => {
    setEditId(c.id);
    setEditNome(c.name);
    setEditEmpresa(c.empresa || '');
    setEditSenha('');
  };

  const handleSaveEdit = async () => {
    const fd = new FormData();
    fd.append('nome', editNome);
    fd.append('empresa', editEmpresa);
    if (editSenha) fd.append('nova_senha', editSenha);
    await fetch(`/api/sac/clientes-externos/${editId}`, { credentials: 'include', 
      method: 'PATCH',
      headers: { 'user-id': user.id },
      body: fd,
    });
    showToast('Cliente atualizado', 'success');
    setEditId(null);
    load();
  };

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleDateString('pt-BR') : '—';

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-5">
        <h1 className="text-2xl font-bold text-slate-800">SAC — Clientes Externos</h1>
        <div className="flex gap-2">
          <button onClick={load} className="flex items-center gap-1.5 px-3 py-2 border border-slate-300 rounded-lg text-slate-600 text-sm hover:bg-slate-50">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition-colors"
          >
            <UserPlus className="w-4 h-4" /> Novo Cliente
          </button>
        </div>
      </div>

      {/* Tabela */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
        </div>
      ) : clientes.length === 0 ? (
        <div className="text-center py-16 text-slate-400">Nenhum cliente externo cadastrado</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
          {/* Desktop */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  {['Nome','E-mail','Empresa','Último acesso','Status','Ações'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {clientes.map(c => (
                  <tr key={c.id} className={`hover:bg-slate-50 ${!c.is_active ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-3">
                      {editId === c.id ? (
                        <input value={editNome} onChange={e => setEditNome(e.target.value)}
                          className="border border-slate-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                      ) : (
                        <span className="font-semibold text-slate-800">{c.name}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{c.email}</td>
                    <td className="px-4 py-3">
                      {editId === c.id ? (
                        <select value={editEmpresa} onChange={e => setEditEmpresa(e.target.value)}
                          className="border border-slate-300 rounded px-2 py-1 text-sm w-full focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white">
                          <option value="">Selecione...</option>
                          {['ACESSIBILIDADE','B2B','CENTRO-OESTE','LEROY','NORDESTE','NORTE','SAO PAULO - CAPITAL','SAO PAULO - INTERIOR','SUDESTE (MG/ES/RJ)','SUL','ACESSO EXTERNO'].map(o => (
                            <option key={o} value={o}>{o}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-slate-600">{c.empresa || '—'}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-400">{fmt(c.last_login)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${
                        c.is_active ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-500 border-slate-200'
                      }`}>
                        {c.is_active ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {editId === c.id ? (
                          <>
                            <input
                              value={editSenha}
                              onChange={e => setEditSenha(e.target.value)}
                              placeholder="Nova senha (opcional)"
                              type="password"
                              className="border border-slate-300 rounded px-2 py-1 text-xs w-28 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                            />
                            <button onClick={handleSaveEdit} title="Salvar"
                              className="p-1.5 rounded-lg bg-green-500 text-white hover:bg-green-600">
                              <Check className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => setEditId(null)} title="Cancelar"
                              className="p-1.5 rounded-lg bg-slate-200 text-slate-600 hover:bg-slate-300">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => startEdit(c)} title="Editar"
                              className="p-1.5 rounded-lg hover:bg-indigo-50 text-indigo-500">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleToggleActive(c)}
                              title={c.is_active ? 'Desativar' : 'Reativar'}
                              className={`p-1.5 rounded-lg ${c.is_active ? 'hover:bg-red-50 text-red-400' : 'hover:bg-green-50 text-green-500'}`}>
                              <Power className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="md:hidden divide-y divide-slate-100">
            {clientes.map(c => (
              <div key={c.id} className={`px-4 py-3 ${!c.is_active ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-slate-800 text-sm">{c.name}</p>
                    <p className="text-xs text-slate-500">{c.email}</p>
                    {c.empresa && <p className="text-xs text-slate-400">{c.empresa}</p>}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold border ${
                      c.is_active ? 'bg-green-50 text-green-700 border-green-200' : 'bg-slate-50 text-slate-500 border-slate-200'
                    }`}>{c.is_active ? 'Ativo' : 'Inativo'}</span>
                    <button onClick={() => startEdit(c)} className="p-1.5 rounded-lg hover:bg-indigo-50 text-indigo-500">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => handleToggleActive(c)}
                      className={`p-1.5 rounded-lg ${c.is_active ? 'hover:bg-red-50 text-red-400' : 'hover:bg-green-50 text-green-500'}`}>
                      <Power className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-1">Último acesso: {fmt(c.last_login)}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Modal novo cliente */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="text-lg font-bold text-slate-800">Novo Cliente Externo</h2>
              <button onClick={() => { setShowModal(false); setForm(EMPTY_FORM); }}
                className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="px-6 py-5 space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Nome *</label>
                <input required value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">E-mail *</label>
                <input required type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Empresa / Razão Social</label>
                <select value={form.empresa} onChange={e => setForm(f => ({ ...f, empresa: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 bg-white">
                  <option value="">Selecione...</option>
                  {['ACESSIBILIDADE','B2B','CENTRO-OESTE','LEROY','NORDESTE','NORTE','SAO PAULO - CAPITAL','SAO PAULO - INTERIOR','SUDESTE (MG/ES/RJ)','SUL','ACESSO EXTERNO'].map(o => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Senha *</label>
                <input required type="password" value={form.senha} onChange={e => setForm(f => ({ ...f, senha: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Confirmar senha *</label>
                <input required type="password" value={form.confirmar} onChange={e => setForm(f => ({ ...f, confirmar: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => { setShowModal(false); setForm(EMPTY_FORM); }}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-slate-600 text-sm hover:bg-slate-50">
                  Cancelar
                </button>
                <button type="submit" disabled={saving}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
                  Cadastrar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SacClientesExternos;
