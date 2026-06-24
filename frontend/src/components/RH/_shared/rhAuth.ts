// Util compartilhado de permissões do módulo RH.
// Lê o user da sessão e verifica o map permissions.<module_id>.can_view/can_edit.
// IMPORTANTE: isto NÃO substitui validação no backend. É só pra esconder/mostrar
// elementos de UI (links, atalhos) que apontam para módulos sem acesso.

export interface RhUser {
    id?: string;
    role?: string;
    permissions?: Record<string, { can_view?: boolean; can_edit?: boolean; allowed_sectors?: string[] }>;
}

export const getCurrentUser = (): RhUser | null => {
    try {
        return JSON.parse(sessionStorage.getItem('empresa_user') || 'null');
    } catch {
        return null;
    }
};

const ROLES_SUPER = new Set(['super_user', 'ceo']);

export const hasRhPermission = (moduleId: string, level: 'can_view' | 'can_edit' = 'can_view'): boolean => {
    const u = getCurrentUser();
    if (!u) return false;
    if (u.role && ROLES_SUPER.has(u.role)) return true;
    const p = u.permissions?.[moduleId];
    if (!p) return false;
    return !!p[level];
};

export const isRhSuperUser = (): boolean => {
    const u = getCurrentUser();
    return !!(u && u.role && ROLES_SUPER.has(u.role));
};
