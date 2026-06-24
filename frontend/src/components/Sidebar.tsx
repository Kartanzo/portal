import React from 'react';
import { NavLink } from 'react-router-dom';
import { hasAccess } from '../utils/permissionUtils';
import { LayoutDashboard, Ticket, LogOut, PieChart, Users, CalendarDays, ClipboardList, BarChart3, Shield, ShieldCheck, Layers, ChevronLeft, ChevronRight, Package, ChevronDown, Building2, ArrowLeftRight, Tag, Menu, X, Headphones, Info, Factory, MessageSquare, BookOpen, FileText, History } from 'lucide-react';
import { UserRole } from '../types';

interface SidebarProps {
  onLogout: () => void;
  user: any;
  isCollapsed: boolean;
  toggleSidebar: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({ onLogout, user, isCollapsed, toggleSidebar }) => {
  const isSuperUser = user?.role === 'super_user';
  const isCEO = user?.role === 'ceo';
  const [isMobileOpen, setIsMobileOpen] = React.useState(false);
  const [isMobile, setIsMobile] = React.useState(false);

  // Detecta mobile via JS (mais confiável que depender do Tailwind CDN)
  React.useEffect(() => {
    const check = () => setIsMobile(window.innerWidth <= 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Trava scroll do body quando drawer abre
  React.useEffect(() => {
    if (isMobileOpen) document.body.classList.add('drawer-open');
    else document.body.classList.remove('drawer-open');
  }, [isMobileOpen]);

  const hasPermission = (module: string) => hasAccess(user, module);
  const closeMobile = () => setIsMobileOpen(false);

  const [sectorsOpen, setSectorsOpen] = React.useState<Record<string, boolean>>({
    ti: false, todos_setores: false, gerencial: false,
    logistica: false, marketing: false, comercial: false, fabrica: false, financeiro: false, rh: false, configuracoes: false,
  });
  const toggleSector = (key: string) => setSectorsOpen(s => ({ ...s, [key]: !s[key] }));
  const allOpen = Object.values(sectorsOpen).every(Boolean);
  const toggleAll = () => setSectorsOpen(s => Object.fromEntries(Object.keys(s).map(k => [k, !allOpen])));

  const linkClass = ({ isActive }: { isActive: boolean }) => `
    flex items-center px-4 py-2.5 text-xs font-bold rounded-lg transition-all text-left
    ${isActive ? 'bg-red-600 text-white shadow-lg shadow-red-900/20' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}
    ${isCollapsed ? 'justify-center' : ''}
  `;

  const mobileLinkClass = ({ isActive }: { isActive: boolean }) => `
    flex items-center transition-all text-left w-full
    ${isActive ? 'bg-red-600 text-white' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}
  `;

  // ===== Render links (compartilhado entre desktop e drawer mobile) =====
  const isExterno = user?.role === 'externo';

  const renderNav = (mobile: boolean) => {
    const lc = mobile ? mobileLinkClass : linkClass;

    // Usuário externo: só vê o módulo SAC
    if (isExterno) {
      const iconMarginExt = mobile ? 'mr-3' : (!isCollapsed ? 'mr-3' : '');
      const showTextExt = mobile ? true : !isCollapsed;
      const mobileStyleExt = mobile ? { padding: '12px 16px', fontSize: '14px', fontWeight: '600' } : {};
      return (
        <div className="space-y-1">
          <NavLink to="/sac" className={lc} style={mobileStyleExt}>
            <Headphones className={`w-4 h-4 ${iconMarginExt}`} />
            {showTextExt && 'Meus Chamados'}
          </NavLink>
          <NavLink to="/sac/novo" className={lc} style={mobileStyleExt}>
            <ClipboardList className={`w-4 h-4 ${iconMarginExt}`} />
            {showTextExt && 'Novo Chamado'}
          </NavLink>
          <NavLink to="/sac/kanban" className={lc} style={mobileStyleExt}>
            <Layers className={`w-4 h-4 ${iconMarginExt}`} />
            {showTextExt && 'Kanban SAC'}
          </NavLink>
          <NavLink to="/sac/agenda" className={lc} style={mobileStyleExt}>
            <CalendarDays className={`w-4 h-4 ${iconMarginExt}`} />
            {showTextExt && 'Agenda SAC'}
          </NavLink>
        </div>
      );
    }
    const showText = mobile || !isCollapsed;
    const iconMargin = mobile ? 'mr-3' : (!isCollapsed ? 'mr-3' : '');
    const onClick = mobile ? closeMobile : undefined;
    const mobileStyle: React.CSSProperties | undefined = mobile
      ? { padding: '10px 14px', fontSize: '13px', fontWeight: 600, borderRadius: '8px', marginBottom: '2px' }
      : undefined;

    return (
      <>
        {hasPermission('dashboard') && (
          <NavLink to="/overview" className={lc} style={mobileStyle} onClick={onClick} title={!showText ? "Visão Geral" : ""}>
            <LayoutDashboard className={`w-4 h-4 ${iconMargin}`} />
            {showText && "Visão Geral"}
          </NavLink>
        )}
        {/* Itens de Marketing (Eventos / Ficha Técnica / Catálogo de Fichas) removidos do menu */}

        {showText && (
          <button type="button" onClick={toggleAll} style={{
            width: '100%', textAlign: 'right', fontSize: '10px',
            fontWeight: 600, color: '#f1f5f9', background: 'transparent',
            border: 'none', cursor: 'pointer', padding: '0 4px 4px',
            letterSpacing: '0.05em',
          }}>
            {allOpen ? '▲ Recolher tudo' : '▼ Expandir tudo'}
          </button>
        )}

        {/* ── T.I ── */}
        {(hasPermission('sector_info') || hasPermission('tickets') || hasPermission('schedule') || hasPermission('ticket_categories_management') || hasPermission('rh_equipamentos')) && (
          <SectorGroup label="T.I" isCollapsed={mobile ? false : isCollapsed} open={sectorsOpen.ti} onToggle={() => toggleSector('ti')}>
          <SidebarSection title="Suporte de TI" icon={<Ticket style={{width:'14px',height:'14px'}}/>} isCollapsed={mobile ? false : isCollapsed} defaultOpen={mobile} forceOpen={allOpen ? true : undefined}>
            <div className="space-y-1">
              {hasPermission('sector_info') && (
                <NavLink to="/sector-info" className={lc} style={mobileStyle} onClick={onClick}>
                  <ClipboardList className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Tipos de Chamados"}
                </NavLink>
              )}
              {hasPermission('tickets') && (
                <NavLink to="/tickets" className={lc} style={mobileStyle} onClick={onClick}>
                  <Ticket className={`w-4 h-4 ${iconMargin}`} />
                  {showText && (user?.role === 'admin' || isSuperUser || isCEO ? 'Todos os Chamados' : 'Meus Chamados')}
                </NavLink>
              )}
              {hasPermission('schedule') && (
                <NavLink to="/schedule" className={lc} style={mobileStyle} onClick={onClick}>
                  <CalendarDays className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Agenda de Entregas"}
                </NavLink>
              )}
              {hasPermission('ticket_categories_management') && (isSuperUser || ['T.I', 'Gestão de Informação'].includes(user.sector || '')) && (
                <NavLink to="/ticket-categories" className={lc} style={mobileStyle} onClick={onClick}>
                  <Tag className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Gestão de Categorias"}
                </NavLink>
              )}
              {hasPermission('rh_equipamentos') && (isSuperUser || isCEO || ['T.I', 'Gestão de Informação'].includes(user.sector || '')) && (
                <NavLink to="/rh/equipamentos" className={lc} style={mobileStyle} onClick={onClick}>
                  <Package className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Equipamentos T.I"}
                </NavLink>
              )}
            </div>
          </SidebarSection>
        </SectorGroup>
        )}

        {/* ── Todos os Setores ── */}
        {(hasPermission('inter_sector_tickets') || hasPermission('inter_sector_kanban') || hasPermission('inter_sector_schedule') || hasPermission('sector_categories')) && (
          <SectorGroup label="Todos os Setores" isCollapsed={mobile ? false : isCollapsed} open={sectorsOpen.todos_setores} onToggle={() => toggleSector('todos_setores')}>
          <SidebarSection title="Chamados Entre Setores" icon={<ArrowLeftRight style={{width:'14px',height:'14px'}}/>} isCollapsed={mobile ? false : isCollapsed} defaultOpen={mobile} forceOpen={allOpen ? true : undefined}>
            <div className="space-y-1">
              {hasPermission('inter_sector_tickets') && (
                <NavLink to="/inter-sector-info" className={lc} style={mobileStyle} onClick={onClick}>
                  <Info className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Sobre"}
                </NavLink>
              )}
              {hasPermission('inter_sector_tickets') && (
                <NavLink to="/inter-sector-tickets" className={lc} style={mobileStyle} onClick={onClick}>
                  <ArrowLeftRight className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Todos os Chamados"}
                </NavLink>
              )}
              {hasPermission('inter_sector_kanban') && (
                <NavLink to="/inter-sector-kanban" className={lc} style={mobileStyle} onClick={onClick}>
                  <Layers className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Kanban"}
                </NavLink>
              )}
              {hasPermission('inter_sector_schedule') && (
                <NavLink to="/inter-sector-schedule" className={lc} style={mobileStyle} onClick={onClick}>
                  <CalendarDays className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Agenda"}
                </NavLink>
              )}
              {hasPermission('sector_categories') && (
                <NavLink to="/sector-categories" className={lc} style={mobileStyle} onClick={onClick}>
                  <Tag className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Categorias do Setor"}
                </NavLink>
              )}
            </div>
          </SidebarSection>
          </SectorGroup>
        )}

        {/* ── Gerencial ── */}
        {(hasPermission('action_plan_dashboard') || hasPermission('action_plans') || hasPermission('strategic_timeline') || hasPermission('strategic_kanban') || hasPermission('strategic_map') || hasPermission('impl_dashboard') || hasPermission('impl_action_plan') || hasPermission('impl_kanban') || hasPermission('impl_timeline')) && (
          <SectorGroup label="Gerencial" isCollapsed={mobile ? false : isCollapsed} open={sectorsOpen.gerencial} onToggle={() => toggleSector('gerencial')}>
          <SidebarSection title="Planejamento Estratégico" icon={<BarChart3 style={{width:'14px',height:'14px'}}/>} isCollapsed={mobile ? false : isCollapsed} defaultOpen={mobile} forceOpen={allOpen ? true : undefined}>
            <div className="space-y-1">
              {hasPermission('action_plan_dashboard') && (
                <NavLink to="/action-plan-dashboard" className={lc} style={mobileStyle} onClick={onClick}>
                  <BarChart3 className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Indicadores do Plano"}
                </NavLink>
              )}
              {hasPermission('action_plans') && (
                <NavLink to="/action-plan" className={lc} style={mobileStyle} onClick={onClick}>
                  <ClipboardList className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Matriz Estratégica"}
                </NavLink>
              )}
              {hasPermission('strategic_map') && (
                <NavLink to="/strategic-map" className={lc} style={mobileStyle} onClick={onClick}>
                  <Layers className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Mapa Estratégico"}
                </NavLink>
              )}
              {hasPermission('strategic_kanban') && (
                <NavLink to="/strategic-kanban" className={lc} style={mobileStyle} onClick={onClick}>
                  <Layers className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Kanban de Ações"}
                </NavLink>
              )}
              {hasPermission('strategic_timeline') && (
                <NavLink to="/strategic-timeline" className={lc} style={mobileStyle} onClick={onClick}>
                  <CalendarDays className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Cronograma Visual"}
                </NavLink>
              )}
            </div>
          </SidebarSection>
          <SidebarSection title="Gestão de Projetos" icon={<Layers style={{width:'14px',height:'14px'}}/>} isCollapsed={mobile ? false : isCollapsed} defaultOpen={mobile} forceOpen={allOpen ? true : undefined}>
            <div className="space-y-1">
              {hasPermission('impl_dashboard') && (
                <NavLink to="/implementation-dashboard" className={lc} style={mobileStyle} onClick={onClick}>
                  <BarChart3 className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Indicadores de Projetos"}
                </NavLink>
              )}
              {hasPermission('impl_action_plan') && (
                <NavLink to="/implementation-action-plan" className={lc} style={mobileStyle} onClick={onClick}>
                  <ClipboardList className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Matriz de Projetos"}
                </NavLink>
              )}
              {hasPermission('impl_kanban') && (
                <NavLink to="/implementation-kanban" className={lc} style={mobileStyle} onClick={onClick}>
                  <Layers className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Kanban de Projetos"}
                </NavLink>
              )}
              {hasPermission('impl_timeline') && (
                <NavLink to="/implementation-timeline" className={lc} style={mobileStyle} onClick={onClick}>
                  <CalendarDays className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Cronograma Visual"}
                </NavLink>
              )}
            </div>
          </SidebarSection>
          </SectorGroup>
        )}

        {/* ── Logística ── */}
        {hasPermission('importation_v2') && (
          <SectorGroup label="Logística" isCollapsed={mobile ? false : isCollapsed} open={sectorsOpen.logistica} onToggle={() => toggleSector('logistica')}>
          <SidebarSection title="Comex" icon={<Package style={{width:'14px',height:'14px'}}/>} isCollapsed={mobile ? false : isCollapsed} defaultOpen={mobile} forceOpen={allOpen ? true : undefined}>
            {/* Importação v1 desativada em 2026-05-19 — substituída pela v2 */}
            {hasPermission('importation_v2') && (
              <NavLink to="/importacao-v2" end className={lc} style={mobileStyle} onClick={onClick}>
                <Package className={`w-4 h-4 ${iconMargin}`} />
                {showText && "Importação"}
              </NavLink>
            )}
            {hasPermission('importation_v2') && (
              <NavLink to="/importacao-v2/moq" className={lc} style={mobileStyle} onClick={onClick}>
                <Package className={`w-4 h-4 ${iconMargin}`} />
                {showText && "MOQ por SKU"}
              </NavLink>
            )}
          </SidebarSection>
          </SectorGroup>
        )}

        {/* ── Marketing ── removido do menu ── */}

        {/* ── Comercial ── */}
        {(hasPermission('sac') || hasPermission('metas_faturamento')) && (
          <SectorGroup label="Comercial" isCollapsed={mobile ? false : isCollapsed} open={sectorsOpen.comercial} onToggle={() => toggleSector('comercial')}>
          {hasPermission('metas_faturamento') && (
            <SidebarSection title="Metas de Faturamento" icon={<BarChart3 style={{width:'14px',height:'14px'}}/>} isCollapsed={mobile ? false : isCollapsed} defaultOpen={mobile} forceOpen={allOpen ? true : undefined}>
              <div className="space-y-1">
                <NavLink to="/comercial/metas-faturamento" className={lc} style={mobileStyle} onClick={onClick}>
                  <BarChart3 className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Dashboard"}
                </NavLink>
              </div>
            </SidebarSection>
          )}
          {hasPermission('sac') && (
          <SidebarSection title="SAC" icon={<Headphones style={{width:'14px',height:'14px'}}/>} isCollapsed={mobile ? false : isCollapsed} defaultOpen={mobile} forceOpen={allOpen ? true : undefined}>
            <div className="space-y-1">
              <NavLink to="/sac" end className={lc} style={mobileStyle} onClick={onClick}>
                <Headphones className={`w-4 h-4 ${iconMargin}`} />
                {showText && "Chamados SAC"}
              </NavLink>
              {hasPermission('sac_dashboard') && (
                <NavLink to="/sac/dashboard" className={lc} style={mobileStyle} onClick={onClick}>
                  <BarChart3 className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Dashboard SAC"}
                </NavLink>
              )}
              {hasPermission('sac') && !isExterno && (
                <NavLink to="/sac/kanban" className={lc} style={mobileStyle} onClick={onClick}>
                  <Layers className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Kanban SAC"}
                </NavLink>
              )}
              {hasPermission('sac') && !isExterno && (
                <NavLink to="/sac/agenda" className={lc} style={mobileStyle} onClick={onClick}>
                  <CalendarDays className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Agenda SAC"}
                </NavLink>
              )}
              {hasPermission('sac') && !isExterno && (user?.permissions?.['sac']?.can_edit || ['super_user','ceo','admin'].includes(user?.role || '')) && (
          <NavLink to="/sac/tipos-problema" className={lc} style={mobileStyle} onClick={onClick}>
            <Tag className={`w-4 h-4 ${iconMargin}`} />
            {showText && "Tipos de Problema"}
          </NavLink>
        )}
        {hasPermission('sac') && !isExterno && (user?.permissions?.['sac']?.can_edit || ['super_user','ceo','admin'].includes(user?.role || '')) && (
                <NavLink to="/sac/clientes-externos" className={lc} style={mobileStyle} onClick={onClick}>
                  <Users className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Clientes Externos"}
                </NavLink>
              )}
            </div>
          </SidebarSection>
          )}
          </SectorGroup>
        )}

        {/* ── Fábrica ── */}
        {(hasPermission('sop_dashboard') || hasPermission('plano_producao') || hasPermission('otimizador_faturamento') || hasPermission('cadastro_maquinas') || hasPermission('programacao')) && (
          <SectorGroup label="Fábrica" isCollapsed={mobile ? false : isCollapsed} open={sectorsOpen.fabrica} onToggle={() => toggleSector('fabrica')}>
            <SidebarSection title="Torre S&OP" icon={<Factory style={{width:'14px',height:'14px'}}/>} isCollapsed={mobile ? false : isCollapsed} defaultOpen={mobile} forceOpen={allOpen ? true : undefined}>
              <div className="space-y-1">
                {hasPermission('sop_dashboard') && (
                  <NavLink to="/fabrica/sop-dashboard" className={lc} style={mobileStyle} onClick={onClick}>
                    <BarChart3 className={`w-4 h-4 ${iconMargin}`} />
                    {showText && "Dashboard"}
                  </NavLink>
                )}
                {hasPermission('plano_producao') && (
                  <NavLink to="/fabrica/plano-producao" className={lc} style={mobileStyle} onClick={onClick}>
                    <ClipboardList className={`w-4 h-4 ${iconMargin}`} />
                    {showText && "Otimizador de Produção"}
                  </NavLink>
                )}
                {hasPermission('programacao') && (
                  <NavLink to="/fabrica/programacao" className={lc} style={mobileStyle} onClick={onClick}>
                    <ClipboardList className={`w-4 h-4 ${iconMargin}`} />
                    {showText && "Programação de Produção"}
                  </NavLink>
                )}
                {hasPermission('otimizador_faturamento') && (
                  <NavLink to="/fabrica/otimizador-faturamento" className={lc} style={mobileStyle} onClick={onClick}>
                    <PieChart className={`w-4 h-4 ${iconMargin}`} />
                    {showText && "Otimizador de Faturamento"}
                  </NavLink>
                )}
                {hasPermission('otimizador_faturamento') && (
                  <NavLink to="/fabrica/otimizador-faturamento/historico" className={lc} style={mobileStyle} onClick={onClick}>
                    <History className={`w-4 h-4 ${iconMargin}`} />
                    {showText && "Histórico de Faturamento"}
                  </NavLink>
                )}
                {hasPermission('cadastro_maquinas') && (
                  <NavLink to="/fabrica/cadastro-maquinas" className={lc} style={mobileStyle} onClick={onClick}>
                    <Factory className={`w-4 h-4 ${iconMargin}`} />
                    {showText && "Cadastro de Máquinas"}
                  </NavLink>
                )}
              </div>
            </SidebarSection>
          </SectorGroup>
        )}

        {/* ── Financeiro ── */}
        {(hasPermission('financeiro_base_orcado') || hasPermission('financeiro_base_realizado') || hasPermission('financeiro_orcado') || hasPermission('financeiro_orcado_realizado') || hasPermission('financeiro_dre') || hasPermission('financeiro_plano_contas') || hasPermission('financeiro_dre2025') || hasPermission('financeiro_comissao') || hasPermission('financeiro_analise_credito')) && (
          <SectorGroup label="Financeiro" isCollapsed={mobile ? false : isCollapsed} open={sectorsOpen.financeiro} onToggle={() => toggleSector('financeiro')}>
          <SidebarSection title="Gestão Financeira" icon={<PieChart style={{width:'14px',height:'14px'}}/>} isCollapsed={mobile ? false : isCollapsed} defaultOpen={mobile} forceOpen={allOpen ? true : undefined}>
            <div className="space-y-1">
              {hasPermission('financeiro_base_orcado') && (
                <NavLink to="/financeiro/base-orcado" className={lc} style={mobileStyle} onClick={onClick}>
                  <ClipboardList className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Base Orçado"}
                </NavLink>
              )}
              {hasPermission('financeiro_base_realizado') && (
                <NavLink to="/financeiro/base-realizado" className={lc} style={mobileStyle} onClick={onClick}>
                  <ClipboardList className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Base Realizado"}
                </NavLink>
              )}
              {hasPermission('financeiro_orcado') && (
                <NavLink to="/financeiro/orcado" className={lc} style={mobileStyle} onClick={onClick}>
                  <BarChart3 className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Relatório Orçado"}
                </NavLink>
              )}
              {hasPermission('financeiro_orcado_realizado') && (
                <NavLink to="/financeiro/orcado-realizado" className={lc} style={mobileStyle} onClick={onClick}>
                  <BarChart3 className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Orçado x Realizado"}
                </NavLink>
              )}
              {hasPermission('financeiro_dre') && (
                <NavLink to="/financeiro/dre" className={lc} style={mobileStyle} onClick={onClick}>
                  <PieChart className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "DRE Comparativo"}
                </NavLink>
              )}
              {hasPermission('financeiro_plano_contas') && (
                <NavLink to="/financeiro/plano-contas" className={lc} style={mobileStyle} onClick={onClick}>
                  <ClipboardList className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Plano de Contas"}
                </NavLink>
              )}
              {hasPermission('financeiro_comissao') && (
                <NavLink to="/financeiro/comissao" className={lc} style={mobileStyle} onClick={onClick}>
                  <PieChart className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Comissão"}
                </NavLink>
              )}
              {hasPermission('financeiro_analise_credito') && (
                <NavLink to="/financeiro/analise-credito" className={lc} style={mobileStyle} onClick={onClick}>
                  <ShieldCheck className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Análise de Crédito"}
                </NavLink>
              )}
              {hasPermission('financeiro_dre2025') && (
                <NavLink to="/financeiro/dre-2025" className={lc} style={mobileStyle} onClick={onClick}>
                  <BarChart3 className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "DRE 2025"}
                </NavLink>
              )}
            </div>
          </SidebarSection>
          </SectorGroup>
        )}

        {/* ── RH / DP ── */}
        {(hasPermission('rh_dashboard') || hasPermission('rh_colaboradores') || hasPermission('rh_recrutamento') || hasPermission('rh_documentos') || hasPermission('rh_jornada') || hasPermission('rh_movimentacoes') || hasPermission('rh_aprovacoes') || hasPermission('rh_config')) && (
          <SectorGroup label="RH / DP" isCollapsed={mobile ? false : isCollapsed} open={sectorsOpen.rh} onToggle={() => toggleSector('rh')}>
          <SidebarSection title="Recursos Humanos" icon={<Users style={{width:'14px',height:'14px'}}/>} isCollapsed={mobile ? false : isCollapsed} defaultOpen={mobile} forceOpen={allOpen ? true : undefined}>
            <div className="space-y-1">
              {hasPermission('rh_dashboard') && (
                <NavLink to="/rh/dashboard" className={lc} style={mobileStyle} onClick={onClick}>
                  <LayoutDashboard className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Dashboard RH"}
                </NavLink>
              )}
              {hasPermission('rh_aprovacoes') && (
                <NavLink to="/rh/aprovacoes" className={lc} style={mobileStyle} onClick={onClick}>
                  <Shield className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Aprovações"}
                </NavLink>
              )}
              {hasPermission('rh_colaboradores') && (
                <NavLink to="/rh/colaboradores" className={lc} style={mobileStyle} onClick={onClick}>
                  <Users className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Colaboradores"}
                </NavLink>
              )}
              {hasPermission('rh_recrutamento') && (
                <NavLink to="/rh/recrutamento" className={lc} style={mobileStyle} onClick={onClick}>
                  <ClipboardList className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Recrutamento"}
                </NavLink>
              )}
              {hasPermission('rh_documentos') && (
                <NavLink to="/rh/documentos" className={lc} style={mobileStyle} onClick={onClick}>
                  <ClipboardList className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Documentos"}
                </NavLink>
              )}
              {hasPermission('rh_jornada') && (
                <NavLink to="/rh/jornada" className={lc} style={mobileStyle} onClick={onClick}>
                  <CalendarDays className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Jornada / Férias"}
                </NavLink>
              )}
              {hasPermission('rh_movimentacoes') && (
                <NavLink to="/rh/movimentacoes" className={lc} style={mobileStyle} onClick={onClick}>
                  <ArrowLeftRight className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Movimentações"}
                </NavLink>
              )}
              {hasPermission('rh_config') && (
                <NavLink to="/rh/config" className={lc} style={mobileStyle} onClick={onClick}>
                  <Tag className={`w-4 h-4 ${iconMargin}`} />
                  {showText && "Configurações"}
                </NavLink>
              )}
            </div>
          </SidebarSection>
          </SectorGroup>
        )}

        {/* ── Configurações ── */}
        {isSuperUser && !isCEO && (
          <SectorGroup label="Configurações" isCollapsed={mobile ? false : isCollapsed} open={sectorsOpen.configuracoes} onToggle={() => toggleSector('configuracoes')}>
          <SidebarSection title="Administração" icon={<Shield style={{width:'14px',height:'14px'}}/>} isCollapsed={mobile ? false : isCollapsed} defaultOpen={mobile} forceOpen={allOpen ? true : undefined}>
            <div className="space-y-1">
              <NavLink to="/metrics" className={lc} style={mobileStyle} onClick={onClick}>
                <PieChart className={`w-4 h-4 ${iconMargin}`} />
                {showText && "Métricas Técnicas"}
              </NavLink>
              <NavLink to="/users" className={lc} style={mobileStyle} onClick={onClick}>
                <Users className={`w-4 h-4 ${iconMargin}`} />
                {showText && "Gestão de Usuários"}
              </NavLink>
              <NavLink to="/sectors" className={lc} style={mobileStyle} onClick={onClick}>
                <Building2 className={`w-4 h-4 ${iconMargin}`} />
                {showText && "Gestão de Setores"}
              </NavLink>
              <NavLink to="/permissions" className={lc} style={mobileStyle} onClick={onClick}>
                <Shield className={`w-4 h-4 ${iconMargin}`} />
                {showText && "Controle de Permissões"}
              </NavLink>
              <NavLink to="/configuracoes/whatsapp-numeros" className={lc} style={mobileStyle} onClick={onClick}>
                <MessageSquare className={`w-4 h-4 ${iconMargin}`} />
                {showText && "Números WhatsApp"}
              </NavLink>
            </div>
          </SidebarSection>
          </SectorGroup>
        )}
      </>
    );
  };

  // ====== DESKTOP (>768px) ======
  if (!isMobile) {
    return (
      <aside className={`${isCollapsed ? 'w-20' : 'w-64'} bg-slate-900 flex flex-col h-full shadow-xl z-20 border-r border-slate-800 transition-all duration-300 relative`}>
        <button
          onClick={toggleSidebar}
          className="absolute -right-3 top-8 bg-slate-800 text-slate-400 p-1 rounded-full border border-slate-700 hover:text-white hover:bg-slate-700 transition-colors shadow-md z-30"
        >
          {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
        </button>

        <div className="p-4">
          <div className={`flex flex-col transition-all duration-300 ${isCollapsed ? 'items-center' : ''}`}>
            {isCollapsed ? (
              <div className="w-12 h-12 bg-red-600 rounded-lg flex items-center justify-center shadow-lg">
                <span className="text-2xl font-black text-white tracking-tighter">M</span>
              </div>
            ) : (
              <div className="bg-red-600 p-4 rounded-xl shadow-lg border border-red-500/30">
                <img
                  src="/Logo-Empresa.png"
                  alt="EMPRESA Logo"
                  className="w-full h-auto object-contain"
                />
              </div>
            )}
          </div>
        </div>

        <nav className="flex-1 px-4 py-2 space-y-2 overflow-y-auto custom-scrollbar overflow-x-hidden">
          {renderNav(false)}
        </nav>

        <div className="p-4 border-t border-slate-800">
          <button onClick={onLogout} className={`flex w-full items-center px-4 py-3 text-xs font-bold text-red-400 rounded-lg hover:bg-red-900/20 transition-colors uppercase tracking-widest ${isCollapsed ? 'justify-center' : ''}`}>
            <LogOut className={`w-4 h-4 ${!isCollapsed ? 'mr-3' : ''}`} />
            {!isCollapsed && "Sair"}
          </button>
        </div>
      </aside>
    );
  }

  // ====== MOBILE (<=768px) ======
  // Header e drawer usam styles inline para garantir render mesmo sem Tailwind CDN/cache
  return (
    <>
      {/* Header fixo no topo */}
      <header
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: '56px',
          background: '#0f172a',
          borderBottom: '1px solid #1e293b',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 12px',
          zIndex: 1000,
          boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        }}
      >
        <button
          onClick={() => setIsMobileOpen(true)}
          aria-label="Abrir menu"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#e2e8f0',
            padding: '8px',
            borderRadius: '8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <Menu style={{ width: '24px', height: '24px' }} />
        </button>

        <div style={{
          background: '#dc2626',
          padding: '4px 14px',
          borderRadius: '6px',
          fontWeight: 900,
          color: '#fff',
          fontSize: '16px',
          letterSpacing: '0.5px',
        }}>
          EMPRESA
        </div>

        <button
          onClick={onLogout}
          aria-label="Sair"
          style={{
            background: 'transparent',
            border: 'none',
            color: '#f87171',
            padding: '8px',
            borderRadius: '8px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <LogOut style={{ width: '20px', height: '20px' }} />
        </button>
      </header>

      {/* Overlay */}
      <div
        onClick={closeMobile}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0,0,0,0.55)',
          zIndex: 1001,
          opacity: isMobileOpen ? 1 : 0,
          pointerEvents: isMobileOpen ? 'auto' : 'none',
          transition: 'opacity 250ms ease',
        }}
      />

      {/* Drawer lateral */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: '280px',
          maxWidth: '85vw',
          background: '#0f172a',
          zIndex: 1002,
          display: 'flex',
          flexDirection: 'column',
          transform: isMobileOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 280ms ease',
          boxShadow: '4px 0 20px rgba(0,0,0,0.5)',
        }}
      >
        {/* Drawer header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: '1px solid #1e293b',
          background: 'linear-gradient(135deg, #1a0505 0%, #4a0404 100%)',
        }}>
          <div style={{
            background: '#dc2626',
            padding: '4px 14px',
            borderRadius: '6px',
            fontWeight: 900,
            color: '#fff',
            fontSize: '16px',
          }}>
            EMPRESA
          </div>
          <button
            onClick={closeMobile}
            aria-label="Fechar menu"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#cbd5e1',
              padding: '6px',
              borderRadius: '6px',
              cursor: 'pointer',
              display: 'flex',
            }}
          >
            <X style={{ width: '22px', height: '22px' }} />
          </button>
        </div>

        {/* Nav */}
        <nav style={{
          flex: 1,
          padding: '12px',
          overflowY: 'auto',
          overflowX: 'hidden',
        }}>
          {renderNav(true)}
        </nav>

        {/* Logout */}
        <div style={{ padding: '12px', borderTop: '1px solid #1e293b' }}>
          <button
            onClick={() => { closeMobile(); onLogout(); }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              padding: '12px',
              background: 'rgba(127, 29, 29, 0.2)',
              border: '1px solid rgba(248, 113, 113, 0.3)',
              color: '#f87171',
              fontWeight: 700,
              fontSize: '13px',
              borderRadius: '8px',
              cursor: 'pointer',
              textTransform: 'uppercase',
              letterSpacing: '1px',
            }}
          >
            <LogOut style={{ width: '16px', height: '16px', marginRight: '10px' }} />
            Sair
          </button>
        </div>
      </div>
    </>
  );
};

// Divisória de setor
const SectorGroup: React.FC<{ label: string; isCollapsed: boolean; open: boolean; onToggle: () => void; children: React.ReactNode }> = ({ label, isCollapsed, open, onToggle, children }) => (
  <div style={{ margin: '14px 0 0' }}>
    {isCollapsed ? (
      <div style={{ height: '1px', background: 'rgba(148,163,184,0.12)', margin: '0 8px 6px' }} />
    ) : (
      <button
        type="button"
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', width: '100%',
          background: 'transparent', border: 'none', cursor: 'pointer',
          marginBottom: open ? '4px' : '4px', padding: 0,
        }}
      >
        <div style={{ width: '10px', height: '1px', background: 'rgba(148,163,184,0.12)', flexShrink: 0 }} />
        <span className={`sidebar-sector-pill ${open ? 'sidebar-sector-pill--open' : ''}`}>
          {label}
          <span style={{ fontSize: '8px', opacity: 0.7 }}>{open ? '▲' : '▼'}</span>
        </span>
        <div style={{ flex: 1, height: '1px', background: 'rgba(148,163,184,0.12)' }} />
      </button>
    )}
    <div style={{
      maxHeight: open ? '2000px' : '0',
      overflow: 'hidden',
      transition: 'max-height 300ms ease-in-out',
    }}>
      {children}
    </div>
  </div>
);

// Section colapsável — design flat moderno
const SidebarSection: React.FC<{ title: string, icon?: React.ReactNode, children: React.ReactNode, isCollapsed: boolean, defaultOpen?: boolean, forceOpen?: boolean }> = ({ title, icon, children, isCollapsed, defaultOpen = false, forceOpen }) => {
  const [isOpen, setIsOpen] = React.useState(defaultOpen);
  React.useEffect(() => { if (forceOpen !== undefined) setIsOpen(forceOpen); }, [forceOpen]);

  if (isCollapsed) {
    return <div style={{ marginBottom: '4px' }}>{children}</div>;
  }

  return (
    <div style={{ marginBottom: '2px' }}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          fontSize: '12px',
          fontWeight: 600,
          color: isOpen ? '#e2e8f0' : '#94a3b8',
          padding: '7px 10px',
          background: isOpen ? 'rgba(255,255,255,0.05)' : 'transparent',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          transition: 'all 150ms ease',
        }}
        onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = '#e2e8f0'; (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.05)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = isOpen ? '#e2e8f0' : '#94a3b8'; (e.currentTarget as HTMLButtonElement).style.background = isOpen ? 'rgba(255,255,255,0.05)' : 'transparent'; }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flex: 1, minWidth: 0 }}>
          {icon && <span style={{ color: isOpen ? '#f87171' : '#64748b', flexShrink: 0, display: 'flex' }}>{icon}</span>}
          <span style={{ textAlign: 'left', letterSpacing: '0.02em' }}>{title}</span>
        </div>
        {isOpen
          ? <ChevronDown style={{ width: '12px', height: '12px', flexShrink: 0, color: '#64748b' }} />
          : <ChevronRight style={{ width: '12px', height: '12px', flexShrink: 0, color: '#475569' }} />}
      </button>
      <div style={{
        maxHeight: isOpen ? '800px' : '0',
        opacity: isOpen ? 1 : 0,
        overflow: 'hidden',
        transition: 'max-height 300ms ease, opacity 200ms ease',
        paddingLeft: '8px',
        marginTop: isOpen ? '2px' : '0',
      }}>
        {children}
      </div>
    </div>
  );
};

export default Sidebar;
