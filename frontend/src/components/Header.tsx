import React, { useState } from 'react';
import { User } from '../types';
import { Bell, LogOut, Settings, Moon, Sun } from 'lucide-react';
import { useLocation } from 'react-router-dom';

const PAGE_NAMES: Record<string, string> = {
  '/overview': 'Visão Geral',
  '/tickets': 'Chamados de T.I',
  '/tickets/new': 'Novo Chamado',
  '/schedule': 'Agenda de Entregas',
  '/sector-info': 'Tipos de Chamados',
  '/ticket-categories': 'Gestão de Categorias',
  '/action-plan': 'Matriz Estratégica',
  '/action-plan-dashboard': 'Indicadores do Plano',
  '/strategic-kanban': 'Kanban Estratégico',
  '/strategic-timeline': 'Cronograma Estratégico',
  '/strategic-map': 'Mapa Estratégico',
  '/implementation-action-plan': 'Matriz de Projetos',
  '/implementation-dashboard': 'Indicadores de Projetos',
  '/implementation-kanban': 'Kanban de Projetos',
  '/implementation-timeline': 'Cronograma de Projetos',
  '/inter-sector-tickets': 'Chamados Entre Setores',
  '/inter-sector-kanban': 'Kanban Entre Setores',
  '/inter-sector-schedule': 'Agenda Entre Setores',
  '/sector-categories': 'Categorias do Setor',
  '/importation': 'Importação (Comex)',
  '/sac': 'SAC — Chamados',
  '/sac/novo': 'Novo Chamado SAC',
  '/sac/kanban': 'Kanban SAC',
  '/sac/agenda': 'Agenda SAC',
  '/sac/dashboard': 'Dashboard SAC',
  '/sac/clientes-externos': 'Clientes Externos',
  '/sac/tipos-problema': 'Categorias SAC',
  '/financeiro/base-orcado': 'Base Orçado',
  '/financeiro/base-realizado': 'Base Realizado',
  '/financeiro/orcado': 'Relatório Orçado',
  '/financeiro/orcado-realizado': 'Orçado x Realizado',
  '/financeiro/dre': 'DRE Comparativo',
  '/financeiro/plano-contas': 'Plano de Contas',
  '/financeiro/dre-2025': 'DRE 2025',
  '/users': 'Gestão de Usuários',
  '/sectors': 'Gestão de Setores',
  '/permissions': 'Controle de Permissões',
  '/metrics': 'Métricas Técnicas',
};
import { useNotification } from '../contexts/NotificationContext';
import NotificationSettings from './NotificationSettings';
import { formatDateBR } from './dateUtils';

interface HeaderProps {
  user: User;
  onLogout?: () => void;
  isDarkMode?: boolean;                          // DARK_MODE_TEST
  toggleDarkMode?: (x?: number, y?: number) => void; // DARK_MODE_TEST
}

const Header: React.FC<HeaderProps> = ({ user, onLogout, isDarkMode, toggleDarkMode }) => {
  const { unreadCount, notifications, markAsRead } = useNotification();
  const location = useLocation();
  const pageName = PAGE_NAMES[location.pathname] ?? (location.pathname.startsWith('/sac/') ? 'SAC' : location.pathname.startsWith('/tickets/') ? 'Chamado' : '');
  const [showSettings, setShowSettings] = useState(false);
  const [showNotifDropdown, setShowNotifDropdown] = useState(false);
  const [showProfileDropdown, setShowProfileDropdown] = useState(false);

  const notifRef = React.useRef<HTMLDivElement>(null);
  const profileRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(event.target as Node)) {
        setShowNotifDropdown(false);
      }
      if (profileRef.current && !profileRef.current.contains(event.target as Node)) {
        setShowProfileDropdown(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const handleNotifClick = async (id: string, link?: string) => {
    await markAsRead(id);
    if (link) {
      window.location.hash = link; // Using HashRouter
      setShowNotifDropdown(false);
    }
  };

  return (
    <header className="h-16 bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between px-4 sm:px-6 shrink-0 relative" style={{ zIndex: 30 }}>
      <div className="flex items-center flex-1">
        {pageName && (
          <span className="text-sm font-semibold text-gray-700 dark:text-slate-200 truncate">{pageName}</span>
        )}
      </div>

      <div className="flex items-center space-x-4">
        {/* DARK_MODE_TEST toggle switch */}
        {toggleDarkMode && (
          <button
            onClick={(e) => toggleDarkMode?.(e.clientX, e.clientY)}
            title={isDarkMode ? 'Modo claro' : 'Modo escuro'}
            className={`relative inline-flex items-center w-14 h-7 rounded-full transition-colors duration-300 focus:outline-none ${
              isDarkMode ? 'bg-indigo-600' : 'bg-slate-300'
            }`}
          >
            <span className={`absolute flex items-center justify-center w-5 h-5 bg-white rounded-full shadow-md transform transition-transform duration-300 ${
              isDarkMode ? 'translate-x-8' : 'translate-x-1'
            }`}>
              {isDarkMode
                ? <Moon className="w-3 h-3 text-indigo-600" />
                : <Sun className="w-3 h-3 text-yellow-500" />
              }
            </span>
          </button>
        )}
        {/* Notification Bell */}
        <div className="relative" ref={notifRef}>
          <button
            className="relative p-2 text-gray-500 hover:bg-gray-100 rounded-full transition-colors"
            onClick={() => setShowNotifDropdown(!showNotifDropdown)}
          >
            <Bell className="h-5 w-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 h-2.5 w-2.5 bg-red-600 rounded-full border-2 border-white"></span>
            )}
          </button>

          {showNotifDropdown && (
            <div className="absolute right-0 mt-2 w-80 bg-white rounded-lg shadow-xl border border-gray-100 overflow-hidden" style={{ zIndex: 105 }}>
              <div className="p-3 border-b bg-gray-50 flex justify-between items-center">
                <h3 className="font-semibold text-gray-700">Notificações</h3>
                <span className="text-xs text-gray-500">{unreadCount} não lidas</span>
              </div>
              <div className="max-h-96 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="p-4 text-center text-gray-500 text-sm">Nenhuma notificação recente</div>
                ) : (
                  notifications.map(n => (
                    <div key={n.id}
                      className={`p-3 border-b hover:bg-gray-50 cursor-pointer transition-colors ${!n.is_read ? 'bg-red-50' : ''}`}
                      onClick={() => handleNotifClick(n.id, n.link)}
                    >
                      <h4 className={`text-sm ${!n.is_read ? 'font-bold text-gray-900' : 'font-medium text-gray-700'}`}>{n.title}</h4>
                      <p className="text-xs text-gray-500 mt-1">{n.message}</p>
                      <span className="text-[10px] text-gray-400 mt-2 block">{formatDateBR(n.created_at)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="h-8 w-px bg-gray-200 mx-2"></div>

        {/* Profile Dropdown */}
        <div className="relative" ref={profileRef}>
          <div
            className="flex items-center space-x-3 cursor-pointer group"
            onClick={() => setShowProfileDropdown(!showProfileDropdown)}
          >
            <div className="text-right hidden sm:block">
              <p className="text-sm font-semibold text-gray-900 dark:text-slate-100 group-hover:text-red-600 transition-colors">{user.name}</p>
              <p className="text-sm text-gray-500 dark:text-slate-400 capitalize">{user.role}</p>
            </div>
            <div className="h-10 w-10 rounded-full bg-red-100 border-2 border-transparent group-hover:border-red-600 overflow-hidden transition-all shadow-sm">
              <img src={user.avatar || `https://ui-avatars.com/api/?name=${user.name}`} alt={user.name} className="h-full w-full object-cover" />
            </div>
          </div>

          {showProfileDropdown && (
            <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-xl border border-gray-100 z-[105] overflow-hidden">
              <button
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center"
                onClick={() => {
                  setShowSettings(true);
                  setShowProfileDropdown(false);
                }}
              >
                <Settings className="w-4 h-4 mr-2" />
                Configurações
              </button>
              {onLogout && (
                <button
                  className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center border-t"
                  onClick={onLogout}
                >
                  <LogOut className="w-4 h-4 mr-2" />
                  Sair
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <NotificationSettings isOpen={showSettings} onClose={() => setShowSettings(false)} />
    </header>
  );
};

export default Header;
