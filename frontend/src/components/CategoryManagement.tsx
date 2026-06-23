import React, { useState, useEffect } from 'react';
import { User } from '../types';
import { api } from '../app_api';
import { useToast } from '../contexts/ToastContext';
import { Plus, Trash2, Tag, Loader, ChevronRight, Layers, LayoutGrid, Info, ArrowLeft } from 'lucide-react';
import ConfirmationModal from './ConfirmationModal';

interface Props { user: User; }

const ALLOWED_SECTORS = ['T.I', 'Gestão de Informação'];

const CategoryManagement: React.FC<Props> = ({ user }) => {
    const { showToast } = useToast();

    const isSuperUser = user.role === 'super_user';
    const hasAccess = isSuperUser || ALLOWED_SECTORS.includes(user.sector || '');

    const [activeSector, setActiveSector] = useState<'T.I' | 'Gestão de Informação'>('T.I');
    const [categories, setCategories] = useState<any[]>([]);
    const [selectedCategory, setSelectedCategory] = useState<any | null>(null);
    const [subcategories, setSubcategories] = useState<any[]>([]);

    const [loadingCats, setLoadingCats] = useState(false);
    const [loadingSubs, setLoadingSubs] = useState(false);

    const [newCatName, setNewCatName] = useState('');
    const [newSubName, setNewSubName] = useState('');

    const [creatingCat, setCreatingCat] = useState(false);
    const [creatingSub, setCreatingSub] = useState(false);

    const [deleteItem, setDeleteItem] = useState<{ id: string, type: 'category' | 'subcategory' } | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

    // Load categories
    const loadCategories = async () => {
        setLoadingCats(true);
        try {
            const data = await api.getCategories(activeSector);
            setCategories(data);
            if (selectedCategory) {
                // Refresh selected category if it's still in the list
                const stillExists = data.find((c: any) => c.id === selectedCategory.id);
                if (!stillExists) setSelectedCategory(null);
            }
        } catch (err) {
            showToast('Erro ao carregar categorias.', 'error');
        } finally {
            setLoadingCats(false);
        }
    };

    // Load subcategories
    const loadSubcategories = async (catId: string) => {
        setLoadingSubs(true);
        try {
            const data = await api.getSubcategories(catId);
            setSubcategories(data);
        } catch (err) {
            showToast('Erro ao carregar subcategorias.', 'error');
        } finally {
            setLoadingSubs(false);
        }
    };

    useEffect(() => {
        loadCategories();
    }, [activeSector]);

    useEffect(() => {
        if (selectedCategory) {
            loadSubcategories(selectedCategory.id);
        } else {
            setSubcategories([]);
        }
    }, [selectedCategory]);

    const handleAddCategory = async () => {
        if (!newCatName.trim()) return;
        setCreatingCat(true);
        try {
            await api.createCategory({ name: newCatName.trim(), sector: activeSector });
            setNewCatName('');
            loadCategories();
            showToast('Categoria criada com sucesso!', 'success');
        } catch (err) {
            showToast('Erro ao criar categoria.', 'error');
        } finally {
            setCreatingCat(false);
        }
    };

    const handleAddSubcategory = async () => {
        if (!newSubName.trim() || !selectedCategory) return;
        setCreatingSub(true);
        try {
            await api.createSubcategory(selectedCategory.id, { name: newSubName.trim() });
            setNewSubName('');
            loadSubcategories(selectedCategory.id);
            showToast('Subcategoria criada com sucesso!', 'success');
        } catch (err) {
            showToast('Erro ao criar subcategoria.', 'error');
        } finally {
            setCreatingSub(false);
        }
    };

    const handleDelete = async () => {
        if (!deleteItem) return;
        setIsDeleting(true);
        try {
            if (deleteItem.type === 'category') {
                await api.deleteCategory(deleteItem.id);
                showToast('Categoria excluída.', 'success');
            } else {
                await api.deleteSubcategory(deleteItem.id);
                showToast('Subcategoria excluída.', 'success');
            }
            setDeleteItem(null);
            if (deleteItem.type === 'category') loadCategories();
            else loadSubcategories(selectedCategory.id);
        } catch (err) {
            showToast('Erro ao excluir item.', 'error');
        } finally {
            setIsDeleting(false);
        }
    };

    if (!hasAccess) {
        return (
            <div className="flex flex-col items-center justify-center h-64 text-slate-500">
                <Tag className="w-12 h-12 mb-4 text-slate-300" />
                <p className="text-lg font-semibold">Acesso restrito</p>
                <p className="text-sm">Apenas os setores T.I e Gestão de Informação podem gerenciar categorias.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 tracking-tight">Gestão de Categorias</h1>
                    <p className="text-slate-500 font-medium">Configure as categorias e subcategorias para T.I e Gestão de Informação.</p>
                </div>

                <div className="flex bg-slate-200/50 p-1 rounded-xl border border-slate-200">
                    <button
                        onClick={() => setActiveSector('T.I')}
                        className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeSector === 'T.I'
                                ? 'bg-red-600 text-white shadow-lg shadow-red-600/30'
                                : 'text-slate-500 hover:text-slate-700'
                            }`}
                    >
                        T.I
                    </button>
                    <button
                        onClick={() => setActiveSector('Gestão de Informação')}
                        className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${activeSector === 'Gestão de Informação'
                                ? 'bg-red-600 text-white shadow-lg shadow-red-600/30'
                                : 'text-slate-500 hover:text-slate-700'
                            }`}
                    >
                        Gestão de Informação
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Categorias */}
                <div className={`bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden flex flex-col ${selectedCategory ? 'hidden lg:flex' : 'flex'}`}>
                    <div className="p-6 border-b border-slate-50 bg-slate-50/50 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-red-100 flex items-center justify-center">
                                <LayoutGrid className="w-5 h-5 text-red-600" />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-slate-900">Categorias</h3>
                                <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">{activeSector}</p>
                            </div>
                        </div>
                        <span className="bg-slate-200 text-slate-700 text-xs font-black px-2.5 py-1 rounded-full">{categories.length}</span>
                    </div>

                    <div className="p-6 border-b border-slate-50">
                        <div className="flex gap-2">
                            <input
                                type="text"
                                value={newCatName}
                                onChange={e => setNewCatName(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleAddCategory()}
                                placeholder="Nome da nova categoria..."
                                className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:bg-white transition-all"
                            />
                            <button
                                onClick={handleAddCategory}
                                disabled={creatingCat || !newCatName.trim()}
                                className="px-4 py-2.5 bg-red-600 text-white rounded-xl hover:bg-red-700 disabled:opacity-50 transition-all shadow-lg shadow-red-600/20 active:scale-95"
                            >
                                {creatingCat ? <Loader className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 overflow-y-auto max-h-[500px] custom-scrollbar p-2">
                        {loadingCats ? (
                            <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
                                <Loader className="w-8 h-8 animate-spin" />
                                <span className="text-sm font-bold">Carregando categorias...</span>
                            </div>
                        ) : categories.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400 opacity-50">
                                <Tag className="w-12 h-12" />
                                <span className="text-sm font-bold">Nenhuma categoria encontrada</span>
                            </div>
                        ) : (
                            <div className="space-y-1">
                                {categories.map(cat => (
                                    <div
                                        key={cat.id}
                                        onClick={() => setSelectedCategory(cat)}
                                        className={`group flex items-center justify-between p-4 rounded-2xl cursor-pointer transition-all ${selectedCategory?.id === cat.id
                                                ? 'bg-red-50 border border-red-100 shadow-sm'
                                                : 'hover:bg-slate-50 border border-transparent'
                                            }`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`w-2 h-2 rounded-full ${selectedCategory?.id === cat.id ? 'bg-red-600 animate-pulse' : 'bg-slate-300'}`} />
                                            <span className={`text-sm font-bold transition-colors ${selectedCategory?.id === cat.id ? 'text-red-900' : 'text-slate-700'}`}>
                                                {cat.name}
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setDeleteItem({ id: cat.id, type: 'category' });
                                                }}
                                                className="p-2 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                            <ChevronRight className={`w-4 h-4 transition-all ${selectedCategory?.id === cat.id ? 'text-red-400 translate-x-1' : 'text-slate-300 group-hover:translate-x-0.5'}`} />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* Subcategorias */}
                <div className={`bg-white rounded-3xl border border-slate-100 shadow-sm overflow-hidden flex flex-col ${selectedCategory ? 'flex animate-in slide-in-from-right duration-300' : 'hidden lg:flex opacity-50 pointer-events-none'}`}>
                    <div className="p-6 border-b border-slate-50 bg-slate-50/50 flex items-center gap-4">
                        <button
                            onClick={() => setSelectedCategory(null)}
                            className="lg:hidden p-2 hover:bg-slate-200 rounded-lg transition-colors"
                        >
                            <ArrowLeft className="w-5 h-5 text-slate-600" />
                        </button>
                        <div className="flex items-center gap-3 flex-1">
                            <div className="w-10 h-10 rounded-xl bg-orange-100 flex items-center justify-center">
                                <Layers className="w-5 h-5 text-orange-600" />
                            </div>
                            <div className="min-w-0">
                                <h3 className="text-lg font-bold text-slate-900 truncate">
                                    {selectedCategory ? `Subcategorias de ${selectedCategory.name}` : 'Subcategorias'}
                                </h3>
                                <p className="text-xs text-slate-500 font-semibold uppercase tracking-wider">Detalhamento</p>
                            </div>
                        </div>
                        {selectedCategory && (
                            <span className="bg-slate-200 text-slate-700 text-xs font-black px-2.5 py-1 rounded-full">{subcategories.length}</span>
                        )}
                    </div>

                    {!selectedCategory ? (
                        <div className="flex-1 flex flex-col items-center justify-center py-20 gap-4 text-slate-400">
                            <div className="w-16 h-16 rounded-full bg-slate-100 flex items-center justify-center italic text-2xl font-serif">i</div>
                            <p className="text-sm font-bold text-center px-10">Selecione uma categoria para gerenciar suas subcategorias</p>
                        </div>
                    ) : (
                        <>
                            <div className="p-6 border-b border-slate-50">
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={newSubName}
                                        onChange={e => setNewSubName(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleAddSubcategory()}
                                        placeholder={`Nova subcategoria para ${selectedCategory.name}...`}
                                        className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-500 focus:bg-white transition-all"
                                    />
                                    <button
                                        onClick={handleAddSubcategory}
                                        disabled={creatingSub || !newSubName.trim()}
                                        className="px-4 py-2.5 bg-orange-600 text-white rounded-xl hover:bg-orange-700 disabled:opacity-50 transition-all shadow-lg shadow-orange-600/20 active:scale-95"
                                    >
                                        {creatingSub ? <Loader className="w-5 h-5 animate-spin" /> : <Plus className="w-5 h-5" />}
                                    </button>
                                </div>
                            </div>

                            <div className="flex-1 overflow-y-auto max-h-[500px] custom-scrollbar p-2">
                                {loadingSubs ? (
                                    <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400">
                                        <Loader className="w-8 h-8 animate-spin" />
                                        <span className="text-sm font-bold">Carregando subcategorias...</span>
                                    </div>
                                ) : subcategories.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-20 gap-3 text-slate-400 opacity-50">
                                        <Info className="w-12 h-12" />
                                        <span className="text-sm font-bold text-center px-10 ">Nenhuma subcategoria para esta categoria</span>
                                    </div>
                                ) : (
                                    <div className="space-y-1">
                                        {subcategories.map(sub => (
                                            <div
                                                key={sub.id}
                                                className="group flex items-center justify-between p-4 rounded-2xl hover:bg-slate-50 border border-transparent transition-all"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <Layers className="w-4 h-4 text-slate-300" />
                                                    <span className="text-sm font-semibold text-slate-700">
                                                        {sub.name}
                                                    </span>
                                                </div>
                                                <button
                                                    onClick={() => setDeleteItem({ id: sub.id, type: 'subcategory' })}
                                                    className="p-2 text-slate-300 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>

            <ConfirmationModal
                isOpen={!!deleteItem}
                onClose={() => setDeleteItem(null)}
                onConfirm={handleDelete}
                title={`Excluir ${deleteItem?.type === 'category' ? 'Categoria' : 'Subcategoria'}`}
                message={`Tem certeza que deseja excluir esta ${deleteItem?.type === 'category' ? 'categoria e todas as suas subcategorias' : 'subcategoria'}?`}
                isLoading={isDeleting}
            />
        </div>
    );
};

export default CategoryManagement;
