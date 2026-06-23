
import React, { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../app_api';
import { useToast } from '../contexts/ToastContext';
import { Lock, Eye, EyeOff } from 'lucide-react';

const ResetPassword: React.FC = () => {
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');
    const navigate = useNavigate();
    const { showToast } = useToast();

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password !== confirmPassword) {
            showToast("As senhas não conferem.", 'error');
            return;
        }
        if (!token) {
            showToast("Token inválido ou ausente.", 'error');
            return;
        }

        setLoading(true);
        try {
            await api.resetPassword(token, password);
            showToast("Senha redefinida com sucesso! Faça login.", 'success');
            setTimeout(() => navigate('/'), 2000);
        } catch (error: any) {
            console.error(error);
            showToast(error.message || "Erro ao redefinir senha.", 'error');
        } finally {
            setLoading(false);
        }
    };

    if (!token) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-100">
                <div className="bg-white p-8 rounded-xl shadow-lg text-center">
                    <h2 className="text-xl font-bold text-red-600 mb-2">Link Inválido</h2>
                    <p className="text-gray-600 mb-4">O link de redefinição de senha é inválido ou expirou.</p>
                    <button onClick={() => navigate('/')} className="text-sm font-bold text-gray-900 border-b-2 border-red-500 pb-0.5">Voltar ao Login</button>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-100 p-4">
            <div className="w-full max-w-md bg-white p-8 rounded-2xl shadow-xl border border-gray-100">
                <div className="text-center mb-8">
                    <h1 className="text-2xl font-black text-gray-900 uppercase tracking-tight">Redefinir Senha</h1>
                    <p className="text-sm text-gray-500 mt-2">Crie uma nova senha para sua conta.</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">Nova Senha</label>
                        <div className="relative">
                            <input
                                type={showPassword ? "text" : "password"}
                                required
                                minLength={6}
                                className="block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm outline-none"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                            />
                            <button type="button" className="absolute right-3 top-3.5" onClick={() => setShowPassword(!showPassword)}>
                                {showPassword ? <EyeOff className="h-4 w-4 text-gray-400" /> : <Eye className="h-4 w-4 text-gray-400" />}
                            </button>
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-semibold text-gray-700 mb-1">Confirmar Nova Senha</label>
                        <div className="relative">
                            <input
                                type={showPassword ? "text" : "password"}
                                required
                                minLength={6}
                                className="block w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm outline-none"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                            />
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-3.5 bg-red-600 text-white rounded-xl font-bold uppercase text-sm hover:bg-red-700 disabled:bg-gray-400 transition-colors shadow-lg shadow-red-200"
                    >
                        {loading ? 'Processando...' : 'Atualizar Senha'}
                    </button>
                </form>
            </div>
        </div>
    );
};

export default ResetPassword;
