import React, { useState, useEffect } from 'react';
import { api } from '../../app_api';
import { User } from '../../types';

interface BaseUploadProps {
    user: User | null;
    type: 'orcado' | 'realizado';
    title: string;
}

const BaseUpload: React.FC<BaseUploadProps> = ({ user, type, title }) => {
    const [file, setFile] = useState<File | null>(null);
    const [versionName, setVersionName] = useState('');
    const [competencia, setCompetencia] = useState(''); // New state for month selection
    const [bases, setBases] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [message, setMessage] = useState<{ text: string, type: 'success' | 'error' } | null>(null);

    const months = [
        'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
        'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];

    useEffect(() => {
        loadHistory();
    }, [type]);

    const loadHistory = async () => {
        setLoading(true);
        try {
            const data = await api.getFinanceBases(type);
            setBases(data);
        } catch (error) {
            console.error("Failed to load history", error);
        } finally {
            setLoading(false);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files[0]) {
            const selectedFile = e.target.files[0];
            setFile(selectedFile);
            if (!versionName) {
                // Auto-fill version name from file name (without extension)
                const nameWithoutExt = selectedFile.name.replace(/\.[^/.]+$/, "");
                setVersionName(nameWithoutExt);
            }
        }
    };

    const handleUpload = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!file || !versionName || !user) return;

        setUploading(true);
        setMessage(null);
        try {
            await api.uploadFinanceBase(type, file, user.id || '', versionName);
            setMessage({ text: 'Upload realizado com sucesso!', type: 'success' });
            setFile(null);
            setVersionName('');
            loadHistory();
        } catch (error: any) {
            setMessage({ text: error.message || 'Erro ao realizar upload.', type: 'error' });
        } finally {
            setUploading(false);
        }
    };

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-800">{title}</h2>

            <div className="bg-white shadow rounded-lg p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Novo Upload</h3>
                {message && (
                    <div className={`p-4 mb-4 rounded-md ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
                        {message.text}
                    </div>
                )}
                <form onSubmit={handleUpload} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Nome da Versão
                        </label>
                        <input
                            type="text"
                            required
                            value={versionName}
                            onChange={(e) => setVersionName(e.target.value)}
                            placeholder="Ex: Base 2026 v1"
                            className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    {type === 'realizado' && (
                        <div className="mb-4">
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Mês de Competência
                            </label>
                            <select
                                required
                                value={competencia}
                                onChange={(e) => setCompetencia(e.target.value)}
                                className="w-full p-2 border rounded focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">Selecione o mês...</option>
                                {months.map((m, index) => (
                                    <option key={index} value={m}>{m}</option>
                                ))}
                            </select>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-medium text-gray-700">Arquivo Excel (.xlsx)</label>
                        <input
                            type="file"
                            accept=".xlsx, .xls"
                            required
                            onChange={handleFileChange}
                            className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-red-50 file:text-red-700 hover:file:bg-red-100"
                        />
                    </div>
                    <button
                        type="submit"
                        disabled={uploading || !file || !versionName}
                        className="inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
                    >
                        {uploading ? 'Enviando...' : 'Enviar Base'}
                    </button>
                </form>
            </div>

            <div className="bg-white shadow rounded-lg p-6">
                <h3 className="text-lg font-medium text-gray-900 mb-4">Histórico de Versões</h3>
                <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-gray-200">
                        <thead className="bg-gray-50">
                            <tr>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Versão</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Data Upload</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Usuário</th>
                                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Arquivo</th>
                            </tr>
                        </thead>
                        <tbody className="bg-white divide-y divide-gray-200">
                            {loading ? (
                                <tr><td colSpan={4} className="px-6 py-4 text-center">Carregando...</td></tr>
                            ) : bases.length === 0 ? (
                                <tr><td colSpan={4} className="px-6 py-4 text-center text-gray-500">Nenhuma base encontrada.</td></tr>
                            ) : (
                                bases.map((base) => (
                                    <tr key={base.id}>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{base.version_name}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{new Date(base.uploaded_at).toLocaleString()}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{base.uploaded_by_name || 'N/A'}</td>
                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{base.filename}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default BaseUpload;
