import React from 'react';
import { Link } from 'react-router-dom';
import { LayoutDashboard } from 'lucide-react';
import { hasRhPermission } from './rhAuth';

// Botão padrão "Voltar para Dashboard RH" — só renderiza se o usuário tem permissão rh_dashboard.
const VoltarDashboardRH: React.FC = () => {
    if (!hasRhPermission('rh_dashboard')) return null;
    return (
        <Link to="/rh/dashboard"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-300 text-xs font-bold hover:bg-rose-50 dark:hover:bg-rose-900/20 transition">
            <LayoutDashboard className="w-3.5 h-3.5" /> Dashboard RH
        </Link>
    );
};

export default VoltarDashboardRH;
