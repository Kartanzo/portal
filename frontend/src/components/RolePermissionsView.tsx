import React, { useState, useEffect, useRef } from 'react';
import { Shield, Save, ChevronDown, X } from 'lucide-react';
import { api } from '../app_api';
import { useSectors } from '../hooks/useSectors';

import { useToast } from '../contexts/ToastContext';

const RolePermissionsView: React.FC = () => {
    const { showToast } = useToast();
    const SECTORS = useSectors();
    const [roles, setRoles] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [activeRole, setActiveRole] = useState('user'); // 'user' or 'admin'

    useEffect(() => {
        loadPermissions();
    }, []);

    const loadPermissions = async () => {
        try {
            const data = await api.getRolePermissions();
            let userPerms = data.find(r => r.role === 'user')?.permissions || {};
            let adminPerms = data.find(r => r.role === 'admin')?.permissions || {};

            setRoles([
                { role: 'user', label: 'Usuário Padrão', permissions: userPerms },
                { role: 'admin', label: 'Administrador', permissions: adminPerms }
            ]);
        } catch (e) {
            console.error("Failed to load permissions", e);
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            const currentRoleData = roles.find(r => r.role === activeRole);
            if (currentRoleData) {
                await api.updateRolePermissions(activeRole, currentRoleData.permissions);
                showToast('Permissões salvas com sucesso!', 'success');
            }
        } catch (e) {
            showToast('Erro ao salvar permissões', 'error');
        } finally {
            setSaving(false);
        }
    };

    const updatePermission = (module: string, setting: string, value: any) => {
        setRoles(prevRoles => prevRoles.map(r => {
            if (r.role === activeRole) {
                const newPerms = { ...r.permissions };
                if (!newPerms[module]) newPerms[module] = { can_view: true };
                newPerms[module][setting] = value;
                return { ...r, permissions: newPerms };
            }
            return r;
        }));
    };

    const modules = [
        { id: 'dashboard', label: 'Visão Geral (Dashboard)', group: 'Geral' },
        { id: 'sector_info', label: 'Tipos de Chamados', group: 'Chamados' },
        { id: 'tickets', label: 'Chamados', group: 'Chamados' },
        { id: 'schedule', label: 'Agenda de Entregas', group: 'Chamados' },
        { id: 'action_plan_dashboard', label: 'Indicadores do Plano', group: 'Planejamento Estratégico' },
        { id: 'action_plans', label: 'Matriz Estratégica', group: 'Planejamento Estratégico' },
        { id: 'strategic_map', label: 'Mapa Estratégico', group: 'Planejamento Estratégico' },
        { id: 'strategic_timeline', label: 'Cronograma Visual (Estratégico)', group: 'Planejamento Estratégico' },
        { id: 'strategic_kanban', label: 'Kanban de Ação', group: 'Planejamento Estratégico' },
        { id: 'impl_dashboard', label: 'Indicadores de Projetos', group: 'Gestão de Projetos' },
        { id: 'impl_action_plan', label: 'Matriz de Projetos', group: 'Gestão de Projetos' },
        { id: 'impl_kanban', label: 'Kanban de Projetos', group: 'Gestão de Projetos' },
        { id: 'impl_timeline', label: 'Cronograma Visual (Projetos)', group: 'Gestão de Projetos' },
        { id: 'inter_sector_tickets', label: 'Chamados Entre Setores', group: 'Chamados Entre Setores' },
        { id: 'inter_sector_kanban', label: 'Kanban Entre Setores', group: 'Chamados Entre Setores' },
        { id: 'inter_sector_schedule', label: 'Agenda Entre Setores', group: 'Chamados Entre Setores' },
        { id: 'sector_categories', label: 'Categorias por Setor', group: 'Chamados Entre Setores' },
        { id: 'sop_dashboard', label: 'Torre de Controle S&OP', group: 'Fábrica' },
        { id: 'plano_producao', label: 'Otimizador de Produção', group: 'Fábrica' },
        { id: 'otimizador_faturamento', label: 'Otimizador de Faturamento', group: 'Fábrica' },
        { id: 'cadastro_maquinas', label: 'Cadastro de Máquinas', group: 'Fábrica' },
        { id: 'programacao', label: 'Programação', group: 'Fábrica' },
        { id: 'eventos_album', label: 'Eventos — Álbum (visível a todos)', group: 'Marketing' },
        { id: 'eventos_admin', label: 'Eventos — Gerenciar', group: 'Marketing' },
        { id: 'marketing_ficha_tecnica', label: 'Ficha Técnica — Gerenciar PDFs', group: 'Marketing' },
        { id: 'ficha_tecnica_catalogo', label: 'Ficha Técnica — Catálogo (galeria, baixar/link)', group: 'Marketing' },
        { id: 'importation', label: 'Importação (legacy)', group: 'Comex' },
        { id: 'importation_v2', label: 'Importação · Análise de Ruptura', group: 'Comex' },
  { id: 'sac', label: 'SAC — Chamados', group: 'SAC (Comercial)' },
  { id: 'sac_dashboard', label: 'Dashboard SAC', group: 'SAC (Comercial)' },
        { id: 'financeiro_base_orcado', label: 'Base Orçado', group: 'Gestão Financeira' },
        { id: 'financeiro_base_realizado', label: 'Base Realizado', group: 'Gestão Financeira' },
        { id: 'financeiro_orcado', label: 'Relatório Orçado', group: 'Gestão Financeira' },
        { id: 'financeiro_orcado_realizado', label: 'Orçado x Realizado', group: 'Gestão Financeira' },
        { id: 'financeiro_dre', label: 'DRE Comparativo', group: 'Gestão Financeira' },
        { id: 'financeiro_plano_contas', label: 'Plano de Contas', group: 'Gestão Financeira' },
        { id: 'financeiro_comissao', label: 'Comissão', group: 'Gestão Financeira' },
        { id: 'rh_dashboard', label: 'Dashboard RH', group: 'RH / DP' },
        { id: 'rh_colaboradores', label: 'Colaboradores', group: 'RH / DP' },
        { id: 'rh_recrutamento', label: 'Recrutamento', group: 'RH / DP' },
        { id: 'rh_documentos', label: 'Documentos', group: 'RH / DP' },
        { id: 'rh_jornada', label: 'Jornada (Banco de Horas / Férias)', group: 'RH / DP' },
        { id: 'rh_movimentacoes', label: 'Movimentações (Admissão / Desligamento)', group: 'RH / DP' },
        { id: 'rh_aprovacoes', label: 'Aprovações Pendentes', group: 'RH / DP' },
        { id: 'rh_config', label: 'Configurações do RH', group: 'RH / DP' },
        { id: 'rh_equipamentos', label: 'Controle de Equipamentos (T.I)', group: 'RH / DP' },
    ];

    if (loading) return <div className="p-8 text-center text-gray-500">Carregando...</div>;

    const currentPermissions = roles.find(r => r.role === activeRole)?.permissions || {};

    // Group modules
    const groupedModules: { [key: string]: typeof modules } = {};
    modules.forEach(m => {
        if (!groupedModules[m.group]) groupedModules[m.group] = [];
        groupedModules[m.group].push(m);
    });

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Permissões de Acesso</h1>
                    <p className="text-gray-500 text-sm">Defina o que cada perfil pode acessar no sistema.</p>
                </div>
                <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-bold shadow-md hover:bg-red-700 transition-colors disabled:opacity-50"
                >
                    <Save className="w-4 h-4 mr-2" /> {saving ? 'Salvando...' : 'Salvar Alterações'}
                </button>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100">
                {/* Role Tabs */}
                <div className="flex border-b border-gray-100">
                    {roles.map(role => (
                        <button
                            key={role.role}
                            onClick={() => setActiveRole(role.role)}
                            className={`flex-1 py-4 text-sm font-bold uppercase tracking-wider transition-colors border-b-2 ${activeRole === role.role
                                ? 'border-red-600 text-red-600 bg-red-50/50'
                                : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                                }`}
                        >
                            {role.label}
                        </button>
                    ))}
                </div>

                {/* Permissions Matrix — desktop (md+): tabela; mobile: cards */}
                <div className="p-4 sm:p-6">
                    {/* DESKTOP: tabela */}
                    <div className="hidden md:block border border-gray-200 rounded-lg overflow-x-auto">
                        <table className="w-full text-sm text-left">
                            <thead className="bg-gray-50 text-xs text-gray-500 font-bold uppercase">
                                <tr>
                                    <th className="px-6 py-4">Módulo</th>
                                    <th className="px-6 py-4 text-center">Acesso (Ver)</th>
                                    <th className="px-6 py-4 text-center">Ver Todos os Setores</th>
                                    <th className="px-6 py-4 text-center">Pode Editar</th>
                                    <th className="px-6 py-4 text-center min-w-[320px]">Setores</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {Object.entries(groupedModules).map(([groupName, groupModules]) => (
                                    <React.Fragment key={groupName}>
                                        {/* Group Header */}
                                        <tr className="bg-slate-800">
                                            <td colSpan={5} className="px-6 py-2.5 text-[10px] font-black uppercase tracking-[0.2em] text-white">
                                                {groupName}
                                            </td>
                                        </tr>
                                        {groupModules.map(module => {
                                            const perms = currentPermissions[module.id] || {};
                                            return (
                                                <tr key={module.id} className="hover:bg-gray-50 transition-colors">
                                                    <td className="px-6 py-4 font-medium text-gray-900 border-r border-gray-100 bg-gray-50/30">
                                                        {module.label}
                                                    </td>
                                                    <td className="px-6 py-4 text-center">
                                                        <input
                                                            type="checkbox"
                                                            className="w-5 h-5 text-red-600 rounded focus:ring-red-500 cursor-pointer"
                                                            checked={perms.can_view !== false}
                                                            onChange={e => updatePermission(module.id, 'can_view', e.target.checked)}
                                                        />
                                                    </td>
                                                    <td className="px-6 py-4 text-center">
                                                        <input
                                                            type="checkbox"
                                                            className="w-5 h-5 text-red-600 rounded focus:ring-red-500 cursor-pointer"
                                                            checked={perms.view_all_sectors || false}
                                                            onChange={e => updatePermission(module.id, 'view_all_sectors', e.target.checked)}
                                                        />
                                                    </td>
                                                    <td className="px-6 py-4 text-center">
                                                        <input
                                                            type="checkbox"
                                                            className="w-5 h-5 text-red-600 rounded focus:ring-red-500 cursor-pointer"
                                                            checked={perms.can_edit || false}
                                                            onChange={e => updatePermission(module.id, 'can_edit', e.target.checked)}
                                                        />
                                                    </td>
                                                    <td className="px-6 py-4">
                                                        <SectorMultiSelect
                                                            selected={perms.allowed_sectors || []}
                                                            onChange={(sectors) => updatePermission(module.id, 'allowed_sectors', sectors)}
                                                            sectorMode={perms.sector_mode || 'include'}
                                                            onModeChange={(mode) => updatePermission(module.id, 'sector_mode', mode)}
                                                        />
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* MOBILE: cards — cada modulo vira um card empilhado */}
                    <div className="md:hidden space-y-4">
                        {Object.entries(groupedModules).map(([groupName, groupModules]) => (
                            <div key={groupName}>
                                <div className="bg-slate-800 text-white text-[10px] font-black uppercase tracking-[0.2em] px-3 py-2 rounded-md mb-2">
                                    {groupName}
                                </div>
                                <div className="space-y-2">
                                    {groupModules.map(module => {
                                        const perms = currentPermissions[module.id] || {};
                                        return (
                                            <div key={module.id} className="bg-white border border-gray-200 rounded-lg p-3 space-y-3">
                                                <div className="font-semibold text-sm text-gray-900">{module.label}</div>
                                                <div className="grid grid-cols-3 gap-2">
                                                    <label className="flex flex-col items-center gap-1 bg-gray-50 border border-gray-200 rounded-md py-2 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            className="w-5 h-5 text-red-600 rounded focus:ring-red-500"
                                                            checked={perms.can_view !== false}
                                                            onChange={e => updatePermission(module.id, 'can_view', e.target.checked)}
                                                        />
                                                        <span className="text-[10px] font-bold uppercase text-gray-500 text-center">Ver</span>
                                                    </label>
                                                    <label className="flex flex-col items-center gap-1 bg-gray-50 border border-gray-200 rounded-md py-2 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            className="w-5 h-5 text-red-600 rounded focus:ring-red-500"
                                                            checked={perms.view_all_sectors || false}
                                                            onChange={e => updatePermission(module.id, 'view_all_sectors', e.target.checked)}
                                                        />
                                                        <span className="text-[10px] font-bold uppercase text-gray-500 text-center">Todos Setores</span>
                                                    </label>
                                                    <label className="flex flex-col items-center gap-1 bg-gray-50 border border-gray-200 rounded-md py-2 cursor-pointer">
                                                        <input
                                                            type="checkbox"
                                                            className="w-5 h-5 text-red-600 rounded focus:ring-red-500"
                                                            checked={perms.can_edit || false}
                                                            onChange={e => updatePermission(module.id, 'can_edit', e.target.checked)}
                                                        />
                                                        <span className="text-[10px] font-bold uppercase text-gray-500 text-center">Editar</span>
                                                    </label>
                                                </div>
                                                <div>
                                                    <div className="text-[10px] font-bold uppercase text-gray-500 mb-1">Setores</div>
                                                    <SectorMultiSelect
                                                        selected={perms.allowed_sectors || []}
                                                        onChange={(sectors) => updatePermission(module.id, 'allowed_sectors', sectors)}
                                                        sectorMode={perms.sector_mode || 'include'}
                                                        onModeChange={(mode) => updatePermission(module.id, 'sector_mode', mode)}
                                                    />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>

                    <p className="text-xs text-gray-400 mt-3 italic">
                        <strong>Setores:</strong> Clique no seletor para escolher setores e alternar entre modo <strong className="text-emerald-600">Permitir</strong> (somente os selecionados acessam) ou <strong className="text-red-600">Bloquear</strong> (todos acessam exceto os selecionados). Sem seleção = todos acessam. Super users e CEO sempre têm acesso total.
                    </p>
                </div>
            </div>
            <div className="h-64"></div>
        </div>
    );
};


// Multi-Select Dropdown for Sectors with Include/Exclude mode
const SectorMultiSelect: React.FC<{
    selected: string[],
    onChange: (sectors: string[]) => void,
    sectorMode?: string,
    onModeChange?: (mode: string) => void
}> = ({ selected, onChange, sectorMode = 'include', onModeChange }) => {
    const SECTORS = useSectors();
    const [isOpen, setIsOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const isExclude = sectorMode === 'exclude';

    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setIsOpen(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const toggleSector = (sector: string) => {
        if (selected.includes(sector)) {
            onChange(selected.filter(s => s !== sector));
        } else {
            onChange([...selected, sector]);
        }
    };

    const removeSector = (sector: string) => {
        onChange(selected.filter(s => s !== sector));
    };

    const selectAll = () => onChange([...SECTORS]);
    const selectNone = () => onChange([]);

    // Colors based on mode
    const tagBg = isExclude ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700';
    const tagHover = isExclude ? 'hover:text-red-900' : 'hover:text-emerald-900';
    const checkboxColor = isExclude ? 'text-red-600 focus:ring-red-500' : 'text-emerald-600 focus:ring-emerald-500';

    // Placeholder text
    const placeholder = selected.length === 0
        ? 'Todos os setores'
        : `${selected.length} setor${selected.length > 1 ? 'es' : ''} ${isExclude ? 'bloqueado' : 'permitido'}${selected.length > 1 ? 's' : ''}`;

    return (
        <div className="relative" ref={ref}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={`flex items-center gap-2 w-full border rounded-lg px-3 py-2 text-xs text-left transition-colors min-h-[36px] ${selected.length > 0 && isExclude
                    ? 'bg-red-50/50 border-red-200 hover:bg-red-50'
                    : selected.length > 0
                        ? 'bg-emerald-50/50 border-emerald-200 hover:bg-emerald-50'
                        : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                    }`}
            >
                <div className="flex-1 flex flex-wrap gap-1">
                    {selected.length === 0 ? (
                        <span className="text-slate-400 italic">{placeholder}</span>
                    ) : selected.length <= 3 ? (
                        selected.map(s => (
                            <span key={s} className={`${tagBg} px-1.5 py-0.5 rounded text-[10px] font-bold flex items-center gap-1`}>
                                {s}
                                <X className={`w-3 h-3 cursor-pointer ${tagHover}`} onClick={(e) => { e.stopPropagation(); removeSector(s); }} />
                            </span>
                        ))
                    ) : (
                        <span className={`${tagBg} px-2 py-0.5 rounded text-[10px] font-bold`}>
                            {placeholder}
                        </span>
                    )}
                </div>
                <ChevronDown className={`w-3.5 h-3.5 text-slate-400 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute z-50 top-full left-0 mt-1 w-72 bg-white border border-slate-200 rounded-lg shadow-xl">
                    {/* Header: Mode toggle + quick actions */}
                    <div className="px-3 py-2.5 border-b border-slate-100 bg-slate-50/80 rounded-t-lg">
                        <div className="flex items-center justify-between">
                            <div className="flex bg-white border border-slate-200 p-0.5 rounded-md">
                                <button
                                    type="button"
                                    onClick={() => onModeChange?.('include')}
                                    className={`px-2.5 py-1 rounded text-[10px] font-bold transition-all ${!isExclude ? 'bg-emerald-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'
                                        }`}
                                >
                                    ✓ Permitir
                                </button>
                                <button
                                    type="button"
                                    onClick={() => onModeChange?.('exclude')}
                                    className={`px-2.5 py-1 rounded text-[10px] font-bold transition-all ${isExclude ? 'bg-red-600 text-white shadow-sm' : 'text-slate-400 hover:text-slate-600'
                                        }`}
                                >
                                    ✕ Bloquear
                                </button>
                            </div>
                            <div className="flex gap-1">
                                <button type="button" onClick={selectAll} className="px-2 py-1 text-[10px] font-bold text-blue-600 hover:bg-blue-50 rounded transition-colors">Todos</button>
                                <button type="button" onClick={selectNone} className="px-2 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-100 rounded transition-colors">Nenhum</button>
                            </div>
                        </div>
                        <p className="text-[9px] text-slate-400 mt-1.5">
                            {isExclude ? 'Setores marcados serão bloqueados' : 'Somente setores marcados terão acesso'}
                        </p>
                    </div>
                    {/* Sector list */}
                    <div className="max-h-48 overflow-y-auto">
                        {SECTORS.map(sector => (
                            <label
                                key={sector}
                                className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer text-xs"
                            >
                                <input
                                    type="checkbox"
                                    className={`w-4 h-4 rounded cursor-pointer ${checkboxColor}`}
                                    checked={selected.includes(sector)}
                                    onChange={() => toggleSector(sector)}
                                />
                                <span className="font-medium text-slate-700">{sector}</span>
                            </label>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default RolePermissionsView;
