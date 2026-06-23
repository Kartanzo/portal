
import React, { useState, useEffect } from 'react';
import { User, UserRole } from '../types';
import { UserPlus, Search, MoreVertical, Shield, Mail, Calendar, Edit2, Trash2, X, Eye, EyeOff, Lock, Briefcase, ChevronDown, ChevronRight, Folder, FolderOpen, Layers } from 'lucide-react';
import { api } from '../app_api';
import ConfirmationModal from './ConfirmationModal';
import { formatDateBR } from './dateUtils';

import { useToast } from '../contexts/ToastContext';
import { useSectors } from '../hooks/useSectors';
import { MobileLandscapeHint } from './ui/MobileLandscapeHint';

const UserManagement: React.FC = () => {
  const { showToast } = useToast();
  const sectors = useSectors();
  const [showModal, setShowModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [role, setRole] = useState<UserRole>('user');
  const [loading, setLoading] = useState(true);

  // Edit/Create State
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [formData, setFormData] = useState<Partial<User> & { password?: string }>({});

  // Delete State
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [userToDelete, setUserToDelete] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // Hierarchy State
  const [expandedSectors, setExpandedSectors] = useState<Set<string>>(new Set());
  const [expandedRoles, setExpandedRoles] = useState<Set<string>>(new Set());

  const loadUsers = async () => {
    try {
      const data = await api.getUsers();
      // Sort alphabetically by name
      data.sort((a, b) => a.name.localeCompare(b.name));
      setUsers(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleDeleteClick = (id: string) => {
    setUserToDelete(id);
    setDeleteModalOpen(true);
  };

  const handleConfirmDelete = async () => {
    if (!userToDelete) return;
    setIsDeleting(true);
    try {
      await api.deleteUser(userToDelete);
      setUsers(prev => prev.filter(u => u.id !== userToDelete));
      setDeleteModalOpen(false);
      setUserToDelete(null);
      showToast('Usuário excluído com sucesso!', 'success');
    } catch (e: any) {
      const msg = e.message || 'Erro ao deletar usuário';
      showToast(msg, 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleEdit = (user: User) => {
    setEditingUser(user);
    setFormData(user);
    setShowModal(true);
  };

  const handleCreate = () => {
    setEditingUser(null);
    setFormData({ role: 'user', sector: sectors[0] });
    setShowModal(true);
  };

  const handleSave = async () => {
    try {
      if (editingUser && editingUser.id) {
        await api.updateUser(editingUser.id, formData);
        showToast('Usuário atualizado com sucesso!', 'success');
      } else {
        // Create user
        if (!formData.password) {
          showToast("Senha é obrigatória para novos usuários.", 'error');
          return;
        }
        await api.createUser(formData);
        showToast('Usuário criado com sucesso!', 'success');
      }
      setShowModal(false);
      loadUsers();
    } catch (e: any) {
      // Extract backend error message if available
      const msg = e.message || 'Erro ao salvar. Verifique os dados.';
      showToast(msg, 'error');
    }
  };

  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    u.email.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const getRoleBadge = (role: UserRole) => {
    switch (role) {
      case 'super_user': return 'bg-red-100 text-red-700 border-red-200';
      case 'admin': return 'bg-slate-100 text-slate-700 border-slate-200';
      case 'ceo': return 'bg-purple-100 text-purple-700 border-purple-200';
      default: return 'bg-blue-100 text-blue-700 border-blue-200';
    }
  };

  // Hierarchy Logic
  const groupedUsers = React.useMemo<Record<string, { role: string, users: User[] }[]>>(() => {
    const groups: Record<string, Record<string, User[]>> = {};

    filteredUsers.forEach(user => {
      const userSectors = new Set<string>();
      if (user.sector) userSectors.add(user.sector);
      if (user.managed_sectors) {
        user.managed_sectors.split(/[;,]\s*/).forEach(s => {
          if (s.trim()) userSectors.add(s.trim());
        });
      }

      if (userSectors.size === 0) userSectors.add('Sem Setor');

      userSectors.forEach(sector => {
        const role = user.role || 'user';

        if (!groups[sector]) groups[sector] = {};
        if (!groups[sector][role]) groups[sector][role] = [];

        if (!groups[sector][role].some(u => u.id === user.id)) {
          groups[sector][role].push(user);
        }
      });
    });

    // Sort sectors alphabetically
    const sortedSectors = Object.keys(groups).sort();

    const sortedGroups: Record<string, { role: string, users: User[] }[]> = {};

    // Sort roles by hierarchy (ceo > super_user > admin > user)
    const roleOrder: Record<string, number> = { 'ceo': 1, 'super_user': 2, 'admin': 3, 'user': 4 };

    sortedSectors.forEach(sector => {
      const roles = Object.keys(groups[sector]);
      roles.sort((a, b) => (roleOrder[a] || 99) - (roleOrder[b] || 99));

      sortedGroups[sector] = roles.map(role => ({
        role,
        users: groups[sector][role].sort((a, b) => a.name.localeCompare(b.name))
      }));
    });

    return sortedGroups;
  }, [filteredUsers]);

  const toggleSector = (sector: string) => {
    const next = new Set(expandedSectors);
    if (next.has(sector)) next.delete(sector);
    else next.add(sector);
    setExpandedSectors(next);
  };

  const toggleRole = (sector: string, role: string) => {
    const key = `${sector}-${role}`;
    const next = new Set(expandedRoles);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setExpandedRoles(next);
  };

  const expandAll = () => {
    const allSectors = new Set(Object.keys(groupedUsers));
    const allRoles = new Set<string>();
    Object.keys(groupedUsers).forEach(sector => {
      groupedUsers[sector].forEach(r => allRoles.add(`${sector}-${r.role}`));
    });
    setExpandedSectors(allSectors);
    setExpandedRoles(allRoles);
  };

  const collapseAll = () => {
    setExpandedSectors(new Set());
    setExpandedRoles(new Set());
  };


  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Gestão de Acessos</h1>
          <p className="text-gray-500 text-sm">Controle de usuários, setores e permissões do Portal.</p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-bold shadow-md hover:bg-red-700 transition-colors"
        >
          <UserPlus className="w-4 h-4 mr-2" /> Novo Usuário
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {/* Search Bar... */}
        {/* Search Bar & Actions */}
        <div className="p-4 border-b border-gray-100 bg-gray-50/50 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="relative md:flex-1 max-w-md w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="Pesquisar por nome ou e-mail..."
              className="w-full pl-10 pr-4 py-2 bg-white border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-red-500 outline-none transition-all"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={expandAll} className="px-3 py-1.5 text-xs font-bold text-gray-600 bg-white border border-gray-200 rounded-md hover:bg-gray-50 flex items-center">
              <FolderOpen className="w-3.5 h-3.5 mr-1.5 text-blue-500" /> Expandir Todos
            </button>
            <button onClick={collapseAll} className="px-3 py-1.5 text-xs font-bold text-gray-600 bg-white border border-gray-200 rounded-md hover:bg-gray-50 flex items-center">
              <Folder className="w-3.5 h-3.5 mr-1.5 text-slate-400" /> Recolher Todos
            </button>
          </div>
        </div>

        <MobileLandscapeHint message="A lista de usuários funciona melhor em paisagem ou no desktop." />
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="bg-gray-50 text-[10px] font-black text-gray-400 uppercase tracking-widest border-b border-gray-100">
                <th className="px-6 py-4">Usuário / Setor</th>
                <th className="px-6 py-4">Perfil</th>
                <th className="px-6 py-4">Último Acesso</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {Object.keys(groupedUsers).map(sector => {
                const roles = groupedUsers[sector];
                const isSectorExpanded = expandedSectors.has(sector) || searchTerm.length > 0;
                const totalUsersInSector = roles.reduce((acc, r) => acc + r.users.length, 0);

                return (
                  <React.Fragment key={sector}>
                    {/* Sector Header */}
                    <tr
                      className="bg-slate-100/50 hover:bg-slate-100 dark:bg-slate-700/60 dark:hover:bg-slate-700 cursor-pointer transition-colors border-y border-slate-200 dark:border-slate-600"
                      onClick={() => toggleSector(sector)}
                    >
                      <td colSpan={5} className="px-4 py-3">
                        <div className="flex items-center text-slate-700 dark:text-slate-100">
                          {isSectorExpanded ? <ChevronDown className="w-4 h-4 mr-2 text-slate-400" /> : <ChevronRight className="w-4 h-4 mr-2 text-slate-400" />}
                          <Briefcase className="w-4 h-4 mr-2 text-blue-600" />
                          <span className="font-black text-xs uppercase tracking-wider">{sector}</span>
                          <span className="ml-3 px-2 py-0.5 bg-white text-slate-500 text-[10px] font-bold rounded-full border border-slate-200">
                            {totalUsersInSector} usuário{totalUsersInSector !== 1 ? 's' : ''}
                          </span>
                        </div>
                      </td>
                    </tr>

                    {/* Roles under Sector */}
                    {isSectorExpanded && roles.map(({ role, users: roleUsers }) => {
                      const isRoleExpanded = expandedRoles.has(`${sector}-${role}`) || searchTerm.length > 0;

                      return (
                        <React.Fragment key={`${sector}-${role}`}>
                          {/* Role Header */}
                          <tr
                            className="bg-gray-50/50 hover:bg-gray-50 dark:bg-slate-800/50 dark:hover:bg-slate-800 cursor-pointer transition-colors"
                            onClick={() => toggleRole(sector, role)}
                          >
                            <td colSpan={5} className="px-4 py-2 pl-10">
                              <div className="flex items-center text-gray-600 dark:text-slate-300">
                                {isRoleExpanded ? <ChevronDown className="w-3.5 h-3.5 mr-2 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 mr-2 text-gray-400" />}
                                <Layers className="w-3.5 h-3.5 mr-2 text-slate-500" />
                                <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border bg-white ${getRoleBadge(role as UserRole).split(' ')[2]}`}>
                                  {role.replace('_', ' ')}
                                </span>
                                <span className="ml-2 px-1.5 py-0.5 text-gray-400 text-[10px] font-bold">
                                  {roleUsers.length}
                                </span>
                              </div>
                            </td>
                          </tr>

                          {/* Users under Role */}
                          {isRoleExpanded && roleUsers.map(u => (
                            <tr key={u.id} className="hover:bg-blue-50/30 dark:hover:bg-slate-700/30 transition-colors group bg-white dark:bg-transparent">
                              <td className="px-6 py-3 pl-16">
                                <div className="flex items-center">
                                  <img src={u.avatar || `https://ui-avatars.com/api/?name=${u.name}`} alt={u.name} className="w-8 h-8 rounded-full mr-3 border border-gray-200 shadow-sm" />
                                  <div>
                                    <p className="text-sm font-bold text-gray-900 leading-tight">{u.name}</p>
                                    <div className="flex items-center space-x-1 mt-0.5">
                                      <span className="text-[10px] font-medium text-gray-400 flex items-center lowercase">
                                        <Mail className="w-3 h-3 mr-1" /> {u.email}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-3">
                                {/* Role is already contextually known, but keeping badge for clarity */}
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${getRoleBadge(u.role)}`}>
                                  {u.role ? u.role.replace('_', ' ') : 'USER'}
                                </span>
                              </td>
                              <td className="px-6 py-3">
                                <div className="text-[11px] text-gray-500 flex items-center font-medium">
                                  <Calendar className="w-3.5 h-3.5 mr-1.5 text-gray-300" />
                                  {formatDateBR(u.last_login)}
                                </div>
                              </td>
                              <td className="px-6 py-3">
                                <span className="flex items-center text-[10px] font-black uppercase text-green-600 tracking-wider">
                                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full mr-1.5"></span> Ativo
                                </span>
                              </td>
                              <td className="px-6 py-3 text-right">
                                <div className="flex items-center justify-end space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                  <button onClick={() => handleEdit(u)} className="p-1.5 text-gray-400 hover:text-blue-600 bg-white border border-gray-100 shadow-sm rounded transition-all" title="Editar Usuário">
                                    <Edit2 className="w-3.5 h-3.5" />
                                  </button>
                                  <button onClick={() => handleDeleteClick(u.id)} className="p-1.5 text-gray-400 hover:text-red-600 bg-white border border-gray-100 shadow-sm rounded transition-all" title="Excluir Usuário">
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                );
              })}

              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-gray-500">
                    Nenhum usuário encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowModal(false)}></div>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md relative z-10 overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 bg-slate-900 text-white flex justify-between items-center shrink-0">
              <div>
                <h3 className="text-lg font-bold">{editingUser ? 'Editar Usuário' : 'Novo Usuário'}</h3>
              </div>
              <button onClick={() => setShowModal(false)} className="p-2 hover:bg-slate-800 rounded-full transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form className="p-6 space-y-4 overflow-y-auto" onSubmit={(e) => { e.preventDefault(); handleSave(); }}>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5">Nome Completo</label>
                <input
                  type="text"
                  className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-red-500 outline-none"
                  value={formData.name || ''}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5">Email</label>
                <input
                  type="text"
                  className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-red-500 outline-none"
                  value={formData.email || ''}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5">Senha {editingUser ? '(deixe em branco para manter)' : ''}</label>
                <input
                  type="password"
                  className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg text-sm text-gray-900 focus:ring-2 focus:ring-red-500 outline-none"
                  value={(formData as any).password || ''}
                  onChange={e => setFormData({ ...formData, password: e.target.value } as any)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5">Perfil</label>
                  <select
                    className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg text-sm"
                    value={formData.role || 'user'}
                    onChange={e => {
                      const newRole = e.target.value as any;
                      setFormData(prev => ({
                        ...prev,
                        role: newRole,
                        // If switching to non-admin, clear managed sectors? 
                        // Or keep them but they won't be used/shown.
                        // Let's keep it simple.
                      }));
                    }}
                  >
                    <option value="user">Usuário</option>
                    <option value="admin">Admin</option>
                    <option value="super_user">Super User</option>
                    <option value="ceo">CEO</option>
                  </select>
                </div>

                <div className={formData.role === 'admin' ? 'col-span-2' : ''}>
                  <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-1.5">
                    {formData.role === 'admin' ? 'Setores de Atuação (Selecione um ou mais)' : 'Setor'}
                  </label>

                  {formData.role === 'admin' ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 bg-gray-50 p-3 rounded-lg border border-gray-200">
                      {sectors.map(s => {
                        // Determine if checked
                        // We use managed_sectors as the source of truth for admins
                        // If managed_sectors is empty, fallback to 'sector'
                        const currentManaged = formData.managed_sectors
                          ? formData.managed_sectors.split(';')
                          : (formData.sector ? [formData.sector] : []);

                        const isChecked = currentManaged.includes(s);

                        return (
                          <label key={s} className={`flex items-center space-x-2 text-xs cursor-pointer p-2 rounded transition-colors ${isChecked ? 'bg-red-50 text-red-700 font-bold border border-red-100' : 'hover:bg-white text-gray-600 border border-transparent'}`}>
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={(e) => {
                                let newDetails = [...currentManaged];
                                if (e.target.checked) {
                                  newDetails.push(s);
                                } else {
                                  newDetails = newDetails.filter(d => d !== s);
                                }
                                // Deduplicate
                                newDetails = [...new Set(newDetails)];

                                // Sort for consistency?
                                // newDetails.sort(); 

                                // Primary Sector Logic: Use the FIRST selected sector
                                const primarySector = newDetails.length > 0 ? newDetails[0] : '';

                                setFormData(prev => ({
                                  ...prev,
                                  managed_sectors: newDetails.join(';'),
                                  sector: primarySector
                                }));
                              }}
                              className="rounded text-red-600 focus:ring-red-500 border-gray-300"
                            />
                            <span>{s}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <select
                      className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg text-sm"
                      value={formData.sector || ''}
                      onChange={e => setFormData({ ...formData, sector: e.target.value })}
                    >
                      {sectors.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                  {formData.role === 'admin' && (
                    <p className="text-[10px] text-gray-400 mt-1.5">* O primeiro setor selecionado será usado como setor principal (avatar).</p>
                  )}
                </div>
              </div>



              <div className="pt-4 border-t border-gray-100">
                <label className="block text-[10px] font-black text-gray-500 uppercase tracking-widest mb-3">Permissões Individuais (Ações Extras)</label>
                <div className="overflow-hidden border border-gray-200 rounded-xl">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 border-b border-gray-200">
                      <tr>
                        <th className="px-4 py-2 font-black text-gray-400 uppercase tracking-widest">Módulo</th>
                        <th className="px-4 py-2 font-black text-gray-400 uppercase tracking-widest text-center">Editar</th>
                        <th className="px-4 py-2 font-black text-gray-400 uppercase tracking-widest text-center">Excluir</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {[
                        { key: 'tickets', label: 'Chamado' },
                        { key: 'strategic', label: 'Planejamento Estratégico' },
                        { key: 'projects', label: 'Gestão de Projeto' },
                        { key: 'importation', label: 'Importação' },
                        { key: 'finance', label: 'Financeiro' }
                      ].map(mod => (
                        <tr key={mod.key} className="hover:bg-gray-50">
                          <td className="px-4 py-3 font-bold text-gray-700">{mod.label}</td>
                          <td className="px-4 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={formData.permissions?.[mod.key]?.can_edit || false}
                              onChange={e => {
                                const val = e.target.checked;
                                setFormData(prev => ({
                                  ...prev,
                                  permissions: {
                                    ...prev.permissions,
                                    [mod.key]: {
                                      ...prev.permissions?.[mod.key],
                                      can_edit: val
                                    }
                                  }
                                }));
                              }}
                              className="rounded text-red-600 focus:ring-red-500 border-gray-300"
                            />
                          </td>
                          <td className="px-4 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={formData.permissions?.[mod.key]?.can_delete || false}
                              onChange={e => {
                                const val = e.target.checked;
                                setFormData(prev => ({
                                  ...prev,
                                  permissions: {
                                    ...prev.permissions,
                                    [mod.key]: {
                                      ...prev.permissions?.[mod.key],
                                      can_delete: val
                                    }
                                  }
                                }));
                              }}
                              className="rounded text-red-600 focus:ring-red-500 border-gray-300"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[9px] text-gray-400 mt-2 px-1 leading-tight">
                  * Habilite permissões de edição e exclusão para este usuário, independente do cargo orignal. <br />
                  * A permissão de <strong>Incluir</strong> permanece vinculada ao cargo original.
                </p>
              </div>

              <div className="pt-4 flex space-x-3 bg-white">
                <button type="button" onClick={() => setShowModal(false)} className="flex-1 px-4 py-2.5 bg-gray-100 text-gray-600 rounded-lg text-sm font-bold">Cancelar</button>
                <button type="submit" className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg text-sm font-bold shadow-md hover:bg-red-700">Salvar</button>
              </div>
            </form>
          </div>
        </div >
      )}
      <ConfirmationModal
        isOpen={deleteModalOpen}
        onClose={() => {
          setDeleteModalOpen(false);
          setUserToDelete(null);
        }}
        onConfirm={handleConfirmDelete}
        title="Excluir Usuário"
        message="Tem certeza que deseja excluir este usuário? O acesso será revogado imediatamente. Esta ação não pode ser desfeita."
        isLoading={isDeleting}
      />
    </div >
  );
};

export default UserManagement;
