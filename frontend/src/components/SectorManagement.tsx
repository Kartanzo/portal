import React, { useState, useEffect } from 'react';
import { api } from '../app_api';
import { useConfirm } from '../contexts/ConfirmContext';
import { Plus, Pencil, Trash2, Check, X, RotateCcw } from 'lucide-react';

interface Sector {
    id: number;
    name: string;
    is_active: boolean;
    created_at: string;
}

const SectorManagement: React.FC = () => {
    const confirmar = useConfirm();
    const [sectors, setSectors] = useState<Sector[]>([]);
    const [loading, setLoading] = useState(true);
    const [showInactive, setShowInactive] = useState(false);
    const [newName, setNewName] = useState('');
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editingName, setEditingName] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    useEffect(() => {
        loadSectors();
    }, [showInactive]);

    const loadSectors = async () => {
        setLoading(true);
        try {
            const data = await api.getSectors(showInactive);
            setSectors(data);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleCreate = async () => {
        if (!newName.trim()) return;
        setError('');
        try {
            await api.createSector(newName.trim());
            setNewName('');
            setSuccess('Setor criado com sucesso!');
            setTimeout(() => setSuccess(''), 3000);
            loadSectors();
        } catch (e: any) {
            setError(e.message);
            setTimeout(() => setError(''), 5000);
        }
    };

    const handleUpdate = async (id: number) => {
        if (!editingName.trim()) return;
        setError('');
        try {
            await api.updateSector(id, { name: editingName.trim() });
            setEditingId(null);
            setEditingName('');
            setSuccess('Setor atualizado com sucesso!');
            setTimeout(() => setSuccess(''), 3000);
            loadSectors();
        } catch (e: any) {
            setError(e.message);
            setTimeout(() => setError(''), 5000);
        }
    };

    const handleDelete = async (id: number, name: string) => {
        const ok = await confirmar({
            title: 'Desativar setor',
            message: `Tem certeza que deseja desativar o setor "${name}"?`,
            confirmText: 'Desativar',
            variant: 'warning',
        });
        if (!ok) return;
        setError('');
        try {
            await api.deleteSector(id);
            setSuccess('Setor desativado com sucesso!');
            setTimeout(() => setSuccess(''), 3000);
            loadSectors();
        } catch (e: any) {
            setError(e.message);
            setTimeout(() => setError(''), 5000);
        }
    };

    const handleReactivate = async (id: number) => {
        setError('');
        try {
            await api.updateSector(id, { is_active: true });
            setSuccess('Setor reativado com sucesso!');
            setTimeout(() => setSuccess(''), 3000);
            loadSectors();
        } catch (e: any) {
            setError(e.message);
            setTimeout(() => setError(''), 5000);
        }
    };

    const startEditing = (sector: Sector) => {
        setEditingId(sector.id);
        setEditingName(sector.name);
    };

    const cancelEditing = () => {
        setEditingId(null);
        setEditingName('');
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h2 className="text-2xl font-bold text-gray-800">Gestão de Setores</h2>
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={showInactive}
                        onChange={e => setShowInactive(e.target.checked)}
                        className="rounded border-gray-300 text-red-600 focus:ring-red-500"
                    />
                    Mostrar inativos
                </label>
            </div>

            {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm">{error}</div>
            )}
            {success && (
                <div className="bg-green-50 border border-green-200 text-green-700 px-4 py-3 rounded-lg text-sm">{success}</div>
            )}

            {/* Add New Sector */}
            <div className="bg-white shadow rounded-lg p-4">
                <h3 className="text-sm font-semibold text-gray-700 mb-3">Adicionar Novo Setor</h3>
                <div className="flex gap-3">
                    <input
                        type="text"
                        value={newName}
                        onChange={e => setNewName(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && handleCreate()}
                        placeholder="Nome do setor..."
                        className="flex-1 rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-sm"
                    />
                    <button
                        onClick={handleCreate}
                        disabled={!newName.trim()}
                        className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 text-sm font-medium transition-colors"
                    >
                        <Plus className="w-4 h-4" />
                        Adicionar
                    </button>
                </div>
            </div>

            {/* Sectors List */}
            <div className="bg-white shadow rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Nome</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Criado em</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Ações</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {loading ? (
                            <tr><td colSpan={4} className="px-6 py-8 text-center text-gray-500">Carregando...</td></tr>
                        ) : sectors.length === 0 ? (
                            <tr><td colSpan={4} className="px-6 py-8 text-center text-gray-500">Nenhum setor encontrado.</td></tr>
                        ) : sectors.map(sector => (
                            <tr key={sector.id} className={`hover:bg-gray-50 ${!sector.is_active ? 'opacity-50 bg-gray-50' : ''}`}>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    {editingId === sector.id ? (
                                        <input
                                            type="text"
                                            value={editingName}
                                            onChange={e => setEditingName(e.target.value)}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter') handleUpdate(sector.id);
                                                if (e.key === 'Escape') cancelEditing();
                                            }}
                                            className="rounded-md border-gray-300 shadow-sm focus:border-red-500 focus:ring-red-500 text-sm w-full"
                                            autoFocus
                                        />
                                    ) : (
                                        <span className="text-sm font-medium text-gray-900">{sector.name}</span>
                                    )}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap">
                                    <span className={`px-2 py-1 text-xs font-semibold rounded-full ${sector.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                        {sector.is_active ? 'Ativo' : 'Inativo'}
                                    </span>
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                                    {new Date(sector.created_at).toLocaleDateString('pt-BR')}
                                </td>
                                <td className="px-6 py-4 whitespace-nowrap text-right">
                                    {editingId === sector.id ? (
                                        <div className="flex justify-end gap-2">
                                            <button onClick={() => handleUpdate(sector.id)} className="text-green-600 hover:text-green-800 p-1" title="Salvar">
                                                <Check className="w-4 h-4" />
                                            </button>
                                            <button onClick={cancelEditing} className="text-gray-400 hover:text-gray-600 p-1" title="Cancelar">
                                                <X className="w-4 h-4" />
                                            </button>
                                        </div>
                                    ) : (
                                        <div className="flex justify-end gap-2">
                                            {sector.is_active ? (
                                                <>
                                                    <button onClick={() => startEditing(sector)} className="text-blue-600 hover:text-blue-800 p-1" title="Editar">
                                                        <Pencil className="w-4 h-4" />
                                                    </button>
                                                    <button onClick={() => handleDelete(sector.id, sector.name)} className="text-red-600 hover:text-red-800 p-1" title="Desativar">
                                                        <Trash2 className="w-4 h-4" />
                                                    </button>
                                                </>
                                            ) : (
                                                <button onClick={() => handleReactivate(sector.id)} className="text-green-600 hover:text-green-800 p-1" title="Reativar">
                                                    <RotateCcw className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <p className="text-xs text-gray-400">
                Total: {sectors.length} setores • Setores desativados não aparecem nas opções de seleção do portal.
            </p>
        </div>
    );
};

export default SectorManagement;
