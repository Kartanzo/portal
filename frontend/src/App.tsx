
import React, { useState, useEffect } from 'react';
import { HashRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import Login from './components/Login';
import TicketList from './components/TicketList';
import TicketDetail from './components/TicketDetail';
import NewTicket from './components/NewTicket';
import Metrics from './components/Metrics';
import UserManagement from './components/UserManagement';
import { hasAccess, mergePermissions } from './utils/permissionUtils';
import RolePermissionsView from './components/RolePermissionsView';
import CategoryManagement from './components/CategoryManagement';
import ScheduleView from './components/ScheduleView';
import ActionPlan from './components/ActionPlan';
import ActionPlanDashboard from './components/ActionPlanDashboard';
import StrategicKanban from './components/StrategicKanban';
import StrategicTimeline from './components/StrategicTimeline';
import StrategicMap from './components/StrategicMap';
import ImplementationActionPlan from './components/ImplementationActionPlan';
import ImplementationDashboard from './components/ImplementationDashboard';
import ImplementationKanban from './components/ImplementationKanban';
import ImplementationTimeline from './components/ImplementationTimeline';
import SectorInfo from './components/SectorInfo';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import { User } from './types';
import { ToastProvider } from './contexts/ToastContext';
import { NotificationProvider } from './contexts/NotificationContext';
import { ConfirmProvider } from './contexts/ConfirmContext';
import { Toaster } from './components/ui/Toaster';
import NotificationSettings from './components/NotificationSettings';
import GeneralOverview from './components/GeneralOverview';
import EventosAlbum from './components/Eventos/EventosAlbum';
import MarketingPage from './components/Marketing/MarketingPage';
import CatalogoPublico from './components/Catalogo/CatalogoPublico';
import FichaTecnicaManager from './components/Marketing/FichaTecnicaManager';
import CatalogoFichas from './components/FichaTecnica/CatalogoFichas';
import ResetPassword from './components/ResetPassword';
// Importation Module
import Importation from './components/Importation';
import ImportacaoV2 from './components/Comex/ImportacaoV2';
import ImportacaoMoq from './components/Comex/ImportacaoMoq';

// Inter-Sector Module
import InterSectorInfo from './components/InterSetorial/InterSectorInfo';
import InterSectorTicketList from './components/InterSetorial/InterSectorTicketList';
import NewInterSectorTicket from './components/InterSetorial/NewInterSectorTicket';
import InterSectorTicketDetail from './components/InterSetorial/InterSectorTicketDetail';
import InterSectorKanban from './components/InterSetorial/InterSectorKanban';
import InterSectorScheduleView from './components/InterSetorial/InterSectorScheduleView';
import SectorCategoryManager from './components/InterSetorial/SectorCategoryManager';

// Finance Module
import BaseUpload from './components/Financeiro/BaseUpload';
import RelatorioOrcado from './components/Financeiro/RelatorioOrcado';
import RelatorioOrcadoRealizado from './components/Financeiro/RelatorioOrcadoRealizado';
import RelatorioDRE from './components/Financeiro/RelatorioDRE';
import PlanoContas from './components/Financeiro/PlanoContas';
import DRE2025 from './components/Financeiro/DRE2025';
import Comissao from './components/Financeiro/Comissao';
import AnaliseCredito from './components/Financeiro/AnaliseCredito';
import SectorManagement from './components/SectorManagement';

// Módulo SAC
import SacList from './components/SAC/SacList';
import SacDetail from './components/SAC/SacDetail';
import SacNewTicket from './components/SAC/SacNewTicket';
import SacKanban from './components/SAC/SacKanban';
import SacAgenda from './components/SAC/SacAgenda';
import SacDashboard from './components/SAC/SacDashboard';
import SacClientesExternos from './components/SAC/SacClientesExternos';
import SacTipoProblema from './components/SAC/SacTipoProblema';

// Comercial — Metas de Faturamento
import MetasFaturamentoDashboard from './components/Comercial/MetasFaturamentoDashboard';
import SopDashboard from './components/Fabrica/SopDashboard';
import PlanoProducao from './components/Fabrica/PlanoProducao';
import OtimizadorFaturamento from './components/Fabrica/OtimizadorFaturamento';
import HistoricoFaturamento from './components/Fabrica/HistoricoFaturamento';
import CadastroMaquinas from './components/Fabrica/CadastroMaquinas';
import ProgramacaoPage from './components/Fabrica/ProgramacaoPage';

// RH / DP — placeholders enquanto as telas reais não existem
import RhPlaceholder from './components/RH/RhPlaceholder';
import ColaboradoresList from './components/RH/Colaboradores/ColaboradoresList';
import ColaboradorPerfil from './components/RH/Colaboradores/ColaboradorPerfil';
import VagasList from './components/RH/Recrutamento/VagasList';
import VagaDetalhe from './components/RH/Recrutamento/VagaDetalhe';
import DocumentosPage from './components/RH/Documentos/DocumentosPage';
import JornadaPage from './components/RH/Jornada/JornadaPage';
import MovimentacoesPage from './components/RH/Movimentacoes/MovimentacoesPage';
import AprovacoesPage from './components/RH/Aprovacoes/AprovacoesPage';
import DashboardRH from './components/RH/Dashboard/DashboardRH';
import ConfigPage from './components/RH/Config/ConfigPage';
import EquipamentosPage from './components/RH/Equipamentos/EquipamentosPage';
import AcessoNegado from './components/AcessoNegado';

import { api } from './app_api';
import { useDarkMode } from './hooks/useDarkMode'; // DARK_MODE_TEST
import { useAutoLogout } from './hooks/useAutoLogout';
import { TICKET_FILTER_STORAGE_KEY } from './components/TicketList';

// Aplica o background azul padrão em todas as páginas, EXCETO as de RH (/rh/*).
// Não restringe largura (o quadro da Programação precisa de espaço total).
function MainShell({ children }: { children: React.ReactNode }) {
  const loc = useLocation();
  const onRh = loc.pathname.startsWith('/rh');
  return (
    <main className="flex-1 overflow-y-auto relative">
      <div className={`relative min-h-full ${onRh ? '' : 'bg-gradient-to-br from-slate-50 via-blue-50/60 to-indigo-50 dark:from-slate-900 dark:via-blue-950/40 dark:to-indigo-950/40'}`}>
        {!onRh && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
            <div className="absolute -top-32 -left-32 w-[480px] h-[480px] rounded-full bg-blue-300/30 blur-3xl dark:bg-blue-700/20" />
            <div className="absolute top-1/3 -right-40 w-[520px] h-[520px] rounded-full bg-indigo-300/30 blur-3xl dark:bg-indigo-700/20" />
            <div className="absolute bottom-0 left-1/3 w-[480px] h-[480px] rounded-full bg-sky-300/20 blur-3xl dark:bg-sky-800/20" />
            <div className="absolute inset-0 opacity-[0.04] dark:opacity-[0.08]" style={{ backgroundImage: 'linear-gradient(rgb(30,58,138) 1px, transparent 1px), linear-gradient(90deg, rgb(30,58,138) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
          </div>
        )}
        <div className="relative p-4 md:p-6 lg:p-8">{children}</div>
      </div>
    </main>
  );
}

function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useAutoLogout(user, () => {
    setUser(null);
    sessionStorage.removeItem('empresa_user');
    sessionStorage.removeItem(TICKET_FILTER_STORAGE_KEY);
    sessionStorage.removeItem('empresa_is_ticket_filters');
  });

  useEffect(() => {
    const savedUser = sessionStorage.getItem('empresa_user');
    if (savedUser) {
      const parsedUser = JSON.parse(savedUser);
      setUser(parsedUser); // Set initial state from cache for speed

      // Refresh from API to get latest state (sectors, permissions) and role_permissions
      Promise.all([
        api.getUser(parsedUser.id),
        api.getRolePermissions()
      ]).then(([latestUser, rolePerms]) => {
        console.log("App: Refreshed user data and role_permissions from API");
        // Merge: role defaults as base, individual user permissions as override
        const roleDefaults = (rolePerms as { role: string, permissions: any }[])
          .find((rp) => rp.role === latestUser.role)?.permissions || {};
        const mergedPermissions = mergePermissions(roleDefaults, latestUser.permissions);
        const enrichedUser = { ...latestUser, permissions: mergedPermissions };
        setUser(enrichedUser);
        sessionStorage.setItem('empresa_user', JSON.stringify(enrichedUser));
      }).catch(err => {
        console.error("App: Failed to refresh user data", err);
        if (err.message.includes("404") || err.message.includes("User not found")) {
          handleLogout();
        }
      });
    }
  }, []);

  const handleLogin = (userData: User) => {
    // On login, also fetch role_permissions and merge immediately
    api.getRolePermissions().then((rolePerms) => {
      const roleDefaults = (rolePerms as { role: string, permissions: any }[])
        .find((rp) => rp.role === userData.role)?.permissions || {};
      const mergedPermissions = mergePermissions(roleDefaults, userData.permissions);
      const enrichedUser = { ...userData, permissions: mergedPermissions };
      setUser(enrichedUser);
      sessionStorage.setItem('empresa_user', JSON.stringify(enrichedUser));
    }).catch(() => {
      // Fallback: use user as-is if role_permissions fetch fails
      setUser(userData);
      sessionStorage.setItem('empresa_user', JSON.stringify(userData));
    });
  };

  const handleLogout = () => {
    // Fire-and-forget: deleta sessao no backend e limpa cookie HttpOnly
    fetch('/api/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
    setUser(null);
    sessionStorage.removeItem('empresa_user');
    sessionStorage.removeItem(TICKET_FILTER_STORAGE_KEY);
    sessionStorage.removeItem('empresa_is_ticket_filters');
    // Also clear localStorage just in case of migration/legacy
    localStorage.removeItem('empresa_user');
    localStorage.removeItem('sop_dashboard_filters');
  };

  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  // Responsividade: auto-colapsa o menu lateral em telas estreitas (notebooks/monitores menores).
  // >1180px abre; 769–1180px colapsa (mais espaço p/ conteúdo); <=768px usa o drawer mobile (Sidebar).
  useEffect(() => {
    const ajustarMenu = () => {
      const w = window.innerWidth;
      if (w <= 768) return;
      setIsSidebarCollapsed(w < 1180);
    };
    ajustarMenu();
    window.addEventListener('resize', ajustarMenu);
    return () => window.removeEventListener('resize', ajustarMenu);
  }, []);
  const { isDark, toggle: toggleDark } = useDarkMode(); // DARK_MODE_TEST

  // Auto-logout after 8 hours of inactivity
  useAutoLogout(user, handleLogout);

  // Centralized hasAccess is now imported from utils/permissionUtils
  const canAccess = (module: string) => hasAccess(user, module);

  const ProtectedRoute = ({ module, sectors, children }: { module: string, sectors?: string[], children: React.ReactNode }) => {
    if (!user) return <Navigate to="/" replace />;
    // Externo always has access to sac module (avoid redirect loop while permissions load)
    if (user.role === 'externo' && module === 'sac') return <>{children}</>;
    if (canAccess(module)) {
      // Restrição por setor (defesa contra acesso por URL). super_user/ceo passam.
      if (sectors && !['super_user', 'ceo'].includes(user.role) && !sectors.includes(user.sector || '')) {
        return <AcessoNegado />;
      }
      return <>{children}</>;
    }
    return <Navigate to={user.role === 'externo' ? '/sac' : '/overview'} replace />;
  };

  const AdminRoute = ({ children }: { children: React.ReactNode }) => {
    if (!user || user.role !== 'super_user') return <Navigate to="/overview" replace />;
    return <>{children}</>;
  };

  return (
    <ToastProvider>
      <ConfirmProvider>
      <NotificationProvider user={user}>
        <Toaster />
        <Router>
          {!user ? (
            <Routes>
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="*" element={<Login onLogin={handleLogin} />} />
            </Routes>
          ) : (
            <div className="flex h-screen bg-gray-100 dark:bg-slate-900 overflow-hidden">
              <Sidebar
                onLogout={handleLogout}
                user={user}
                isCollapsed={isSidebarCollapsed}
                toggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
              />
              <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                <Header user={user} onLogout={handleLogout} isDarkMode={isDark} toggleDarkMode={(x, y) => toggleDark(x, y)} />
                <MainShell>
                  <Routes>
                    <Route path="/overview" element={<ProtectedRoute module="dashboard"><GeneralOverview user={user} /></ProtectedRoute>} />
                    <Route path="/eventos" element={<EventosAlbum />} />
                    <Route path="/catalogo" element={<CatalogoPublico />} />
                    <Route path="/marketing/eventos" element={<ProtectedRoute module="eventos_admin"><MarketingPage /></ProtectedRoute>} />
                    <Route path="/marketing/ficha-tecnica" element={<ProtectedRoute module="marketing_ficha_tecnica"><FichaTecnicaManager /></ProtectedRoute>} />
                    <Route path="/catalogo-fichas" element={<CatalogoFichas />} />
                    <Route path="/tickets" element={<ProtectedRoute module="tickets"><TicketList user={user} /></ProtectedRoute>} />
                    <Route path="/sector-info" element={<ProtectedRoute module="sector_info"><SectorInfo /></ProtectedRoute>} />
                    <Route path="/tickets/new" element={<ProtectedRoute module="tickets"><NewTicket user={user} /></ProtectedRoute>} />
                    <Route path="/tickets/:id" element={<ProtectedRoute module="tickets"><TicketDetail user={user} /></ProtectedRoute>} />
                    <Route path="/schedule" element={<ProtectedRoute module="schedule"><ScheduleView user={user} /></ProtectedRoute>} />

                    <Route path="/action-plan" element={<ProtectedRoute module="action_plans"><ActionPlan user={user} /></ProtectedRoute>} />
                    <Route path="/action-plan-dashboard" element={<ProtectedRoute module="action_plan_dashboard"><ActionPlanDashboard user={user} /></ProtectedRoute>} />
                    <Route path="/strategic-kanban" element={<ProtectedRoute module="strategic_kanban"><StrategicKanban user={user} /></ProtectedRoute>} />
                    <Route path="/strategic-timeline" element={<ProtectedRoute module="strategic_timeline"><StrategicTimeline user={user} /></ProtectedRoute>} />
                    <Route path="/strategic-map" element={<ProtectedRoute module="strategic_map"><StrategicMap user={user} /></ProtectedRoute>} />

                    <Route path="/implementation-action-plan" element={<ProtectedRoute module="impl_action_plan"><ImplementationActionPlan user={user} /></ProtectedRoute>} />
                    <Route path="/implementation-dashboard" element={<ProtectedRoute module="impl_dashboard"><ImplementationDashboard user={user} /></ProtectedRoute>} />
                    <Route path="/implementation-kanban" element={<ProtectedRoute module="impl_kanban"><ImplementationKanban user={user} /></ProtectedRoute>} />
                    <Route path="/implementation-timeline" element={<ProtectedRoute module="impl_timeline"><ImplementationTimeline user={user} /></ProtectedRoute>} />

                    {/* Finance Routes */}
                    <Route path="/financeiro/base-orcado" element={<ProtectedRoute module="financeiro_base_orcado"><BaseUpload user={user} type="orcado" title="Base Orçado" /></ProtectedRoute>} />
                    <Route path="/financeiro/base-realizado" element={<ProtectedRoute module="financeiro_base_realizado"><BaseUpload user={user} type="realizado" title="Base Realizado" /></ProtectedRoute>} />
                    <Route path="/financeiro/orcado" element={<ProtectedRoute module="financeiro_orcado"><RelatorioOrcado user={user} /></ProtectedRoute>} />
                    <Route path="/financeiro/orcado-realizado" element={<ProtectedRoute module="financeiro_orcado_realizado"><RelatorioOrcadoRealizado user={user} /></ProtectedRoute>} />
                    <Route path="/financeiro/dre" element={<ProtectedRoute module="financeiro_dre"><RelatorioDRE user={user} /></ProtectedRoute>} />
                    <Route path="/financeiro/plano-contas" element={<ProtectedRoute module="financeiro_plano_contas"><PlanoContas /></ProtectedRoute>} />
                    <Route path="/financeiro/dre-2025" element={<ProtectedRoute module="financeiro_dre2025"><DRE2025 user={user} /></ProtectedRoute>} />
                    <Route path="/financeiro/comissao" element={<ProtectedRoute module="financeiro_comissao"><Comissao user={user} /></ProtectedRoute>} />
                    <Route path="/financeiro/analise-credito" element={<ProtectedRoute module="financeiro_analise_credito"><AnaliseCredito user={user} /></ProtectedRoute>} />

                    {/* Inter-Sector Tickets */}
                    <Route path="/inter-sector-info" element={<ProtectedRoute module="inter_sector_tickets"><InterSectorInfo /></ProtectedRoute>} />
                    <Route path="/inter-sector-tickets" element={<ProtectedRoute module="inter_sector_tickets"><InterSectorTicketList user={user} /></ProtectedRoute>} />
                    <Route path="/inter-sector-tickets/new" element={<ProtectedRoute module="inter_sector_tickets"><NewInterSectorTicket user={user} /></ProtectedRoute>} />
                    <Route path="/inter-sector-tickets/:id" element={<ProtectedRoute module="inter_sector_tickets"><InterSectorTicketDetail user={user} /></ProtectedRoute>} />
                    <Route path="/inter-sector-kanban" element={<ProtectedRoute module="inter_sector_kanban"><InterSectorKanban user={user} /></ProtectedRoute>} />
                    <Route path="/inter-sector-schedule" element={<ProtectedRoute module="inter_sector_schedule"><InterSectorScheduleView user={user} /></ProtectedRoute>} />
                    <Route path="/sector-categories" element={<ProtectedRoute module="sector_categories"><SectorCategoryManager user={user} /></ProtectedRoute>} />

                    {/* Admin Routes */}
                    <Route path="/permissions" element={<AdminRoute><RolePermissionsView /></AdminRoute>} />
                    {/* /importation (v1) descontinuado em 2026-05-19 — redireciona para v2 */}
                    <Route path="/importation" element={<Navigate to="/importacao-v2" replace />} />
                            <Route path="/importacao-v2" element={<ProtectedRoute module="importation_v2"><ImportacaoV2 user={user} /></ProtectedRoute>} />
                            <Route path="/importacao-v2/moq" element={<ProtectedRoute module="importation_v2"><ImportacaoMoq user={user} /></ProtectedRoute>} />
                    {/* SAC Module */}
                    <Route path="/sac" element={<ProtectedRoute module="sac"><SacList user={user} /></ProtectedRoute>} />
                    <Route path="/sac/novo" element={<ProtectedRoute module="sac"><SacNewTicket user={user} /></ProtectedRoute>} />
                    <Route path="/sac/:id" element={<ProtectedRoute module="sac"><SacDetail user={user} /></ProtectedRoute>} />
                    <Route path="/sac/kanban" element={<ProtectedRoute module="sac"><SacKanban user={user} /></ProtectedRoute>} />
                    <Route path="/sac/agenda" element={<ProtectedRoute module="sac"><SacAgenda user={user} /></ProtectedRoute>} />
                    <Route path="/sac/dashboard" element={<ProtectedRoute module="sac_dashboard"><SacDashboard user={user} /></ProtectedRoute>} />
                    <Route path="/sac/clientes-externos" element={<ProtectedRoute module="sac"><SacClientesExternos user={user} /></ProtectedRoute>} />
                    <Route path="/sac/tipos-problema" element={<ProtectedRoute module="sac"><SacTipoProblema user={user} /></ProtectedRoute>} />
                    <Route path="/comercial/metas-faturamento" element={<ProtectedRoute module="metas_faturamento"><MetasFaturamentoDashboard user={user} /></ProtectedRoute>} />
                    <Route path="/fabrica/sop-dashboard" element={<ProtectedRoute module="sop_dashboard"><SopDashboard /></ProtectedRoute>} />
                    <Route path="/fabrica/plano-producao" element={<ProtectedRoute module="plano_producao"><PlanoProducao /></ProtectedRoute>} />
                    <Route path="/fabrica/otimizador-faturamento" element={<ProtectedRoute module="otimizador_faturamento"><OtimizadorFaturamento /></ProtectedRoute>} />
                    <Route path="/fabrica/otimizador-faturamento/historico" element={<ProtectedRoute module="otimizador_faturamento"><HistoricoFaturamento /></ProtectedRoute>} />
                    <Route path="/fabrica/cadastro-maquinas" element={<ProtectedRoute module="cadastro_maquinas"><CadastroMaquinas /></ProtectedRoute>} />
                    <Route path="/fabrica/programacao" element={<ProtectedRoute module="programacao"><ProgramacaoPage /></ProtectedRoute>} />

              {/* RH / DP — placeholders */}
              <Route path="/rh/dashboard" element={<ProtectedRoute module="rh_dashboard"><DashboardRH /></ProtectedRoute>} />
              <Route path="/rh/colaboradores" element={<ProtectedRoute module="rh_colaboradores"><ColaboradoresList /></ProtectedRoute>} />
              <Route path="/rh/colaboradores/:id" element={<ProtectedRoute module="rh_colaboradores"><ColaboradorPerfil /></ProtectedRoute>} />
              <Route path="/rh/recrutamento" element={<ProtectedRoute module="rh_recrutamento"><VagasList /></ProtectedRoute>} />
              <Route path="/rh/recrutamento/:id" element={<ProtectedRoute module="rh_recrutamento"><VagaDetalhe /></ProtectedRoute>} />
              <Route path="/rh/documentos" element={<ProtectedRoute module="rh_documentos"><DocumentosPage /></ProtectedRoute>} />
              <Route path="/rh/jornada" element={<ProtectedRoute module="rh_jornada"><JornadaPage /></ProtectedRoute>} />
              <Route path="/rh/movimentacoes" element={<ProtectedRoute module="rh_movimentacoes"><MovimentacoesPage /></ProtectedRoute>} />
              <Route path="/rh/aprovacoes" element={<ProtectedRoute module="rh_aprovacoes"><AprovacoesPage /></ProtectedRoute>} />
              <Route path="/rh/config" element={<ProtectedRoute module="rh_config"><ConfigPage /></ProtectedRoute>} />
              <Route path="/rh/equipamentos" element={<ProtectedRoute module="rh_equipamentos" sectors={['T.I', 'Gestão de Informação']}><EquipamentosPage /></ProtectedRoute>} />

                    <Route path="/" element={<Navigate to={user?.role === 'externo' ? '/sac' : '/overview'} replace />} />
                    <Route path="/metrics" element={<AdminRoute><Metrics /></AdminRoute>} />
                    <Route path="/ticket-categories" element={<ProtectedRoute module="ticket_categories_management"><CategoryManagement user={user} /></ProtectedRoute>} />
                    <Route path="/users" element={<AdminRoute><UserManagement /></AdminRoute>} />
                    <Route path="/sectors" element={<AdminRoute><SectorManagement /></AdminRoute>} />
                  </Routes>
                </MainShell>
              </div>
            </div>
          )}
        </Router>
      </NotificationProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
};

export default App;
