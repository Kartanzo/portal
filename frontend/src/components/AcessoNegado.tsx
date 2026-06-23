import React from 'react';
import { Link } from 'react-router-dom';
import { ShieldX, ArrowLeft } from 'lucide-react';

/**
 * Tela de "Acesso negado" — exibida quando o usuário tenta acessar uma rota
 * para a qual não tem permissão (ex.: setor incorreto).
 */
const AcessoNegado: React.FC<{ mensagem?: string }> = ({ mensagem }) => (
    <div className="flex-1 flex items-center justify-center p-6">
        <div className="max-w-md w-full text-center bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 p-8">
            <div className="mx-auto w-16 h-16 rounded-full bg-rose-100 dark:bg-rose-900/30 flex items-center justify-center mb-4">
                <ShieldX className="w-8 h-8 text-rose-600 dark:text-rose-400" />
            </div>
            <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">Acesso negado</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-2">
                {mensagem || 'Você não tem permissão para acessar esta página. Este conteúdo é restrito ao setor de T.I / Gestão de Informação.'}
            </p>
            <p className="text-xs text-slate-400 mt-1">Se acredita que deveria ter acesso, fale com o administrador do portal.</p>
            <Link to="/overview"
                className="inline-flex items-center gap-1.5 mt-5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-sm font-bold">
                <ArrowLeft className="w-4 h-4" /> Voltar ao início
            </Link>
        </div>
    </div>
);

export default AcessoNegado;
