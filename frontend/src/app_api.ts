import { User, Ticket, UserRole, ActionPlanItem, ActionPlanSubItem, Notification, NotificationPreferences } from './types';

// Basic API client for the frontend
const isDevelopment = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_URL = isDevelopment ? "/api" : "/api"; // Using /api for both to leverage proxy/nginx
const API_PREFIX = API_URL;

function getAuthHeaders(): Record<string, string> {
    try {
        const saved = sessionStorage.getItem('blackd_user');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (parsed?.id) return { 'user-id': String(parsed.id) };
        }
    } catch { }
    return {};
}

// Wrapper global: garante credentials:'include' em toda requisicao (cookie de sessao)
const apiFetch: typeof fetch = (input, init = {}) => {
    return fetch(input, { ...init, credentials: 'include' });
};


export const api = {
    API_PREFIX,
    async get(path: string, options?: { params?: Record<string, any> }) {
        const url = new URL(`${API_PREFIX}${path}`, window.location.origin);
        if (options?.params) {
            Object.keys(options.params).forEach(key => {
                if (options.params![key] !== undefined && options.params![key] !== null) {
                    url.searchParams.append(key, options.params![key]);
                }
            });
        }
        const response = await apiFetch(url.toString(), { headers: getAuthHeaders() });
        if (!response.ok) throw new Error(`GET ${path} failed`);
        return { data: await response.json() };
    },
    async post(path: string, body?: any) {
        const response = await apiFetch(`${API_PREFIX}${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify(body ?? {}),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `POST ${path} failed`);
        }
        return { data: await response.json() };
    },
    async put(path: string, body?: any) {
        const response = await apiFetch(`${API_PREFIX}${path}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify(body ?? {}),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `PUT ${path} failed`);
        }
        return { data: await response.json() };
    },
    async del(path: string) {
        const response = await apiFetch(`${API_PREFIX}${path}`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || `DELETE ${path} failed`);
        }
        return { data: await response.json() };
    },
    comissaoDocUrl(docId: string): string {
        let uid = '';
        try { const s = sessionStorage.getItem('blackd_user'); if (s) { const pp = JSON.parse(s); if (pp?.id) uid = String(pp.id); } } catch { /* */ }
        return `${API_PREFIX}/financeiro/comissao/documento/${docId}?_uid=${encodeURIComponent(uid)}`;
    },
    async comissaoUploadDoc(regId: string, file: File) {
        const fd = new FormData(); fd.append('file', file);
        const r = await apiFetch(`${API_PREFIX}/financeiro/comissao/${regId}/documento`, { method: 'POST', headers: getAuthHeaders(), body: fd });
        if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.detail || 'Falha no upload'); }
        return r.json();
    },
    async comissaoUploadLote(referencia: string, files: File[]) {
        const fd = new FormData(); files.forEach(f => fd.append('files', f));
        const url = `${API_PREFIX}/financeiro/comissao/documentos-lote?referencia=${encodeURIComponent(referencia)}`;
        const r = await apiFetch(url, { method: 'POST', headers: getAuthHeaders(), body: fd });
        if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.detail || 'Falha no upload em lote'); }
        return r.json();
    },
    async login(email: string, password?: string): Promise<User> {
        // Correcting parameter mapping: email and password are required for login.
        // Role is identified by the backend after authentication.
        const response = await apiFetch(`${API_PREFIX}/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ email, password: password || '', role: '' })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Login failed');
        }

        return response.json();
    },

    async forgotPassword(email: string): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/forgot-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Failed to send reset email');
        }
        return response.json();
    },

    async resetPassword(token: string, newPassword: string): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/reset-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, new_password: newPassword })
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Failed to reset password');
        }
        return response.json();
    },

    async getTickets(userId?: string, role?: string): Promise<Ticket[]> {
        const params = new URLSearchParams();
        if (userId) params.append('user_id', userId);
        if (role) params.append('role', role);

        const response = await apiFetch(`${API_PREFIX}/tickets?${params.toString()}`, {
            headers: getAuthHeaders()
        });

        if (!response.ok) {
            throw new Error('Failed to fetch tickets');
        }

        return response.json();
    },

    async getDashboardMetrics(userId?: string): Promise<any> {
        const params = new URLSearchParams();
        if (userId) params.append('user_id', userId);
        const response = await apiFetch(`${API_PREFIX}/dashboard/metrics?${params.toString()}`, {
            headers: getAuthHeaders()
        });
        if (!response.ok) throw new Error('Failed to fetch dashboard metrics');
        return response.json();
    },

    async getTicket(id: string): Promise<Ticket> {
        const response = await apiFetch(`${API_PREFIX}/tickets/${id}`, {
            headers: getAuthHeaders()
        });
        if (!response.ok) throw new Error('Failed to fetch ticket');
        return response.json();
    },

    async updateTicket(id: string, updates: Partial<Ticket> & { skip_notification?: boolean }): Promise<void> {
        // Backend expects snake_case, need to map if necessary.
        // TicketUpdate model has `delivery_forecast`. Ticket interface has `deliveryForecast`.
        const payload: any = { ...updates };
        if (updates.deliveryForecast) {
            payload.delivery_forecast = updates.deliveryForecast;
            delete payload.deliveryForecast;
        }
        if (updates.requesterId) {
            payload.requester_id = updates.requesterId;
            delete payload.requesterId;
        }

        const response = await apiFetch(`${API_PREFIX}/tickets/${id}`, {
            method: 'PUT',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('Failed to update ticket');
    },

    async getTicketUpdates(ticketId: string): Promise<any[]> {
        const response = await apiFetch(`${API_PREFIX}/tickets/${ticketId}/updates`, {
            headers: getAuthHeaders()
        });
        if (!response.ok) throw new Error('Failed to fetch ticket updates');
        return response.json();
    },

    async sendTicketUpdate(ticketId: string, userId: string, message: string, file: File | null): Promise<void> {
        const formData = new FormData();
        formData.append('user_id', userId);
        // Sempre envia message (mesmo vazio) — coluna ticket_updates.message eh NOT NULL no DB
        formData.append('message', message || '');
        if (file) formData.append('file', file);

        const response = await apiFetch(`${API_PREFIX}/tickets/${ticketId}/updates`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: formData,
        });
        if (!response.ok) throw new Error('Failed to send update');
    },

    async createTicket(ticket: any, files?: File[]): Promise<Ticket> {
        const formData = new FormData();
        formData.append('title', ticket.title);
        formData.append('description', ticket.description);
        formData.append('category', ticket.category);
        formData.append('priority', ticket.priority);
        formData.append('status', ticket.status);
        formData.append('requester_id', ticket.requester_id);

        if (ticket.category_id) formData.append('category_id', ticket.category_id);
        if (ticket.subcategory_id) formData.append('subcategory_id', ticket.subcategory_id);

        if (ticket.delivery_forecast) {
            formData.append('delivery_forecast', ticket.delivery_forecast);
        }

        if (files && files.length > 0) {
            files.forEach(file => {
                formData.append('files', file);
            });
        }

        const response = await apiFetch(`${API_PREFIX}/tickets`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: formData,
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Failed to create ticket');
        }

        return response.json();
    },

    async forwardTicket(id: string, payload: { category_id: string, subcategory_id?: string, reason?: string }): Promise<void> {
        const response = await apiFetch(`${API_PREFIX}/tickets/${id}/forward`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Failed to forward ticket');
        }
    },

    async getCategories(sector?: string): Promise<any[]> {
        const url = sector ? `${API_PREFIX}/categories?sector=${encodeURIComponent(sector)}` : `${API_PREFIX}/categories`;
        const response = await apiFetch(url, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to fetch categories');
        return response.json();
    },

    async getSubcategories(categoryId: string): Promise<any[]> {
        const response = await apiFetch(`${API_PREFIX}/categories/${categoryId}/subcategories`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to fetch subcategories');
        return response.json();
    },

    async createCategory(category: { name: string, sector: string }): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/categories`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(category)
        });
        if (!response.ok) throw new Error('Failed to create category');
        return response.json();
    },

    async deleteCategory(id: string): Promise<void> {
        const response = await apiFetch(`${API_PREFIX}/categories/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        if (!response.ok) throw new Error('Failed to delete category');
    },

    async createSubcategory(categoryId: string, subcategory: { name: string }): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/categories/${categoryId}/subcategories`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(subcategory)
        });
        if (!response.ok) throw new Error('Failed to create subcategory');
        return response.json();
    },

    async deleteSubcategory(id: string): Promise<void> {
        const response = await apiFetch(`${API_PREFIX}/subcategories/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders()
        });
        if (!response.ok) throw new Error('Failed to delete subcategory');
    },

    async getActionPlans(sector?: string, userId?: string): Promise<any[]> {
        const params = new URLSearchParams();
        if (sector) params.append('sector', sector);
        if (userId) params.append('user_id', userId);

        const response = await apiFetch(`${API_PREFIX}/action-plans?${params.toString()}`, {
            headers: getAuthHeaders()
        });
        if (!response.ok) throw new Error('Failed to fetch action plans');
        return response.json();
    },

    async createActionPlan(plan: any): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/action-plans`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(plan)
        });
        if (!response.ok) throw new Error('Failed to create action plan');
        return response.json();
    },

    async createActionPlanItem(planId: string, item: any): Promise<any> {
        const payload = {
            actions: item.actions,
            expected_result: item.expectedResult,
            projects: item.projects,
            responsible: item.responsible,
            status: item.status,
            schedule_start: item.scheduleStart,
            schedule_end: item.scheduleEnd,
            observation: item.observation,
            budget_planned: item.budgetPlanned,
            budget_actual: item.budgetActual,
            hours_planned: item.hoursPlanned,
            hours_actual: item.hoursActual,
            roi_percentage: item.roiPercentage,
            stakeholder_satisfaction: item.stakeholderSatisfaction,
            blocked_by_user_id: item.blockedByUserId,
            waiting_for_return: item.waitingForReturn,
            created_by: item.createdBy
        };
        const response = await apiFetch(`${API_PREFIX}/action-plans/${planId}/items`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('Failed to create action plan item');
        return response.json();
    },

    async deleteTicket(id: string): Promise<void> {
        const response = await apiFetch(`${API_PREFIX}/tickets/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to delete ticket');
    },

    async deleteActionPlan(id: string): Promise<void> {
        const response = await apiFetch(`${API_PREFIX}/action-plans/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to delete action plan');
    },

    async updateActionPlan(id: string, data: { objective: string, macro_theme?: string, sector?: string }): Promise<void> {
        const response = await apiFetch(`${API_PREFIX}/action-plans/${id}`, {
            method: 'PUT',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('Failed to update action plan');
    },

    async updateActionPlanItem(id: string, item: Partial<ActionPlanSubItem> & { blockedByUserId?: string, updatedBy?: string }): Promise<void> {
        // Backend expects snake_case for Pydantic model ActionPlanItemCreate
        const payload = {
            actions: item.actions,
            expected_result: item.expectedResult,
            projects: item.projects,
            responsible: item.responsible,
            status: item.status,
            schedule_start: item.scheduleStart,
            schedule_end: item.scheduleEnd,
            observation: item.observation,
            budget_planned: item.budgetPlanned,
            budget_actual: item.budgetActual,
            hours_planned: item.hoursPlanned,
            hours_actual: item.hoursActual,
            roi_percentage: item.roiPercentage,
            stakeholder_satisfaction: item.stakeholderSatisfaction,
            blocked_by_user_id: item.blockedByUserId,
            updated_by: item.updatedBy,
            waiting_for_return: item.waitingForReturn
        };
        const response = await apiFetch(`${API_PREFIX}/action-plan-items/${id}`, {
            method: 'PUT',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('Failed to update action plan item');
    },

    async getActionPlanHistory(itemId: string): Promise<{ user_name: string, change_summary: string, created_at: string }[]> {
        const response = await apiFetch(`${API_PREFIX}/action-plan-items/${itemId}/history`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to fetch history');
        return response.json();
    },

    async deleteActionPlanItem(id: string): Promise<void> {
        const response = await apiFetch(`${API_PREFIX}/action-plan-items/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to delete action plan item');
    },

    // --- Action Plan Attachments ---
    async uploadActionPlanAttachment(itemId: string, file: File, userId?: string): Promise<any> {
        const formData = new FormData();
        formData.append('file', file);
        if (userId) {
            formData.append('user_id', userId);
        }

        const response = await apiFetch(`${API_PREFIX}/action-plans/${itemId}/attachments`, {
            method: 'POST',
            body: formData
        });
        if (!response.ok) throw new Error('Failed to upload attachment');
        return response.json();
    },

    async getActionPlanAttachments(itemId: string): Promise<any[]> {
        const response = await apiFetch(`${API_PREFIX}/action-plans/${itemId}/attachments`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to fetch attachments');
        return response.json();
    },

    async deleteActionPlanAttachment(attachmentId: string): Promise<void> {
        const response = await apiFetch(`${API_PREFIX}/action-plans/attachments/${attachmentId}`, {
            method: 'DELETE', headers: getAuthHeaders()
        });
        if (!response.ok) throw new Error('Failed to delete attachment');
    },

    // --- Implementation Schedule ---
    async getImplementationSchedules(sector?: string, userId?: string): Promise<any[]> {
        const params = new URLSearchParams();
        if (sector) params.append('sector', sector);
        if (userId) params.append('user_id', userId);
        const response = await apiFetch(`${API_PREFIX}/implementation-schedules?${params.toString()}`, {
            headers: getAuthHeaders()
        });
        if (!response.ok) throw new Error('Failed to fetch implementation schedules');
        return response.json();
    },

    async createImplementationSchedule(plan: any): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/implementation-schedules`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(plan)
        });
        if (!response.ok) throw new Error('Failed to create implementation schedule');
        return response.json();
    },

    async updateImplementationSchedule(id: string, data: { objective: string, macro_theme?: string, sector?: string }): Promise<void> {
        const response = await apiFetch(`${API_PREFIX}/implementation-schedules/${id}`, {
            method: 'PUT',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('Failed to update implementation schedule');
    },

    async deleteImplementationSchedule(id: string): Promise<void> {
        const response = await apiFetch(`${API_PREFIX}/implementation-schedules/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to delete implementation schedule');
    },

    async createImplementationScheduleItem(planId: string, item: any): Promise<any> {
        const payload = {
            actions: item.actions,
            expected_result: item.expectedResult,
            projects: item.projects,
            responsible: item.responsible,
            status: item.status,
            schedule_start: item.scheduleStart,
            schedule_end: item.scheduleEnd,
            observation: item.observation,
            budget_planned: item.budgetPlanned,
            budget_actual: item.budgetActual,
            hours_planned: item.hoursPlanned,
            hours_actual: item.hoursActual,
            roi_percentage: item.roiPercentage,
            stakeholder_satisfaction: item.stakeholderSatisfaction,
            blocked_by_user_id: item.blockedByUserId,
            waiting_for_return: item.waitingForReturn,
            created_by: item.createdBy
        };
        const response = await apiFetch(`${API_PREFIX}/implementation-schedules/${planId}/items`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('Failed to create item');
        return response.json();
    },

    async updateImplementationScheduleItem(id: string, item: any): Promise<void> {
        const payload = {
            actions: item.actions,
            expected_result: item.expectedResult,
            projects: item.projects,
            responsible: item.responsible,
            status: item.status,
            schedule_start: item.scheduleStart,
            schedule_end: item.scheduleEnd,
            observation: item.observation,
            budget_planned: item.budgetPlanned,
            budget_actual: item.budgetActual,
            hours_planned: item.hours_planned,
            hours_actual: item.hours_actual,
            roi_percentage: item.roiPercentage,
            stakeholder_satisfaction: item.stakeholderSatisfaction,
            blocked_by_user_id: item.blockedByUserId,
            waiting_for_return: item.waitingForReturn,
            updated_by: item.updatedBy
        };
        const response = await apiFetch(`${API_PREFIX}/implementation-schedule-items/${id}`, {
            method: 'PUT',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!response.ok) throw new Error('Failed to update item');
    },

    async deleteImplementationScheduleItem(id: string): Promise<void> {
        const response = await apiFetch(`${API_PREFIX}/implementation-schedule-items/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to delete item');
    },

    async getImplementationScheduleHistory(itemId: string): Promise<any[]> {
        const response = await apiFetch(`${API_PREFIX}/implementation-schedule-items/${itemId}/history`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to fetch history');
        return response.json();
    },

    async uploadImplementationScheduleAttachment(itemId: string, file: File, userId?: string): Promise<any> {
        const formData = new FormData();
        formData.append('file', file);
        if (userId) formData.append('user_id', userId);
        const response = await apiFetch(`${API_PREFIX}/implementation-schedules/${itemId}/attachments`, {
            method: 'POST',
            body: formData
        });
        if (!response.ok) throw new Error('Failed to upload attachment');
        return response.json();
    },

    async getImplementationScheduleAttachments(itemId: string): Promise<any[]> {
        const response = await apiFetch(`${API_PREFIX}/implementation-schedules/${itemId}/attachments`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to fetch attachments');
        return response.json();
    },

    async deleteImplementationScheduleAttachment(attachmentId: string): Promise<void> {
        const response = await apiFetch(`${API_PREFIX}/implementation-schedules/attachments/${attachmentId}`, {
            method: 'DELETE', headers: getAuthHeaders()
        });
        if (!response.ok) throw new Error('Failed to delete attachment');
    },

    async getUsersBySector(sector: string): Promise<{ id: string, name: string, sector: string, role?: string, permissions?: any, managed_sectors?: string }[]> {
        const response = await apiFetch(`${API_PREFIX}/users/by-sector?sector=${encodeURIComponent(sector)}`);
        if (!response.ok) throw new Error('Failed to fetch users by sector');
        return response.json();
    },

    async getAllUsersSimple(): Promise<{ id: string, name: string, sector: string, role?: string, permissions?: any, managed_sectors?: string }[]> {
        const response = await apiFetch(`${API_PREFIX}/users/list-all`);
        if (!response.ok) throw new Error('Failed to fetch all users');
        return response.json();
    },

    async getUsers(): Promise<User[]> {
        const response = await apiFetch(`${API_PREFIX}/users`);
        if (!response.ok) throw new Error('Failed to fetch users');
        return response.json();
    },

    async getTicketParticipants(ticketId: string): Promise<any[]> {
        const response = await apiFetch(`${API_PREFIX}/tickets/${ticketId}/participants`);
        if (!response.ok) throw new Error('Falha ao buscar participantes');
        return response.json();
    },

    async addTicketParticipant(ticketId: string, userId: string): Promise<{ message: string }> {
        const response = await apiFetch(`${API_PREFIX}/tickets/${ticketId}/participants`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId })
        });
        if (!response.ok) throw new Error('Falha ao adicionar participante');
        return response.json();
    },

    async removeTicketParticipant(ticketId: string, userId: string): Promise<{ message: string }> {
        const response = await apiFetch(`${API_PREFIX}/tickets/${ticketId}/participants/${userId}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Falha ao remover participante');
        return response.json();
    },

    async reactivateUser(id: string): Promise<{ message: string }> {
        const response = await apiFetch(`${API_PREFIX}/users/${id}/reactivate`, { method: 'PUT' });
        if (!response.ok) throw new Error('Falha ao reativar usuário');
        return response.json();
    },

    async getUser(id: string): Promise<User> {
        const response = await apiFetch(`${API_PREFIX}/users/${id}`);
        if (!response.ok) throw new Error('Failed to fetch user');
        return response.json();
    },

    async createUser(user: any): Promise<void> {
        const response = await apiFetch(`${API_PREFIX}/users`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(user)
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Failed to create user');
        }
    },

    async updateUser(id: string, user: Partial<User>): Promise<void> {
        const response = await apiFetch(`${API_PREFIX}/users/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(user)
        });
        if (!response.ok) throw new Error('Failed to update user');
    },

    async deleteUser(id: string): Promise<void> {
        const response = await apiFetch(`${API_PREFIX}/users/${id}`, { method: 'DELETE' });
        if (!response.ok) throw new Error('Failed to delete user');
    },
    async getRolePermissions(): Promise<{ role: string, permissions: any }[]> {
        const response = await apiFetch(`${API_PREFIX}/role-permissions`);
        if (!response.ok) throw new Error('Failed to fetch permissions');
        return response.json();
    },

    async getStrategicSectors(): Promise<{ allowed_sectors: string[], allowed_users: { id: string, name: string, sector: string, role: string }[] }> {
        const response = await apiFetch(`${API_PREFIX}/strategic-sectors`);
        if (!response.ok) throw new Error('Failed to fetch strategic sectors');
        return response.json();
    },

    async getImplementationSectors(userId?: string): Promise<{ allowed_sectors: string[], allowed_users: { id: string, name: string, sector: string, role: string }[] }> {
        const url = userId ? `${API_PREFIX}/implementation-sectors?user_id=${userId}` : `${API_PREFIX}/implementation-sectors`;
        const response = await apiFetch(url);
        if (!response.ok) throw new Error('Failed to fetch implementation sectors');
        return response.json();
    },

    async updateRolePermissions(role: string, permissions: any): Promise<void> {
        const response = await apiFetch(`${API_PREFIX}/role-permissions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role, permissions })
        });
        if (!response.ok) throw new Error('Failed to update permissions');
    },

    async getNotifications(userId: string): Promise<Notification[]> {
        const response = await apiFetch(`${API_PREFIX}/notifications?user_id=${userId}`);
        if (!response.ok) throw new Error('Failed to fetch notifications');
        return response.json();
    },

    async markNotificationRead(id: string): Promise<void> {
        const response = await apiFetch(`${API_PREFIX}/notifications/${id}/read`, { method: 'PUT' });
        if (!response.ok) throw new Error('Failed to mark notification read');
    },

    async updateNotificationPreferences(userId: string, prefs: NotificationPreferences): Promise<void> {
        const response = await apiFetch(`${API_PREFIX}/users/${userId}/preferences`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(prefs)
        });
        if (!response.ok) throw new Error('Failed to update preferences');
    },

    async calculateImportation(data: { items?: any[], history_id?: string }): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/importation/calculate`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || err.error || `Erro ${response.status} ao calcular importação.`);
        }
        return response.json();
    },

    async uploadImportationExcel(formData: FormData, userId: string): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/importation/upload`, {
            method: 'POST',
            headers: { 'user-id': userId },
            body: formData
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Failed to upload Excel');
        }
        return response.json();
    },

    async getImportationCache(): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/importation/cache`, { headers: getAuthHeaders() });
        if (!response.ok) return null;
        try {
            return await response.json();
        } catch {
            return null;
        }
    },

    async getImportationHistory(): Promise<any[]> {
        const response = await apiFetch(`${API_PREFIX}/importation/history`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to fetch history');
        return response.json();
    },

    async getImportationTemplate(): Promise<Blob> {
        const response = await apiFetch(`${API_PREFIX}/importation/template`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to download template');
        return response.blob();
    },

    async deleteImportationHistory(historyId: string): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/importation/history/${historyId}`, {
            method: 'DELETE', headers: getAuthHeaders()
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Failed to delete history');
        }
        return response.json();
    },

    // --- Finance Module ---

    async uploadFinanceBase(type: 'orcado' | 'realizado', file: File, userId: string, versionName: string, competencia?: string): Promise<any> {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('version_name', versionName);
        if (competencia) formData.append('competencia', competencia);

        const response = await apiFetch(`${API_PREFIX}/financeiro/upload/${type}`, {
            method: 'POST',
            headers: { 'user-id': userId },
            body: formData
        });

        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Failed to upload file');
        }
        return response.json();
    },

    async getFinanceBases(type: 'orcado' | 'realizado'): Promise<any[]> {
        const response = await apiFetch(`${API_PREFIX}/financeiro/bases/${type}`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to fetch bases');
        return response.json();
    },

    async deleteFinanceBase(baseId: string, userId: string): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/financeiro/bases/${baseId}`, {
            method: 'DELETE',
            headers: { 'user-id': userId }
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Failed to delete base');
        }
        return response.json();
    },

    async getReportOrcado(baseId?: string, departamento?: string): Promise<any[]> {
        const params = new URLSearchParams();
        if (baseId) params.append('base_id', baseId);
        if (departamento) params.append('departamento', departamento);

        const response = await apiFetch(`${API_PREFIX}/financeiro/report/orcado?${params.toString()}`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to fetch report');
        return response.json();
    },

    async getReportOrcadoRealizado(baseIdOrc?: string, baseIdReal?: string, departamento?: string): Promise<any[]> {
        const params = new URLSearchParams();
        if (baseIdOrc) params.append('base_id_orcado', baseIdOrc);
        if (baseIdReal) params.append('base_id_realizado', baseIdReal);
        if (departamento) params.append('departamento', departamento);

        const response = await apiFetch(`${API_PREFIX}/financeiro/report/orcado-realizado?${params.toString()}`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to fetch report');
        return response.json();
    },

    async getReportDre(baseIdOrc?: string, baseIdReal?: string, departamento?: string): Promise<any[]> {
        const params = new URLSearchParams();
        if (baseIdOrc) params.append('base_id_orcado', baseIdOrc);
        if (baseIdReal) params.append('base_id_realizado', baseIdReal);
        if (departamento) params.append('departamento', departamento);

        const response = await apiFetch(`${API_PREFIX}/financeiro/report/dre?${params.toString()}`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to fetch report');
        return response.json();
    },

    async getPlanoContas(): Promise<any[]> {
        const response = await apiFetch(`${API_PREFIX}/financeiro/plano-contas`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to fetch plano de contas');
        return response.json();
    },

    async getDepartamentos(baseId?: string): Promise<string[]> {
        const params = new URLSearchParams();
        if (baseId) params.append('base_id', baseId);
        const response = await apiFetch(`${API_PREFIX}/financeiro/departamentos?${params.toString()}`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to fetch departamentos');
        return response.json();
    },

    async getJustificativas(baseId: string, month?: string): Promise<any[]> {
        const params = new URLSearchParams();
        params.append('base_id', baseId);
        if (month) params.append('month', month);
        const response = await apiFetch(`${API_PREFIX}/financeiro/justificativas?${params.toString()}`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to fetch justifications');
        return response.json();
    },

    async saveJustificativa(data: { base_id: string, competencia: string, conta_contabil: string, departamento?: string, grupo?: string, justificativa: string, created_by?: string }): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/financeiro/justificativa`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) throw new Error('Failed to save justification');
        return response.json();
    },

    // === Sectors Management ===
    async getSectors(includeInactive: boolean = false): Promise<any[]> {
        const params = includeInactive ? '?include_inactive=true' : '';
        const response = await apiFetch(`${API_PREFIX}/sectors${params}`);
        if (!response.ok) throw new Error('Failed to fetch sectors');
        return response.json();
    },

    async createSector(name: string): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/sectors`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name })
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Failed to create sector');
        }
        return response.json();
    },

    async updateSector(id: number, data: { name?: string, is_active?: boolean }): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/sectors/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Failed to update sector');
        }
        return response.json();
    },

    async deleteSector(id: number): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/sectors/${id}`, {
            method: 'DELETE'
        });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Failed to delete sector');
        }
        return response.json();
    },

    // --- Módulo: Chamados Entre Setores ---

    async getSectorCategories(sector?: string): Promise<any[]> {
        const url = new URL(`${API_PREFIX}/sector-categories`, window.location.origin);
        if (sector) url.searchParams.append('sector', sector);
        const response = await apiFetch(url.toString(), { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to fetch sector categories');
        return response.json();
    },

    async createSectorCategory(sector: string, name: string, min_chars: number = 0): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/sector-categories`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ sector, name, min_chars })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Failed to create category');
        }
        return response.json();
    },

    async updateSectorCategory(id: string, name: string, min_chars: number = 0): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/sector-categories/${id}`, {
            method: 'PUT',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ sector: '', name, min_chars })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Failed to update category');
        }
        return response.json();
    },

    async deleteSectorCategory(id: string): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/sector-categories/${id}`, {
            method: 'DELETE', headers: getAuthHeaders()
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Failed to delete category');
        }
        return response.json();
    },

    async getSectorSubcategories(categoryId: string): Promise<any[]> {
        const response = await apiFetch(`${API_PREFIX}/sector-categories/${categoryId}/subcategories`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to fetch subcategories');
        return response.json();
    },

    async createSectorSubcategory(categoryId: string, name: string, min_chars: number = 0, require_attachment: boolean = false): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/sector-categories/${categoryId}/subcategories`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ sector: '', name, min_chars, require_attachment })
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Failed to create subcategory');
        }
        return response.json();
    },

    async deleteSectorSubcategory(id: string): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/sector-subcategories/${id}`, {
            method: 'DELETE', headers: getAuthHeaders()
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Failed to delete subcategory');
        }
        return response.json();
    },

    async getInterSectorTickets(): Promise<any[]> {
        const response = await apiFetch(`${API_PREFIX}/inter-sector-tickets`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to fetch inter-sector tickets');
        return response.json();
    },

    async createInterSectorTicket(data: {
        title: string; description: string; category: string;
        priority: string; target_sector: string; requester_id: string;
        subcategory?: string;
    }, files?: File[]): Promise<any> {
        const formData = new FormData();
        formData.append('title', data.title);
        formData.append('description', data.description);
        formData.append('category', data.category);
        if (data.subcategory) formData.append('subcategory', data.subcategory);
        formData.append('priority', data.priority);
        formData.append('target_sector', data.target_sector);
        formData.append('requester_id', data.requester_id);
        if (files && files.length > 0) {
            files.forEach(file => formData.append('files', file));
        }
        const response = await apiFetch(`${API_PREFIX}/inter-sector-tickets`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: formData,
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Failed to create inter-sector ticket');
        }
        return response.json();
    },

    async getInterSectorTicket(id: string): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/inter-sector-tickets/${id}`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to fetch inter-sector ticket');
        return response.json();
    },

    async updateInterSectorTicket(id: string, data: Partial<{
        title: string; description: string; category: string;
        priority: string; status: string; delivery_forecast: string;
    }>): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/inter-sector-tickets/${id}`, {
            method: 'PUT',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Failed to update inter-sector ticket');
        }
        return response.json();
    },

    async deleteInterSectorTicket(id: string): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/inter-sector-tickets/${id}`, {
            method: 'DELETE', headers: getAuthHeaders()
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Failed to delete inter-sector ticket');
        }
        return response.json();
    },

    async getInterSectorTicketUpdates(ticketId: string): Promise<any[]> {
        const response = await apiFetch(`${API_PREFIX}/inter-sector-tickets/${ticketId}/updates`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to fetch updates');
        return response.json();
    },

    async addInterSectorTicketUpdate(ticketId: string, message: string, userId: string, file?: File | File[]): Promise<any> {
        const formData = new FormData();
        formData.append('message', message);
        formData.append('user_id_form', userId);
        if (file) {
            const list = Array.isArray(file) ? file : [file];
            list.forEach(f => formData.append('files', f));
        }
        const response = await apiFetch(`${API_PREFIX}/inter-sector-tickets/${ticketId}/updates`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: formData
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Failed to add update');
        }
        return response.json();
    },

    async getInterSectorSectors(): Promise<{ allowed_sectors: string[], allowed_users: { id: string, name: string, sector: string, role: string }[] }> {
        const response = await apiFetch(`${API_PREFIX}/inter-sector-sectors`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Failed to fetch inter-sector sectors');
        return response.json();
    },

    async forwardInterSectorTicket(ticketId: string, sector: string): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/inter-sector-tickets/${ticketId}/forward`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ sector }),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao reencaminhar chamado.');
        }
        return response.json();
    },

    async getInterSectorParticipants(ticketId: string): Promise<any[]> {
        const response = await apiFetch(`${API_PREFIX}/inter-sector-tickets/${ticketId}/participants`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Falha ao buscar participantes');
        return response.json();
    },

    async addInterSectorParticipant(ticketId: string, userId: string): Promise<{ message: string }> {
        const response = await apiFetch(`${API_PREFIX}/inter-sector-tickets/${ticketId}/participants`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: userId }),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Falha ao adicionar participante');
        }
        return response.json();
    },

    async removeInterSectorParticipant(ticketId: string, userId: string): Promise<{ message: string }> {
        const response = await apiFetch(`${API_PREFIX}/inter-sector-tickets/${ticketId}/participants/${userId}`, { method: 'DELETE', headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Falha ao remover participante');
        return response.json();
    },

    // --- Torre S&OP (Fábrica) ---
    async getSopDashboardData(refresh: boolean = false): Promise<any> {
        const url = `${API_PREFIX}/sop-dashboard/data${refresh ? '?refresh=1' : ''}`;
        const response = await apiFetch(url, { headers: getAuthHeaders() });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao carregar dados do S&OP.');
        }
        return response.json();
    },

    async gerarPlanoProducao(hoje?: string, timeLimit: number = 300): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/fabrica/plano-producao/gerar`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ hoje, time_limit: timeLimit }),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao gerar plano de producao.');
        }
        return response.json();
    },

    async listarVersoesPlanoProducao(): Promise<any[]> {
        const response = await apiFetch(`${API_PREFIX}/fabrica/plano-producao/versoes`, {
            headers: getAuthHeaders(),
        });
        if (!response.ok) throw new Error('Erro ao listar versoes do plano.');
        return response.json();
    },

    async obterVersaoPlanoProducao(id: string): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/fabrica/plano-producao/versoes/${id}`, {
            headers: getAuthHeaders(),
        });
        if (!response.ok) throw new Error('Erro ao obter versao.');
        return response.json();
    },

    async getOficiaisEmUso(): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/programacao/oficiais-uso`, { headers: getAuthHeaders() });
        if (!response.ok) throw new Error('Erro ao consultar uso das versões.');
        return response.json();
    },

    async marcarVersaoOficial(id: string, oficial: boolean): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/fabrica/plano-producao/versoes/${id}/oficial`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
            body: JSON.stringify({ oficial }),
        });
        if (!response.ok) { const e = await response.json().catch(() => ({})); throw new Error(e.detail || 'Erro ao marcar oficial.'); }
        return response.json();
    },

    getPlanoProducaoXlsxUrl(id: string): string {
        return `${API_PREFIX}/fabrica/plano-producao/versoes/${id}/xlsx`;
    },

    async otimizadorFaturamento(versaoId?: string, refresh: boolean = false): Promise<any> {
        const params = new URLSearchParams();
        if (versaoId) params.set('versao_id', versaoId);
        if (refresh) params.set('refresh', 'true');
        const qs = params.toString() ? `?${params.toString()}` : '';
        const response = await apiFetch(`${API_PREFIX}/fabrica/otimizador-faturamento${qs}`, {
            headers: getAuthHeaders(),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao carregar faturamento.');
        }
        return response.json();
    },

    async enviarPlanoProducaoWhatsApp(versaoId: string, numero: string): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/fabrica/plano-producao/versoes/${versaoId}/enviar-whatsapp`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ numero }),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao enviar pelo WhatsApp.');
        }
        return response.json();
    },

    async listarNumerosWhatsApp(): Promise<any[]> {
        const response = await apiFetch(`${API_PREFIX}/admin/whatsapp/numeros`, {
            headers: getAuthHeaders(),
        });
        if (!response.ok) throw new Error('Erro ao listar numeros autorizados.');
        return response.json();
    },

    async criarNumeroWhatsApp(numero: string, descricao?: string, ativo: boolean = true): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/admin/whatsapp/numeros`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ numero, descricao, ativo }),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao cadastrar numero.');
        }
        return response.json();
    },

    async atualizarNumeroWhatsApp(id: number, body: { descricao?: string; ativo?: boolean }): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/admin/whatsapp/numeros/${id}`, {
            method: 'PATCH',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao atualizar numero.');
        }
        return response.json();
    },

    async listarNumerosAtivosWhatsApp(): Promise<{ id: number; numero: string; descricao: string | null }[]> {
        const response = await apiFetch(`${API_PREFIX}/admin/whatsapp/numeros/ativos`, {
            headers: getAuthHeaders(),
        });
        if (!response.ok) throw new Error('Erro ao listar numeros ativos.');
        return response.json();
    },

    async enviarSopDashboardWhatsAppInterativo(numero: string, buckets: {
        db_main: any[]; db_drill: Record<string, any>; db_ai: any[];
        db_aging: any[]; db_late: any[]; periods: any[];
        kpis_topo: any; total_late_vol: number; total_backlog_vol: number;
        current_year: number; current_month: number;
    }): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/sop-dashboard/enviar-whatsapp-interativo`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ numero, ...buckets }),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao enviar SopDashboard interativo.');
        }
        return response.json();
    },

    async enviarSopDashboardWhatsApp(payload: {
        numero: string;
        caption: string;
        filename: string;
        mimetype: string;
        data_base64: string;
    }): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/sop-dashboard/enviar-whatsapp`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao enviar SopDashboard pelo WhatsApp.');
        }
        return response.json();
    },

    async enviarImportacaoWhatsApp(numero: string): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/importation/enviar-whatsapp`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ numero }),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao enviar Importacao pelo WhatsApp.');
        }
        return response.json();
    },

    async removerNumeroWhatsApp(id: number): Promise<any> {
        const response = await apiFetch(`${API_PREFIX}/admin/whatsapp/numeros/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
        });
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao remover numero.');
        }
        return response.json();
    },

    // ===== Importação v2 =====
    async importacaoV2Defaults(): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/defaults`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error('Erro ao carregar defaults da Importação v2');
        return r.json();
    },

    async importacaoV2Calculate(body: {
        codigos?: string[];
        qtd_meses: number;
        modo: 'corrido' | 'vendas';
        lead_time_default: number;
        nivel_servico_default: number;
        threshold_sigma: number;
        overrides: Record<string, { lead_time?: number; nivel_servico?: number; pipeline?: number }>;
    }): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/calculate`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao calcular Importação v2');
        }
        return r.json();
    },

    async importacaoV2ListarModelos(): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/modelos`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error('Erro ao listar modelos');
        return r.json();
    },

    async importacaoV2SalvarModelo(body: {
        nome: string;
        codigos: string[];
        qtd_meses: number;
        modo: 'corrido' | 'vendas';
        overrides: Record<string, any>;
        threshold_sigma: number;
    }): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/modelos`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao salvar modelo');
        }
        return r.json();
    },

    async importacaoV2ExcluirModelo(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/modelos/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
        });
        if (!r.ok) throw new Error('Erro ao excluir modelo');
        return r.json();
    },

    // Versões (histórico)
    async importacaoV2LabelsPadrao(): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/labels-padrao`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error('Erro ao carregar labels padrão');
        return r.json();
    },

    async importacaoV2ListarVersoes(): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/versoes`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error('Erro ao listar versões');
        return r.json();
    },

    async importacaoV2CarregarVersao(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/versoes/${id}`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error('Erro ao carregar versão');
        return r.json();
    },

    async importacaoV2SalvarVersao(body: {
        nome: string;
        labels: string[];
        observacao?: string;
        parametros: Record<string, any>;
        resultado: Record<string, any>;
    }): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/versoes`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao salvar versão');
        }
        return r.json();
    },

    async importacaoV2ExcluirVersao(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/versoes/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao excluir versão');
        }
        return r.json();
    },

    async importacaoV2BaixarXlsx(parametros: any, itens: any[]): Promise<void> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/gerar-xlsx`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ parametros, itens }),
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao gerar Excel');
        }
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `Importacao_v2_${new Date().toISOString().slice(0, 10)}.xlsx`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    },

    async importacaoV2ListarMoq(): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/moq`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error('Erro ao listar MOQ');
        return r.json();
    },

    async importacaoV2SalvarMoq(codigo: string, body: {
        descricao?: string; moq: number; codigo: string;
        unit_ctn?: number; cbm?: number; gw?: number; nw?: number;
        comprimento?: number; largura?: number; altura?: number;
        price?: number; ncm?: string; unit?: string;
    }): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/moq/${encodeURIComponent(codigo)}`, {
            method: 'PUT',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!r.ok) {
            const e = await r.json().catch(() => ({}));
            throw new Error(e.detail || 'Erro ao salvar MOQ');
        }
        return r.json();
    },

    async importacaoV2ExcluirMoq(codigo: string): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/moq/${encodeURIComponent(codigo)}`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
        });
        if (!r.ok) {
            const e = await r.json().catch(() => ({}));
            throw new Error(e.detail || 'Erro ao excluir MOQ');
        }
        return r.json();
    },

    async importacaoV2UploadMoq(file: File): Promise<any> {
        // Lê o xlsx no navegador e envia só os dados parseados (evita upload de arquivos grandes com imagens)
        const XLSX = await import('xlsx');
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: 'array' });
        if (wb.SheetNames.length > 1) {
            throw new Error(`A planilha tem ${wb.SheetNames.length} abas (${wb.SheetNames.join(', ')}). Deixe apenas 1 aba com os dados de MOQ.`);
        }
        const ws = wb.Sheets[wb.SheetNames[0]];
        const aoa: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false });
        if (aoa.length < 2) throw new Error('Planilha vazia ou sem dados.');
        const headers = (aoa[0] || []).map((h: any) => String(h ?? '').trim());
        // Remove acentos + lowercase + tira espaços/pontuação (robustez entre encodings/maquinas)
        const norm = (s: string) => s
            .normalize('NFD').replace(/[̀-ͯ]/g, '')
            .toLowerCase()
            .replace(/[\s_/.\-º°"']/g, '');
        const findIdx = (opts: Set<string>) => headers.findIndex(h => opts.has(norm(h)));
        const idxCod = findIdx(new Set(['itemno', 'item', 'codigo', 'cod', 'codigoblackd', 'codblackd', 'codprod', 'codproduto', 'codigoproduto', 'sku']));
        const idxMoq = findIdx(new Set(['moq', 'lotemin', 'loteminimo', 'qtdmin', 'qtdminima', 'minorderquantity']));
        const idxDesc = findIdx(new Set(['description', 'descricao', 'descricaoproduto', 'descricaodoproduto']));
        // Campos adicionais (todos opcionais)
        const idxUnitCtn = findIdx(new Set(['unitctn', 'unitsctn', 'unidadescaixa', 'pcsctn', 'undcaixa']));
        const idxCbm = findIdx(new Set(['cbm', 'volumecbm', 'cbmun']));
        const idxGw = findIdx(new Set(['gw', 'gwkg', 'pesobruto', 'pesobrutoun', 'pesobrutokg']));
        const idxNw = findIdx(new Set(['nw', 'nwkg', 'pesoliquido', 'pesoliquidoun', 'pesoliquidokg']));
        const idxL = findIdx(new Set(['l', 'comprimento']));
        const idxW = findIdx(new Set(['w', 'largura']));
        const idxH = findIdx(new Set(['h', 'altura']));
        const idxPrice = findIdx(new Set(['uprice', 'price', 'preco', 'unitprice', 'precounitario']));
        const idxNcm = findIdx(new Set(['ncm']));
        const idxUnit = findIdx(new Set(['unit', 'unidade']));
        // Campos extras da planilha completa (moq.xlsx)
        const idxBarcode = findIdx(new Set(['barcodenumber', 'barcode', 'codbarras', 'codigodebarras', 'ean']));
        const idxNameCn  = findIdx(new Set(['name', 'nomecn', 'nomechines']));
        const idxRemark  = findIdx(new Set(['remark', 'remarks']));
        const idxObs     = findIdx(new Set(['obs']));
        const idxObserv  = findIdx(new Set(['observacoes', 'observacao', 'observacoes1303', 'observacao1303']));
        const idxEngDesc = findIdx(new Set(['englishdescription', 'engdescription', 'descriptionen']));
        const idxCtns    = findIdx(new Set(['ctns', 'cartons', 'cxs']));
        const idxQty     = findIdx(new Set(['qty', 'quantity', 'quantidade']));
        const idxAmount  = findIdx(new Set(['amount', 'valortotal', 'total']));
        const idxCbmTot  = findIdx(new Set(['cbmtotal']));
        const idxTgw     = findIdx(new Set(['tgw', 'totalgw', 'totalgrossweight']));
        const idxTnw     = findIdx(new Set(['tnw', 'totalnw', 'totalnetweight']));
        if (idxCod < 0) throw new Error(`Coluna de código não encontrada. Cabeçalhos: ${headers.join(', ')}`);

        const items: Array<{ codigo: string; descricao?: string; moq: number;
            unit_ctn?: number; cbm?: number; gw?: number; nw?: number;
            comprimento?: number; largura?: number; altura?: number;
            price?: number; ncm?: string; unit?: string;
            barcode?: string; name_cn?: string; remark?: string; obs?: string;
            observacoes?: string; english_description?: string;
            ctns?: number; qty?: number; amount?: number;
            cbm_total?: number; tgw?: number; tnw?: number; }> = [];
        // Aceita zero/negativo — só descarta valor inválido (NaN)
        const cleanNum = (v: any): number | undefined => {
            if (v == null || v === '') return undefined;
            const n = Number(v);
            return isFinite(n) ? n : undefined;
        };
        const cleanStr = (idx: number, row: any[]): string | undefined => {
            if (idx < 0) return undefined;
            const v = row[idx];
            if (v == null) return undefined;
            const s = String(v).trim();
            return s || undefined;
        };
        for (let i = 1; i < aoa.length; i++) {
            const row = aoa[i] || [];
            const rawCod = row[idxCod];
            if (rawCod == null || rawCod === '') continue;
            // MOQ vazio/inválido vira 0 — todas as linhas com ITEM NO entram
            let moq = idxMoq >= 0 ? Number(row[idxMoq]) : 0;
            if (!isFinite(moq) || moq < 0) moq = 0;
            let cod = String(rawCod).trim();
            if (cod.endsWith('.0')) cod = cod.slice(0, -2);
            const desc = idxDesc >= 0 ? String(row[idxDesc] ?? '').trim() : '';
            items.push({
                codigo: cod, descricao: desc || undefined, moq,
                unit_ctn:    idxUnitCtn >= 0 ? cleanNum(row[idxUnitCtn]) : undefined,
                cbm:         idxCbm     >= 0 ? cleanNum(row[idxCbm])     : undefined,
                gw:          idxGw      >= 0 ? cleanNum(row[idxGw])      : undefined,
                nw:          idxNw      >= 0 ? cleanNum(row[idxNw])      : undefined,
                comprimento: idxL       >= 0 ? cleanNum(row[idxL])       : undefined,
                largura:     idxW       >= 0 ? cleanNum(row[idxW])       : undefined,
                altura:      idxH       >= 0 ? cleanNum(row[idxH])       : undefined,
                price:       idxPrice   >= 0 ? cleanNum(row[idxPrice])   : undefined,
                ncm:         cleanStr(idxNcm, row),
                unit:        cleanStr(idxUnit, row),
                barcode:             cleanStr(idxBarcode, row),
                name_cn:             cleanStr(idxNameCn,  row),
                remark:              cleanStr(idxRemark,  row),
                obs:                 cleanStr(idxObs,     row),
                observacoes:         cleanStr(idxObserv,  row),
                english_description: cleanStr(idxEngDesc, row),
                ctns:      idxCtns   >= 0 ? cleanNum(row[idxCtns])   : undefined,
                qty:       idxQty    >= 0 ? cleanNum(row[idxQty])    : undefined,
                amount:    idxAmount >= 0 ? cleanNum(row[idxAmount]) : undefined,
                cbm_total: idxCbmTot >= 0 ? cleanNum(row[idxCbmTot]) : undefined,
                tgw:       idxTgw    >= 0 ? cleanNum(row[idxTgw])    : undefined,
                tnw:       idxTnw    >= 0 ? cleanNum(row[idxTnw])    : undefined,
            });
        }
        if (items.length === 0) throw new Error('Nenhuma linha com ITEM NO encontrada.');

        const r = await apiFetch(`${API_PREFIX}/importation-v2/moq/bulk`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ items }),
        });
        if (!r.ok) {
            const e = await r.json().catch(() => ({}));
            throw new Error(e.detail || 'Erro no upload');
        }
        const result = await r.json();
        return { ...result, aba: wb.SheetNames[0] };
    },

    async importacaoV2SugestaoContainer(body: {
        items: Array<{ codigo: string; descricao?: string; qtd: number }>;
        tipo: string;
        capacidade_custom?: number;
    }): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/containers`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao calcular sugestão de container');
        }
        return r.json();
    },

    async importacaoV2ListarOrderLists(): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/order-lists`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error('Erro ao listar order lists');
        return r.json();
    },

    async importacaoV2CarregarOrderList(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/order-lists/${id}`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error('Erro ao carregar order list');
        return r.json();
    },

    async importacaoV2SalvarOrderList(body: {
        nome: string; labels: string[]; observacao?: string;
        items: Array<{ codigo: string; qty: number; data?: string }>;
        datas_chegada: Record<string, string>;
    }): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/order-lists`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao salvar order list');
        }
        return r.json();
    },

    async importacaoV2ExcluirOrderList(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/order-lists/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao excluir order list');
        }
        return r.json();
    },

    async importacaoV2ListarContainerModelos(): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/container-modelos`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error('Erro ao listar modelos');
        return r.json();
    },
    async importacaoV2SalvarContainerModelo(body: { nome: string; tipo_container: string; capacidade_cbm: number; containers: any[] }): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/container-modelos`, {
            method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!r.ok) throw new Error('Erro ao salvar modelo');
        return r.json();
    },
    async importacaoV2CarregarContainerModelo(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/container-modelos/${id}`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error('Erro ao carregar modelo');
        return r.json();
    },
    async importacaoV2ExcluirContainerModelo(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/container-modelos/${id}`, {
            method: 'DELETE', headers: getAuthHeaders(),
        });
        if (!r.ok) throw new Error('Erro ao excluir modelo');
        return r.json();
    },

    async importacaoV2EnviarWhatsApp(numero: string, parametros: any, itens: any[], mensagem?: string): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/importation-v2/enviar-whatsapp`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ numero, parametros, itens, mensagem }),
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao enviar via WhatsApp');
        }
        return r.json();
    },

    // ===== RH · Colaboradores =====
    async rhColaboradoresListar(filtros: { search?: string; setor?: string; status?: string; tipo?: string } = {}): Promise<any> {
        const qs = new URLSearchParams();
        Object.entries(filtros).forEach(([k, v]) => { if (v) qs.set(k, String(v)); });
        const r = await apiFetch(`${API_PREFIX}/rh/colaboradores${qs.toString() ? '?' + qs : ''}`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao listar colaboradores');
        return r.json();
    },
    async rhColaboradorObter(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/colaboradores/${id}`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao obter colaborador');
        return r.json();
    },
    async rhColaboradorCriar(payload: any): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/colaboradores`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao criar colaborador');
        return r.json();
    },
    async rhColaboradorAtualizar(id: number, payload: any): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/colaboradores/${id}`, {
            method: 'PUT',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao atualizar colaborador');
        return r.json();
    },
    async rhColaboradorRemover(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/colaboradores/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao remover colaborador');
        return r.json();
    },
    async rhColaboradorObterAcessos(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/colaboradores/${id}/acessos`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhColaboradorAtualizarAcessos(id: number, payload: any): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/colaboradores/${id}/acessos`, {
            method: 'PUT', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhEquipamentosTipos(): Promise<{ tipos: string[] }> {
        const r = await apiFetch(`${API_PREFIX}/rh/equipamentos/_meta/tipos`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhColaboradorUploadFoto(id: number, file: File): Promise<any> {
        const fd = new FormData();
        fd.append('arquivo', file);
        const r = await apiFetch(`${API_PREFIX}/rh/colaboradores/${id}/foto`, { method: 'POST', headers: getAuthHeaders(), body: fd });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao subir foto');
        return r.json();
    },
    async rhColaboradoresDistinct(): Promise<{ setores: string[]; cargos: string[]; tipos: string[] }> {
        const r = await apiFetch(`${API_PREFIX}/rh/colaboradores/_meta/distinct`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao carregar metadados');
        return r.json();
    },

    // ===== RH · Recrutamento =====
    async rhVagasListar(filtros: { search?: string; setor?: string; status?: string } = {}): Promise<any> {
        const qs = new URLSearchParams();
        Object.entries(filtros).forEach(([k, v]) => { if (v) qs.set(k, String(v)); });
        const r = await apiFetch(`${API_PREFIX}/rh/recrutamento/vagas${qs.toString() ? '?' + qs : ''}`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao listar vagas');
        return r.json();
    },
    async rhVagaObter(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/recrutamento/vagas/${id}`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao obter vaga');
        return r.json();
    },
    async rhVagaCriar(payload: any): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/recrutamento/vagas`, {
            method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao criar vaga');
        return r.json();
    },
    async rhVagaAtualizar(id: number, payload: any): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/recrutamento/vagas/${id}`, {
            method: 'PUT', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao atualizar vaga');
        return r.json();
    },
    async rhVagaFechar(id: number, motivo?: string): Promise<any> {
        const qs = motivo ? `?motivo=${encodeURIComponent(motivo)}` : '';
        const r = await apiFetch(`${API_PREFIX}/rh/recrutamento/vagas/${id}/fechar${qs}`, {
            method: 'POST', headers: getAuthHeaders(),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao fechar vaga');
        return r.json();
    },
    async rhVagaRemover(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/recrutamento/vagas/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao remover vaga');
        return r.json();
    },
    async rhCandidatosListar(vagaId: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/recrutamento/vagas/${vagaId}/candidatos`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao listar candidatos');
        return r.json();
    },
    async rhCandidatoCriar(payload: any): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/recrutamento/candidatos`, {
            method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao criar candidato');
        return r.json();
    },
    async rhCandidatoAtualizar(id: number, payload: any): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/recrutamento/candidatos/${id}`, {
            method: 'PUT', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao atualizar candidato');
        return r.json();
    },
    async rhCandidatoRemover(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/recrutamento/candidatos/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao remover candidato');
        return r.json();
    },

    // ===== RH · Documentos =====
    async rhModelosListar(filtros: { search?: string; categoria?: string; ativo?: boolean } = {}): Promise<any> {
        const qs = new URLSearchParams();
        Object.entries(filtros).forEach(([k, v]) => { if (v !== undefined && v !== '') qs.set(k, String(v)); });
        const r = await apiFetch(`${API_PREFIX}/rh/documentos/modelos${qs.toString() ? '?' + qs : ''}`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao listar modelos');
        return r.json();
    },
    async rhModeloCriar(payload: any): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/documentos/modelos`, {
            method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao criar modelo');
        return r.json();
    },
    async rhModeloAtualizar(id: number, payload: any): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/documentos/modelos/${id}`, {
            method: 'PUT', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao atualizar modelo');
        return r.json();
    },
    async rhModeloRemover(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/documentos/modelos/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao remover modelo');
        return r.json();
    },
    async rhModelosUploadLote(files: File[]): Promise<any> {
        const fd = new FormData();
        files.forEach((f) => fd.append('arquivos', f));
        const r = await apiFetch(`${API_PREFIX}/rh/documentos/modelos/upload-lote`, { method: 'POST', headers: getAuthHeaders(), body: fd });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao subir lote');
        return r.json();
    },
    async rhModeloUploadArquivo(id: number, file: File): Promise<any> {
        const fd = new FormData();
        fd.append('arquivo', file);
        const r = await apiFetch(`${API_PREFIX}/rh/documentos/modelos/${id}/upload`, { method: 'POST', headers: getAuthHeaders(), body: fd });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao subir arquivo');
        return r.json();
    },
    rhModeloDownloadUrl(id: number): string {
        return `${API_PREFIX}/rh/documentos/modelos/${id}/download`;
    },
    async rhMovEquipamentosColab(colaboradorId: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/movimentacoes/equipamentos/${colaboradorId}`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao buscar equipamentos');
        return r.json();
    },
    async rhDocumentosListar(filtros: { colaborador_id?: number; modelo_id?: number; status?: string } = {}): Promise<any> {
        const qs = new URLSearchParams();
        Object.entries(filtros).forEach(([k, v]) => { if (v !== undefined && v !== '') qs.set(k, String(v)); });
        const r = await apiFetch(`${API_PREFIX}/rh/documentos${qs.toString() ? '?' + qs : ''}`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao listar documentos');
        return r.json();
    },
    async rhDocumentoCriar(payload: any): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/documentos`, {
            method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao criar documento');
        return r.json();
    },
    async rhDocumentoAtualizar(id: number, payload: any): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/documentos/${id}`, {
            method: 'PUT', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao atualizar documento');
        return r.json();
    },
    async rhDocumentoRemover(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/documentos/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro ao remover documento');
        return r.json();
    },

    // ===== RH · Jornada =====
    async rhBHListar(filtros: { colaborador_id?: number; mes?: string; status?: string; tipo?: string } = {}): Promise<any> {
        const qs = new URLSearchParams();
        Object.entries(filtros).forEach(([k, v]) => { if (v !== undefined && v !== '') qs.set(k, String(v)); });
        const r = await apiFetch(`${API_PREFIX}/rh/jornada/banco-horas${qs.toString() ? '?' + qs : ''}`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhBHCriar(payload: any): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/jornada/banco-horas`, { method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhBHAtualizar(id: number, payload: any): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/jornada/banco-horas/${id}`, { method: 'PUT', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhBHAprovar(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/jornada/banco-horas/${id}/aprovar`, { method: 'POST', headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhBHRejeitar(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/jornada/banco-horas/${id}/rejeitar`, { method: 'POST', headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhBHRemover(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/jornada/banco-horas/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhFeriasListar(filtros: { colaborador_id?: number; ano?: number; status?: string } = {}): Promise<any> {
        const qs = new URLSearchParams();
        Object.entries(filtros).forEach(([k, v]) => { if (v !== undefined && v !== '') qs.set(k, String(v)); });
        const r = await apiFetch(`${API_PREFIX}/rh/jornada/ferias${qs.toString() ? '?' + qs : ''}`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhFeriasCriar(payload: any): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/jornada/ferias`, { method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhFeriasAtualizar(id: number, payload: any): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/jornada/ferias/${id}`, { method: 'PUT', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhFeriasAprovar(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/jornada/ferias/${id}/aprovar`, { method: 'POST', headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhFeriasRejeitar(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/jornada/ferias/${id}/rejeitar`, { method: 'POST', headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhFeriasRemover(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/jornada/ferias/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },

    // ===== RH · Movimentações =====
    async rhMovListar(filtros: { tipo?: string; status?: string; colaborador_id?: number; search?: string } = {}): Promise<any> {
        const qs = new URLSearchParams();
        Object.entries(filtros).forEach(([k, v]) => { if (v !== undefined && v !== '') qs.set(k, String(v)); });
        const r = await apiFetch(`${API_PREFIX}/rh/movimentacoes${qs.toString() ? '?' + qs : ''}`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhMovObter(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/movimentacoes/${id}`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhMovCriar(payload: any): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/movimentacoes`, { method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhMovAtualizar(id: number, payload: any): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/movimentacoes/${id}`, { method: 'PUT', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhMovAprovar(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/movimentacoes/${id}/aprovar`, { method: 'POST', headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhMovRejeitar(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/movimentacoes/${id}/rejeitar`, { method: 'POST', headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhMovRemover(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/movimentacoes/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },

    // ===== RH · Config =====
    async rhSindicatosListar(): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/config/sindicatos`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhSindicatoCriar(payload: any): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/config/sindicatos`, { method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhSindicatoAtualizar(id: number, payload: any): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/config/sindicatos/${id}`, { method: 'PUT', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhSindicatoRemover(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/config/sindicatos/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhParametrosListar(): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/config/parametros`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    // ===== RH · Equipamentos (TI) =====
    async rhEquipamentosPorColaborador(filtros: { search?: string; tipo?: string } = {}): Promise<any> {
        const qs = new URLSearchParams();
        Object.entries(filtros).forEach(([k, v]) => { if (v) qs.set(k, String(v)); });
        const r = await apiFetch(`${API_PREFIX}/rh/equipamentos/por-colaborador${qs.toString() ? '?' + qs : ''}`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhEquipamentoHistorico(eqId: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/equipamentos/${eqId}/historico`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhEquipamentoCredenciais(eqId: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/equipamentos/${eqId}/credenciais`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhEquipamentosColabDetalhe(cid: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/equipamentos/colaborador/${cid}/detalhe`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhClearDummy(): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/_dev/clear-dummy`, { method: 'POST', headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhEquipamentosListar(filtros: { tipo?: string; status?: string; colaborador_id?: number; search?: string } = {}): Promise<any> {
        const qs = new URLSearchParams();
        Object.entries(filtros).forEach(([k, v]) => { if (v !== undefined && v !== '') qs.set(k, String(v)); });
        const r = await apiFetch(`${API_PREFIX}/rh/equipamentos${qs.toString() ? '?' + qs : ''}`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhEquipamentoCriar(payload: any): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/equipamentos`, { method: 'POST', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhEquipamentoAtualizar(id: number, payload: any): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/equipamentos/${id}`, { method: 'PUT', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhEquipamentoAtribuir(eqId: number, colabId: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/equipamentos/${eqId}/atribuir/${colabId}`, { method: 'POST', headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhEquipamentoDevolver(eqId: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/equipamentos/${eqId}/devolver`, { method: 'POST', headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhEquipamentoRemover(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/equipamentos/${id}`, { method: 'DELETE', headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },

    async rhParametroAtualizar(chave: string, payload: any): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/config/parametros/${chave}`, { method: 'PUT', headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhAuditListar(entidade: string, eid: string | number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/audit/${entidade}/${eid}`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },
    async rhSeedDummy(): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/rh/_dev/seed-dummy`, { method: 'POST', headers: getAuthHeaders() });
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Erro');
        return r.json();
    },

    async simuladorImportacaoCambio(): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/simulador-importacao/cambio`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error('Erro ao buscar cotação');
        return r.json();
    },

    async simuladorImportacaoAtualizarCambio(): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/simulador-importacao/cambio/atualizar`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao atualizar cotação');
        }
        return r.json();
    },

    async simuladorImportacaoItens(): Promise<any[]> {
        const r = await apiFetch(`${API_PREFIX}/simulador-importacao/itens`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error('Erro ao carregar itens do catálogo');
        return r.json();
    },

    async simuladorImportacaoListarSimulacoes(): Promise<any[]> {
        const r = await apiFetch(`${API_PREFIX}/simulador-importacao/simulacoes`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error('Erro ao listar simulacoes');
        return r.json();
    },

    async simuladorImportacaoCarregarSimulacao(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/simulador-importacao/simulacoes/${id}`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error('Erro ao carregar simulacao');
        return r.json();
    },

    async simuladorImportacaoSalvarSimulacao(body: any): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/simulador-importacao/simulacoes`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao salvar simulacao');
        }
        return r.json();
    },

    async simuladorImportacaoExcluirSimulacao(id: number): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/simulador-importacao/simulacoes/${id}`, {
            method: 'DELETE',
            headers: getAuthHeaders(),
        });
        if (!r.ok) throw new Error('Erro ao excluir simulacao');
        return r.json();
    },

    // ===== Fábrica · Estrutura de Produtos =====
    async estruturaUpload(arquivo: File): Promise<{ versao_id: number; arquivo_nome: string; total_linhas: number }> {
        const fd = new FormData();
        fd.append('arquivo', arquivo);
        const r = await apiFetch(`${API_PREFIX}/maquinas/estrutura/upload`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: fd,
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao enviar base de estrutura');
        }
        return r.json();
    },

    async estruturaVersoes(): Promise<{ versoes: { id: number; arquivo_nome: string; total_linhas: number; enviado_em: string; enviado_por_nome: string }[] }> {
        const r = await apiFetch(`${API_PREFIX}/maquinas/estrutura/versoes`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error('Erro ao listar versões da estrutura');
        return r.json();
    },

    async removerUsoComponente(payload: { versao_id: string; cod_item: string; cod_componente: string }): Promise<any> {
        const params = new URLSearchParams();
        params.set('versao_id', String(payload.versao_id));
        params.set('cod_item', String(payload.cod_item));
        params.set('cod_componente', String(payload.cod_componente));
        const r = await apiFetch(`${API_PREFIX}/programacao/uso-componente?${params.toString()}`, {
            method: 'DELETE',
            headers: { ...getAuthHeaders() },
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao remover uso de componente');
        }
        return r.json();
    },

    async estruturaBuscarItem(q: string, limite: number = 15): Promise<any> {
        const params = new URLSearchParams({ q, limite: String(limite) });
        const r = await apiFetch(`${API_PREFIX}/maquinas/estrutura/buscar-item?${params.toString()}`, { headers: getAuthHeaders() });
        if (!r.ok) throw new Error('Erro ao buscar item');
        return r.json();
    },

    async estruturaProduto(cod: string, versaoId?: number): Promise<any> {
        const params = new URLSearchParams();
        if (versaoId !== undefined && versaoId !== null) params.set('versao_id', String(versaoId));
        const qs = params.toString() ? `?${params.toString()}` : '';
        const r = await apiFetch(`${API_PREFIX}/maquinas/estrutura/produto/${encodeURIComponent(cod)}${qs}`, { headers: getAuthHeaders() });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao buscar estrutura do produto');
        }
        return r.json();
    },

    async getUsoComponentes(versaoId: string, codItem: string): Promise<{ itens: { cod_componente: string; descricao: string; tipo_comp: string; qtd_usar: number; maquina_id?: number | null }[] }> {
        const params = new URLSearchParams();
        params.set('versao_id', String(versaoId));
        params.set('cod_item', String(codItem));
        const r = await apiFetch(`${API_PREFIX}/programacao/uso-componentes?${params.toString()}`, { headers: getAuthHeaders() });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao buscar uso de componentes');
        }
        return r.json();
    },

    async salvarUsoComponente(payload: { versao_id: string; cod_item: string; cod_componente: string; descricao?: string; tipo_comp?: string; qtd_usar?: number; maquina_id?: number | null }): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/programacao/uso-componente`, {
            method: 'PUT',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao salvar uso de componente');
        }
        return r.json();
    },

    async gerarExcelProgramacao(payload: any): Promise<Blob> {
        const r = await apiFetch(`${API_PREFIX}/programacao/xlsx`, {
            method: 'POST',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao gerar Excel da programação');
        }
        return r.blob();
    },

    async getTabasSopro(versaoId: string): Promise<{ tabas: { cod_item: string; sequencia: number; cod_componente: string; descricao: string; qtd: number; maquina_id: number; ordem: number; lote: number; inicio: string | null }[] }> {
        const r = await apiFetch(`${API_PREFIX}/programacao/tabas-sopro?versao_id=${encodeURIComponent(versaoId)}`, { headers: getAuthHeaders() });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao buscar tabas do Sopro');
        }
        return r.json();
    },

    async salvarTabasSopro(payload: { versao_id: string; cards: { cod_item: string; sequencia: number; cod_componente: string; descricao?: string; qtd: number; maquina_id: number | null; ordem: number; lote: number; inicio?: string | null }[] }): Promise<{ ok: boolean; total: number }> {
        const r = await apiFetch(`${API_PREFIX}/programacao/tabas-sopro`, {
            method: 'PUT',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao salvar tabas do Sopro');
        }
        return r.json();
    },

    async getUsoTabas(versaoId: string): Promise<{ itens: { cod_item: string; cod_componente: string; qtd_usar: number | null; maquina_id: number | null }[] }> {
        const r = await apiFetch(`${API_PREFIX}/programacao/uso-tabas?versao_id=${encodeURIComponent(versaoId)}`, { headers: getAuthHeaders() });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao buscar uso de tabas');
        }
        return r.json();
    },

    async estruturaTabas(versaoId?: number): Promise<{ itens: { cod_item: string; cod_componente: string; descricao: string; qtdbase: number }[] }> {
        const qs = (versaoId !== undefined && versaoId !== null) ? `?versao_id=${versaoId}` : '';
        const r = await apiFetch(`${API_PREFIX}/maquinas/estrutura/tabas${qs}`, { headers: getAuthHeaders() });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao buscar tabas da estrutura');
        }
        return r.json();
    },

    async getCalendarioProducao(): Promise<{ config: any; por_maquina?: Record<string, any> }> {
        const r = await apiFetch(`${API_PREFIX}/programacao/calendario`, { headers: getAuthHeaders() });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao buscar calendário de produção');
        }
        return r.json();
    },

    async salvarCalendarioProducao(config: any, maquinaId?: number | null, limpar?: boolean): Promise<any> {
        const r = await apiFetch(`${API_PREFIX}/programacao/calendario`, {
            method: 'PUT',
            headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ config, maquina_id: maquinaId ?? null, limpar: !!limpar }),
        });
        if (!r.ok) {
            const err = await r.json().catch(() => ({}));
            throw new Error(err.detail || 'Erro ao salvar calendário de produção');
        }
        return r.json();
    },

};
