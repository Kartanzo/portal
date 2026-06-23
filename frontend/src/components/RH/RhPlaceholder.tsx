import React from 'react';
import { Users, Hammer } from 'lucide-react';

interface Props {
    titulo: string;
    moduleId: string;
}

const RhPlaceholder: React.FC<Props> = ({ titulo, moduleId }) => (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-rose-50/30 to-slate-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-950">
        <div className="p-4 sm:p-6 max-w-[1400px] mx-auto">
            <header className="flex items-center gap-3 mb-6">
                <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 flex items-center justify-center shadow-lg shadow-rose-500/30">
                    <Users className="w-6 h-6 text-white" />
                </div>
                <div>
                    <h1 className="text-2xl font-black bg-gradient-to-r from-rose-600 to-pink-600 dark:from-rose-400 dark:to-pink-400 bg-clip-text text-transparent">
                        RH / DP · {titulo}
                    </h1>
                    <p className="text-xs text-slate-500 mt-0.5">Módulo: <code className="font-mono">{moduleId}</code></p>
                </div>
            </header>
            <div className="bg-white dark:bg-slate-800 rounded-xl border border-rose-200 dark:border-rose-900/40 p-8 text-center">
                <Hammer className="w-12 h-12 mx-auto text-rose-400 mb-3" />
                <h2 className="text-lg font-bold text-slate-700 dark:text-slate-200">Em construção</h2>
                <p className="text-sm text-slate-500 mt-2">
                    Essa tela está reservada e a permissão já pode ser concedida na tela de Administração.
                    A implementação será feita conforme o roadmap em <code className="font-mono">docs/rh_layout_design.md</code>.
                </p>
            </div>
        </div>
    </div>
);

export default RhPlaceholder;
