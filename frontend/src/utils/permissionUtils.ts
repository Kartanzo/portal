import { User } from '../types';

/**
 * Mescla as permissões padrão da role (role_permissions da API) com as
 * permissões individuais do usuário (override na coluna `permissions` do banco).
 *
 * Regra: permissão individual do user sobrescreve a da role, mas apenas para
 * as chaves que existem no objeto individual. Módulos sem override ficam com
 * o valor da role.
 *
 * @param rolePerms  Permissões padrão da role, ex: { tickets: { can_view: true, ... }, ... }
 * @param userPerms  Permissões individuais do user (pode ser null/undefined/{})
 * @returns          Objeto permissões mesclado
 */
export const mergePermissions = (
    rolePerms: Record<string, any> | null = {},
    userPerms: Record<string, any> | null = {}
): Record<string, any> => {
    const base = rolePerms || {};
    const override = userPerms || {};
    const merged: Record<string, any> = { ...base };

    for (const module of Object.keys(override)) {
        if (override[module] && typeof override[module] === 'object') {
            merged[module] = { ...(base[module] || {}), ...override[module] };
        }
    }

    return merged;
};

/**
 * Standardized permission evaluation for the entire frontend.
 * Enforces a 'Restrictive by Default' policy and sectoral filtering.
 *
 * NOTE: user.permissions deve ser o objeto JÁ MESCLADO (role padrão + override individual).
 * Use mergePermissions() no App.tsx após buscar role-permissions para garantir isso.
 */
export const hasAccess = (user: User | null, module: string): boolean => {
    if (!user) return false;

    // 1. Super users and CEO always have access to everything
    if (user.role === 'super_user' || user.role === 'ceo') return true;

    const perm = user.permissions?.[module];

    // 2. RESTRICTIVE BY DEFAULT: If no permission config exists for this exact module, deny.
    if (!perm) return false;

    // 3. EXPLICIT VIEW DENIAL: If can_view is explicitly false, deny.
    // If can_view is undefined (not explicitly set), allow — admin configured the module entry intentionally.
    if (perm.can_view === false) return false;

    // 4. SECTORAL FILTERING
    const allowedSectors: string[] = perm.allowed_sectors || [];

    if (allowedSectors.length > 0) {
        const userSectors = new Set<string>();

        // Primary Sector
        if (user.sector) {
            user.sector.split(/[;,]/).map((s: string) => s.trim()).filter(Boolean).forEach((s: string) => userSectors.add(s));
        }

        // Managed Sectors (for admins/managers)
        if (user.managed_sectors) {
            user.managed_sectors.split(/[;,]/).map((s: string) => s.trim()).filter(Boolean).forEach((s: string) => userSectors.add(s));
        }

        const userSectorsList = Array.from(userSectors);

        const hasMatch = userSectorsList.some(s => allowedSectors.includes(s));

        if (!hasMatch) return false;
    }

    // 5. If all checks pass, allow access.
    return true;
};

/**
 * Returns the list of sectors the user is permitted to see for a given module,
 * based on role_permissions (allowed_sectors + sector_mode).
 * - Empty allowed_sectors = no restriction = return allSectors.
 * - sector_mode 'include' = only the listed sectors.
 * - sector_mode 'exclude' = all sectors except the listed ones.
 * - super_user / ceo = always all sectors.
 */
export const getPermittedSectors = (
    user: User | null,
    moduleId: string,
    allSectors: string[]
): string[] => {
    if (!user) return [];
    if (user.role === 'super_user' || user.role === 'ceo') return allSectors;

    const perm = user.permissions?.[moduleId];
    // No permission entry at all → no sectors visible
    if (!perm) return [];

    const allowedSectors: string[] = perm.allowed_sectors || [];
    const sectorMode: string = perm.sector_mode || 'include';

    // No sector restriction configured → show all sectors
    if (allowedSectors.length === 0) return allSectors;

    return sectorMode === 'include'
        ? allSectors.filter(s => allowedSectors.includes(s))
        : allSectors.filter(s => !allowedSectors.includes(s));
};
