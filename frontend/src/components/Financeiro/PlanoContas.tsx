import React, { useState, useEffect } from 'react';
import { api } from '../../app_api';

const PlanoContas = () => {
    const [data, setData] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.getPlanoContas().then(setData).catch(console.error).finally(() => setLoading(false));
    }, []);

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold text-gray-800">Plano de Contas</h2>
            <div className="bg-white shadow rounded-lg overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Conta</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Descrição</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Grupo</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Tipo</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {loading ? (
                            <tr><td colSpan={4} className="px-6 py-4 text-center">Carregando...</td></tr>
                        ) : data.map((row) => (
                            <tr key={row.conta_contabil} className="hover:bg-gray-50">
                                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">{row.conta_contabil}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{row.descricao_conta}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{row.grupo}</td>
                                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{row.tipo}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

export default PlanoContas;
