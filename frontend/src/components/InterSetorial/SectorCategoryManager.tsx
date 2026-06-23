import React, { useState, useEffect } from 'react';
import { User } from '../../types';
import { api } from '../../app_api';
import { useToast } from '../../contexts/ToastContext';
import { Plus, Trash2, Tag, Loader, ChevronDown, ChevronRight, Edit2, Save, X, FileText, Hash, Paperclip } from 'lucide-react';
import ConfirmationModal from '../ConfirmationModal';

interface Props { user: User; }

const SectorCategoryManager: React.FC<Props> = ({ user }) => {
  const { showToast } = useToast();
  const isSuperUser = user.role === 'super_user';

  const managedSectors: string[] = (() => {
    if (isSuperUser) return [];
    const s = user.sector ? [user.sector] : [];
    const m = (user.managed_sectors || '').split(/;\s*/).filter(Boolean);
    return Array.from(new Set([...s, ...m]));
  })();

  const [sectors, setSectors] = useState<string[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [subcategoriesMap, setSubcategoriesMap] = useState<Record<string, any[]>>({});
  const [loadingCats, setLoadingCats] = useState(false);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [loadingSubs, setLoadingSubs] = useState(false);

  // Modal state
  const [showModal, setShowModal] = useState<'category' | 'subcategory' | null>(null);
  const [modalSector, setModalSector] = useState('');
  const [modalCatName, setModalCatName] = useState('');
  const [modalSubName, setModalSubName] = useState('');
  const [modalCatId, setModalCatId] = useState(''); // for adding subcategory to existing
  const [modalMinChars, setModalMinChars] = useState(0);
  const [modalHasMinChars, setModalHasMinChars] = useState(false);
  const [modalRequireAttachment, setModalRequireAttachment] = useState(false);
  const [modalSubmitting, setModalSubmitting] = useState(false);

  // Edit state
  const [editingCat, setEditingCat] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  // Delete state
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteSubId, setDeleteSubId] = useState<string | null>(null);
  const [isDeletingSub, setIsDeletingSub] = useState(false);

  // Selected sector for viewing
  const [selectedSector, setSelectedSector] = useState('');

  useEffect(() => {
    if (isSuperUser) {
      api.getSectors().then((data: any[]) => {
        const s = data.filter(s => s.is_active).map(s => s.name).sort();
        setSectors(s);
      }).catch(() => {});
    } else {
      setSectors(managedSectors.sort());
      if (managedSectors.length === 1) setSelectedSector(managedSectors[0]);
    }
  }, []);

  useEffect(() => {
    if (!selectedSector) { setCategories([]); return; }
    setLoadingCats(true);
    api.getSectorCategories(selectedSector)
      .then(setCategories)
      .catch(() => showToast('Erro ao carregar categorias.', 'error'))
      .finally(() => setLoadingCats(false));
  }, [selectedSector]);

  // Load subcategories when expanding
  useEffect(() => {
    if (!expandedCat) return;
    if (subcategoriesMap[expandedCat]) return; // already loaded
    setLoadingSubs(true);
    api.getSectorSubcategories(expandedCat)
      .then(data => setSubcategoriesMap(prev => ({ ...prev, [expandedCat]: data })))
      .catch(() => {})
      .finally(() => setLoadingSubs(false));
  }, [expandedCat]);

  const canManage = (sector: string) => isSuperUser || managedSectors.includes(sector);

  const userSectors = isSuperUser ? sectors : managedSectors;

  const resetModal = () => {
    setShowModal(null);
    setModalSector(userSectors.length === 1 ? userSectors[0] : '');
    setModalCatName('');
    setModalSubName('');
    setModalCatId('');
    setModalMinChars(0);
    setModalHasMinChars(false);
    setModalRequireAttachment(false);
  };

  const openNewCategoryModal = () => {
    resetModal();
    setModalSector(selectedSector || (userSectors.length === 1 ? userSectors[0] : ''));
    setShowModal('category');
  };

  const openAddSubcategoryModal = (catId: string) => {
    resetModal();
    setModalCatId(catId);
    setShowModal('subcategory');
  };

  const handleCreateCategory = async () => {
    if (!modalCatName.trim() || !modalSector) return;
    setModalSubmitting(true);
    try {
      const created = await api.createSectorCategory(modalSector, modalCatName.trim(), 0);
      if (modalSector === selectedSector) {
        setCategories(prev => [...prev, created].sort((a, b) => a.name.localeCompare(b.name)));
      }
      // If subcategory name is provided, create it too
      if (modalSubName.trim()) {
        const sub = await api.createSectorSubcategory(
          created.id, modalSubName.trim(),
          modalHasMinChars ? modalMinChars : 0,
          modalRequireAttachment
        );
        setSubcategoriesMap(prev => ({ ...prev, [created.id]: [sub] }));
      }
      showToast('Categoria criada com sucesso!', 'success');
      resetModal();
      // Refresh if needed
      if (modalSector !== selectedSector) setSelectedSector(modalSector);
    } catch (err: any) {
      showToast(err.message || 'Erro ao criar.', 'error');
    } finally {
      setModalSubmitting(false);
    }
  };

  const handleCreateSubcategory = async () => {
    if (!modalSubName.trim() || !modalCatId) return;
    setModalSubmitting(true);
    try {
      const created = await api.createSectorSubcategory(
        modalCatId, modalSubName.trim(),
        modalHasMinChars ? modalMinChars : 0,
        modalRequireAttachment
      );
      setSubcategoriesMap(prev => ({
        ...prev,
        [modalCatId]: [...(prev[modalCatId] || []), created].sort((a: any, b: any) => a.name.localeCompare(b.name))
      }));
      showToast('Subcategoria criada!', 'success');
      resetModal();
    } catch (err: any) {
      showToast(err.message || 'Erro ao criar subcategoria.', 'error');
    } finally {
      setModalSubmitting(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingCat || !editName.trim()) return;
    setSavingEdit(true);
    try {
      const updated = await api.updateSectorCategory(editingCat, editName.trim(), 0);
      setCategories(prev => prev.map(c => c.id === editingCat ? { ...c, name: updated.name } : c));
      setEditingCat(null);
      showToast('Categoria atualizada.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Erro ao atualizar.', 'error');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeleteCat = async () => {
    if (!deleteId) return;
    setIsDeleting(true);
    try {
      await api.deleteSectorCategory(deleteId);
      setCategories(prev => prev.filter(c => c.id !== deleteId));
      setDeleteId(null);
      showToast('Categoria excluída.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Erro ao excluir.', 'error');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteSub = async () => {
    if (!deleteSubId) return;
    setIsDeletingSub(true);
    try {
      await api.deleteSectorSubcategory(deleteSubId);
      setSubcategoriesMap(prev => {
        const updated = { ...prev };
        for (const key of Object.keys(updated)) {
          updated[key] = updated[key].filter((s: any) => s.id !== deleteSubId);
        }
        return updated;
      });
      setDeleteSubId(null);
      showToast('Subcategoria excluída.', 'success');
    } catch (err: any) {
      showToast(err.message || 'Erro ao excluir.', 'error');
    } finally {
      setIsDeletingSub(false);
    }
  };

  const toggleExpand = (catId: string) => {
    setExpandedCat(expandedCat === catId ? null : catId);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Categorias por Setor</h1>
          <p className="text-gray-500 text-sm">Gerencie categorias e subcategorias de chamados. Defina regras por subcategoria.</p>
        </div>
        <button
          onClick={openNewCategoryModal}
          className="flex items-center gap-2 px-5 py-2.5 bg-red-600 text-white text-sm font-bold rounded-lg hover:bg-red-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" /> Novo
        </button>
      </div>

      {/* Sector dropdown */}
      <div className="max-w-xs">
        <label className="block text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1.5">Selecione o Setor</label>
        <select
          value={selectedSector}
          onChange={e => setSelectedSector(e.target.value)}
          className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm font-medium focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
        >
          <option value="">Selecione um setor...</option>
          {(isSuperUser ? sectors : managedSectors).map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      {/* Categories table */}
      {!selectedSector ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-16 text-center">
          <Tag className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">Selecione um setor acima para visualizar as categorias.</p>
        </div>
      ) : loadingCats ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-16 text-center">
          <Loader className="w-6 h-6 animate-spin text-gray-300 mx-auto" />
        </div>
      ) : categories.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-16 text-center">
          <Tag className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 text-sm font-medium">Nenhuma categoria cadastrada para {selectedSector}.</p>
          <p className="text-gray-400 text-xs mt-1">Clique em "Novo" para criar a primeira.</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-12 gap-4 px-5 py-3 bg-gray-50 border-b border-gray-100 text-[10px] font-black text-gray-400 uppercase tracking-wider">
            <div className="col-span-4">Categoria</div>
            <div className="col-span-2">Criado por</div>
            <div className="col-span-2">Subcategorias</div>
            <div className="col-span-2">Regras</div>
            <div className="col-span-2 text-right">Ações</div>
          </div>

          {/* Rows */}
          {categories.map(c => {
            const subs = subcategoriesMap[c.id] || [];
            const isExpanded = expandedCat === c.id;

            return (
              <div key={c.id} className="border-b border-gray-50 last:border-0">
                {/* Category row */}
                {editingCat === c.id ? (
                  <div className="px-5 py-3 bg-blue-50/50 flex items-center gap-3">
                    <input
                      type="text"
                      value={editName}
                      onChange={e => setEditName(e.target.value)}
                      className="flex-1 px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                    />
                    <button onClick={handleSaveEdit} disabled={savingEdit || !editName.trim()} className="flex items-center gap-1 px-3 py-1.5 bg-red-600 text-white text-xs font-bold rounded-lg hover:bg-red-700 disabled:opacity-50">
                      {savingEdit ? <Loader className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Salvar
                    </button>
                    <button onClick={() => setEditingCat(null)} className="p-1.5 text-gray-400 hover:text-gray-600 border border-gray-200 rounded-lg">
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-12 gap-4 px-5 py-3.5 items-center hover:bg-gray-50/50 transition-colors">
                    <div className="col-span-4 flex items-center gap-2">
                      <button onClick={() => toggleExpand(c.id)} className="p-0.5">
                        {isExpanded
                          ? <ChevronDown className="w-4 h-4 text-red-500" />
                          : <ChevronRight className="w-4 h-4 text-gray-300" />
                        }
                      </button>
                      <Tag className="w-4 h-4 text-red-400" />
                      <span className="text-sm font-semibold text-gray-800">{c.name}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-xs text-gray-500">{c.created_by_name || '—'}</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-xs text-gray-400">
                        {subs.length > 0 ? `${subs.length} subcategoria(s)` : isExpanded && !loadingSubs ? '0' : '—'}
                      </span>
                    </div>
                    <div className="col-span-2">
                      {c.min_chars > 0 && (
                        <span className="inline-flex items-center gap-1 text-[10px] text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full">
                          <Hash className="w-2.5 h-2.5" /> {c.min_chars}
                        </span>
                      )}
                    </div>
                    <div className="col-span-2 flex items-center justify-end gap-1">
                      {canManage(selectedSector) && (
                        <>
                          <button onClick={() => openAddSubcategoryModal(c.id)} className="text-green-500 hover:text-green-700 p-1" title="Adicionar subcategoria">
                            <Plus className="w-4 h-4" />
                          </button>
                          <button onClick={() => { setEditingCat(c.id); setEditName(c.name); }} className="text-gray-400 hover:text-blue-500 p-1" title="Editar">
                            <Edit2 className="w-4 h-4" />
                          </button>
                          <button onClick={() => setDeleteId(c.id)} className="text-gray-400 hover:text-red-500 p-1" title="Excluir">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )}

                {/* Subcategories expanded */}
                {isExpanded && (
                  <div className="bg-gray-50/30 border-t border-gray-100">
                    {loadingSubs && !subcategoriesMap[c.id] ? (
                      <div className="px-12 py-4 text-xs text-gray-400 flex items-center gap-2">
                        <Loader className="w-3 h-3 animate-spin" /> Carregando subcategorias...
                      </div>
                    ) : subs.length === 0 ? (
                      <div className="px-12 py-4 text-xs text-gray-400">
                        Nenhuma subcategoria cadastrada.
                        {canManage(selectedSector) && (
                          <button onClick={() => openAddSubcategoryModal(c.id)} className="ml-2 text-red-500 hover:text-red-700 font-bold">
                            + Adicionar
                          </button>
                        )}
                      </div>
                    ) : (
                      subs.map((s: any) => (
                        <div key={s.id} className="grid grid-cols-12 gap-4 px-5 py-2.5 items-center ml-6 border-b border-gray-100/50 last:border-0">
                          <div className="col-span-5 flex items-center gap-2">
                            <span className="text-gray-300 text-xs">└</span>
                            <FileText className="w-3.5 h-3.5 text-gray-300" />
                            <span className="text-xs text-gray-700 font-medium">{s.name}</span>
                          </div>
                          <div className="col-span-3" />
                          <div className="col-span-2 flex items-center gap-1.5">
                            {s.min_chars > 0 && (
                              <span className="inline-flex items-center gap-0.5 text-[9px] text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-full" title={`Mínimo ${s.min_chars} caracteres`}>
                                <Hash className="w-2 h-2" /> {s.min_chars}
                              </span>
                            )}
                            {s.require_attachment && (
                              <span className="inline-flex items-center gap-0.5 text-[9px] text-orange-600 bg-orange-50 px-1.5 py-0.5 rounded-full" title="Anexo obrigatório">
                                <Paperclip className="w-2 h-2" /> Anexo
                              </span>
                            )}
                          </div>
                          <div className="col-span-2 flex justify-end">
                            {canManage(selectedSector) && (
                              <button onClick={() => setDeleteSubId(s.id)} className="text-gray-400 hover:text-red-500 p-0.5" title="Excluir subcategoria">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ==================== MODAL ==================== */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={() => resetModal()}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-gray-100">
              <h3 className="text-lg font-bold text-gray-900">
                {showModal === 'category' ? 'Nova Categoria' : 'Nova Subcategoria'}
              </h3>
              <button onClick={resetModal} className="p-1 text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-5 space-y-4">
              {/* Setor */}
              {showModal === 'category' && (
                <div>
                  <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-1.5">Setor</label>
                  {userSectors.length === 1 ? (
                    <div className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm font-medium text-gray-700">{userSectors[0]}</div>
                  ) : (
                    <select
                      value={modalSector}
                      onChange={e => setModalSector(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 bg-white"
                    >
                      <option value="">Selecione o setor...</option>
                      {userSectors.map(s => <option key={s} value={s}>{s}</option>)}
                    </select>
                  )}
                </div>
              )}

              {/* Categoria */}
              {showModal === 'category' && (
                <div>
                  <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-1.5">Nome da Categoria *</label>
                  <input
                    type="text"
                    value={modalCatName}
                    onChange={e => setModalCatName(e.target.value)}
                    placeholder="Ex: Compras, Financeiro, Manutenção..."
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                  />
                </div>
              )}

              {/* Subcategoria */}
              <div>
                <label className="block text-xs font-bold text-gray-600 uppercase tracking-wider mb-1.5">
                  {showModal === 'category' ? 'Subcategoria (opcional)' : 'Nome da Subcategoria *'}
                </label>
                <input
                  type="text"
                  value={modalSubName}
                  onChange={e => setModalSubName(e.target.value)}
                  placeholder="Ex: Solicitação de compra, Reembolso..."
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                />
              </div>

              {/* Regras — sempre visível */}
              <div className="bg-gray-50 rounded-lg p-4 space-y-3">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">Regras para o Chamado</p>

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={modalHasMinChars}
                      onChange={e => { setModalHasMinChars(e.target.checked); if (!e.target.checked) setModalMinChars(0); }}
                      className="w-4 h-4 text-red-600 rounded border-gray-300 focus:ring-red-500"
                    />
                    <span className="text-sm text-gray-700">Exigir mínimo de caracteres na descrição</span>
                  </label>
                  {modalHasMinChars && (
                    <div className="ml-6">
                      <input
                        type="number"
                        min={1}
                        max={5000}
                        value={modalMinChars || ''}
                        onChange={e => setModalMinChars(parseInt(e.target.value) || 0)}
                        placeholder="Ex: 100"
                        className="w-32 px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
                      />
                      <span className="text-xs text-gray-400 ml-2">caracteres</span>
                    </div>
                  )}

                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={modalRequireAttachment}
                      onChange={e => setModalRequireAttachment(e.target.checked)}
                      className="w-4 h-4 text-red-600 rounded border-gray-300 focus:ring-red-500"
                    />
                    <span className="text-sm text-gray-700">Exigir anexo obrigatório</span>
                  </label>
                </div>
            </div>

            <div className="flex justify-end gap-3 p-5 border-t border-gray-100">
              <button onClick={resetModal} className="px-4 py-2 text-sm font-bold text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                Cancelar
              </button>
              <button
                onClick={showModal === 'category' ? handleCreateCategory : handleCreateSubcategory}
                disabled={
                  modalSubmitting ||
                  (showModal === 'category' && (!modalCatName.trim() || !modalSector)) ||
                  (showModal === 'subcategory' && !modalSubName.trim())
                }
                className="flex items-center gap-2 px-5 py-2 bg-red-600 text-white text-sm font-bold rounded-lg hover:bg-red-700 disabled:opacity-50 transition-colors"
              >
                {modalSubmitting ? <Loader className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Criar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation modals */}
      <ConfirmationModal isOpen={!!deleteId} onClose={() => setDeleteId(null)} onConfirm={handleDeleteCat} title="Excluir Categoria" message="Tem certeza? Subcategorias vinculadas também serão excluídas." isLoading={isDeleting} />
      <ConfirmationModal isOpen={!!deleteSubId} onClose={() => setDeleteSubId(null)} onConfirm={handleDeleteSub} title="Excluir Subcategoria" message="Tem certeza que deseja excluir esta subcategoria?" isLoading={isDeletingSub} />
    </div>
  );
};

export default SectorCategoryManager;
